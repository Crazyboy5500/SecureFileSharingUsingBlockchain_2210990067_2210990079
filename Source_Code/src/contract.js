import Web3 from "web3";

const contractABI = [
  {
    inputs: [{ internalType: "string", name: "_hash", type: "string" }],
    name: "uploadFile",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "", type: "uint256" }],
    name: "files",
    outputs: [
      { internalType: "string",  name: "hash",  type: "string"  },
      { internalType: "address", name: "owner", type: "address" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ internalType: "uint256", name: "index", type: "uint256" }],
    name: "getFile",
    outputs: [
      { internalType: "string",  name: "", type: "string"  },
      { internalType: "address", name: "", type: "address" },
    ],
    stateMutability: "view",
    type: "function",
  },
];

const contractAddress = "0x84e8e8c5794dE351c98B8829688F80b67c5E1380";

export const getContract = async () => {
  if (!window.ethereum) {
    throw new Error("MetaMask not installed");
  }

  const web3 = new Web3(window.ethereum);
  await window.ethereum.request({ method: "eth_requestAccounts" });
  const accounts = await web3.eth.getAccounts();

  if (!accounts || accounts.length === 0) {
    throw new Error("No accounts found");
  }

  const contract = new web3.eth.Contract(contractABI, contractAddress);
  return { contract, account: accounts[0], web3 };
};