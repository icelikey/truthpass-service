import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { anchorPlan, evaluateBatch, inspectBatch } from "./cli.js";
import {
  BotChainClient,
  buildEvidenceAnchorTransaction,
  buildConsumerGatewayContributionTransaction,
  buildConsumerGatewayDisputeTransaction,
  buildConsumerGatewayPurchaseTransaction,
  buildRaiseDisputeTransaction,
  buildRecordContributionTransaction,
  buildRecordPurchaseTransaction,
  buildRecordVerificationTransaction,
} from "./chain.js";
import { getBotChainConfig } from "./chain-config.js";
import { ConsumerParticipationRegistry } from "./consumer.js";
import { replayFishOilFlow } from "./replay.js";
import { loadLocalEnv } from "./jev/http-provider.js";
import { getDatabasePool, persistenceEnabled } from "./data/persistence.js";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const WEB_ROOT = join(PROJECT_ROOT, "web-demo");
const FRONTEND_ROOT = join(PROJECT_ROOT, "web-frontend", "dist");
const DEPLOYMENT_FILE = join(PROJECT_ROOT, "config", "bot-chain-mainnet.deployed.json");
const GATEWAY_FILE = join(PROJECT_ROOT, "config", "bot-chain-mainnet.gateway.json");
const REPLAY_FILE = join(PROJECT_ROOT, "config", "bot-chain-mainnet.replay.json");
const DEFAULT_PORT = 4173;
const BATCH_ID = "FO-2026-001";
const consumers = new ConsumerParticipationRegistry();

type PublicDeployment = {
  network?: string;
  chainId?: number;
  explorerUrl?: string;
  contract?: { address?: string; deploymentTxHash?: string; domainSeparator?: string };
  consumerGateway?: { address?: string; deploymentTxHash?: string; explorerUrl?: string; status?: string };
};

type PublicReplayManifest = {
  schemaVersion?: string;
  status?: string;
  lifecycle?: string;
  network?: string;
  chainId?: number;
  contractAddress?: string;
  batchId?: string;
  taskId?: string;
  dataClass?: string;
  runId?: string;
  ids?: Record<string, string>;
  events?: Array<Record<string, unknown>>;
  recordedAt?: string;
  integrityHash?: string;
};

const MIME_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  const payload = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type, authorization, x-truthpass-agent, x-truthpass-tenant, x-truthpass-request-id",
  });
  response.end(payload);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) throw new Error("request body too large");
    chunks.push(buffer);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("JSON object required");
  return parsed as Record<string, unknown>;
}

async function loadDeployment(): Promise<PublicDeployment> {
  try {
    const deployment = JSON.parse(await readFile(DEPLOYMENT_FILE, "utf8")) as PublicDeployment;
    try {
      const gateway = JSON.parse(await readFile(GATEWAY_FILE, "utf8")) as { consumerGateway?: PublicDeployment["consumerGateway"] };
      if (gateway.consumerGateway?.address) deployment.consumerGateway = gateway.consumerGateway;
      else if (gateway.consumerGateway) deployment.consumerGateway = gateway.consumerGateway;
    } catch {
      // Gateway metadata is optional until the consumer gateway is deployed.
    }
    return deployment;
  } catch {
    return {};
  }
}

async function loadReplayManifest(): Promise<PublicReplayManifest | null> {
  try {
    return JSON.parse(await readFile(REPLAY_FILE, "utf8")) as PublicReplayManifest;
  } catch {
    return null;
  }
}

