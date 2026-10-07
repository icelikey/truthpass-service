#!/usr/bin/env node

/**
 * Replay the TruthPass fish-oil lifecycle on Bohr Testnet.
 * This is an explicit testnet/demo command. It sends seven public commitment
 * transactions and prints only hashes, ids and receipt metadata.
 */

import process from "node:process";
import { Contract, JsonRpcProvider, Wallet, keccak256, toUtf8Bytes } from "ethers";

const RPC_URL = process.env.TRUTHPASS_BOT_CHAIN_RPC_URL || "https://rpc.bohr.life";
const CHAIN_ID = 968n;
const EXPLORER_URL = "https://scan.bohr.life";
const ROLE_ENV = "TRUTHPASS_REPLAY_CONFIRM";
const ABI = [
  "function DOMAIN_SEPARATOR() view returns (bytes32)",
  "function DEPLOYED_CHAIN_ID() view returns (uint256)",
  "function anchorEvidence(bytes32,bytes32,bytes32,bytes32,bytes32,uint8,uint256,bytes32) returns (bool)",
  "function recordVerification(bytes32,bytes32,bytes32,bytes32,bytes32,bytes32,uint8,uint8,uint256,bytes32) returns (bool)",
  "function recordPurchase(bytes32,bytes32,bytes32,bytes32,bytes32,uint256,bytes32) returns (bool)",
  "function recordContribution(bytes32,bytes32,bytes32,bytes32,uint8,uint256,bytes32) returns (bool)",
  "function raiseDispute(bytes32,uint8,bytes32,bytes32,uint256,bytes32) returns (bool)",
  "function revokeOrSupersede(uint8,bytes32,bytes32,bytes32,uint256,bytes32) returns (bool)",
  "event EvidenceAnchored(bytes32 indexed requestId,bytes32 indexed evidenceRoot,bytes32 indexed subjectHash,bytes32 schemaHash,bytes32 sourceHash,uint8 state,address writer)",
  "event VerificationRecorded(bytes32 indexed requestId,bytes32 indexed evidenceRoot,bytes32 indexed taskHash,bytes32 policyHash,bytes32 verifierVersionHash,bytes32 resultHash,uint8 state,uint8 scope,address verifier)",
  "event PurchaseRecorded(bytes32 indexed purchaseId,bytes32 indexed consumerCommitment,bytes32 indexed batchCommitment,bytes32 purchaseProofHash,bytes32 consentHash,address writer)",
  "event ContributionRecorded(bytes32 indexed contributionId,bytes32 indexed purchaseId,bytes32 indexed evidenceHash,bytes32 contributionHash,uint8 score,address writer)",
  "event DisputeRaised(bytes32 indexed disputeId,uint8 indexed targetKind,bytes32 indexed targetId,bytes32 reasonHash,address raisedBy)",
  "event RecordRevokedOrSuperseded(uint8 indexed targetKind,bytes32 indexed targetId,bytes32 indexed replacementId,bytes32 reasonHash,bool superseded,address writer)",
];

function fail(message) {
  throw new Error(`[replay-bot-chain] ${message}`);
}

function parseArgs(argv) {
  const args = new Set(argv);
  return { help: args.has("--help") || args.has("-h"), confirmed: args.has("--confirm") || process.env[ROLE_ENV] === "REPLAY_TO_BOHR_TESTNET" };
}

