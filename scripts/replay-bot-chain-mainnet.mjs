#!/usr/bin/env node

/**
 * Write one deterministic fish-oil evidence + verification demo to BOT Chain Mainnet.
 * Secrets are read from .env.local and are never printed.
 */
import process from "node:process";
import { Contract, JsonRpcProvider, Wallet, keccak256, toUtf8Bytes } from "ethers";

const RPC_URL = process.env.TRUTHPASS_MAINNET_RPC_URL || "https://rpc.botchain.ai";
const CHAIN_ID = 677n;
const EXPLORER_URL = "https://scan.botchain.ai";
const CONFIRM = "REPLAY_TO_BOTCHAIN_MAINNET";
const ABI = [
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function DEPLOYED_CHAIN_ID() view returns (uint256)",
  "function anchorEvidence(bytes32,bytes32,bytes32,bytes32,bytes32,uint8,uint256,bytes32) returns (bool)",
  "function recordVerification(bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,uint8,uint8,uint256,bytes32) returns (bool)",
  "event EvidenceAnchored(bytes32 indexed requestId,bytes32 indexed evidenceRoot,bytes32 indexed subjectHash,uint8 state,address writer)",
  "event VerificationRecorded(bytes32 indexed requestId,bytes32 indexed evidenceRoot,bytes32 indexed taskHash,uint8 state,uint8 scope,address verifier)",
];

function fail(message) { throw new Error(`[replay-bot-chain-mainnet] ${message}`); }
function id(runId, label) { return keccak256(toUtf8Bytes(`truthpass/demo/fish-oil/mainnet/${runId}/${label}`)); }

async function main() {
  if (!process.argv.includes("--confirm") || process.env.TRUTHPASS_MAINNET_REPLAY_CONFIRM !== CONFIRM) {
    fail(`live replay requires --confirm and TRUTHPASS_MAINNET_REPLAY_CONFIRM=${CONFIRM}`);
  }
  const privateKey = process.env.TRUTHPASS_DEPLOYER_PRIVATE_KEY;
  const contractAddress = process.env.TRUTHPASS_CONTRACT_ADDRESS;
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) fail("TRUTHPASS_DEPLOYER_PRIVATE_KEY is missing or invalid");
  if (!contractAddress || !/^0x[0-9a-fA-F]{40}$/.test(contractAddress)) fail("TRUTHPASS_CONTRACT_ADDRESS is missing or invalid");

  const provider = new JsonRpcProvider(RPC_URL, Number(CHAIN_ID), { staticNetwork: true, batchMaxCount: 1 });
  const network = await provider.getNetwork();
  if (network.chainId !== CHAIN_ID) fail(`RPC network mismatch: expected ${CHAIN_ID}, got ${network.chainId}`);
  const signer = new Wallet(privateKey, provider);
  const contract = new Contract(contractAddress, ABI, signer);
  const deployedChainId = BigInt((await contract.DEPLOYED_CHAIN_ID()).toString());
  if (deployedChainId !== CHAIN_ID) fail(`contract domain mismatch: ${deployedChainId}`);
  const domain = await contract.DOMAIN_SEPARATOR();
  const runId = process.env.TRUTHPASS_MAINNET_REPLAY_RUN_ID || new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const requestId = id(runId, "evidence/request");
  const evidenceRoot = id(runId, "evidence/root");
  const subjectHash = id(runId, "subject/FO-2026-001");
  const schemaHash = id(runId, "schema/fish-oil-evidence-v1");
  const sourceHash = id(runId, "source/lab-agent-c");
  const verificationRequestId = id(runId, "verification/request");
  const taskHash = id(runId, "task/fish-oil-quality-check");
  const policyHash = id(runId, "policy/fish-oil-v1");
  const verifierVersionHash = id(runId, "verifier/deterministic-v1");
  const resultHash = id(runId, "result/accepted");

  async function send(name, txPromise, eventName) {
    const tx = await txPromise;
    const receipt = await tx.wait(2);
    if (!receipt || receipt.status !== 1) fail(`${name} transaction failed: ${tx.hash}`);
    const parsed = receipt.logs.map((log) => { try { return contract.interface.parseLog(log)?.name; } catch { return null; } }).filter(Boolean);
    if (!parsed.includes(eventName)) fail(`${name} receipt missing ${eventName}`);
    return { name, txHash: tx.hash, blockNumber: receipt.blockNumber, explorerUrl: `${EXPLORER_URL}/tx/${tx.hash}`, event: eventName };
  }

  const events = [];
  events.push(await send("evidence", contract.anchorEvidence(requestId, evidenceRoot, subjectHash, schemaHash, sourceHash, 1, CHAIN_ID, domain), "EvidenceAnchored"));
  events.push(await send("verification", contract.recordVerification(verificationRequestId, evidenceRoot, taskHash, policyHash, verifierVersionHash, resultHash, 1, 0x1f, CHAIN_ID, domain), "VerificationRecorded"));
  console.log(JSON.stringify({ schemaVersion: "truthpass.mainnet.replay.v1", status: "mainnet_receipts_verified", network: "bot-mainnet", chainId: Number(CHAIN_ID), contractAddress, deployerAddress: await signer.getAddress(), runId, ids: { requestId, evidenceRoot, verificationRequestId }, events }, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