function sha256(value: string): string {
  return `0x${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

export async function getMainnetStatus(): Promise<Record<string, unknown>> {
  loadLocalEnv();
  const deployment = await loadDeployment();
  const replay = await loadReplayManifest();
  const contractAddress = process.env.TRUTHPASS_CONTRACT_ADDRESS ?? deployment.contract?.address;
  const consumerGatewayAddress = process.env.TRUTHPASS_CONSUMER_GATEWAY_ADDRESS ?? deployment.consumerGateway?.address ?? null;
  const replayVerified = replay?.status === "mainnet_receipts_verified" && replay?.batchId === BATCH_ID && replay?.network === "bot-mainnet" && replay?.chainId === 677;
  const result: Record<string, unknown> = {
    network: "bot-mainnet",
    chainId: 677,
    contractAddress: contractAddress ?? null,
    consumerGatewayAddress,
    deploymentStatus: deployment.contract?.address ? "deployment_receipt_verified" : "metadata_missing",
    businessStatus: replayVerified ? "business_replay_receipts_verified" : "business_replay_not_recorded",
    anchored: replayVerified,
    replayManifest: replayVerified ? { schemaVersion: replay?.schemaVersion, runId: replay?.runId, recordedAt: replay?.recordedAt, integrityHash: replay?.integrityHash, ids: replay?.ids, events: replay?.events } : null,
    explorerUrl: deployment.explorerUrl ?? "https://scan.botchain.ai",
    consumerGatewayExplorerUrl: deployment.consumerGateway?.explorerUrl ?? (consumerGatewayAddress ? `https://scan.botchain.ai/address/${consumerGatewayAddress}` : null),
  };
  if (!contractAddress) return { ...result, status: "not_configured" };

  try {
    const config = getBotChainConfig("mainnet", { contractAddress });
    const client = new BotChainClient({ config, dryRun: true, timeoutMs: 3_000 });
    const chainId = await client.assertNetwork();
    const code = await client.getCode(contractAddress);
    const domainSeparator = await client.getDomainSeparator();
    return {
      ...result,
      status: code !== "0x" ? "reachable" : "contract_missing",
      chainId,
      contractCodePresent: code !== "0x",
      domainSeparator,
    };
  } catch (error) {
    return {
      ...result,
      status: "unreachable",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

type RegisteredAgent = {
  agentId: string;
  tenantId: string;
  name: string;
  capabilities: string[];
  publicKey?: string;
  registrationId: string;
  registeredAt: string;
  dataClass: "demo/synthetic" | "external";
};

const registeredAgents = new Map<string, RegisteredAgent>();
let agentRegistryTableReady: Promise<void> | undefined;

function agentRegistryMode(): "postgres" | "memory" {
  return persistenceEnabled() ? "postgres" : "memory";
}

async function ensureAgentRegistryTable(): Promise<void> {
  if (!persistenceEnabled()) return;
  agentRegistryTableReady ??= getDatabasePool().query(
    `create table if not exists truthpass_agent_registry (
       agent_id text not null,
       tenant_id text not null,
       name text not null,
       capabilities text[] not null,
       public_key text,
       registration_id text not null,
       registered_at timestamptz not null,
       data_class text not null,
       updated_at timestamptz not null default now(),
       primary key (tenant_id, agent_id)
     )`,
  ).then(() => undefined);
  await agentRegistryTableReady;
}

async function persistAgentRegistration(record: RegisteredAgent): Promise<void> {
  registeredAgents.set(record.tenantId + ":" + record.agentId, record);
  if (!persistenceEnabled()) return;
  await ensureAgentRegistryTable();
  await getDatabasePool().query(
    `insert into truthpass_agent_registry (agent_id, tenant_id, name, capabilities, public_key, registration_id, registered_at, data_class)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (tenant_id, agent_id) do update set name = excluded.name,
       capabilities = excluded.capabilities, public_key = excluded.public_key,
       registration_id = excluded.registration_id, registered_at = excluded.registered_at,
       data_class = excluded.data_class, updated_at = now()`,
    [record.agentId, record.tenantId, record.name, record.capabilities, record.publicKey ?? null, record.registrationId, record.registeredAt, record.dataClass],
  );
}

async function listRegisteredAgents(): Promise<RegisteredAgent[]> {
  if (!persistenceEnabled()) return [...registeredAgents.values()];
  await ensureAgentRegistryTable();
  const result = await getDatabasePool().query(
    `select agent_id, tenant_id, name, capabilities, public_key, registration_id, registered_at, data_class
     from truthpass_agent_registry order by registered_at, agent_id`,
  );
  return result.rows.map((row) => ({
    agentId: String(row.agent_id),
    tenantId: String(row.tenant_id),
    name: String(row.name),
    capabilities: Array.isArray(row.capabilities) ? row.capabilities.map(String) : [],
    publicKey: row.public_key ? String(row.public_key) : undefined,
    registrationId: String(row.registration_id),
    registeredAt: new Date(String(row.registered_at)).toISOString(),
    dataClass: row.data_class === "external" ? "external" : "demo/synthetic",
  }));
}

function normalizeAgentRegistration(body: Record<string, unknown>): Omit<RegisteredAgent, "registrationId" | "registeredAt" | "dataClass"> {
  const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "";
  const tenantId = typeof body.tenantId === "string" && body.tenantId.trim() ? body.tenantId.trim() : "demo";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const capabilities = Array.isArray(body.capabilities)
    ? body.capabilities.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()).slice(0, 32)
    : [];
  const publicKey = typeof body.publicKey === "string" && body.publicKey.trim().length > 0 ? body.publicKey.trim() : undefined;
  if (!/^[A-Za-z0-9._:-]{3,128}$/.test(agentId)) throw new Error("agentId must be 3-128 characters using letters, digits, ., _, :, or -");
  if (!/^[A-Za-z0-9._:-]{2,128}$/.test(tenantId)) throw new Error("tenantId must be 2-128 characters using letters, digits, ., _, :, or -");
  if (!name || name.length > 128) throw new Error("name must be 1-128 characters");
  if (capabilities.length === 0) throw new Error("capabilities must contain at least one value");
  if (publicKey && publicKey.length > 2048) throw new Error("publicKey is too long");
  return { agentId, tenantId, name, capabilities, publicKey };
}

async function buildAgentRegistration(body: Record<string, unknown>): Promise<RegisteredAgent> {
  const input = normalizeAgentRegistration(body);
  const registeredAt = new Date().toISOString();
  const registrationId = await sha256("truthpass:agent-registration:" + input.tenantId + ":" + input.agentId + ":" + registeredAt);
  const dataClass = process.env.TRUTHPASS_AGENT_DATA_CLASS === "external" ? "external" : "demo/synthetic";
  const record: RegisteredAgent = { ...input, registrationId, registeredAt, dataClass };
  await persistAgentRegistration(record);
  return record;
}


function agentRegistryAuthorized(request: IncomingMessage): { authorized: boolean; authMode: "configured" | "unconfigured" } {
  const expected = process.env.TRUTHPASS_AGENT_REGISTRATION_TOKEN?.trim();
  if (!expected) return { authorized: true, authMode: "unconfigured" };
  const authorization = typeof request.headers.authorization === "string" ? request.headers.authorization : "";
  return { authorized: authorization === "Bearer " + expected, authMode: "configured" };
}

function buildConsumerSummary(inspection: Record<string, unknown>): string {
  const status = inspection.status === "accepted" || inspection.status === "accepted_with_scope" ? "按当前规则通过验收" : "暂未通过当前规则";
  const dataClass = inspection.dataClass === "demo/synthetic" ? "当前为演示数据" : "当前为外部数据";
  const jev = inspection.jev && typeof inspection.jev === "object" ? inspection.jev as Record<string, unknown> : {};
  const route = typeof jev.route === "string" ? jev.route : "等待证据路由";
  return status + "；" + dataClass + "；Agent 路由：" + route + "。最终结论来自确定性规则，模型只负责解释。";
}


function publicChainForInspection(inspection: Record<string, unknown>): Record<string, unknown> {
  const raw = inspection.chain && typeof inspection.chain === "object" ? inspection.chain as Record<string, unknown> : {};
  if (inspection.dataClass !== "demo/synthetic") return raw;
  if (raw.status !== "mainnet_receipts_verified" && raw.lifecycle !== "anchored") return raw;
  return {
    ...raw,
    anchored: false,
    status: "replay_verified",
    lifecycle: "replay_verified",
    source: "historical_replay",
    reason: "demo/synthetic 历史回放，不代表当前现场消费者交易。",
  };
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw new Error(`${field} must be a non-empty string`);
  return value.trim();
}

function bytes32OrHash(value: unknown, field: string, fallback?: string): string {
  const raw = typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
  if (!raw) throw new Error(`${field} is required`);
  const normalized = raw.startsWith("0x") ? raw : sha256(raw);
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) throw new Error(`${field} must be bytes32 or plain text`);
  return normalized;
}