async function main() {
  const { help, confirmed } = parseArgs(process.argv.slice(2));
  if (help) {
    console.log("Usage: node scripts/replay-bot-chain.mjs --confirm");
    console.log(`Required: TRUTHPASS_DEPLOYER_PRIVATE_KEY, TRUTHPASS_CONTRACT_ADDRESS; or ${ROLE_ENV}=REPLAY_TO_BOHR_TESTNET`);
    return;
  }
  if (!confirmed) fail("explicit confirmation required: pass --confirm or set TRUTHPASS_REPLAY_CONFIRM=REPLAY_TO_BOHR_TESTNET");
  const privateKey = process.env.TRUTHPASS_DEPLOYER_PRIVATE_KEY;
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) fail("TRUTHPASS_DEPLOYER_PRIVATE_KEY is missing or invalid");
  const address = process.env.TRUTHPASS_CONTRACT_ADDRESS;
  if (!address || !/^0x[0-9a-fA-F]{40}$/.test(address)) fail("TRUTHPASS_CONTRACT_ADDRESS is missing or invalid");

  const provider = new JsonRpcProvider(RPC_URL, Number(CHAIN_ID), { staticNetwork: false });
  const network = await provider.getNetwork();
  if (network.chainId !== CHAIN_ID) fail(`RPC chain id mismatch: expected ${CHAIN_ID}, got ${network.chainId}`);
  const signer = new Wallet(privateKey, provider);
  const deployerAddress = await signer.getAddress();
  const contract = new Contract(address, ABI, signer);
  const code = await provider.getCode(address);
  if (code === "0x") fail(`no contract bytecode at ${address}`);
  const deployedChainId = BigInt((await contract.DEPLOYED_CHAIN_ID()).toString());
  const domain = await contract.DOMAIN_SEPARATOR();
  if (deployedChainId !== CHAIN_ID) fail(`contract deployed chain id mismatch: ${deployedChainId}`);

  // A run id makes retries explicit while preserving idempotency when the same
  // run id is supplied again. It also avoids colliding with an earlier demo
  // replay that may already exist on the public testnet.
  const runId = process.env.TRUTHPASS_REPLAY_RUN_ID || new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);
  const id = (label) => keccak256(toUtf8Bytes(`truthpass/demo/fish-oil/${runId}/${label}`));

  const evidenceRequestId = id("evidence/request");
  const evidenceRoot = id("evidence/root");
  const replacementRequestId = id("evidence/replacement/request");
  const replacementRoot = id("evidence/replacement/root");
  const verificationRequestId = id("verification/request");
  const purchaseId = id("purchase/consumer-001");
  const contributionId = id("contribution/consumer-001");
  const disputeId = id("dispute/evidence");
  const subjectHash = id("subject/FO-2026-001");
  const schemaHash = id("schema/evidence-envelope-v1");
  const sourceHash = id("source/lab-c-fish-oil-demo");
  const replacementSourceHash = id("source/lab-c-fish-oil-replacement");
  const taskHash = id("task/FO-2026-001");
  const policyHash = id("policy/fish-oil-v1");
  const verifierVersionHash = id("verifier/rules-v1");
  const resultHash = id("result/accepted");
  const consumerCommitment = id("consumer/consumer-001");
  const batchCommitment = id("batch/FO-2026-001");
  const purchaseProofHash = id("purchase-proof/consumer-001");
  const consentHash = id("consent/consumer-001");
  const contributionEvidenceHash = id("feedback/package-odor-batch");
  const contributionHash = id("feedback/accepted");
  const disputeReasonHash = id("reason/packaging-photo-review");
  const supersedeReasonHash = id("reason/replacement-lab-report");

  const events = [];
  async function send(name, invoke, expectedEvent) {
    const tx = await invoke();
    const receipt = await tx.wait(1);
    if (!receipt || receipt.status !== 1) fail(`${name} transaction failed`);
    const parsed = receipt.logs.map((log) => {
      try {
        const event = contract.interface.parseLog(log);
        return event ? event.name : null;
      } catch {
        return null;
      }
    }).filter(Boolean);
    if (!parsed.includes(expectedEvent)) fail(`${name} receipt did not contain ${expectedEvent}`);
    const item = { name, txHash: tx.hash, blockNumber: receipt.blockNumber, explorerUrl: `${EXPLORER_URL}/tx/${tx.hash}`, event: expectedEvent };
    events.push(item);
    return item;
  }

  await send("evidence", () => contract.anchorEvidence(evidenceRequestId, evidenceRoot, subjectHash, schemaHash, sourceHash, 1, CHAIN_ID, domain), "EvidenceAnchored");
  await send("verification", () => contract.recordVerification(verificationRequestId, evidenceRoot, taskHash, policyHash, verifierVersionHash, resultHash, 1, 0x1f, CHAIN_ID, domain), "VerificationRecorded");
  await send("purchase", () => contract.recordPurchase(purchaseId, consumerCommitment, batchCommitment, purchaseProofHash, consentHash, CHAIN_ID, domain), "PurchaseRecorded");
  await send("contribution", () => contract.recordContribution(contributionId, purchaseId, contributionEvidenceHash, contributionHash, 92, CHAIN_ID, domain), "ContributionRecorded");
  await send("dispute", () => contract.raiseDispute(disputeId, 1, evidenceRequestId, disputeReasonHash, CHAIN_ID, domain), "DisputeRaised");
  await send("replacement_evidence", () => contract.anchorEvidence(replacementRequestId, replacementRoot, subjectHash, schemaHash, replacementSourceHash, 1, CHAIN_ID, domain), "EvidenceAnchored");
  await send("supersede", () => contract.revokeOrSupersede(1, evidenceRequestId, replacementRequestId, supersedeReasonHash, CHAIN_ID, domain), "RecordRevokedOrSuperseded");

  console.log(JSON.stringify({
    network: "bohr-testnet",
    chainId: CHAIN_ID.toString(),
    contractAddress: address,
    deployerAddress,
    runId,
    domainSeparator: domain,
    deployedChainId: deployedChainId.toString(),
    ids: { evidenceRequestId, evidenceRoot, replacementRequestId, replacementRoot, verificationRequestId, purchaseId, contributionId, disputeId },
    events,
    status: "lifecycle_replayed_and_receipts_verified",
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
