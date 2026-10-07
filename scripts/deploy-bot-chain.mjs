#!/usr/bin/env node

/**
 * Deploy TruthPassEvidenceAnchor to BOT Chain Bohr Testnet.
 *
 * Safety properties:
 * - The private key is read only from TRUTHPASS_DEPLOYER_PRIVATE_KEY and is
 *   never printed, persisted, or included in the result.
 * - Deployment is refused unless the RPC reports the expected chain id,
 *   the deployer has enough native balance, and --confirm (or the explicit
 *   TRUTHPASS_DEPLOY_CONFIRM value) is present.
 * - The result contains only public deployment metadata and read-back checks.
 */

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Contract, ContractFactory, JsonRpcProvider, Wallet } from "ethers";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, "..");
const DEFAULT_SOURCE = path.join(ROOT_DIR, "contracts", "TruthPassEvidenceAnchor.sol");
const DEFAULT_RPC_URL = "https://rpc.bohr.life";
const DEFAULT_CHAIN_ID = 968n;
const EXPLORER_URL = "https://scan.bohr.life";

function usage() {
  return [
    "Usage: node scripts/deploy-bot-chain.mjs --confirm",
    "",
    "Required environment:",
    "  TRUTHPASS_DEPLOYER_PRIVATE_KEY  Testnet-only deployer key (never print or commit)",
    "",
    "Optional environment:",
    `  TRUTHPASS_BOT_CHAIN_RPC_URL     RPC URL (default: ${DEFAULT_RPC_URL})`,
    "  TRUTHPASS_EXPECTED_CHAIN_ID     Expected chain id (default: 968)",
    "  TRUTHPASS_ARTIFACT_PATH         ABI/bytecode JSON; otherwise compile source",
    "  TRUTHPASS_SOLIDITY_SOURCE       Solidity source path (default: contracts/TruthPassEvidenceAnchor.sol)",
    "  TRUTHPASS_CONFIRMATIONS         Receipt confirmations (default: 1)",
    "  TRUTHPASS_DEPLOY_CONFIRM        Must equal DEPLOY_TO_BOHR_TESTNET instead of --confirm",
    "",
    "The command refuses to send a transaction when the key, chain, balance, or explicit confirmation is missing.",
  ].join("\n");
}

function parseArgs(argv) {
  const args = new Set(argv);
  if (args.has("--help") || args.has("-h")) {
    return { confirmed: false, help: true };
  }
  return { confirmed: args.has("--confirm") || process.env.TRUTHPASS_DEPLOY_CONFIRM === "DEPLOY_TO_BOHR_TESTNET", help: false };
}

function fail(message) {
  throw new Error(`[deploy-bot-chain] ${message}`);
}

function parseChainId(value, name) {
  if (!value || !/^\d+$/.test(value)) fail(`${name} must be a decimal integer`);
  const parsed = BigInt(value);
  if (parsed <= 0n) fail(`${name} must be greater than zero`);
  return parsed;
}

function asBytecode(bytecode) {
  if (typeof bytecode === "string") {
    const normalized = bytecode.startsWith("0x") ? bytecode : `0x${bytecode}`;
    if (normalized.length <= 2) fail("artifact bytecode is empty");
    return normalized;
  }
  if (bytecode && typeof bytecode.object === "string") {
    const normalized = bytecode.object.startsWith("0x") ? bytecode.object : `0x${bytecode.object}`;
    if (normalized.length <= 2) fail("artifact bytecode is empty");
    return normalized;
  }
  fail("artifact bytecode is missing");
}