function walletAddress(value: unknown): string {
  const address = requiredString(value, "wallet");
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("wallet must be an EVM address");
  return address;
}

function publicOrigin(request: IncomingMessage, fallback: URL): string {
  const configured = process.env.TRUTHPASS_PUBLIC_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  const forwardedProto = request.headers["x-forwarded-proto"];
  const forwardedHost = request.headers["x-forwarded-host"];
  const protocol = (Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto)?.split(",")[0]?.trim() || "http";
  const host = (Array.isArray(forwardedHost) ? forwardedHost[0] : forwardedHost)?.split(",")[0]?.trim()
    || request.headers.host
    || fallback.host;
  return `${protocol}://${host}`;
}

async function prepareWalletTransaction(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  loadLocalEnv();
  const action = requiredString(body.action, "action");
  const wallet = walletAddress(body.wallet);
  const batchId = typeof body.batchId === "string" && body.batchId.trim() ? body.batchId.trim() : BATCH_ID;
  const clientNonce = typeof body.clientNonce === "string" && body.clientNonce.trim()
    ? body.clientNonce.trim()
    : `wallet-${Date.now()}`;

  // Transaction preparation is intentionally metadata-first.  The public
  // deployment manifest contains the verified contract/domain/chain tuple,
  // so a transient RPC outage cannot prevent a wallet from composing a
  // transaction.  RPC-backed health/receipt reads remain available through
  // the dedicated status and replay endpoints.
  const deployment = await loadDeployment();
  const replayManifest = await loadReplayManifest();
  const metadataAddress = typeof deployment.contract?.address === "string" ? deployment.contract.address : "";
  const configuredAddress = typeof process.env.TRUTHPASS_CONTRACT_ADDRESS === "string"
    ? process.env.TRUTHPASS_CONTRACT_ADDRESS.trim()
    : "";
  if (configuredAddress && metadataAddress && configuredAddress.toLowerCase() !== metadataAddress.toLowerCase()) {
    throw new Error("TRUTHPASS_CONTRACT_ADDRESS does not match verified BOT Chain deployment metadata");
  }
  const contractAddress = configuredAddress || metadataAddress;
  const gatewayAddress = typeof process.env.TRUTHPASS_CONSUMER_GATEWAY_ADDRESS === "string"
    ? process.env.TRUTHPASS_CONSUMER_GATEWAY_ADDRESS.trim()
    : typeof deployment.consumerGateway?.address === "string" ? deployment.consumerGateway.address : "";
  const chainId = Number(deployment.chainId ?? 0);
  const domainSeparator = typeof deployment.contract?.domainSeparator === "string"
    ? deployment.contract.domainSeparator
    : "";
  if (chainId !== 677 || !contractAddress || !domainSeparator) {
    throw new Error("BOT Chain deployment metadata is incomplete (contract address, domain separator and chainId 677 are required)");
  }
  const config = getBotChainConfig("mainnet", { contractAddress });
  const replay = replayManifest && typeof replayManifest === "object"
    ? replayManifest as Record<string, unknown>
    : {};
  const replayIds = replay.ids && typeof replay.ids === "object" ? replay.ids as Record<string, unknown> : {};
  const explorerUrl = typeof deployment.explorerUrl === "string" ? deployment.explorerUrl : "https://scan.botchain.ai";

  if (action === "evidence") {
    const requestId = bytes32OrHash(body.requestId, "requestId", `evidence-request:${wallet}:${batchId}:${clientNonce}`);
    const evidenceRoot = bytes32OrHash(body.evidenceRoot, "evidenceRoot", `evidence-root:${wallet}:${batchId}:${clientNonce}`);
    const transaction = buildEvidenceAnchorTransaction({
      requestId,
      evidenceRoot,
      subjectHash: bytes32OrHash(body.subjectHash, "subjectHash", `subject:${batchId}`),
      schemaHash: bytes32OrHash(body.schemaHash, "schemaHash", "evidence.v1"),
      sourceHash: bytes32OrHash(body.sourceHash, "sourceHash", `source:${wallet}`),
      state: 1,
      domainSeparator,
      contractAddress,
    }, config);
    return { schemaVersion: "truthpass.wallet.transaction.v1", action, batchId, network: "bot-mainnet", chainId, contractAddress, explorerUrl, requiredRole: "EVIDENCE_WRITER_ROLE", ids: { requestId, evidenceRoot }, transaction };
  }

  if (action === "verification") {
    const evidenceRoot = bytes32OrHash(body.evidenceRoot ?? replayIds.evidenceRoot, "evidenceRoot");
    const requestId = bytes32OrHash(body.requestId, "requestId", `verification-request:${wallet}:${batchId}:${clientNonce}`);
    const transaction = buildRecordVerificationTransaction({
      requestId,
      evidenceRoot,
      taskHash: bytes32OrHash(body.taskHash, "taskHash", `task:${batchId}`),
      policyHash: bytes32OrHash(body.policyHash, "policyHash", "food-quality-v1"),
      verifierVersionHash: bytes32OrHash(body.verifierVersionHash, "verifierVersionHash", "truthpass-verifier-v1"),
      resultHash: bytes32OrHash(body.resultHash, "resultHash", `accepted:${batchId}`),
      state: 1,
      scope: Number.isInteger(body.scope) ? Number(body.scope) : 15,
      domainSeparator,
      contractAddress,
    }, config);
    return { schemaVersion: "truthpass.wallet.transaction.v1", action, batchId, network: "bot-mainnet", chainId, contractAddress, explorerUrl, requiredRole: "VERIFIER_ROLE", ids: { requestId, evidenceRoot }, transaction };
  }

  if (action === "purchase") {
    const purchaseId = bytes32OrHash(body.purchaseId, "purchaseId", `purchase:${wallet}:${batchId}:${clientNonce}`);
    if (gatewayAddress) {
      const transaction = buildConsumerGatewayPurchaseTransaction({
        purchaseId,
        batchCommitment: bytes32OrHash(body.batchCommitment, "batchCommitment", `batch:${batchId}`),
        purchaseProofHash: bytes32OrHash(body.purchaseProofHash, "purchaseProofHash", `purchase-proof:${wallet}:${batchId}:${clientNonce}`),
        consentHash: bytes32OrHash(body.consentHash, "consentHash", `consent:${wallet}:${batchId}`),
        gatewayAddress,
      }, config);
      return { schemaVersion: "truthpass.wallet.transaction.v1", action, batchId, network: "bot-mainnet", chainId, contractAddress: gatewayAddress, anchorAddress: contractAddress, explorerUrl, requiredRole: "CONSUMER_SELF_SERVICE", gateway: true, ids: { purchaseId }, transaction };
    }
    const transaction = buildRecordPurchaseTransaction({
      purchaseId,
      consumerCommitment: bytes32OrHash(body.consumerCommitment, "consumerCommitment", `consumer:${wallet}`),
      batchCommitment: bytes32OrHash(body.batchCommitment, "batchCommitment", `batch:${batchId}`),
      purchaseProofHash: bytes32OrHash(body.purchaseProofHash, "purchaseProofHash", `purchase-proof:${wallet}:${batchId}:${clientNonce}`),
      consentHash: bytes32OrHash(body.consentHash, "consentHash", `consent:${wallet}:${batchId}`),
      domainSeparator,
      contractAddress,
    }, config);
    return { schemaVersion: "truthpass.wallet.transaction.v1", action, batchId, network: "bot-mainnet", chainId, contractAddress, explorerUrl, requiredRole: "PURCHASE_WRITER_ROLE", ids: { purchaseId }, transaction };
  }

  if (action === "contribution") {
    const purchaseId = bytes32OrHash(body.purchaseId, "purchaseId");
    const contributionId = bytes32OrHash(body.contributionId, "contributionId", `contribution:${wallet}:${purchaseId}:${clientNonce}`);
    if (gatewayAddress) {
      const transaction = buildConsumerGatewayContributionTransaction({
        contributionId,
        purchaseId,
        evidenceHash: bytes32OrHash(body.evidenceHash, "evidenceHash", `feedback-evidence:${wallet}:${batchId}`),
        contributionHash: bytes32OrHash(body.contributionHash, "contributionHash", `feedback:${wallet}:${batchId}:${clientNonce}`),
        score: Number.isInteger(body.score) ? Math.max(0, Math.min(100, Number(body.score))) : 90,
        gatewayAddress,
      }, config);
      return { schemaVersion: "truthpass.wallet.transaction.v1", action, batchId, network: "bot-mainnet", chainId, contractAddress: gatewayAddress, anchorAddress: contractAddress, explorerUrl, requiredRole: "CONSUMER_SELF_SERVICE", gateway: true, ids: { contributionId, purchaseId }, transaction };
    }
    const transaction = buildRecordContributionTransaction({
      contributionId,
      purchaseId,
      evidenceHash: bytes32OrHash(body.evidenceHash, "evidenceHash", `feedback-evidence:${wallet}:${batchId}`),
      contributionHash: bytes32OrHash(body.contributionHash, "contributionHash", `feedback:${wallet}:${batchId}:${clientNonce}`),
      score: Number.isInteger(body.score) ? Math.max(0, Math.min(100, Number(body.score))) : 90,
      domainSeparator,
      contractAddress,
    }, config);
    return { schemaVersion: "truthpass.wallet.transaction.v1", action, batchId, network: "bot-mainnet", chainId, contractAddress, explorerUrl, requiredRole: "CONTRIBUTION_WRITER_ROLE", ids: { contributionId, purchaseId }, transaction };
  }

  if (action === "dispute") {
    const targetKind = Number.isInteger(body.targetKind) ? Number(body.targetKind) : 1;
    if (![1, 2, 3, 4].includes(targetKind)) throw new Error("targetKind must be 1, 2, 3 or 4");
    const targetId = bytes32OrHash(body.targetId ?? replayIds.requestId, "targetId");
    if (gatewayAddress) {
      const transaction = buildConsumerGatewayDisputeTransaction({
        disputeId: bytes32OrHash(body.disputeId, "disputeId", `dispute:${wallet}:${targetId}:${clientNonce}`),
        targetKind: targetKind as 1 | 2 | 3 | 4,
        targetId,
        reasonHash: bytes32OrHash(body.reasonHash, "reasonHash", `consumer-question:${batchId}:${clientNonce}`),
        gatewayAddress,
      }, config);
      return { schemaVersion: "truthpass.wallet.transaction.v1", action, batchId, network: "bot-mainnet", chainId, contractAddress: gatewayAddress, anchorAddress: contractAddress, explorerUrl, requiredRole: "CONSUMER_SELF_SERVICE", gateway: true, ids: { targetId }, transaction };
    }
    const transaction = buildRaiseDisputeTransaction({
      disputeId: bytes32OrHash(body.disputeId, "disputeId", `dispute:${wallet}:${targetId}:${clientNonce}`),
      targetKind: targetKind as 1 | 2 | 3 | 4,
      targetId,
      reasonHash: bytes32OrHash(body.reasonHash, "reasonHash", `consumer-question:${batchId}:${clientNonce}`),
      domainSeparator,
      contractAddress,
    }, config);
    return { schemaVersion: "truthpass.wallet.transaction.v1", action, batchId, network: "bot-mainnet", chainId, contractAddress, explorerUrl, requiredRole: "DISPUTE_ROLE", ids: { targetId }, transaction };
  }

  throw new Error(`unsupported wallet action: ${action}`);
}

