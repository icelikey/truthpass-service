import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { extname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { anchorPlan, evaluateBatch } from "./cli.js";
import { BotChainClient } from "./chain.js";
import { getBotChainConfig } from "./chain-config.js";
import { ConsumerParticipationRegistry } from "./consumer.js";
import { replayFishOilFlow } from "./replay.js";
import { loadLocalEnv } from "./jev/http-provider.js";

const PROJECT_ROOT = resolve(fileURLToPath(new URL("..", import.meta.url)));
const WEB_ROOT = join(PROJECT_ROOT, "web-demo");
const DEPLOYMENT_FILE = join(PROJECT_ROOT, "config", "bot-chain-mainnet.deployed.json");
const REPLAY_FILE = join(PROJECT_ROOT, "config", "bot-chain-mainnet.replay.json");
const DEFAULT_PORT = 4173;
const BATCH_ID = "FO-2026-001";
const consumers = new ConsumerParticipationRegistry();

type PublicDeployment = {
  network?: string;
  chainId?: number;
  explorerUrl?: string;
  contract?: { address?: string; deploymentTxHash?: string; domainSeparator?: string };
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
    return JSON.parse(await readFile(DEPLOYMENT_FILE, "utf8")) as PublicDeployment;
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
  const replayVerified = replay?.status === "mainnet_receipts_verified" && replay?.batchId === BATCH_ID && replay?.network === "bot-mainnet" && replay?.chainId === 677;
  const result: Record<string, unknown> = {
    network: "bot-mainnet",
    chainId: 677,
    contractAddress: contractAddress ?? null,
    deploymentStatus: deployment.contract?.address ? "deployment_receipt_verified" : "metadata_missing",
    businessStatus: replayVerified ? "business_replay_receipts_verified" : "business_replay_not_recorded",
    anchored: replayVerified,
    replayManifest: replayVerified ? { schemaVersion: replay?.schemaVersion, runId: replay?.runId, recordedAt: replay?.recordedAt, integrityHash: replay?.integrityHash, ids: replay?.ids, events: replay?.events } : null,
    explorerUrl: deployment.explorerUrl ?? "https://scan.botchain.ai",
  };
  if (!contractAddress) return { ...result, status: "not_configured" };

  try {
    const config = getBotChainConfig("mainnet", { contractAddress });
    const client = new BotChainClient({ config, dryRun: true });
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

async function handleApi(url: URL, request: IncomingMessage, response: ServerResponse): Promise<boolean> {
  if (request.method === "GET" && url.pathname === "/api/health") {
    return sendJson(response, 200, { status: "ok", service: "truthpass-web-bff", batchId: BATCH_ID, chain: await getMainnetStatus() }), true;
  }
  if (request.method === "GET" && url.pathname === "/api/chain/status") {
    return sendJson(response, 200, await getMainnetStatus()), true;
  }
  if (request.method === "GET" && url.pathname === "/api/verify") {
    const batchId = url.searchParams.get("batchId") ?? BATCH_ID;
    const verification = await evaluateBatch(batchId);
    const plan = await anchorPlan(batchId, "mainnet");
    const chain = await getMainnetStatus();
    const replay = await loadReplayManifest();
    const anchor = chain.anchored && replay ? {
      ...plan,
      ...replay,
      command: "replay",
      anchorStatus: "anchored",
      lifecycle: "anchored",
      requestId: replay.ids?.requestId ?? plan.requestId,
      evidenceRoot: replay.ids?.evidenceRoot ?? plan.evidenceRoot,
      txHash: replay.events?.[0]?.txHash ?? null,
      reason: "主网业务 receipt 已确认；网页读取公开 manifest，不把部署回执当作业务回执。",
    } : plan;
    return sendJson(response, 200, { verification, anchor, chain }), true;
  }
  if (request.method === "GET" && url.pathname === "/api/replay") {
    const batchId = url.searchParams.get("batchId") ?? BATCH_ID;
    return sendJson(response, 200, await replayFishOilFlow(batchId, "mainnet")), true;
  }
  if (request.method === "POST" && url.pathname === "/api/feedback") {
    const body = await readJson(request);
    const batchId = typeof body.batchId === "string" ? body.batchId : BATCH_ID;
    const consumerId = typeof body.consumerId === "string" ? body.consumerId : "consumer-web-demo";
    const categories = Array.isArray(body.categories) ? body.categories.filter((item): item is string => typeof item === "string") : [];
    const consent = await consumers.grantConsent({ consumerId, batchId, scopes: ["purchase", "quality-feedback"], grantedAt: new Date().toISOString() });
    const purchase = await consumers.recordPurchase({ consumerId, batchId, purchaseProofHash: sha256(`${consumerId}:${batchId}`), createdAt: new Date().toISOString() });
    const feedback = await consumers.recordFeedback({ purchaseId: purchase.purchaseId, rating: Number(body.rating ?? 5), categories, evidence: { source: "web-demo", tags: categories }, createdAt: new Date().toISOString() });
    return sendJson(response, 201, { ok: true, consentHash: consent.consentHash, purchaseId: purchase.purchaseId, feedbackId: feedback.feedbackId, evidenceHash: feedback.evidenceHash, contributionPoints: feedback.contributionPoints, chainStatus: "anchor_pending" }), true;
  }
  return false;
}

async function serveStatic(url: URL, response: ServerResponse): Promise<void> {
  const webPath = url.pathname.startsWith("/web-demo/") ? url.pathname.slice("/web-demo".length) : url.pathname;
  const relative = decodeURIComponent(webPath === "/" ? "/index.html" : webPath).replace(/^\/+/, "");
  const filePath = resolve(WEB_ROOT, relative);
  if (filePath !== WEB_ROOT && !filePath.startsWith(`${WEB_ROOT}${sep}`)) {
    response.writeHead(403);
    response.end("forbidden");
    return;
  }
  try {
    const content = await readFile(filePath);
    response.writeHead(200, { "content-type": MIME_TYPES[extname(filePath)] ?? "application/octet-stream", "cache-control": "no-store" });
    response.end(content);
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("not found");
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
