#!/usr/bin/env node

/**
 * Deploy TruthPassEvidenceAnchor to BOT Chain Mainnet.
 *
 * Secrets are read only from the process environment. This script never writes
 * or prints a private key. Mainnet deployment requires both --confirm and the
 * exact TRUTHPASS_DEPLOY_CONFIRM value.
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import solc from "solc";
import {
  Contract,
  ContractFactory,
  JsonRpcProvider,
  Wallet,
  formatEther,
  getAddress,
} from "ethers";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_RPC_URL = "https://rpc.botchain.ai";
const DEFAULT_CHAIN_ID = 677n;
const EXPLORER_URL = "https://scan.botchain.ai";
const CONFIRMATION_VALUE = "DEPLOY_TO_BOTCHAIN_MAINNET";

function usage() {
  return [
    "Usage:",
    "  node --env-file-if-exists=.env.local scripts/deploy-bot-chain-mainnet.mjs --dry-run",
    "  node --env-file-if-exists=.env.local scripts/deploy-bot-chain-mainnet.mjs --confirm",
    "",
    "Required for dry-run:",
    "  TRUTHPASS_DEPLOYER_ADDRESS       Public EVM address used for balance estimation",
    "",
    "Required for live deployment:",
    "  TRUTHPASS_DEPLOYER_PRIVATE_KEY   Secret held outside Git",
    "  TRUTHPASS_DEPLOY_CONFIRM=DEPLOY_TO_BOTCHAIN_MAINNET",
    "",
    "Optional:",
    "  TRUTHPASS_MAINNET_RPC_URL        Default: " + DEFAULT_RPC_URL,
    "  TRUTHPASS_EXPECTED_CHAIN_ID     Must remain 677",
    "  TRUTHPASS_ARTIFACT_PATH          ABI/bytecode JSON",
    "  TRUTHPASS_CONFIRMATIONS          Default: 2",
    "  TRUTHPASS_DEPLOYMENT_OUTPUT      Default: config/bot-chain-mainnet.deployed.json",
  ].join("\n");
}

function parseArgs(argv) {
  const args = new Set(argv);
  return {
    help: args.has("--help") || args.has("-h"),
    dryRun: args.has("--dry-run"),
    confirmed: args.has("--confirm")
      && process.env.TRUTHPASS_DEPLOY_CONFIRM === CONFIRMATION_VALUE,
  };
}

function fail(message) {
  throw new Error("[deploy-bot-chain-mainnet] " + message);
}

function parseAddress(value, name) {
  if (!value) fail(name + " is required");
  try {
    return getAddress(value);
  } catch {
    fail(name + " is not a valid EVM address");
  }
}

function parsePositiveBigInt(value, name, fallback) {
  const raw = value ?? fallback.toString();
  if (!/^\d+$/.test(raw)) fail(name + " must be a positive integer");
  const parsed = BigInt(raw);
  if (parsed < 1n) fail(name + " must be a positive integer");
  return parsed;
}

async function loadArtifact() {
  const configured = process.env.TRUTHPASS_ARTIFACT_PATH;
  if (configured) {
    const artifactPath = path.resolve(ROOT_DIR, configured);
    const artifact = JSON.parse(await fs.readFile(artifactPath, "utf8"));
    const bytecode = artifact.bytecode ?? artifact.evm?.bytecode?.object;
    if (!Array.isArray(artifact.abi) || typeof bytecode !== "string" || !/^0x[0-9a-fA-F]+$/.test(bytecode)) {
      fail("artifact is missing abi/bytecode: " + artifactPath);
    }
    return { abi: artifact.abi, bytecode, source: artifactPath, mode: "artifact" };
  }

  const sourcePath = path.join(ROOT_DIR, "contracts", "TruthPassEvidenceAnchor.sol");
  const source = await fs.readFile(sourcePath, "utf8");
  const input = {
    language: "Solidity",
    sources: { "TruthPassEvidenceAnchor.sol": { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors ?? []).filter((item) => item.severity === "error");
  if (errors.length) fail(errors.map((item) => item.formattedMessage).join("\n"));
  const contract = output.contracts?.["TruthPassEvidenceAnchor.sol"]?.TruthPassEvidenceAnchor;
  if (!contract?.abi || !contract.evm?.bytecode?.object) fail("compiled TruthPassEvidenceAnchor artifact is missing");
  return {
    abi: contract.abi,
    bytecode: "0x" + contract.evm.bytecode.object,
    source: sourcePath,
    mode: "compiled",
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.dryRun && !args.confirmed) {
    fail("live deployment requires --confirm and TRUTHPASS_DEPLOY_CONFIRM=" + CONFIRMATION_VALUE);
  }

  const rpcUrl = process.env.TRUTHPASS_MAINNET_RPC_URL || DEFAULT_RPC_URL;
  const expectedChainId = parsePositiveBigInt(
    process.env.TRUTHPASS_EXPECTED_CHAIN_ID,
    "TRUTHPASS_EXPECTED_CHAIN_ID",
    DEFAULT_CHAIN_ID,
  );
  if (expectedChainId !== DEFAULT_CHAIN_ID) fail("mainnet deployment is hard-coded to Chain ID 677");

  const provider = new JsonRpcProvider(rpcUrl, Number(DEFAULT_CHAIN_ID), {
    staticNetwork: true,
    batchMaxCount: 1,
  });
  const network = await provider.getNetwork();
  const actualChainId = network.chainId;
  if (actualChainId !== expectedChainId) {
    fail("RPC network mismatch: expected " + expectedChainId + ", got " + actualChainId);
  }

  const privateKey = process.env.TRUTHPASS_DEPLOYER_PRIVATE_KEY;
  let deployerAddress = process.env.TRUTHPASS_DEPLOYER_ADDRESS
    ? parseAddress(process.env.TRUTHPASS_DEPLOYER_ADDRESS, "TRUTHPASS_DEPLOYER_ADDRESS")
    : undefined;
  if (privateKey) {
    if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) fail("TRUTHPASS_DEPLOYER_PRIVATE_KEY is not a valid 32-byte key");
    const derived = new Wallet(privateKey).address;
    if (deployerAddress && derived.toLowerCase() !== deployerAddress.toLowerCase()) {
      fail("TRUTHPASS_DEPLOYER_ADDRESS does not match the supplied private key");
    }
    deployerAddress = derived;
  }
  if (!deployerAddress) fail("TRUTHPASS_DEPLOYER_ADDRESS is required; the private key is never generated by this script");

  const artifact = await loadArtifact();
  const factory = new ContractFactory(artifact.abi, artifact.bytecode);
  const unsigned = await factory.getDeployTransaction();
  if (!unsigned.data) fail("deployment bytecode is empty");

  const balance = await provider.getBalance(deployerAddress);
  const estimatedGas = await provider.estimateGas({ from: deployerAddress, data: unsigned.data });
  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice ?? feeData.maxFeePerGas;
  const estimatedCost = gasPrice === null ? undefined : estimatedGas * gasPrice;
  const preflight = {
    network: "bot-mainnet",
    chainId: Number(actualChainId),
    rpcUrl,
    explorerUrl: EXPLORER_URL,
    deployerAddress,
    balanceWei: balance.toString(),
    balanceBOT: formatEther(balance),
    bytecodeBytes: (unsigned.data.length - 2) / 2,
    estimatedGas: estimatedGas.toString(),
    gasPriceWei: gasPrice?.toString() ?? null,
    estimatedCostWei: estimatedCost?.toString() ?? null,
    estimatedCostBOT: estimatedCost === undefined ? null : formatEther(estimatedCost),
    privateKeyConfigured: Boolean(privateKey),
    artifact: { mode: artifact.mode, source: path.relative(ROOT_DIR, artifact.source) },
  };

  if (args.dryRun) {
    console.log(JSON.stringify({ schemaVersion: "truthpass.mainnet.deploy-preflight.v1", status: "dry_run", ...preflight }, null, 2));
    return;
  }
  if (!privateKey) fail("TRUTHPASS_DEPLOYER_PRIVATE_KEY is required for live deployment");
  if (estimatedCost !== undefined && balance < estimatedCost) {
    fail("insufficient balance: estimated deployment cost is " + formatEther(estimatedCost) + " BOT, available " + formatEther(balance) + " BOT");
  }

  const confirmations = Number.parseInt(process.env.TRUTHPASS_CONFIRMATIONS || "2", 10);
  if (!Number.isInteger(confirmations) || confirmations < 1 || confirmations > 20) fail("TRUTHPASS_CONFIRMATIONS must be 1..20");

  const signer = new Wallet(privateKey, provider);
  const deployed = await new ContractFactory(artifact.abi, artifact.bytecode, signer).deploy();
  const deploymentTx = deployed.deploymentTransaction();
  if (!deploymentTx) fail("deployment transaction was not created");
  const receipt = await deploymentTx.wait(confirmations);
  if (!receipt || receipt.status !== 1) fail("deployment receipt failed: " + deploymentTx.hash);

  const contractAddress = await deployed.getAddress();
  const code = await provider.getCode(contractAddress);
  if (code === "0x" || code === "0x0") fail("no bytecode found at deployed contract " + contractAddress);
  const readback = new Contract(
    contractAddress,
    [
      "function DEPLOYED_CHAIN_ID() view returns (uint256)",
      "function DOMAIN_SEPARATOR() view returns (bytes32)",
      "function hasRole(bytes32,address) view returns (bool)",
    ],
    provider,
  );
  const deployedChainId = await readback.DEPLOYED_CHAIN_ID();
  if (deployedChainId !== actualChainId) fail("deployed contract chain domain mismatch: " + deployedChainId);
  const domainSeparator = await readback.DOMAIN_SEPARATOR();
  const metadata = {
    schemaVersion: "truthpass.chain-deployment.v0.8.5",
    status: "deployed_mainnet_receipt_verified",
    network: "bot-mainnet",
    chainId: Number(actualChainId),
    chainIdHex: "0x" + actualChainId.toString(16),
    rpcUrl,
    explorerUrl: EXPLORER_URL,
    contract: {
      name: "TruthPassEvidenceAnchor",
      address: contractAddress,
      deploymentTxHash: deploymentTx.hash,
      deploymentBlockNumber: receipt.blockNumber,
      domainSeparator,
    },
    deployerAddress,
    verification: {
      ethChainId: "verified",
      ethGetCode: "verified",
      deployedChainId: "verified",
      domainSeparatorReadback: "verified",
      confirmations,
    },
    note: "Public metadata only. Private keys and raw consumer data stay outside Git.",
  };
  const outputPath = path.resolve(ROOT_DIR, process.env.TRUTHPASS_DEPLOYMENT_OUTPUT || "config/bot-chain-mainnet.deployed.json");
  await fs.writeFile(outputPath, JSON.stringify(metadata, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify(metadata, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
