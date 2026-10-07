#!/usr/bin/env node

/**
 * Grant and verify the TruthPass business roles on an already deployed
 * TruthPassEvidenceAnchor instance. Testnet only; private key is never printed.
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Contract, JsonRpcProvider, Wallet } from "ethers";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RPC_URL = process.env.TRUTHPASS_BOT_CHAIN_RPC_URL || "https://rpc.bohr.life";
const EXPECTED_CHAIN_ID = 968n;
const EXPLORER_URL = "https://scan.bohr.life";
const ROLE_NAMES = [
  "EVIDENCE_WRITER_ROLE",
  "VERIFIER_ROLE",
  "PURCHASE_WRITER_ROLE",
  "CONTRIBUTION_WRITER_ROLE",
  "DISPUTE_ROLE",
  "REVOKER_ROLE",
];

function fail(message) {
  throw new Error(`[grant-bot-chain-roles] ${message}`);
}

function parseArgs(argv) {
  const args = new Set(argv);
  if (args.has("--help") || args.has("-h")) return { help: true, confirmed: false };
  return {
    help: false,
    confirmed: args.has("--confirm") || process.env.TRUTHPASS_ROLE_CONFIRM === "GRANT_ROLES_TO_BOHR_TESTNET",
  };
}

function addressFromEnv(name, fallback) {
  const value = process.env[name] || fallback;
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) fail(`${name} is not a valid address`);
  return value;
}

function usage() {
  return [
    "Usage: node scripts/grant-bot-chain-roles.mjs --confirm",
    "Required: TRUTHPASS_DEPLOYER_PRIVATE_KEY, TRUTHPASS_CONTRACT_ADDRESS",
    "Optional: TRUTHPASS_ROLE_<ROLE_NAME> address overrides (default: deployer)",
    "Confirmation env: TRUTHPASS_ROLE_CONFIRM=GRANT_ROLES_TO_BOHR_TESTNET",
  ].join("\n");
}

async function loadAbi() {
  const sourcePath = path.join(ROOT_DIR, "contracts", "TruthPassEvidenceAnchor.sol");
  const source = await fs.readFile(sourcePath, "utf8");
  const input = {
    language: "Solidity",
    sources: { "TruthPassEvidenceAnchor.sol": { content: source } },
    settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi"] } } },
  };
  const { default: solc } = await import("solc");
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter((entry) => entry.severity === "error");
  if (errors.length) fail(`Solidity compilation failed: ${errors.map((entry) => entry.formattedMessage || entry.message).join("\n")}`);
  const abi = output.contracts?.["TruthPassEvidenceAnchor.sol"]?.TruthPassEvidenceAnchor?.abi;
  if (!abi) fail("compiled contract ABI is missing");
  return abi;
}

async function main() {
  const { help, confirmed } = parseArgs(process.argv.slice(2));
  if (help) {
    console.log(usage());
    return;
  }
  if (!confirmed) fail("explicit confirmation required: pass --confirm or set TRUTHPASS_ROLE_CONFIRM=GRANT_ROLES_TO_BOHR_TESTNET");
  const privateKey = process.env.TRUTHPASS_DEPLOYER_PRIVATE_KEY;
  if (!privateKey || !/^0x[0-9a-fA-F]{64}$/.test(privateKey)) fail("TRUTHPASS_DEPLOYER_PRIVATE_KEY is missing or invalid");
  const contractAddress = addressFromEnv("TRUTHPASS_CONTRACT_ADDRESS", "");

  const provider = new JsonRpcProvider(RPC_URL, Number(EXPECTED_CHAIN_ID), { staticNetwork: false });
  const network = await provider.getNetwork();
  if (network.chainId !== EXPECTED_CHAIN_ID) fail(`RPC chain id mismatch: expected ${EXPECTED_CHAIN_ID}, got ${network.chainId}`);
  const signer = new Wallet(privateKey, provider);
  const deployerAddress = await signer.getAddress();
  const abi = await loadAbi();
  const contract = new Contract(contractAddress, abi, signer);
  const code = await provider.getCode(contractAddress);
  if (code === "0x") fail(`no contract bytecode at ${contractAddress}`);

  const roleAddresses = {};
  for (const roleName of ROLE_NAMES) {
    roleAddresses[roleName] = addressFromEnv(`TRUTHPASS_ROLE_${roleName}`, deployerAddress);
  }
  const txs = [];
  for (const roleName of ROLE_NAMES) {
    const role = await contract[roleName]();
    const target = roleAddresses[roleName];
    const has = await contract.hasRole(role, target);
    if (!has) {
      const tx = await contract.grantRole(role, target);
      const receipt = await tx.wait(1);
      if (!receipt || receipt.status !== 1) fail(`grant transaction failed for ${roleName}`);
      txs.push({ role: roleName, account: target, txHash: tx.hash, blockNumber: receipt.blockNumber });
    }
  }

  const verified = {};
  for (const roleName of ROLE_NAMES) {
    const role = await contract[roleName]();
    verified[roleName] = {};
    const account = roleAddresses[roleName];
    verified[roleName][account] = await contract.hasRole(role, account);
    if (!verified[roleName][account]) fail(`role read-back failed for ${roleName}`);
  }
  const domainSeparator = await contract.DOMAIN_SEPARATOR();
  const deployedChainId = BigInt((await contract.DEPLOYED_CHAIN_ID()).toString());
  if (deployedChainId !== EXPECTED_CHAIN_ID) fail(`contract deployed chain id mismatch: ${deployedChainId}`);
  console.log(JSON.stringify({
    network: "bohr-testnet",
    chainId: EXPECTED_CHAIN_ID.toString(),
    rpcUrl: new URL(RPC_URL).origin,
    explorerUrl: `${EXPLORER_URL}/address/${contractAddress}`,
    contractAddress,
    deployerAddress,
    roleAddresses,
    grantedTransactions: txs.map((item) => ({ ...item, explorerUrl: `${EXPLORER_URL}/tx/${item.txHash}` })),
    roleReadback: verified,
    domainSeparator,
    deployedChainId: deployedChainId.toString(),
    status: "roles_granted_and_readback_verified",
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