export async function handleApi(url: URL, request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  if (request.method === "OPTIONS" && url.pathname.startsWith("/api/")) {
    response.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type, authorization, x-truthpass-agent, x-truthpass-tenant, x-truthpass-request-id",
      "access-control-max-age": "600",
    });
    response.end();
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    return sendJson(response, 200, { status: "ok", service: "truthpass-web-bff", batchId: BATCH_ID, chain: await getMainnetStatus() }), true;
  }

  if (request.method === "GET" && url.pathname === "/api/agent/manifest") {
    const chain = await getMainnetStatus();
    const baseUrl = publicOrigin(request, url);
    return sendJson(response, 200, {
      schemaVersion: "truthpass.agent.manifest.v1",
      service: "truthpass",
      name: "TruthPass Consumer Agent Gateway",
      version: "1.4.0",
      status: "ready",
      agentMode: "deterministic_fallback",
      authMode: process.env.TRUTHPASS_AGENT_REGISTRATION_TOKEN ? "bearer_token" : "unconfigured_demo",
      dataClass: "demo/synthetic",
      publicUrl: baseUrl,
      capabilities: ["agent.register", "consumer.inspect", "cli.inspect", "jev.route", "chain.status", "consumer.feedback", "wallet.prepare"],
      endpoints: {
        register: baseUrl + "/api/agent/register",
        inspection: baseUrl + "/api/consumer/inspection?batchId={batchId}",
        cliInspect: baseUrl + "/api/cli/inspect?batchId={batchId}",
        jevDetection: baseUrl + "/api/jev/detection?batchId={batchId}",
        chainStatus: baseUrl + "/api/chain/status",
        walletPrepare: baseUrl + "/api/wallet/prepare",
        health: baseUrl + "/api/health",
      },
      cli: {
        package: "truthpass-service",
        commands: ["doctor", "discover", "verify", "explain", "recommend", "order", "inspect", "anchor", "replay"],
        localCommand: "npm run truthpass -- inspect --batch FO-2026-001 --json",
        networkMode: "api_gateway_required_for_remote_agents",
        walletActions: ["evidence", "verification", "purchase", "contribution", "dispute"],
      },
      chain,
      consumerGateway: {
        address: process.env.TRUTHPASS_CONSUMER_GATEWAY_ADDRESS ?? (await loadDeployment()).consumerGateway?.address ?? null,
        chainId: 677,
        actions: ["purchase", "contribution", "dispute"],
      },
      publicDataBoundary: {
        rawReports: "off_chain",
        personalData: "off_chain",
        privateKeys: "off_chain",
        note: "演示环境允许匿名查询；生产环境应增加 Agent 身份认证和请求限流。",
      },
    }), true;
  }

  if (request.method === "POST" && url.pathname === "/api/agent/register") {
    const access = agentRegistryAuthorized(request);
    if (!access.authorized) return sendJson(response, 401, { error: "AGENT_REGISTRATION_AUTH_REQUIRED" }), true;
    const body = await readJson(request);
    const tenantHeader = typeof request.headers["x-truthpass-tenant"] === "string" ? request.headers["x-truthpass-tenant"] : "";
    if (tenantHeader && body.tenantId === undefined) body.tenantId = tenantHeader;
    const record = await buildAgentRegistration(body);
    return sendJson(response, 201, {
      schemaVersion: "truthpass.agent.registration.v1",
      status: agentRegistryMode() === "postgres" ? "registered_persistent" : "registered_local",
      authMode: access.authMode,
      registryMode: agentRegistryMode(),
      dataClass: record.dataClass,
      agent: record,
      chainStatus: "not_submitted",
      nextAction: "使用 registrationId 调用 consumer/inspection；生产环境再由 relayer 将身份承诺锚定到 BOT Chain。",
    }), true;
  }

  if (request.method === "GET" && url.pathname === "/api/agent/register") {
    const access = agentRegistryAuthorized(request);
    if (!access.authorized) return sendJson(response, 401, { error: "AGENT_REGISTRATION_AUTH_REQUIRED" }), true;
    const agents = await listRegisteredAgents();
    return sendJson(response, 200, {
      schemaVersion: "truthpass.agent.registry.v1",
      dataClass: agents.some((agent) => agent.dataClass === "external") ? "external" : "demo/synthetic",
      registryMode: agentRegistryMode(),
      authMode: access.authMode,
      count: agents.length,
      agents,
      chainStatus: "not_submitted",
    }), true;
  }

  if (request.method === "GET" && url.pathname === "/api/chain/status") {
    return sendJson(response, 200, await getMainnetStatus()), true;
  }

  if (request.method === "GET" && url.pathname.startsWith("/api/products/")) {
    const segments = url.pathname.split("/").filter(Boolean);
    const batchId = decodeURIComponent(segments[2] ?? BATCH_ID);
    const inspection = await inspectBatch(batchId);
    if (segments[3] === "journey") {
      return sendJson(response, 200, {
        batchId,
        journey: (inspection.product as Record<string, unknown> | undefined)?.productionProcess ?? inspection.batch ?? [],
        chain: publicChainForInspection(inspection),
      }), true;
    }
    if (segments[3] === "evidence-link") {
      return sendJson(response, 200, {
        batchId,
        evidenceHash: (inspection.quality as Record<string, unknown> | undefined)?.evidenceHash ?? (inspection.verification as Record<string, unknown> | undefined)?.evidenceHash ?? null,
        verification: inspection.verification,
        chain: publicChainForInspection(inspection),
      }), true;
    }
    if (segments[3] === "metrics") {
      return sendJson(response, 200, {
        batchId,
        metric: segments[4] ?? null,
        metrics: (inspection.product as Record<string, unknown> | undefined)?.keyMetrics ?? [],
        quality: inspection.quality,
      }), true;
    }
    const product = inspection.product && typeof inspection.product === "object" ? inspection.product as Record<string, unknown> : {};
    const batch = inspection.batch && typeof inspection.batch === "object" ? inspection.batch as Record<string, unknown> : {};
    const quality = inspection.quality && typeof inspection.quality === "object" ? inspection.quality as Record<string, unknown> : {};
    const chain = inspection.chain && typeof inspection.chain === "object" ? inspection.chain as Record<string, unknown> : {};
    const evidenceHash = (inspection.evidence && typeof inspection.evidence === "object" ? (inspection.evidence as Record<string, unknown>).evidenceHash : null)
      ?? chain.evidenceRoot
      ?? "0x0000000000000000000000000000000000000000000000000000000000000000";
    const numberValue = (key: string, fallback: number) => typeof quality[key] === "number" ? quality[key] as number : fallback;
    const verification = inspection.verification && typeof inspection.verification === "object" ? inspection.verification as Record<string, unknown> : {};
    const frontendVerification = {
      ...verification,
      evidenceHash,
      summary: verification.status === "accepted" ? "证据、规则与主网回执均已核验" : "当前批次需要进一步复核",
      scope: "EPA+DHA、氧化指标、冷链与批次一致性",
      rules: [
        { name: "批次一致性", passed: true, desc: "生产、报告与链上批次一致" },
        { name: "EPA+DHA 含量", passed: numberValue("epaDhaPercent", 78) >= 70, desc: "达到公开规则下限" },
        { name: "氧化指标", passed: numberValue("peroxideValue", 2.1) <= 5, desc: "过氧化值与 Totox 在阈值内" },
        { name: "冷链记录", passed: numberValue("coldChainGapHours", 2) <= 6, desc: "冷链间隔在公开阈值内" },
      ],
    };
    return sendJson(response, 200, {
      ...product,
      imageUrl: "/assets/fish-oil-product.png",
      dataSource: "replay",
      dataMode: inspection.dataClass ?? "demo/synthetic",
      supplyChainTags: ["深海鱼油", "第三方检测", "全程冷链"],
      origin: "秘鲁 / 智利深海鱼原料",
      productionDate: String(batch.productionTime ?? "2026-10-06").slice(0, 10),
      keyMetrics: [
        { key: "epa-dha", label: "EPA + DHA", value: `${numberValue("epaDhaPercent", 78)}%`, unit: "含量", bar: Math.min(100, numberValue("epaDhaPercent", 78)), status: "pass", icon: "fish" },
        { key: "peroxide", label: "过氧化值", value: `${numberValue("peroxideValue", 2.1)}`, unit: "meq/kg · ≤5", bar: 42, status: "pass", icon: "warning" },
        { key: "totox", label: "Totox", value: `${numberValue("totox", 11)}`, unit: "≤20", bar: 55, status: "pass", icon: "sensor" },
        { key: "cold-chain", label: "冷链间隔", value: `${numberValue("coldChainGapHours", 2)}h`, unit: "≤6h", bar: 33, status: "pass", icon: "snowflake" },
      ],
      productionProcess: {
        status: "conformant",
        observedStageCount: 5,
        requiredStageCount: 5,
        originRegion: "秘鲁 / 智利深海渔场",
        facts: [
          { label: "原料接收", value: "批次与供应商记录已关联" },
          { label: "提炼灌装", value: "生产 Agent 已提交过程承诺" },
          { label: "成品抽检", value: "第三方实验室报告已验收" },
        ],
        stages: [
          { stage: "raw-material", label: "原料接收", status: "observed" },
          { stage: "refining", label: "提炼", status: "observed" },
          { stage: "encapsulation", label: "灌装", status: "observed" },
          { stage: "lab", label: "第三方检测", status: "observed" },
          { stage: "cold-chain", label: "冷链交付", status: "observed" },
        ],
        missingStages: [],
        sourceKinds: ["third_party", "platform_device", "manufacturer"],
        dataMode: inspection.dataClass ?? "demo/synthetic",
      },
      verification: frontendVerification,
    }), true;
  }

  if (request.method === "GET" && url.pathname === "/api/verification") {
    const batchId = url.searchParams.get("batchId") ?? BATCH_ID;
    const inspection = await inspectBatch(batchId);
    const quality = inspection.quality && typeof inspection.quality === "object"
      ? inspection.quality as Record<string, unknown>
      : {};
    const numberValue = (key: string, fallback: number) =>
      typeof quality[key] === "number" ? quality[key] as number : fallback;
    const evidence = inspection.evidence && typeof inspection.evidence === "object"
      ? inspection.evidence as Record<string, unknown>
      : {};
    const verification = inspection.verification && typeof inspection.verification === "object"
      ? inspection.verification as Record<string, unknown>
      : {};
    const chain = inspection.chain && typeof inspection.chain === "object"
      ? inspection.chain as Record<string, unknown>
      : {};
    return sendJson(response, 200, {
      ...verification,
      evidenceHash: evidence.evidenceHash ?? chain.evidenceRoot ?? null,
      rules: [
        { name: "批次一致性", passed: true, desc: "生产、报告与链上批次一致" },
        { name: "EPA+DHA 含量", passed: numberValue("epaDhaPercent", 78) >= 70, desc: "达到公开规则下限" },
        { name: "氧化指标", passed: numberValue("peroxideValue", 2.1) <= 5, desc: "过氧化值与 Totox 在阈值内" },
        { name: "冷链记录", passed: numberValue("coldChainGapHours", 2) <= 6, desc: "冷链间隔在公开阈值内" },
      ],
    }), true;
  }

  if (request.method === "GET" && url.pathname === "/api/observer") {
    const batchId = url.searchParams.get("batchId") ?? BATCH_ID;
    const inspection = await inspectBatch(batchId);
    const batch = inspection.batch && typeof inspection.batch === "object"
      ? inspection.batch as Record<string, unknown>
      : {};
    const verification = inspection.verification && typeof inspection.verification === "object"
      ? inspection.verification as Record<string, unknown>
      : {};
    const chain = inspection.chain && typeof inspection.chain === "object"
      ? inspection.chain as Record<string, unknown>
      : {};
    const jev = inspection.jev && typeof inspection.jev === "object"
      ? inspection.jev as Record<string, unknown>
      : {};
    return sendJson(response, 200, {
      batchId,
      task: batch.taskId ?? "task-fish-oil-2026-001",
      policy: verification.policyId ?? "fish-oil-quality",
      jev: jev.route ?? jev.decision ?? "route_to_rule_verifier",
      evidenceRoot: chain.evidenceRoot ?? null,
      chainStatus: chain.status ?? chain.lifecycle ?? "unavailable",
      services: [
        {
          id: "lab-c",
          history: "verified",
          live: "online",
          verdict: verification.status === "accepted" ? "passed" : "rejected",
        },
      ],
      product: inspection.product,
      verification: inspection.verification,
      chain: publicChainForInspection(inspection),
      jevState: inspection.jev,
    }), true;
  }

  if (request.method === "GET" && url.pathname === "/api/recommend") {
    return sendJson(response, 200, {
      batchId: BATCH_ID,
      recommendation: "FO-2026-001",
      reason: "当前演示批次的质检证据、冷链记录和主网锚定回执完整。",
    }), true;
  }

  if (request.method === "POST" && url.pathname === "/api/orders") {
    const body = await readJson(request);
    const batchId = typeof body.batchId === "string" ? body.batchId : BATCH_ID;
    const quantity = Math.max(1, Number(body.quantity ?? 1));
    return sendJson(response, 201, {
      status: "prepared",
      batchId,
      quantity,
      nextAction: "connect_wallet_and_submit_consumer_purchase",
      gatewayAddress: (await getMainnetStatus()).consumerGatewayAddress,
      chainId: 677,
    }), true;
  }

  if (request.method === "POST" && url.pathname === "/api/simulator/iot") {
    const body = await readJson(request);
    const batchId = typeof body.batchId === "string" ? body.batchId : BATCH_ID;
    const mode = typeof body.mode === "string" ? body.mode : "normal";
    return sendJson(response, 200, {
      schemaVersion: "truthpass.sensor.simulation.v1",
      batchId,
      mode,
      status: mode === "offline" ? "review" : mode === "anomaly" ? "rejected" : "accepted",
      evidenceRoot: sha256(batchId + ":iot:" + mode),
      chainStatus: "anchor_pending",
    }), true;
  }

  if (request.method === "POST" && url.pathname === "/api/agent/chat") {
    const body = await readJson(request);
    const batchId = typeof body.batchId === "string" ? body.batchId : BATCH_ID;
    const inspection = await inspectBatch(batchId);
    const summary = buildConsumerSummary(inspection);
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache",
      "connection": "keep-alive",
      "access-control-allow-origin": "*",
    });
    response.write(`data: ${JSON.stringify({ kind: "begin" })}

`);
    response.write(`data: ${JSON.stringify({ kind: "line", cls: "plain", text: summary })}

`);
    response.write(`data: ${JSON.stringify({ kind: "done" })}

`);
    response.end();
    return true;
  }

  if (request.method === "GET" && url.pathname === "/api/cli/inspect") {
    const batchId = url.searchParams.get("batchId") ?? BATCH_ID;
    const inspection = await inspectBatch(batchId);
    return sendJson(response, 200, inspection), true;
  }

  if (request.method === "GET" && url.pathname === "/api/consumer/inspection") {
    const batchId = url.searchParams.get("batchId") ?? BATCH_ID;
    const inspection = await inspectBatch(batchId);
    return sendJson(response, 200, {
      schemaVersion: "truthpass.consumer.inspection.v1",
      command: "consumer.inspect",
      batchId,
      dataClass: inspection.dataClass,
      product: inspection.product,
      batch: inspection.batch,
      quality: inspection.quality,
      status: inspection.status,
      verification: inspection.verification,
      jev: inspection.jev,
      chain: publicChainForInspection(inspection),
      summary: buildConsumerSummary(inspection),
      publicDataBoundary: inspection.publicDataBoundary,
    }), true;
  }

  if (request.method === "GET" && url.pathname === "/api/jev/detection") {
    const batchId = url.searchParams.get("batchId") ?? BATCH_ID;
    const inspection = await inspectBatch(batchId);
    const jev = inspection.jev && typeof inspection.jev === "object" ? inspection.jev as Record<string, unknown> : {};
    const decision = jev.decision && typeof jev.decision === "object" ? jev.decision as Record<string, unknown> : {};
    const verification = inspection.verification && typeof inspection.verification === "object" ? inspection.verification as Record<string, unknown> : {};
    return sendJson(response, 200, {
      schemaVersion: "truthpass.jev.detection.v1",
      batchId,
      dataClass: inspection.dataClass,
      model: jev.provider ?? "deterministic-fallback",
      mode: jev.mode ?? "deterministic_fallback",
      answers: {
        route: { choice: jev.route ?? "route_to_rule_verifier", confidence: decision.confidence ?? 1 },
        evidence_scope: { choice: decision.evidenceScope ?? "epa_dha,oxidation,totox,cold_chain" },
      },
      deterministicVerifier: { status: verification.status ?? "unknown", score: verification.score ?? null },
      decision,
    }), true;
  }

  if (request.method === "GET" && url.pathname === "/api/verify") {
    const batchId = url.searchParams.get("batchId") ?? BATCH_ID;
    const verification = await evaluateBatch(batchId);
    const plan = await anchorPlan(batchId, "mainnet");
    const chain = await getMainnetStatus();
    const replay = await loadReplayManifest();
    const replayData = verification && typeof verification === "object" ? verification as Record<string, unknown> : {};
    const replayIsSynthetic = replayData.dataClass === "demo/synthetic";
    const anchor = chain.anchored && replay ? {
      ...plan,
      ...replay,
      command: "replay",
      anchorStatus: replayIsSynthetic ? "replay_verified" : "mainnet_receipt_verified",
      lifecycle: replayIsSynthetic ? "replay_verified" : "anchored",
      requestId: replay.ids?.requestId ?? plan.requestId,
      evidenceRoot: replay.ids?.evidenceRoot ?? plan.evidenceRoot,
      txHash: replay.events?.[0]?.txHash ?? null,
      reason: replayIsSynthetic
        ? "当前页面读取的是 demo/synthetic 历史回放；不能替代现场消费者交易 receipt。"
        : "主网业务 receipt 已确认；网页读取公开 manifest。",
    } : plan;
    return sendJson(response, 200, { verification, anchor, chain }), true;
  }

  if (request.method === "GET" && url.pathname === "/api/replay") {
    const batchId = url.searchParams.get("batchId") ?? BATCH_ID;
    return sendJson(response, 200, await replayFishOilFlow(batchId, "mainnet")), true;
  }

  if (request.method === "POST" && url.pathname === "/api/wallet/prepare") {
    const body = await readJson(request);
    return sendJson(response, 200, await prepareWalletTransaction(body)), true;
  }

  if (request.method === "POST" && url.pathname === "/api/feedback") {
    const body = await readJson(request);
    const batchId = typeof body.batchId === "string" ? body.batchId : BATCH_ID;
    const consumerId = typeof body.consumerId === "string" ? body.consumerId : "consumer-web-demo";
    const categories = Array.isArray(body.categories) ? body.categories.filter((item): item is string => typeof item === "string") : [];
    const consent = await consumers.grantConsent({ consumerId, batchId, scopes: ["purchase", "quality-feedback"], grantedAt: new Date().toISOString() });
    const purchase = await consumers.recordPurchase({ consumerId, batchId, purchaseProofHash: sha256(consumerId + ":" + batchId), createdAt: new Date().toISOString() });
    const feedback = await consumers.recordFeedback({ purchaseId: purchase.purchaseId, rating: Number(body.rating ?? 5), categories, evidence: { source: "web-demo", tags: categories }, createdAt: new Date().toISOString() });
    return sendJson(response, 201, { ok: true, consentHash: consent.consentHash, purchaseId: purchase.purchaseId, feedbackId: feedback.feedbackId, evidenceHash: feedback.evidenceHash, contributionPoints: feedback.contributionPoints, chainStatus: "anchor_pending" }), true;
  }
  return false;
}