async function readArtifact() {
  const configured = process.env.TRUTHPASS_ARTIFACT_PATH;
  if (configured) {
    const artifactPath = path.resolve(ROOT_DIR, configured);
    let parsed;
    try {
      parsed = JSON.parse(await fs.readFile(artifactPath, "utf8"));
    } catch (error) {
      fail(`cannot read TRUTHPASS_ARTIFACT_PATH (${artifactPath}): ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!Array.isArray(parsed.abi)) fail("artifact abi must be an array");
    return { abi: parsed.abi, bytecode: asBytecode(parsed.bytecode), source: artifactPath, mode: "artifact" };
  }

  const sourcePath = path.resolve(ROOT_DIR, process.env.TRUTHPASS_SOLIDITY_SOURCE || path.relative(ROOT_DIR, DEFAULT_SOURCE));
  let source;
  try {
    source = await fs.readFile(sourcePath, "utf8");
  } catch (error) {
    fail(`cannot read Solidity source (${sourcePath}): ${error instanceof Error ? error.message : String(error)}`);
  }
  const input = {
    language: "Solidity",
    sources: { "TruthPassEvidenceAnchor.sol": { content: source } },
    settings: {
      optimizer: { enabled: true, runs: 200 },
      outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
    },
  };
  const { default: solc } = await import("solc");
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const diagnostics = Array.isArray(output.errors) ? output.errors : [];
  const errors = diagnostics.filter((entry) => entry.severity === "error");
  if (errors.length) {
    fail(`Solidity compilation failed:\n${errors.map((entry) => entry.formattedMessage || entry.message).join("\n")}`);
  }
  const contract = output.contracts?.["TruthPassEvidenceAnchor.sol"]?.TruthPassEvidenceAnchor;
  if (!contract?.abi || !contract.evm?.bytecode?.object) fail("compiled TruthPassEvidenceAnchor artifact is missing");
  return { abi: contract.abi, bytecode: asBytecode(contract.evm.bytecode.object), source: sourcePath, mode: "compiled" };
}

function publicResult(result) {
  // Keep this list deliberately explicit so a future change cannot accidentally
  // expose private key material or arbitrary environment variables.
  return {
    network: "bohr-testnet",
    chainId: result.chainId.toString(),
    rpcUrl: result.rpcUrl,
    explorerUrl: result.explorerUrl,
    deployerAddress: result.deployerAddress,
    contractAddress: result.contractAddress,
    deploymentTxHash: result.deploymentTxHash,
    deploymentBlockNumber: result.deploymentBlockNumber,
    confirmations: result.confirmations,
    domainSeparator: result.domainSeparator,
    deployedChainId: result.deployedChainId.toString(),
    ethGetCodeVerified: result.codeVerified,
    domainSeparatorVerified: result.domainVerified,
    sourceMode: result.sourceMode,
    source: path.relative(ROOT_DIR, result.source).replaceAll(path.sep, "/"),
    status: "deployed_and_readback_verified",
  };
}

function safeRpcLabel(rpcUrl) {
  try {
    const parsed = new URL(rpcUrl);
    // Do not echo query strings, fragments, credentials, or token-bearing
    // paths from a custom provider URL into a copyable deployment result.
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    parsed.pathname = "/";
    return parsed.toString();
  } catch {
    return "[configured RPC redacted]";
  }
}

async function main() {
  const { confirmed, help } = parseArgs(process.argv.slice(2));
  if (help) {
    console.log(usage());
    return;
  }
  if (!confirmed) fail("explicit confirmation required: pass --confirm or set TRUTHPASS_DEPLOY_CONFIRM=DEPLOY_TO_BOHR_TESTNET");

  const privateKey = process.env.TRUTHPASS_DEPLOYER_PRIVATE_KEY;
  if (!privateKey) fail("TRUTHPASS_DEPLOYER_PRIVATE_KEY is not set; refusing to deploy");
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) fail("TRUTHPASS_DEPLOYER_PRIVATE_KEY is not a valid 32-byte hex key");

  const rpcUrl = process.env.TRUTHPASS_BOT_CHAIN_RPC_URL || DEFAULT_RPC_URL;
  const expectedChainId = parseChainId(process.env.TRUTHPASS_EXPECTED_CHAIN_ID || DEFAULT_CHAIN_ID.toString(), "TRUTHPASS_EXPECTED_CHAIN_ID");
  if (expectedChainId !== DEFAULT_CHAIN_ID) fail(`this deployment script is testnet-only; expected chain id must remain ${DEFAULT_CHAIN_ID}`);
  const confirmations = Number.parseInt(process.env.TRUTHPASS_CONFIRMATIONS || "1", 10);
  if (!Number.isInteger(confirmations) || confirmations < 1 || confirmations > 20) fail("TRUTHPASS_CONFIRMATIONS must be an integer from 1 to 20");

  const provider = new JsonRpcProvider(rpcUrl, Number(expectedChainId), { staticNetwork: false });
  const network = await provider.getNetwork();
  if (network.chainId !== expectedChainId) fail(`RPC chain id mismatch: expected ${expectedChainId}, got ${network.chainId}`);

  const signer = new Wallet(privateKey, provider);
  const deployerAddress = await signer.getAddress();
  const balance = await provider.getBalance(deployerAddress);
  if (balance <= 0n) fail(`deployer ${deployerAddress} has zero native balance on chain ${expectedChainId}`);

  const artifact = await readArtifact();
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);
  const unsigned = await factory.getDeployTransaction();
  const estimate = await provider.estimateGas({ ...unsigned, from: deployerAddress });
  const feeData = await provider.getFeeData();
  const feePerGas = feeData.maxFeePerGas ?? feeData.gasPrice;
  if (!feePerGas || feePerGas <= 0n) fail("RPC did not return a usable gas price; refusing to estimate deployment cost");
  const estimatedCost = estimate * feePerGas;
  if (balance < estimatedCost) {
    fail(`insufficient balance: need at least ${estimatedCost.toString()} wei for estimated deployment, have ${balance.toString()} wei`);
  }

  const deployed = await factory.deploy();
  const deploymentTx = deployed.deploymentTransaction();
  if (!deploymentTx?.hash) fail("deployment transaction hash was not returned");
  const receipt = await deploymentTx.wait(confirmations);
  if (!receipt || receipt.status !== 1) fail(`deployment receipt failed for ${deploymentTx.hash}`);
  const contractAddress = await deployed.getAddress();

  const code = await provider.getCode(contractAddress);
  const codeVerified = code !== "0x";
  if (!codeVerified) fail(`eth_getCode returned 0x for deployed address ${contractAddress}`);
  const contract = new Contract(contractAddress, artifact.abi, provider);
  const deployedChainId = BigInt((await contract.DEPLOYED_CHAIN_ID()).toString());
  const domainSeparator = await contract.DOMAIN_SEPARATOR();
  const domainVerified = deployedChainId === expectedChainId && typeof domainSeparator === "string" && /^0x[0-9a-fA-F]{64}$/.test(domainSeparator);
  if (!domainVerified) fail("DOMAIN_SEPARATOR or DEPLOYED_CHAIN_ID read-back verification failed");

  console.log(JSON.stringify(publicResult({
    network,
    chainId: expectedChainId,
    rpcUrl: safeRpcLabel(rpcUrl),
    explorerUrl: `${EXPLORER_URL}/tx/${deploymentTx.hash}`,
    deployerAddress,
    contractAddress,
    deploymentTxHash: deploymentTx.hash,
    deploymentBlockNumber: receipt.blockNumber,
    confirmations,
    domainSeparator,
    deployedChainId,
    codeVerified,
    domainVerified,
    sourceMode: artifact.mode,
    source: artifact.source,
  }), null, 2));
}

main().catch((error) => {
  // Error messages contain only public addresses and estimates. Never include
  // process.env or the signer object in an error path.
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
