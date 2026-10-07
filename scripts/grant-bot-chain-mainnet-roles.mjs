#!/usr/bin/env node

/**
 * Grant least-privilege TruthPass roles on BOT Chain Mainnet.
 *
 * The deployer key is read from the process environment and never printed.
 * Role addresses must be supplied explicitly for mainnet unless the operator
 * opts into the single-wallet demo mode with an explicit environment flag.
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import {
  Contract,
  JsonRpcProvider,
  Wallet,
  getAddress,
  keccak256,
  toUtf8Bytes,
} from "ethers";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const RPC_URL = process.env.TRUTHPASS_MAINNET_RPC_URL || "https://rpc.botchain.ai";
const CHAIN_ID = 677n;
const CONFIRMATION_VALUE = "GRANT_ROLES_TO_BOTCHAIN_MAINNET";
const ROLE_NAMES = [
  "EVIDENCE_WRITER_ROLE",
  "VERIFIER_ROLE",
  "PURCHASE_WRITER_ROLE",
  "CONTRIBUTION_WRITER_ROLE",
  "DISPUTE_ROLE",
  "REVOKER_ROLE",
];
const ABI = [
  "function hasRole(bytes32 role, address account) view returns (bool)",
  "function grantRole(bytes32 role, address account)",
];

function usage() {
  return [
    "Usage:",
    "  node --env-file-if-exists=.env.local scripts/grant-bot-chain-mainnet-roles.mjs --dry-run",
    "  node --env-file-if-exists=.env.local scripts/grant-bot-chain-mainnet-roles.mjs --confirm",
    "",
    "Required:",
    "  TRUTHPASS_CONTRACT_ADDRESS",
    "  TRUTHPASS_DEPLOYER_ADDRESS",
    "  TRUTHPASS_DEPLOYER_PRIVATE_KEY (live only)",
    "",
    "Each mainnet role must have TRUTHPASS_ROLE_<ROLE_NAME> unless",
    "TRUTHPASS_ALLOW_SINGLE_WALLET_MAINNET=true is explicitly set.",
  ].join("\n");
}

function fail(message) {
  throw new Error("[grant-bot-chain-mainnet-roles] " + message);
}

function addressFrom(value, name) {
  if (!value) fail(name + " is required");
  try {
    return getAddress(value);
  } catch {
    fail(name + " is not a valid EVM address");
  }
}

function parseArgs(argv) {
  const args = new Set(argv);
  return {
    help: args.has("--help") || args.has("-h"),
    dryRun: args.has("--dry-run"),
    confirmed: args.has("--confirm")
      && process.env.TRUTHPASS_ROLE_CONFIRM === CONFIRMATION_VALUE,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.dryRun && !args.confirmed) {
    fail("live role grants require --confirm and TRUTHPASS_ROLE_CONFIRM=" + CONFIRMATION_VALUE);
  }

  const contractAddress = addressFrom(process.env.TRUTHPASS_CONTRACT_ADDRESS, "TRUTHPASS_CONTRACT_ADDRESS");
  const deployerAddress = addressFrom(process.env.TRUTHPASS_DEPLOYER_ADDRESS, "TRUTHPASS_DEPLOYER_ADDRESS");
  const privateKey = process.env.TRUTHPASS_DEPLOYER_PRIVATE_KEY;
  if (!args.dryRun && !privateKey) fail("TRUTHPASS_DEPLOYER_PRIVATE_KEY is required for live role grants");
  if (privateKey) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) fail("TRUTHPASS_DEPLOYER_PRIVATE_KEY is not a valid 32-byte key");
    const derived = new Wallet(privateKey).address;
    if (derived.toLowerCase() !== deployerAddress.toLowerCase()) fail("deployer address does not match the private key");
  }

  const provider = new JsonRpcProvider(RPC_URL, Number(CHAIN_ID), {
    staticNetwork: true,
    batchMaxCount: 1,
  });
  const network = await provider.getNetwork();
  if (network.chainId !== CHAIN_ID) fail("RPC network mismatch: expected " + CHAIN_ID + ", got " + network.chainId);
  const code = await provider.getCode(contractAddress);
  if (code === "0x" || code === "0x0") fail("no contract bytecode found at " + contractAddress);

  const contract = new Contract(contractAddress, ABI, provider);
  const singleWallet = process.env.TRUTHPASS_ALLOW_SINGLE_WALLET_MAINNET === "true";
  const plan = [];
  for (const name of ROLE_NAMES) {
    const configured = process.env["TRUTHPASS_ROLE_" + name];
    if (!configured && !singleWallet) {
      plan.push({ name, target: null, status: "missing_explicit_role_address" });
      continue;
    }
    const target = configured ? addressFrom(configured, "TRUTHPASS_ROLE_" + name) : deployerAddress;
    const role = keccak256(toUtf8Bytes(name));
    const alreadyGranted = await contract.hasRole(role, target);
    plan.push({ name, role, target, alreadyGranted, status: alreadyGranted ? "already_granted" : "pending" });
  }

  if (args.dryRun) {
    console.log(JSON.stringify({
      schemaVersion: "truthpass.mainnet.role-preflight.v1",
      status: "dry_run",
      network: "bot-mainnet",
      chainId: Number(network.chainId),
      contractAddress,
      deployerAddress,
      singleWalletMode: singleWallet,
      plan,
    }, null, 2));
    return;
  }

  if (plan.some((item) => item.status === "missing_explicit_role_address")) {
    fail("role plan is incomplete; provide all TRUTHPASS_ROLE_* addresses or explicitly opt into single-wallet demo mode");
  }

  const signer = new Wallet(privateKey, provider);
  const writable = new Contract(contractAddress, ABI, signer);
  const receipts = [];
  for (const item of plan.filter((entry) => entry.status === "pending")) {
    const tx = await writable.grantRole(item.role, item.target);
    const receipt = await tx.wait(2);
    if (!receipt || receipt.status !== 1) fail("role grant failed for " + item.name + ": " + tx.hash);
    const verified = await contract.hasRole(item.role, item.target);
    if (!verified) fail("role readback failed for " + item.name);
    receipts.push({ name: item.name, target: item.target, txHash: tx.hash, status: "verified" });
  }

  const metadata = {
    schemaVersion: "truthpass.mainnet.roles.v0.8.5",
    status: "roles_receipt_verified",
    network: "bot-mainnet",
    chainId: Number(network.chainId),
    contractAddress,
    deployerAddress,
    singleWalletMode: singleWallet,
    receipts,
    note: "Public role metadata only. Private keys stay outside Git.",
  };
  const outputPath = path.resolve(ROOT_DIR, process.env.TRUTHPASS_ROLE_OUTPUT || "config/bot-chain-mainnet.roles.json");
  await fs.writeFile(outputPath, JSON.stringify(metadata, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify(metadata, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