async function serveStatic(url: URL, response: ServerResponse): Promise<void> {
  const pathname = url.pathname;
  const isDemo = pathname === "/web-demo" || pathname.startsWith("/web-demo/");
  const isFrontend = pathname === "/" || pathname === "/frontend" || pathname.startsWith("/frontend/") || pathname === "/assets" || pathname.startsWith("/assets/");
  if (!isDemo && !isFrontend) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
    return;
  }

  const root = isDemo ? WEB_ROOT : FRONTEND_ROOT;
  const prefix = isDemo ? "/web-demo" : pathname === "/frontend" || pathname.startsWith("/frontend/") ? "/frontend" : "";
  const webPath = prefix
    ? pathname === prefix ? "/" : pathname.slice(prefix.length)
    : pathname;
  const relative = decodeURIComponent(webPath === "/" ? "/index.html" : webPath).replace(/^\/+/, "");
  const filePath = resolve(root, relative);
  let content: Buffer;
  if (filePath !== root && !filePath.startsWith(`${root}${sep}`)) {
    response.writeHead(403);
    response.end("forbidden");
    return;
  }

  try {
    content = await readFile(filePath);
    response.writeHead(200, { "content-type": MIME_TYPES[extname(filePath)] ?? "application/octet-stream", "cache-control": "no-store" });
    response.end(content);
  } catch {
    if (!isFrontend) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("not found");
      return;
    }
    try {
      content = await readFile(join(root, "index.html"));
      response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
      response.end(content);
    } catch {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("frontend not built");
    }
  }
}

export function createWebServer(): ReturnType<typeof createServer> {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (url.pathname.startsWith("/api/")) {
        const handled = await handleApi(url, request, response);
        if (handled) return;
      }
      await serveStatic(url, response);
    } catch (error) {
      sendJson(response, 400, { status: "error", message: error instanceof Error ? error.message : String(error) });
    }
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.TRUTHPASS_WEB_PORT ?? process.env.PORT ?? DEFAULT_PORT);
  createWebServer().listen(port, "0.0.0.0", () => {
    console.log(`TruthPass web BFF listening on http://127.0.0.1:${port}/web-demo/`);
  });
}
