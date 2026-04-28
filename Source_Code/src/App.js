import React, { useState, useEffect } from "react";
import axios from "axios";
import { getContract } from "./contract";
import SHA256 from "crypto-js/sha256";
import "./App.css";

const SESSION_DURATION = 30 * 60 * 1000; // 30 minutes
const PINATA_JWT = process.env.REACT_APP_PINATA_JWT;

function App() {
  const [file, setFile] = useState(null);
  const [hash, setHash] = useState("");
  const [allFiles, setAllFiles] = useState([]);
  const [status, setStatus] = useState({ message: "", type: "" });
  const [loading, setLoading] = useState(false);
  const [account, setAccount] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [fileType, setFileType] = useState("");
  const [currentPage, setCurrentPage] = useState(1);
  const [sessionExpiry, setSessionExpiry] = useState(null);
  const [sessionTimeLeft, setSessionTimeLeft] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [fetchLoading, setFetchLoading] = useState(false);
  const [verifyResult, setVerifyResult] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const FILES_PER_PAGE = 3;

  // ─── Session Timer ───────────────────────────────────────────────
  useEffect(() => {
    const saved = localStorage.getItem("walletSession");
    if (saved) {
      const { account: savedAccount, expiry } = JSON.parse(saved);
      if (Date.now() < expiry) {
        setAccount(savedAccount);
        setIsConnected(true);
        setSessionExpiry(expiry);
        showStatus("Session restored ✅", "success");
      } else {
        localStorage.removeItem("walletSession");
      }
    }
  }, []);

  useEffect(() => {
    if (!sessionExpiry) return;

    const interval = setInterval(() => {
      const remaining = sessionExpiry - Date.now();
      if (remaining <= 0) {
        handleLogout(true);
      } else {
        setSessionTimeLeft(remaining);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [sessionExpiry]);

  // ─── MetaMask Account Change Listener ───────────────────────────
  useEffect(() => {
    if (!window.ethereum) return;

    const handleAccountChange = (accounts) => {
      if (accounts.length === 0) {
        handleLogout(false);
      } else {
        setAccount(accounts[0]);
        updateSession(accounts[0]);
      }
    };

    window.ethereum.on("accountsChanged", handleAccountChange);
    return () => window.ethereum.removeListener("accountsChanged", handleAccountChange);
  }, []);

  // ─── Helpers ─────────────────────────────────────────────────────
  const showStatus = (message, type = "info") => {
    setStatus({ message, type });
    setTimeout(() => setStatus({ message: "", type: "" }), 5000);
  };

  const formatTime = (ms) => {
    if (!ms) return "";
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
  };

  const truncateAddress = (addr) =>
    addr ? `${addr.slice(0, 6)}...${addr.slice(-4)}` : "";

  const updateSession = (acc) => {
    const expiry = Date.now() + SESSION_DURATION;
    localStorage.setItem("walletSession", JSON.stringify({ account: acc, expiry }));
    setSessionExpiry(expiry);
  };

  const getFileIcon = (ext) => {
    const icons = {
      pdf: "📄", doc: "📝", docx: "📝",
      png: "🖼️", jpg: "🖼️", jpeg: "🖼️",
      gif: "🎞️", mp4: "🎬", mp3: "🎵",
      zip: "🗜️", txt: "📃", json: "📋",
      svg: "🎨", xlsx: "📊", pptx: "📊",
    };
    return icons[ext?.toLowerCase()] || "📁";
  };

  const formatFileSize = (bytes) => {
    if (!bytes) return "";
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  // ─── Wallet Connect ──────────────────────────────────────────────
  const connectWallet = async () => {
    if (!window.ethereum) {
      alert("Please install MetaMask to use this app!");
      return;
    }

    try {
      showStatus("Connecting wallet...", "info");
      const { account: acc } = await getContract();

      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0xaa36a7" }],
        });
      } catch (switchError) {
        if (switchError.code === 4902) {
          await window.ethereum.request({
            method: "wallet_addEthereumChain",
            params: [{
              chainId: "0xaa36a7",
              chainName: "Sepolia Test Network",
              rpcUrls: ["https://rpc.sepolia.org"],
              nativeCurrency: { name: "SepoliaETH", symbol: "SepoliaETH", decimals: 18 },
              blockExplorerUrls: ["https://sepolia.etherscan.io"],
            }],
          });
        } else {
          throw switchError;
        }
      }

      setAccount(acc);
      setIsConnected(true);
      updateSession(acc);
      showStatus("Wallet connected successfully ✅", "success");

    } catch (err) {
      console.error(err);
      showStatus(err.code === 4001 ? "Connection rejected by user ❌" : "Connection failed ❌", "error");
    }
  };

  // ─── Logout ──────────────────────────────────────────────────────
  const handleLogout = (isExpired = false) => {
    setAccount("");
    setIsConnected(false);
    setSessionExpiry(null);
    setSessionTimeLeft(null);
    setAllFiles([]);
    setHash("");
    setFile(null);
    setFileType("");
    setCurrentPage(1);
    setVerifyResult(null);
    localStorage.removeItem("walletSession");
    showStatus(
      isExpired ? "Session expired. Please reconnect. ⏰" : "Logged out successfully 👋",
      isExpired ? "warning" : "info"
    );
  };

  // ─── File Handling ───────────────────────────────────────────────
  const handleFileSelect = (selectedFile) => {
    if (!selectedFile) return;
    setFile(selectedFile);
    const ext = selectedFile.name.split(".").pop().toLowerCase();
    setFileType(ext);
    setVerifyResult(null);
    showStatus(`File selected: ${selectedFile.name}`, "info");
  };

  // ─── Upload ──────────────────────────────────────────────────────
  const uploadFile = async () => {
    if (!isConnected) {
      showStatus("Please connect your wallet first 🔐", "warning");
      return;
    }
    if (!file) {
      showStatus("Please select a file first 📁", "warning");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);

    try {
      setLoading(true);
      setUploadProgress(10);
      showStatus("Uploading to IPFS...", "info");

      const res = await axios.post(
        "https://api.pinata.cloud/pinning/pinFileToIPFS",
        formData,
        {
          maxBodyLength: "Infinity",
          headers: {
            "Content-Type": "multipart/form-data",
            Authorization: `Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySW5mb3JtYXRpb24iOnsiaWQiOiI2NDU3NGZmZS01YzY1LTRiOGUtYTUyNS1kMjBhNjQ2ZWVmZjEiLCJlbWFpbCI6ImFkaXR5YWttNTUwMEBnbWFpbC5jb20iLCJlbWFpbF92ZXJpZmllZCI6dHJ1ZSwicGluX3BvbGljeSI6eyJyZWdpb25zIjpbeyJkZXNpcmVkUmVwbGljYXRpb25Db3VudCI6MSwiaWQiOiJGUkExIn0seyJkZXNpcmVkUmVwbGljYXRpb25Db3VudCI6MSwiaWQiOiJOWUMxIn1dLCJ2ZXJzaW9uIjoxfSwibWZhX2VuYWJsZWQiOmZhbHNlLCJzdGF0dXMiOiJBQ1RJVkUifSwiYXV0aGVudGljYXRpb25UeXBlIjoic2NvcGVkS2V5Iiwic2NvcGVkS2V5S2V5IjoiZTIzOTU3OWE2MzQ0NWQ2MDlkOTUiLCJzY29wZWRLZXlTZWNyZXQiOiJlZjJjOGZlZDRhYzc2MzFjZjFhNTJlZDhjZGU4ZDE3M2MxNjJlNjJlYzAyOTI5MjMxNmNiMTA1MjRiOGNiZTRhIiwiZXhwIjoxODA1Njg4MDUyfQ.2zm_rsMyLv4uVr8lPXJERyVhiKAhb_c8TGL5ZdSQdHA`,
          },
          onUploadProgress: (e) => {
            const percent = Math.round((e.loaded * 70) / e.total);
            setUploadProgress(10 + percent);
          },
        }
      );

      const cid = res.data.IpfsHash;
      setUploadProgress(80);
      showStatus("Storing on blockchain...", "info");

      const { contract, account: acc } = await getContract();
      await contract.methods.uploadFile(cid).send({ from: acc });

      setUploadProgress(100);
      setHash(cid);
      showStatus("File stored on blockchain & IPFS ✅", "success");

      setFile(null);
      setFileType("");
      updateSession(acc);

    } catch (err) {
      console.error(err);
      const msg = err?.response?.status === 401
        ? "Invalid Pinata API key ❌"
        : err?.code === 4001
        ? "Transaction rejected ❌"
        : "Upload failed ❌";
      showStatus(msg, "error");
    } finally {
      setLoading(false);
      setTimeout(() => setUploadProgress(0), 1500);
    }
  };

  // ─── Fetch Files ─────────────────────────────────────────────────
  const fetchFromBlockchain = async () => {
    if (!isConnected) {
      showStatus("Please connect your wallet first 🔐", "warning");
      return;
    }

    try {
      setFetchLoading(true);
      showStatus("Fetching files from blockchain...", "info");

      const { contract } = await getContract();
      const filesList = [];

      for (let i = 0; i < 50; i++) {
        try {
          const result = await contract.methods.files(i).call();
          if (!result || !result.hash) break;
          filesList.push({ hash: result.hash, owner: result.owner, index: i });
        } catch {
          break;
        }
      }

      setAllFiles(filesList);
      setCurrentPage(1);
      showStatus(
        filesList.length === 0 ? "No files found on blockchain 📭" : `Found ${filesList.length} file(s) ✅`,
        filesList.length === 0 ? "warning" : "success"
      );

    } catch (err) {
      console.error(err);
      showStatus("Error fetching files ❌", "error");
    } finally {
      setFetchLoading(false);
    }
  };

  // ─── Verify ──────────────────────────────────────────────────────
  const verifyFile = () => {
    if (!file) {
      showStatus("Please select a file to verify 📁", "warning");
      return;
    }
    if (!hash && allFiles.length === 0) {
      showStatus("No blockchain hash to verify against 🔍", "warning");
      return;
    }

    const reader = new FileReader();
    reader.onload = function () {
      const localHash = SHA256(reader.result.toString()).toString();
      const allHashes = allFiles.map((f) => f.hash);
      const isVerified = allHashes.includes(localHash) || localHash === hash;
      setVerifyResult(isVerified);
      showStatus(
        isVerified ? "File verified on blockchain ✅" : "File not found on blockchain ❌",
        isVerified ? "success" : "error"
      );
    };
    reader.readAsDataURL(file);
  };

  // ─── Copy ────────────────────────────────────────────────────────
  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
    showStatus("Copied to clipboard 📋", "success");
  };

  // ─── Pagination ──────────────────────────────────────────────────
  const totalPages = Math.ceil(allFiles.length / FILES_PER_PAGE);
  const currentFiles = allFiles.slice(
    (currentPage - 1) * FILES_PER_PAGE,
    currentPage * FILES_PER_PAGE
  );

  // ─── Render ──────────────────────────────────────────────────────
  return (
    <div className="app-container">
      {/* Background Effects */}
      <div className="bg-orb orb-1" />
      <div className="bg-orb orb-2" />
      <div className="bg-orb orb-3" />

      <div className="main-wrapper">

        {/* ── Header ── */}
        <header className="app-header">
          <div className="header-brand">
            <span className="brand-icon">🔗</span>
            <div>
              <h1 className="brand-title">Blockchain File Vault</h1>
              <p className="brand-sub">Powered by IPFS & Ethereum Sepolia</p>
            </div>
          </div>

          <div className="header-right">
            {isConnected ? (
              <div className="wallet-info">
                <div className="wallet-badge">
                  <span className="status-dot pulse" />
                  <span className="wallet-address">{truncateAddress(account)}</span>
                </div>
                {sessionTimeLeft && (
                  <div className={`session-timer ${sessionTimeLeft < 300000 ? "warning" : ""}`}>
                    ⏱ {formatTime(sessionTimeLeft)}
                  </div>
                )}
                <button className="btn btn-logout" onClick={() => handleLogout(false)}>
                  🚪 Logout
                </button>
              </div>
            ) : (
              <button className="btn btn-connect" onClick={connectWallet}>
                🔐 Connect Wallet
              </button>
            )}
          </div>
        </header>

        {/* ── Status Banner ── */}
        {status.message && (
          <div className={`status-banner status-${status.type}`}>
            <span>{status.message}</span>
          </div>
        )}

        {/* ── Not Connected Screen ── */}
        {!isConnected ? (
          <div className="connect-screen">
            <div className="connect-card">
              <div className="connect-icon">🦊</div>
              <h2>Connect Your Wallet</h2>
              <p>Connect MetaMask to upload, store, and verify files on the blockchain.</p>
              <div className="feature-list">
                <div className="feature-item">🔒 Decentralized Storage via IPFS</div>
                <div className="feature-item">⛓️ Immutable Blockchain Records</div>
                <div className="feature-item">✅ Cryptographic File Verification</div>
                <div className="feature-item">⏱️ 30-Minute Secure Sessions</div>
              </div>
              <button className="btn btn-connect btn-lg" onClick={connectWallet}>
                🔐 Connect MetaMask
              </button>
            </div>
          </div>
        ) : (
          <div className="dashboard">

            {/* ── Left Panel: Upload ── */}
            <div className="panel panel-upload">
              <div className="panel-header">
                <h3>📤 Upload File</h3>
                <span className="panel-badge">IPFS + Blockchain</span>
              </div>

              {/* Drop Zone */}
              <div
                className={`drop-zone ${isDragOver ? "drag-over" : ""} ${file ? "has-file" : ""}`}
                onDrop={(e) => {
                  e.preventDefault();
                  setIsDragOver(false);
                  handleFileSelect(e.dataTransfer.files[0]);
                }}
                onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
                onDragLeave={() => setIsDragOver(false)}
                onClick={() => document.getElementById("file-input").click()}
              >
                {file ? (
                  <div className="file-preview">
                    <span className="file-icon-large">{getFileIcon(fileType)}</span>
                    <div className="file-details">
                      <span className="file-name">{file.name}</span>
                      <span className="file-meta">
                        {fileType.toUpperCase()} • {formatFileSize(file.size)}
                      </span>
                    </div>
                    <button
                      className="file-remove"
                      onClick={(e) => { e.stopPropagation(); setFile(null); setFileType(""); }}
                    >✕</button>
                  </div>
                ) : (
                  <div className="drop-placeholder">
                    <span className="drop-icon">☁️</span>
                    <span className="drop-text">Drag & drop file here</span>
                    <span className="drop-sub">or click to browse</span>
                  </div>
                )}
              </div>

              <input
                id="file-input"
                type="file"
                hidden
                onChange={(e) => handleFileSelect(e.target.files[0])}
              />

              {/* Progress Bar */}
              {uploadProgress > 0 && (
                <div className="progress-wrap">
                  <div className="progress-bar" style={{ width: `${uploadProgress}%` }} />
                  <span className="progress-label">{uploadProgress}%</span>
                </div>
              )}

              {/* Action Buttons */}
              <div className="action-row">
                <button
                  className={`btn btn-primary ${loading ? "loading" : ""}`}
                  onClick={uploadFile}
                  disabled={loading || !file}
                >
                  {loading ? (
                    <><span className="spinner" /> Uploading...</>
                  ) : (
                    "☁️ Upload to IPFS"
                  )}
                </button>

                <button
                  className="btn btn-secondary"
                  onClick={verifyFile}
                  disabled={!file}
                >
                  🔍 Verify File
                </button>
              </div>

              {/* Verify Result */}
              {verifyResult !== null && (
                <div className={`verify-result ${verifyResult ? "verified" : "not-verified"}`}>
                  {verifyResult
                    ? "✅ File is authentic & verified on blockchain"
                    : "❌ File not found on blockchain"}
                </div>
              )}

              {/* Latest Hash */}
              {hash && (
                <div className="hash-card">
                  <div className="hash-header">
                    <span>🆕 Latest Upload</span>
                    <span className="hash-badge">IPFS CID</span>
                  </div>
                  <p className="hash-value">{hash}</p>
                  <div className="hash-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => copyToClipboard(hash)}>
                      📋 Copy
                    </button>
                    <a
                      className="btn btn-ghost btn-sm"
                      href={`https://ipfs.io/ipfs/${hash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      🔗 Open on IPFS
                    </a>
                    <a
                      className="btn btn-ghost btn-sm"
                      href={`https://sepolia.etherscan.io/address/${account}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      🔎 Etherscan
                    </a>
                  </div>
                </div>
              )}
            </div>

            {/* ── Right Panel: Files ── */}
            <div className="panel panel-files">
              <div className="panel-header">
                <h3>📂 Stored Files</h3>
                <button
                  className={`btn btn-secondary btn-sm ${fetchLoading ? "loading" : ""}`}
                  onClick={fetchFromBlockchain}
                  disabled={fetchLoading}
                >
                  {fetchLoading
                    ? <><span className="spinner" /> Fetching...</>
                    : "🔄 Refresh"}
                </button>
              </div>

              {allFiles.length === 0 ? (
                <div className="empty-state">
                  <span className="empty-icon">📭</span>
                  <p>No files fetched yet.</p>
                  <p className="empty-sub">Click Refresh to load blockchain files.</p>
                </div>
              ) : (
                <>
                  <p className="files-count">
                    Showing {(currentPage - 1) * FILES_PER_PAGE + 1}–
                    {Math.min(currentPage * FILES_PER_PAGE, allFiles.length)} of{" "}
                    {allFiles.length} files
                  </p>

                  {/* scrollable only inside this div */}
                  <div className="files-scrollable">
                    <div className="files-list">
                      {currentFiles.map((fileData, index) => (
                        <div key={index} className="file-card">
                          <div className="file-card-top">
                            <span className="file-card-icon">📄</span>
                            <div className="file-card-info">
                              <span className="file-card-index">
                                File #{fileData.index + 1}
                              </span>
                              <span className="file-card-owner">
                                👤 {truncateAddress(fileData.owner)}
                              </span>
                            </div>
                          </div>
                          <div className="file-card-hash">
                            <span className="hash-text">{fileData.hash}</span>
                            <button
                              className="btn-icon"
                              onClick={() => copyToClipboard(fileData.hash)}
                              title="Copy CID"
                            >📋</button>
                          </div>
                          <div className="file-card-actions">
                            <a
                              href={`https://ipfs.io/ipfs/${fileData.hash}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn btn-ghost btn-xs"
                            >
                              🔗 Open IPFS
                            </a>
                            <a
                              href={`https://sepolia.etherscan.io/address/${fileData.owner}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="btn btn-ghost btn-xs"
                            >
                              🔎 Etherscan
                            </a>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {totalPages > 1 && (
                    <div className="pagination">
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setCurrentPage(1)}
                        disabled={currentPage === 1}
                      >«</button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setCurrentPage((p) => p - 1)}
                        disabled={currentPage === 1}
                      >‹ Prev</button>

                      {Array.from({ length: totalPages }, (_, i) => i + 1)
                        .filter((p) => Math.abs(p - currentPage) <= 1)
                        .map((p) => (
                          <button
                            key={p}
                            className={`btn btn-ghost btn-sm ${p === currentPage ? "active" : ""}`}
                            onClick={() => setCurrentPage(p)}
                          >{p}</button>
                        ))}

                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setCurrentPage((p) => p + 1)}
                        disabled={currentPage === totalPages}
                      >Next ›</button>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={() => setCurrentPage(totalPages)}
                        disabled={currentPage === totalPages}
                      >»</button>
                    </div>
                  )}
                </>
              )}
            </div>

          </div>
        )}

        {/* ── Footer ── */}
        <footer className="app-footer">
          <span>🔗 Blockchain File Vault</span>
          <span>·</span>
          <span>Sepolia Testnet</span>
          <span>·</span>
          <a href="https://sepolia.etherscan.io" target="_blank" rel="noopener noreferrer">
            Etherscan ↗
          </a>
          <span>·</span>
          <a href="https://ipfs.io" target="_blank" rel="noopener noreferrer">
            IPFS ↗
          </a>
        </footer>

      </div>
    </div>
  );
}

export default App;