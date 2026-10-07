#!/usr/bin/env node

/**
 * Write one deterministic fish-oil evidence + verification demo to BOT Chain Mainnet.
 * Secrets are read from .env.local and are never printed.
 */
import process from "node:process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { HttpsProxyAgent } from "https-proxy-agent";
import { Contract, FetchRequest, JsonRpcProvider, Wallet, keccak256, toUtf8Bytes } from "ethers";

const RPC_URL = process.env.TRUTHPASS_MAINNET_RPC_URL || "https://rpc.botchain.ai";
const CHAIN_ID = 677n;
const EXPLORER_URL = "https://scan.botchain.ai";
const CONFIRM = "REPLAY_TO_BOTCHAIN_MAINNET";
const ABI = [
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function DEPLOYED_CHAIN_ID() view returns (uint256)",
  "function evidenceByRequest(bytes32) view returns (bytes32,bytes32,bytes32,bytes32,uint8,uint64,uint64)",
  "function verificationByRequest(bytes32) view returns (bytes32,bytes32,bytes32,bytes32,bytes32,uint8,uint8,uint64,uint64)",
  "function purchaseById(bytes32) view returns (bytes32,bytes32,bytes32,bytes32,uint8,uint64,uint64)",
  "function contributionById(bytes32) view returns (bytes32,bytes32,bytes32,uint8,uint8,uint64,uint64)",
  "function anchorEvidence(bytes32,bytes32,bytes32,bytes32,bytes32,uint8,uint256,bytes32) returns (bool)",
  "function recordVerification(bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,uint8,uint8,uint256,bytes32) returns (bool)",
  "function recordPurchase(bytes32,bytes32,bytes32,bytes32,bytes32,uint256,bytes32) returns (bool)",
  "function recordContribution(bytes32,bytes32,bytes32,bytes32,uint8,uint256,bytes32) returns (bool)",
  "event EvidenceAnchored(bytes32 indexed requestId,bytes32 indexed evidenceRoot,bytes32 indexed subjectHash,bytes32 schemaHash,bytes32 sourceHash,uint8 state,address writer)",
  "event VerificationRecorded(bytes32 indexed requestId,bytes32 indexed evidenceRoot,bytes32 indexed taskHash,bytes32 policyHash,bytes32 verifierVersionHash,bytes32 resultHash,uint8 state,uint8 scope,address verifier)",
  "event PurchaseRecorded(bytes32 indexed purchaseId,bytes32 indexed consumerCommitment,bytes32 indexed batchCommitment,bytes32 purchaseProofHash,bytes32 consentHash,address writer)",
  "event ContributionRecorded(bytes32 indexed contributionId,bytes32 indexed purchaseId,bytes32 indexed evidenceHash,bytes32 contributionHash,uint8 score,address writer)",
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

  const proxyUrl = process.env.TRUTHPASS_HTTPS_PROXY || process.env.HTTPS_PROXY;
  if (proxyUrl) {
    FetchRequest.registerGetUrl(FetchRequest.createGetUrlFunc({ agent: new HttpsProxyAgent(proxyUrl) }));
  }
  const provider = new JsonRpcProvider(RPC_URL, Number(CHAIN_ID), { staticNetwork: true, batchMaxCount: 1 });
  const network = await provider.getNetwork();
  if (network.chainId !== CHAIN_ID) fail(`RPC network mismatch: expected ${CHAIN_ID}, got ${network.chainId}`);
  const signer = new Wallet(privateKey, provider);
  const contract = new Contract(contractAddress, ABI, signer);
  const deployedChainId = BigInt((await contract.DEPLOYED_CHAIN_ID()).toString());
  if (deployedChainId !== CHAIN_ID) fail(`contract domain mismatch: ${deployedChainId}`);
  const domain = await contract.DOMAIN_SEPARATOR();
  const runId = process.env.TRUTHPASS_MAINNET_REPLAY_RUN_ID || "FO-2026-001-v1";
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
  const purchaseId = id(runId, "purchase/consumer-demo");
  const consumerCommitment = id(runId, "consumer/anonymous-demo");
  const batchCommitment = id(runId, "batch/FO-2026-001");
  const purchaseProofHash = id(runId, "purchase-proof/consent-demo");
  const consentHash = id(runId, "consent/quality-feedback");
  const contributionId = id(runId, "contribution/consumer-demo");
  const contributionHash = id(runId, "contribution/quality-feedback");

  async function send(name, txPromise, eventName, readback) {
    const tx = await txPromise;
    const receipt = await tx.wait(2);
    if (!receipt || receipt.status !== 1) fail(`${name} transaction failed: ${tx.hash}`);
    const parsed = receipt.logs.map((log) => { try { return contract.interface.parseLog(log)?.name; } catch { return null; } }).filter(Boolean);
    const eventMatched = parsed.includes(eventName);
    if (!eventMatched && !(await readback?.())) fail(`${name} receipt missing ${eventName} and state readback is empty`);
    return { name, txHash: tx.hash, blockNumber: receipt.blockNumber, explorerUrl: `${EXPLORER_URL}/tx/${tx.hash}`, event: eventMatched ? eventName : `${eventName}:idempotent_readback`, receiptStatus: receipt.status, confirmations: 2 };
  }

  const events = [];
  events.push(await send("evidence", contract.anchorEvidence(requestId, evidenceRoot, subjectHash, schemaHash, sourceHash, 1, CHAIN_ID, domain), "EvidenceAnchored", async () => (await contract.evidenceByRequest(requestId))[5] !== 0n));
  events.push(await send("verification", contract.recordVerification(verificationRequestId, evidenceRoot, taskHash, policyHash, verifierVersionHash, resultHash, 1, 0x1f, CHAIN_ID, domain), "VerificationRecorded", async () => (await contract.verificationByRequest(verificationRequestId))[7] !== 0n));
  events.push(await send("purchase", contract.recordPurchase(purchaseId, consumerCommitment, batchCommitment, purchaseProofHash, consentHash, CHAIN_ID, domain), "PurchaseRecorded", async () => (await contract.purchaseById(purchaseId))[5] !== 0n));
  events.push(await send("contribution", contract.recordContribution(contributionId, purchaseId, evidenceRoot, contributionHash, 100, CHAIN_ID, domain), "ContributionRecorded", async () => (await contract.contributionById(contributionId))[5] !== 0n));
  const unsignedManifest = {
    schemaVersion: "truthpass.mainnet.replay.v2",
    status: "mainnet_receipts_verified",
    lifecycle: "anchored",
    network: "bot-mainnet",
    chainId: Number(CHAIN_ID),
    contractAddress,
    deployerAddress: await signer.getAddress(),
    domainSeparator: domain,
    batchId: "FO-2026-001",
    taskId: "task-fish-oil-2026-001",
    dataClass: "demo/synthetic",
    runId,
    ids: { requestId, evidenceRoot, verificationRequestId, purchaseId, contributionId },
    events,
    recordedAt: new Date().toISOString(),
    note: "Public receipt metadata only. Private keys, consumer identity and raw evidence remain outside Git.",
  };
  const manifest = { ...unsignedManifest, integrityHash: keccak256(toUtf8Bytes(JSON.stringify(unsignedManifest))) };
  const manifestPath = resolve(process.cwd(), "config", "bot-chain-mainnet.replay.json");
  await mkdir(dirname(manifestPath), { recursive: true });
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n", "utf8");
  console.log(JSON.stringify(manifest, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
