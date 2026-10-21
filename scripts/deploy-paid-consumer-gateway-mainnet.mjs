#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import solc from "solc";
import { ContractFactory, JsonRpcProvider, Wallet, getAddress, parseEther } from "ethers";
import { configureEthersNetwork } from "./ethers-network.mjs";

const ROOT = process.cwd();
const RPC = process.env.TRUTHPASS_MAINNET_RPC_URL || "https://rpc.botchain.ai";
const CHAIN_ID = 677n;
const EXPLORER = "https://scan.botchain.ai";
const CONFIRM = "DEPLOY_TRUTHPASS_PAID_GATEWAY_MAINNET";

function fail(message) { throw new Error(`[deploy-paid-consumer-gateway-mainnet] ${message}`); }
function address(value, name) { try { return getAddress(value); } catch { fail(`${name} is not a valid EVM address`); } }

async function artifact() {
  const sourcePath = path.join(ROOT, "contracts", "TruthPassPaidConsumerGatewayV2.sol");
  const input = {
    language: "Solidity",
    sources: { "TruthPassPaidConsumerGatewayV2.sol": { content: await fs.readFile(sourcePath, "utf8") } },
    settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } },
  };
  const output = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = (output.errors || []).filter((item) => item.severity === "error");
  if (errors.length) fail(errors.map((item) => item.formattedMessage).join("\n"));
  const contract = output.contracts?.["TruthPassPaidConsumerGatewayV2.sol"]?.TruthPassPaidConsumerGatewayV2;
  if (!contract?.abi || !contract.evm?.bytecode?.object) fail("compiled paid gateway artifact is missing");
  return { abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}` };
}

async function main() {
  configureEthersNetwork();
  const dryRun = process.argv.includes("--dry-run");
  const confirmed = process.argv.includes("--confirm") && process.env.TRUTHPASS_PAID_GATEWAY_DEPLOY_CONFIRM === CONFIRM;
  if (!dryRun && !confirmed) fail(`live deployment requires --confirm and TRUTHPASS_PAID_GATEWAY_DEPLOY_CONFIRM=${CONFIRM}`);

  const deployment = JSON.parse(await fs.readFile(path.join(ROOT, "config", "bot-chain-mainnet.deployed.json"), "utf8"));
  const anchor = address(process.env.TRUTHPASS_CONTRACT_ADDRESS || deployment.contract?.address, "TRUTHPASS_CONTRACT_ADDRESS");
  const merchant = address(process.env.TRUTHPASS_MERCHANT_ADDRESS, "TRUTHPASS_MERCHANT_ADDRESS");
  const domain = deployment.contract?.domainSeparator;
  if (!/^0x[0-9a-fA-F]{64}$/.test(domain || "")) fail("deployment metadata has no domainSeparator");
  const priceWei = process.env.TRUTHPASS_PURCHASE_PRICE_WEI || parseEther("0.001").toString();
  if (!/^\d+$/.test(priceWei) || BigInt(priceWei) <= 0n) fail("TRUTHPASS_PURCHASE_PRICE_WEI must be a positive integer");

  const provider = new JsonRpcProvider(RPC, Number(CHAIN_ID), { staticNetwork: true, batchMaxCount: 1 });
  if ((await provider.getNetwork()).chainId !== CHAIN_ID) fail("RPC network mismatch; expected Chain ID 677");
  const compiled = await artifact();
  const deployer = process.env.TRUTHPASS_DEPLOYER_PRIVATE_KEY ? new Wallet(process.env.TRUTHPASS_DEPLOYER_PRIVATE_KEY, provider) : null;
  const deployerAddress = address(process.env.TRUTHPASS_DEPLOYER_ADDRESS || deployer?.address, "TRUTHPASS_DEPLOYER_ADDRESS");
  const factory = new ContractFactory(compiled.abi, compiled.bytecode, deployer || undefined);
  const unsigned = await factory.getDeployTransaction(anchor, Number(CHAIN_ID), domain, merchant, priceWei);
  const gas = await provider.estimateGas({ from: deployerAddress, data: unsigned.data });
  const fee = await provider.getFeeData();
  const gasPrice = fee.gasPrice ?? fee.maxFeePerGas;
  const result = {
    schemaVersion: "truthpass.paid-consumer-gateway-deployment.v1",
    network: "bot-mainnet",
    chainId: Number(CHAIN_ID),
    anchorAddress: anchor,
    merchantAddress: merchant,
    purchasePriceWei: priceWei,
    purchasePriceBot: "0.001",
    deployerAddress,
    rpcUrl: RPC,
    explorerUrl: EXPLORER,
    estimatedGas: gas.toString(),
    gasPriceWei: gasPrice?.toString() ?? null,
    status: dryRun ? "dry_run" : "pending",
  };
  if (dryRun) { console.log(JSON.stringify(result, null, 2)); return; }
  if (!deployer) fail("TRUTHPASS_DEPLOYER_PRIVATE_KEY is required for live deployment");
  const deployed = await factory.deploy(anchor, Number(CHAIN_ID), domain, merchant, priceWei);
  const tx = deployed.deploymentTransaction();
  if (!tx) fail("deployment transaction was not created");
  const receipt = await tx.wait(2);
  if (!receipt || receipt.status !== 1) fail(`deployment receipt failed: ${tx.hash}`);
  const gatewayAddress = await deployed.getAddress();
  const code = await provider.getCode(gatewayAddress);
  if (code === "0x") fail("deployed paid gateway has no bytecode");
  const metadata = {
    ...result,
    status: "deployed_receipt_verified",
    paidConsumerGateway: { address: gatewayAddress, deploymentTxHash: tx.hash, deploymentBlockNumber: receipt.blockNumber, explorerUrl: `${EXPLORER}/address/${gatewayAddress}` },
  };
  await fs.writeFile(path.join(ROOT, "config", "bot-chain-mainnet.paid-gateway.json"), JSON.stringify(metadata, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify(metadata, null, 2));
}

main().catch((error) => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
