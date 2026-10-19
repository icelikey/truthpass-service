#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { sha256Hex } from "./hash.js";
import type { VerificationResult } from "./types.js";
import { replayFishOilFlow } from "./replay.js";
import { SafeJevDecisionGate } from "./jev/context.js";
import { loadLocalEnv, providerFromEnv } from "./jev/http-provider.js";

const CLI_VERSION = "0.9.2";
const DEMO_BATCH_ID = "FO-2026-001";
const DEMO_TASK_ID = "task-fish-oil-2026-001";

type OutputMode = "text" | "json";
type Command = "doctor" | "discover" | "verify" | "explain" | "recommend" | "order" | "inspect" | "anchor" | "replay" | "manifest" | "status" | "collaborate" | "register" | "help";

interface NormalizedService {
  serviceId: string;
  serviceName: string;
  signer?: string;
  liveStatus: string;
  eligible: boolean;
  score: number;
  executionStatus: string;
  productStatus: string;
  reasons: string[];
  evidenceHash?: string;
}

interface ParsedArgs {
  command: Command;
  json: boolean;
  batchId: string;
  network: "testnet" | "mainnet";
  dryRun: boolean;
  help: boolean;
  remoteUrl?: string;
  token?: string;
  tenantId?: string;
  requestId?: string;
  agentId?: string;
  agentName?: string;
  capabilities: string[];
  publicKey?: string;
  question?: string;
}

export interface CliResult {
  exitCode: number;
  value: Record<string, unknown> | string;
}

const HELP = `真验 TruthPass CLI ${CLI_VERSION}

用法:
  truthpass doctor [--json]
  truthpass discover --batch FO-2026-001 [--json]
  truthpass verify --batch FO-2026-001 [--json]
  truthpass explain --batch FO-2026-001 [--json]
  truthpass recommend --batch FO-2026-001 [--json]
  truthpass order --batch FO-2026-001 [--json]
  truthpass inspect --batch FO-2026-001 [--json]
  truthpass inspect --remote https://truthpass-service.vercel.app --batch FO-2026-001 --tenant demo --token <TOKEN> [--json]
  truthpass collaborate --remote https://truthpass-service.vercel.app --batch FO-2026-001 --tenant demo --token <TOKEN> [--json]
  truthpass register --remote https://truthpass-service.vercel.app --tenant demo --token <TOKEN> --agent-id my-agent --name "我的 Agent" --capability consumer.inspect [--json]
  truthpass anchor --batch FO-2026-001 --dry-run [--network testnet] [--json]
  truthpass replay --batch FO-2026-001 [--json]

说明:
  verify 复用仓库中的 ServiceRegistry 和 Verifier，输出可审计结果。
  anchor 当前只生成离线锚定计划；没有 --dry-run 时不会提交交易。
  --json 输出稳定 JSON；错误也使用机器可读结构，且不包含密钥。
  --remote 让 CLI 直接访问 TruthPass 服务；--token 只用于请求头，不会写入输出。
`;

function parseArgs(argv: string[]): ParsedArgs | { error: string } {
  let command: Command | undefined;
  let json = false;
  let batchId = DEMO_BATCH_ID;
  let batchArgumentProvided = false;
  let network: "testnet" | "mainnet" = "testnet";
  let dryRun = false;
  let help = false;
  let remoteUrl: string | undefined;
  let token: string | undefined;
  let tenantId: string | undefined;
  let requestId: string | undefined;
  let agentId: string | undefined;
  let agentName: string | undefined;
  let publicKey: string | undefined;
  let question: string | undefined;
  const capabilities: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") { json = true; continue; }
    if (arg === "--dry-run") { dryRun = true; continue; }
    if (arg === "--help" || arg === "-h") { help = true; continue; }
    if (["--remote", "--token", "--tenant", "--request-id", "--agent-id", "--name", "--public-key", "--question"].includes(arg)) {
      const value = argv[++index];
      if (!value) return { error: `${arg} 需要一个值` };
      if (arg === "--remote") remoteUrl = value;
      else if (arg === "--token") token = value;
      else if (arg === "--tenant") tenantId = value;
      else if (arg === "--request-id") requestId = value;
      else if (arg === "--agent-id") agentId = value;
      else if (arg === "--name") agentName = value;
      else if (arg === "--public-key") publicKey = value;
      else question = value;
      continue;
    }
    if (arg === "--capability") {
      const value = argv[++index];
      if (!value) return { error: "--capability 需要一个值" };
      capabilities.push(value);
      continue;
    }
    if (arg === "--batch") {
      const value = argv[++index];
      if (!value) return { error: "--batch 需要一个批次 ID" };
      if (batchArgumentProvided) return { error: "批次 ID 只能指定一次" };
      batchId = value;
      batchArgumentProvided = true;
      continue;
    }
    if (arg === "--network") {
      const value = argv[++index];
      if (value !== "testnet" && value !== "mainnet") return { error: "--network 只能是 testnet 或 mainnet" };
      network = value;
      continue;
    }
    if (arg.startsWith("-")) return { error: `未知参数: ${arg}` };
    const knownCommand = ["doctor", "discover", "verify", "explain", "recommend", "order", "inspect", "anchor", "replay", "manifest", "status", "collaborate", "register", "help"].includes(arg);
    if (knownCommand) {
      if (command) return { error: `只能指定一个命令，收到: ${arg}` };
      command = arg as Command;
      continue;
    }
    // Consumer Agents commonly have only a batch number available. Support
    // both `truthpass inspect FO-2026-001` and the shortest `truthpass
    // FO-2026-001`, while retaining the explicit --batch contract.
    const looksLikeBatchId = /^FO-[A-Za-z0-9][A-Za-z0-9-]*$/.test(arg);
    const queryCommands = new Set<Command>(["discover", "verify", "explain", "recommend", "order", "inspect"]);
    if (looksLikeBatchId && !batchArgumentProvided) {
      if (!command) command = "inspect";
      if (!queryCommands.has(command)) return { error: `命令 ${command} 不接受位置批次 ID，请使用 --batch` };
      batchId = arg;
      batchArgumentProvided = true;
      continue;
    }
    if (command) return { error: `只能指定一个命令，收到: ${arg}` };
    return { error: `未知命令: ${arg}` };
  }

  return { command: help ? "help" : command ?? "help", json, batchId, network, dryRun, help, remoteUrl, token, tenantId, requestId, agentId, agentName, capabilities, publicKey, question };
}

function makeTask(batchId: string): Record<string, unknown> {
  return {
    taskId: DEMO_TASK_ID,
    serviceKind: "lab",
    capability: "fish-oil-batch-quality-check",
    batchId,
    productionTime: "2026-10-06T08:00:00Z",
    acceptance: {
      requireSignature: true,
      // The policy fields are used by the current main branch. The threshold
      // fields keep the CLI compatible with the original local demo runtime.
      policyId: "fish-oil-quality",
      policyVersion: "v1",
      maxLogisticsGapHours: 6,
      minEpaDhaPercent: 70,
      maxPeroxideValue: 5,
      maxTotox: 20,
      requireColdChain: true,
    },
  };
}

function adapterFor(card: Record<string, unknown>, mode: "valid" | "wrong-batch" | "offline") {
  return {
    async probe() {
      if (mode === "offline") {
        return {
          serviceId: card.id,
          status: "offline",
          latencyMs: 0,
          capabilityMatch: false,
          schemaValid: false,
          checkedAt: "2026-10-06T12:00:00Z",
          reason: "连接超时",
        };
      }
      return {
        serviceId: card.id,
        status: mode === "valid" ? "healthy" : "degraded",
        latencyMs: mode === "valid" ? 420 : 980,
        capabilityMatch: true,
        schemaValid: true,
        checkedAt: "2026-10-06T12:00:00Z",
      };
    },
    async execute(task: Record<string, any>) {
      return {
        serviceId: card.id,
        taskId: task.taskId,
        batchId: task.batchId,
        reportBatchId: mode === "wrong-batch" ? "FO-2026-000" : task.batchId,
        productionTime: task.productionTime,
        reportTime: "2026-10-06T10:20:00Z",
        logisticsGapHours: mode === "valid" ? 2 : 4,
        signatureValid: mode === "valid",
        epaDhaPercent: mode === "valid" ? 78 : 61,
        peroxideValue: mode === "valid" ? 2.1 : 7.2,
        totox: mode === "valid" ? 11 : 26,
        coldChainGapHours: mode === "valid" ? 2 : 11,
        payload: {
          taskId: task.taskId,
          reportBatchId: mode === "wrong-batch" ? "FO-2026-000" : task.batchId,
          product: "高浓度鱼油软胶囊",
          rawMaterialOrigin: "demo/synthetic",
          evidenceMode: "demo/synthetic",
          signatureValid: mode === "valid",
        },
      };
    },
  };
}

function demoServices(): Array<{ card: Record<string, unknown>; mode: "valid" | "wrong-batch" | "offline" }> {
  return [
    {
      card: {
        id: "lab-a", name: "山野检测服务", kind: "lab", endpoint: "https://example.test/lab-a",
        capabilities: ["fish-oil-batch-quality-check"], signer: "0x1111...aaaa", historicalScore: 92, feedbackCount: 14,
      },
      mode: "wrong-batch",
    },
    {
      card: {
        id: "lab-b", name: "快速检测服务", kind: "lab", endpoint: "https://example.test/lab-b",
        capabilities: ["fish-oil-batch-quality-check"], signer: "0x2222...bbbb", historicalScore: 96, feedbackCount: 9,
      },
      mode: "offline",
    },
    {
      card: {
        id: "lab-c", name: "可信实验室", kind: "lab", endpoint: "https://example.test/lab-c",
        capabilities: ["fish-oil-batch-quality-check"], signer: "0x3333...cccc", historicalScore: 88, feedbackCount: 21,
      },
      mode: "valid",
    },
  ];
}

export async function evaluateBatch(batchId: string): Promise<Record<string, unknown>> {
  loadLocalEnv();
  const { ServiceRegistry } = await import("./registry.js") as { ServiceRegistry: new () => any };
  const registry = new ServiceRegistry();
  const task = makeTask(batchId);
  for (const { card, mode } of demoServices()) registry.register(card, adapterFor(card, mode), "demo/synthetic");
  const providerConfig = providerFromEnv();
  const decisionGate = new SafeJevDecisionGate({ provider: providerConfig.provider, modelId: providerConfig.source === "none" ? "deterministic-fallback" : providerConfig.source });
  const ranking = await registry.evaluate(task, { decisionGate });
  const normalized: NormalizedService[] = ranking.map((item: any): NormalizedService => {
    const verification = item.verification as Record<string, unknown> | undefined;
    const product = item.product as Record<string, unknown> | undefined;
    const eligible = item.eligible ?? verification?.status === "accepted";
    return {
      serviceId: item.service.id,
      serviceName: item.service.name,
      signer: item.service.signer as string | undefined,
      liveStatus: item.probe.status,
      eligible,
      score: item.score,
      executionStatus: typeof verification?.status === "string" ? verification.status : "not-executed",
      productStatus: typeof product?.status === "string" ? product.status : "not-evaluated",
      reasons: [...((verification?.reasons as string[] | undefined) ?? []), ...((product?.reasons as string[] | undefined) ?? []), ...(item.probe.reason ? [item.probe.reason] : [])],
      evidenceHash: verification?.evidenceHash as string | undefined,
    };
  });
  const selected = normalized.find((item) => item.eligible);
  const selectedRanking = ranking.find((item: any) => item.service.id === selected?.serviceId);
  const verificationResult = selectedRanking?.verification as VerificationResult | undefined;
  // The ranked execution is the deterministic verdict, not the raw report.
  // Re-read the selected fixture only for the consumer-facing evidence card.
  const selectedExecution = selected
    ? await adapterFor({ id: selected.serviceId }, "valid").execute(makeTask(batchId)) as Record<string, unknown>
    : undefined;
  const selectedJevDecision = selectedRanking?.jevDecision as Record<string, unknown> | undefined;
  const selectedEvidence = selectedExecution
    ? {
        serviceId: selectedExecution.serviceId ?? null,
        taskId: selectedExecution.taskId ?? null,
        batchId: selectedExecution.batchId ?? null,
        reportBatchId: selectedExecution.reportBatchId ?? null,
        productionTime: selectedExecution.productionTime ?? null,
        reportTime: selectedExecution.reportTime ?? null,
        logisticsGapHours: selectedExecution.logisticsGapHours ?? null,
        signatureValid: selectedExecution.signatureValid ?? null,
        epaDhaPercent: selectedExecution.epaDhaPercent ?? null,
        peroxideValue: selectedExecution.peroxideValue ?? null,
        totox: selectedExecution.totox ?? null,
        coldChainGapHours: selectedExecution.coldChainGapHours ?? null,
      }
    : null;
  const status = selected ? (selected.productStatus === "accepted" || selected.productStatus === "not-evaluated" ? "accepted" : "accepted_with_scope") : "rejected";
  return {
    schemaVersion: "truthpass.cli.result.v1",
    command: "verify",
    dataClass: "demo/synthetic",
    batchId,
    taskId: DEMO_TASK_ID,
    policyId: "fish-oil-quality",
    policyVersion: "v1",
    status,
    score: selected?.score ?? 0,
    selectedServiceId: selected?.serviceId,
    reasons: selected?.reasons ?? ["没有找到当前可用且通过验收的服务"],
    ranking: normalized,
    evidenceHash: selected?.evidenceHash,
    // This is the canonical deterministic result reused by replay, the
    // future API and the web demo. Consumers should not reimplement checks.
    verificationResult: verificationResult ?? null,
    selectedEvidence,
    jevDecision: selectedJevDecision ?? null,
    jevProvider: providerConfig.source,
    liveApiEnabled: providerConfig.enabled,
    nextAction: status === "accepted" || status === "accepted_with_scope" ? "anchor --dry-run" : "review evidence and retry",
  };
}

async function recommendBatch(batchId: string): Promise<Record<string, unknown>> {
  const verification = await evaluateBatch(batchId);
  const accepted = verification.status === "accepted" || verification.status === "accepted_with_scope";
  return {
    schemaVersion: "truthpass.cli.recommendation.v1",
    command: "recommend",
    dataClass: verification.dataClass,
    batchId,
    product: "高浓度鱼油软胶囊",
    recommendation: accepted ? "recommend" : "do_not_recommend",
    reason: accepted ? "当前批次通过确定性规则验收，且存在可用检测服务。" : "当前批次没有满足公开验收规则，不向消费者推荐。",
    selectedServiceId: verification.selectedServiceId ?? null,
    verificationStatus: verification.status,
    evidenceHash: verification.evidenceHash ?? null,
    consumerNextAction: accepted ? "show_evidence_then_prepare_order" : "request_more_evidence",
  };
}

async function orderPlan(batchId: string): Promise<Record<string, unknown>> {
  const recommendation = await recommendBatch(batchId);
  const accepted = recommendation.recommendation === "recommend";
  return {
    schemaVersion: "truthpass.cli.order-plan.v1",
    command: "order",
    dataClass: recommendation.dataClass,
    batchId,
    product: recommendation.product,
    recommendation: recommendation.recommendation,
    orderStatus: accepted ? "prepared_pending_checkout" : "blocked_by_verification",
    purchaseCommitment: accepted ? "prepared_for_consumer_consent" : null,
    checkoutAdapter: accepted ? "merchant_checkout_required" : null,
    chainPurchaseRecord: accepted ? "prepared_pending_signed_purchase" : null,
    evidenceHash: recommendation.evidenceHash,
    reason: accepted
      ? "真验只准备订单与购买承诺；付款、地址和履约由消费者 Agent 调用的商家适配器完成。"
      : "未通过公开验收规则，订单不会继续。",
  };
}

async function doctor(): Promise<Record<string, unknown>> {
  loadLocalEnv();
  const providerConfig = providerFromEnv();
  return {
    schemaVersion: "truthpass.cli.doctor.v1",
    tool: "truthpass",
    version: CLI_VERSION,
    node: process.version,
    fixtureMode: "demo/synthetic",
    fixtureAvailable: true,
    authRequired: false,
    authSource: "not_required_for_fixture",
    jev: {
      adapter: providerConfig.source === "none" ? "not_configured" : `${providerConfig.source}-http`,
      mode: providerConfig.enabled ? "live_with_safe_fallback" : "deterministic_demo_only",
      configured: providerConfig.source !== "none",
      enabled: providerConfig.enabled,
      reason: providerConfig.reason,
    },
    chain: {
      defaultNetwork: "bohr-testnet",
      rpcConfigured: true,
      contractConfigured: false,
      submissionEnabled: false,
      status: "offline_plan_only",
    },
    warnings: ["当前 CLI 使用合成鱼油数据；anchor 仅支持 dry-run，不会发送交易。"],
  };
}

function normalizeRemoteUrl(value: string): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("--remote 必须是完整的 http(s) URL"); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("--remote 只支持 http(s) URL");
  return parsed.toString().replace(/\/$/, "");
}

function remoteHeaders(args: ParsedArgs, requireTenant = false): Record<string, string> {
  const headers: Record<string, string> = { accept: "application/json", "x-truthpass-request-id": ensureRequestId(args) };
  if (args.token) headers.authorization = `Bearer ${args.token}`;
  if (args.tenantId) headers["x-truthpass-tenant"] = args.tenantId;
  if (requireTenant && (!args.token || !args.tenantId)) throw new Error("远程 Agent 请求需要 --token 和 --tenant");
  return headers;
}

function ensureRequestId(args: ParsedArgs): string {
  if (!args.requestId) args.requestId = `cli-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return args.requestId;
}

async function fetchRemoteJson(args: ParsedArgs, path: string, init: RequestInit = {}, requireTenant = false): Promise<Record<string, unknown>> {
  if (!args.remoteUrl) throw new Error("该命令需要 --remote 服务地址");
  const url = new URL(path, normalizeRemoteUrl(args.remoteUrl) + "/");
  const headers = { ...remoteHeaders(args, requireTenant), ...(init.headers as Record<string, string> | undefined) };
  let response: Response | undefined;
  let lastError: unknown;
  // Vercel 的公开入口在冷启动或边缘连接重试时可能出现一次性 TLS/网络错误。
  // CLI 只对网络层失败和 5xx 重试，不重试 4xx，避免把权限错误掩盖掉。
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      response = await fetch(url, { ...init, headers, signal: AbortSignal.timeout(20_000) });
      if (response.status < 500 || attempt === 2) break;
    } catch (error) {
      lastError = error;
      if (attempt === 2) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
  }
  if (!response) throw lastError instanceof Error ? lastError : new Error("远程服务请求失败");
  const text = await response.text();
  let body: Record<string, unknown>;
  try { body = JSON.parse(text) as Record<string, unknown>; } catch { body = { error: "REMOTE_INVALID_JSON", raw: text.slice(0, 400) }; }
  if (!response.ok) {
    const errorCode = typeof body.error === "string" ? body.error : `HTTP_${response.status}`;
    throw new Error(`远程服务返回 ${response.status}: ${errorCode}`);
  }
  return body;
}

async function remoteCommand(args: ParsedArgs): Promise<Record<string, unknown>> {
  const command = args.command;
  if (command === "manifest") return fetchRemoteJson(args, "/api/agent/manifest");
  if (command === "status" || command === "doctor") {
    const [status, manifest] = await Promise.all([
      fetchRemoteJson(args, "/api/agent/status"),
      fetchRemoteJson(args, "/api/agent/manifest"),
    ]);
    return { schemaVersion: "truthpass.cli.remote-doctor.v1", command: "doctor", remoteUrl: normalizeRemoteUrl(args.remoteUrl!), status, manifest, authConfigured: manifest.authMode === "bearer_token", registrationAuthConfigured: manifest.registrationAuthMode === "bearer_token" };
  }
  if (command === "register") {
    if (!args.agentId || !args.agentName || args.capabilities.length === 0) throw new Error("register 需要 --agent-id、--name 和至少一个 --capability");
    return fetchRemoteJson(args, "/api/agent/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ agentId: args.agentId, tenantId: args.tenantId, name: args.agentName, capabilities: args.capabilities, publicKey: args.publicKey }),
    }, true);
  }
  const batchId = encodeURIComponent(args.batchId.toUpperCase());
  if (command === "inspect" || command === "verify") {
    const result = await fetchRemoteJson(args, `/api/cli/inspect?batchId=${batchId}`);
    const verification = result.verification && typeof result.verification === "object" ? result.verification as Record<string, unknown> : {};
    const verificationStatus = verification.status ?? result.status ?? null;
    return {
      ...result,
      command: command === "verify" ? "verify" : "inspect",
      remoteUrl: normalizeRemoteUrl(args.remoteUrl!),
      tenantId: args.tenantId ?? "public",
      traceId: ensureRequestId(args),
      verificationStatus,
      dataMode: result.dataClass ?? verification.dataClass ?? "demo/synthetic",
      nextAction: verificationStatus === "accepted" ? "查看依据；如需上链，请由用户钱包签名确认" : "补齐缺失资料后重新核验",
    };
  }
  if (command === "explain") {
    const result = await fetchRemoteJson(args, `/api/cli/explain?batchId=${batchId}`);
    const inspection = result.inspection && typeof result.inspection === "object" ? result.inspection as Record<string, unknown> : {};
    const verificationStatus = result.status ?? (inspection.verification && typeof inspection.verification === "object" ? (inspection.verification as Record<string, unknown>).status : undefined) ?? null;
    return {
      ...result,
      command: "explain",
      remoteUrl: normalizeRemoteUrl(args.remoteUrl!),
      tenantId: args.tenantId ?? "public",
      traceId: ensureRequestId(args),
      verificationStatus,
      dataMode: result.dataClass ?? "demo/synthetic",
      nextAction: verificationStatus === "accepted" ? "查看依据；真实上链仍需用户钱包签名并回读 receipt" : "补齐检测、冷链和来源签名后重新核验",
    };
  }
  if (command === "collaborate") {
    return fetchRemoteJson(args, "/api/agent/v1/collaborate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ batchId: args.batchId.toUpperCase(), tenantId: args.tenantId, question: args.question ?? "请解释当前批次证据状态，并说明下一步由谁确认。" }),
    }, true);
  }
  if (command === "discover") {
    const manifest = await fetchRemoteJson(args, "/api/agent/manifest");
    return { schemaVersion: "truthpass.cli.remote-discovery.v1", command: "discover", remoteUrl: normalizeRemoteUrl(args.remoteUrl!), batchId: args.batchId, manifest };
  }
  throw new Error(`命令 ${command} 暂不支持远程模式`);
}

interface ReplayManifestResult {
  manifest?: Record<string, unknown>;
  reason?: string;
}

function loadMainnetReplayManifest(batchId: string): ReplayManifestResult {
  const candidates = [
    process.env.TRUTHPASS_MAINNET_REPLAY_MANIFEST,
    resolve(process.cwd(), "config", "bot-chain-mainnet.replay.json"),
    resolve(dirname(fileURLToPath(import.meta.url)), "..", "config", "bot-chain-mainnet.replay.json"),
  ].filter((item): item is string => Boolean(item));
  let foundPath = false;
  for (const manifestPath of candidates) {
    try {
      const raw = readFileSync(manifestPath, "utf8");
      foundPath = true;
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed.batchId !== batchId) return { reason: "manifest_batch_mismatch" };
      if (typeof parsed.schemaVersion !== "string" || !parsed.schemaVersion.startsWith("truthpass.mainnet.replay.")) {
        return { reason: "manifest_schema_invalid" };
      }
      if (parsed.lifecycle !== "anchored") return { reason: "manifest_lifecycle_not_anchored" };
      if (parsed.status !== "mainnet_receipts_verified") return { reason: "manifest_receipts_not_verified" };
      return { manifest: parsed };
    } catch (error) {
      if (foundPath) return { reason: error instanceof SyntaxError ? "manifest_json_invalid" : "manifest_unreadable" };
    }
  }
  return { reason: "manifest_not_found" };
}

function receiptFor(
  manifest: Record<string, unknown> | undefined,
  eventName: string,
): Record<string, unknown> | null {
  if (!manifest || !Array.isArray(manifest.events)) return null;
  const event = manifest.events.find((item): item is Record<string, unknown> =>
    Boolean(item && typeof item === "object" && (item as Record<string, unknown>).name === eventName),
  );
  if (!event) return null;
  return {
    txHash: event.txHash ?? null,
    blockNumber: event.blockNumber ?? null,
    explorerUrl: event.explorerUrl ?? null,
    event: event.event ?? null,
    receiptStatus: event.receiptStatus ?? null,
    confirmations: event.confirmations ?? null,
  };
}

export async function inspectBatch(batchId: string): Promise<Record<string, unknown>> {
  const verification = await evaluateBatch(batchId);
  const ranking = Array.isArray(verification.ranking) ? verification.ranking as Array<Record<string, unknown>> : [];
  const selected = ranking.find((item) => item.serviceId === verification.selectedServiceId);
  const evidence = verification.selectedEvidence && typeof verification.selectedEvidence === "object"
    ? verification.selectedEvidence as Record<string, unknown>
    : {};
  const payload = evidence.payload && typeof evidence.payload === "object"
    ? evidence.payload as Record<string, unknown>
    : {};
  const manifestResult = loadMainnetReplayManifest(batchId);
  const manifest = manifestResult.manifest;
  const receipts = {
    evidence: receiptFor(manifest, "evidence"),
    verification: receiptFor(manifest, "verification"),
    purchase: receiptFor(manifest, "purchase"),
    contribution: receiptFor(manifest, "contribution"),
  };
  const allReceiptsPresent = Object.values(receipts).every((item) =>
    item && item.txHash && item.receiptStatus === 1,
  );
  const chainManifestReady = Boolean(manifest && allReceiptsPresent);
  const jevDecision = verification.jevDecision && typeof verification.jevDecision === "object"
    ? verification.jevDecision as Record<string, unknown>
    : null;
  const accepted = verification.status === "accepted" || verification.status === "accepted_with_scope";
  const task = makeTask(batchId) as Record<string, unknown>;
  const acceptance = (task.acceptance ?? {}) as Record<string, unknown>;
  const rawPolicyHash = await sha256Hex(`${String(verification.policyId ?? "")}:${String(verification.policyVersion ?? "")}`);
  const policyHash = rawPolicyHash.startsWith("0x") ? rawPolicyHash : `0x${rawPolicyHash}`;
  const productionTime = evidence.productionTime ?? task.productionTime;
  return {
    schemaVersion: "truthpass.cli.inspection.v1",
    command: "inspect",
    dataClass: verification.dataClass,
    policyHash,
    status: verification.status,
    product: {
      name: "高浓度鱼油软胶囊",
      category: "营养保健品",
      batchId,
    },
    batch: {
      id: batchId,
      batchId,
      taskId: verification.taskId,
      productionTime,
      reportTime: evidence.reportTime ?? null,
      source: payload.rawMaterialOrigin ?? verification.dataClass,
      dataMode: payload.evidenceMode ?? verification.dataClass,
    },
    quality: {
      epaDhaPercent: evidence.epaDhaPercent ?? null,
      peroxideValue: evidence.peroxideValue ?? null,
      totox: evidence.totox ?? null,
      logisticsGapHours: evidence.logisticsGapHours ?? null,
      coldChainGapHours: evidence.coldChainGapHours ?? null,
      limits: {
        epaDhaMinPercent: acceptance.minEpaDhaPercent ?? null,
        peroxideMaxValue: acceptance.maxPeroxideValue ?? null,
        totoxMax: acceptance.maxTotox ?? null,
        coldChainGapMaxHours: acceptance.maxLogisticsGapHours ?? null,
      },
    },
    evidence: {
      serviceId: verification.selectedServiceId ?? null,
      serviceName: selected?.serviceName ?? null,
      signer: selected?.signer ?? null,
      evidenceHash: verification.evidenceHash ?? null,
      hash: typeof verification.evidenceHash === "string"
        ? (verification.evidenceHash.startsWith("0x") ? verification.evidenceHash : `0x${verification.evidenceHash}`)
        : null,
      mode: payload.evidenceMode ?? verification.dataClass,
      sourceMode: payload.evidenceMode ?? verification.dataClass,
      source: payload.rawMaterialOrigin ?? verification.dataClass,
      reportBatchId: evidence.reportBatchId ?? null,
    },
    jev: {
      provider: verification.jevProvider,
      mode: verification.liveApiEnabled ? "live_with_safe_fallback" : "deterministic_fallback",
      liveApiEnabled: verification.liveApiEnabled,
      route: jevDecision?.decision ?? (accepted ? "route_to_rule_verifier" : "request_more_evidence"),
      decision: jevDecision,
      modelAssisted: jevDecision?.modelAssisted ?? false,
    },
    verification: {
      status: verification.status,
      score: verification.score,
      policyId: verification.policyId,
      policyVersion: verification.policyVersion,
      policyHash,
      verifierVersion: (verification.verificationResult as Record<string, unknown> | null)?.verifierVersion ?? null,
      checks: (verification.verificationResult as Record<string, unknown> | null)?.checks ?? null,
      reasons: verification.reasons,
      missingCodes: (verification.verificationResult as Record<string, unknown> | null)?.missingCodes ?? [],
      conflictCodes: (verification.verificationResult as Record<string, unknown> | null)?.conflictCodes ?? [],
    },
    chain: manifest
      ? {
          network: manifest.network ?? null,
          chainId: manifest.chainId ?? null,
          contractAddress: manifest.contractAddress ?? null,
          runId: manifest.runId ?? null,
          lifecycle: chainManifestReady ? manifest.lifecycle : "unavailable",
          status: chainManifestReady ? manifest.status : "manifest_receipts_incomplete",
          anchored: chainManifestReady,
          evidenceRoot: (manifest.ids as Record<string, unknown> | undefined)?.evidenceRoot ?? null,
          requestId: (manifest.ids as Record<string, unknown> | undefined)?.requestId ?? null,
          verificationRequestId: (manifest.ids as Record<string, unknown> | undefined)?.verificationRequestId ?? null,
          purchaseId: (manifest.ids as Record<string, unknown> | undefined)?.purchaseId ?? null,
          contributionId: (manifest.ids as Record<string, unknown> | undefined)?.contributionId ?? null,
          receipts,
          integrityHash: manifest.integrityHash ?? null,
          availabilityReason: chainManifestReady ? null : "manifest_receipts_incomplete",
        }
      : {
          network: null,
          chainId: null,
          contractAddress: null,
          runId: null,
          lifecycle: "unavailable",
          status: "manifest_unavailable",
          anchored: false,
          receipts,
          availabilityReason: manifestResult.reason ?? "manifest_unavailable",
        },
    publicDataBoundary: {
      rawReports: "off_chain",
      personalData: "off_chain",
      privateKeys: "off_chain",
      notes: [
        "链上只公开批次标识、证据哈希、验证结论和交易回执元数据。",
        "原始检测文件、消费者身份、地址、支付信息和签名私钥不通过 CLI 输出。",
        "dataClass=demo/synthetic 表示当前批次仍是演示数据，不能替代厂家真实产线证明。",
      ],
    },
  };
}

export async function anchorPlan(batchId: string, network: "testnet" | "mainnet"): Promise<Record<string, unknown>> {
  const verification = await evaluateBatch(batchId);
  const rawEvidenceRoot = String(verification.evidenceHash ?? await sha256Hex(JSON.stringify(verification)));
  const evidenceRoot = rawEvidenceRoot.startsWith("0x") ? rawEvidenceRoot : `0x${rawEvidenceRoot}`;
  const rawRequestId = await sha256Hex(`truthpass:${network}:${batchId}:${evidenceRoot}`);
  const requestId = rawRequestId.startsWith("0x") ? rawRequestId : `0x${rawRequestId}`;
  return {
    schemaVersion: "truthpass.cli.anchor-plan.v1",
    command: "anchor",
    dataClass: "demo/synthetic",
    batchId,
    network: network === "testnet" ? "bohr-testnet" : "bot-mainnet",
    status: "prepared_offline_not_submitted",
    anchorStatus: "anchor_pending",
    lifecycle: "anchor_pending",
    requestId,
    evidenceRoot,
    verificationStatus: verification.status,
    contractAddress: null,
    txHash: null,
    reason: "尚未配置已部署合约和签名钱包；本命令只生成可审计计划。",
  };
}

function agentTranslation(result: Record<string, unknown>): string {
  const product = (result.product ?? {}) as Record<string, unknown>;
  const batch = (result.batch ?? {}) as Record<string, unknown>;
  const quality = (result.quality ?? {}) as Record<string, unknown>;
  const limits = (quality.limits ?? {}) as Record<string, unknown>;
  const evidence = (result.evidence ?? {}) as Record<string, unknown>;
  const jev = (result.jev ?? {}) as Record<string, unknown>;
  const jevDecision = (jev.decision ?? {}) as Record<string, unknown>;
  const verification = (result.verification ?? {}) as Record<string, unknown>;
  const chain = (result.chain ?? {}) as Record<string, unknown>;
  const checks = (verification.checks ?? {}) as Record<string, unknown>;
  const checkValues = Object.values(checks);
  const passedChecks = checkValues.filter(Boolean).length;
  const receiptMap = (chain.receipts ?? {}) as Record<string, unknown>;
  const receiptCount = Object.values(receiptMap).filter((item) => {
    const receipt = item as Record<string, unknown> | null;
    return Boolean(receipt?.txHash && receipt.receiptStatus === 1);
  }).length;
  const missing = Array.isArray(jevDecision.missingEvidenceCodes) && jevDecision.missingEvidenceCodes.length > 0
    ? jevDecision.missingEvidenceCodes.join("、")
    : "无";
  const conflicts = Array.isArray(jevDecision.conflictCodes) && jevDecision.conflictCodes.length > 0
    ? jevDecision.conflictCodes.join("、")
    : "无";
  const qualityText = [
    `EPA+DHA ${quality.epaDhaPercent ?? "未知"}%（门槛 ≥ ${limits.epaDhaMinPercent ?? "未声明"}%）`,
    `过氧化值 ${quality.peroxideValue ?? "未知"}（门槛 ≤ ${limits.peroxideMaxValue ?? "未声明"}）`,
    `TOTOX ${quality.totox ?? "未知"}（门槛 ≤ ${limits.totoxMax ?? "未声明"}）`,
    `冷链中断 ${quality.coldChainGapHours ?? "未知"} 小时（门槛 ≤ ${limits.coldChainGapMaxHours ?? "未声明"} 小时）`,
  ].join("；");
  const liveJev = jev.liveApiEnabled === true;
  const chainText = chain.anchored === true
    ? `已在 ${chain.network ?? "目标链"}（Chain ID ${chain.chainId ?? "未知"}）记录，${receiptCount}/4 类业务 receipt 校验通过`
    : `当前没有完整的可验证链上回执（${chain.availabilityReason ?? "manifest unavailable"}）`;
  const conclusion = verification.status === "accepted"
    ? "当前批次通过演示验收，可以向用户展示证据并在征得同意后准备下单。"
    : "当前批次未通过验收，不应向用户推荐或继续下单。";
  return [
    `【真验 Agent 转译】${product.name ?? "鱼油产品"}，批次 ${batch.id ?? batch.batchId ?? "未知"}。`,
    `生产时间：${batch.productionTime ?? "未知"}；检测服务：${evidence.serviceName ?? evidence.serviceId ?? "未知"}。`,
    `检测结果：${qualityText}。`,
    `证据：报告批次 ${evidence.reportBatchId ?? "未知"}，证据哈希 ${evidence.hash ?? evidence.evidenceHash ?? "无"}。`,
    `JEV：${liveJev ? "已调用 live JEV" : "当前为 deterministic fallback，未调用 live JEV"}；路由 ${jev.route ?? "未知"}；置信度 ${jevDecision.confidence ?? "未知"}；缺失证据 ${missing}；冲突 ${conflicts}。`,
    `确定性 Verifier：${verification.verifierVersion ?? "未知"}，${passedChecks}/${checkValues.length || 0} 项检查通过，状态 ${verification.status ?? result.status ?? "未知"}。`,
    `区块链确权：${chainText}；合约 ${chain.contractAddress ?? "未知"}。`,
    conclusion,
    "边界说明：区块链确认的是证据哈希、验收结论和回执事件的一致性；它不会自动把链下原始报告变成真实。当前数据标记为 demo/synthetic，仅用于演示。",
  ].join("\n");
}

export function textFor(result: Record<string, unknown>): string {
  if (result.command === "doctor") return `真验 CLI ${result.version}\nfixture: ${result.fixtureMode}\nJEV: ${((result.jev as Record<string, unknown>).mode)}\n链上: ${((result.chain as Record<string, unknown>).status)}\n`;
  if (result.schemaVersion === "truthpass.cli.remote-doctor.v1") {
    const status = (result.status ?? {}) as Record<string, unknown>;
    const manifest = (result.manifest ?? {}) as Record<string, unknown>;
    return `远程服务：${result.remoteUrl ?? "未知"}\n状态：${status.status ?? "未知"}\nAgent：${status.agentMode ?? "未知"}\n认证：${manifest.authMode ?? "未知"}\n注册认证：${manifest.registrationAuthMode ?? "未知"}\n`;
  }
  if (result.schemaVersion === "truthpass.agent.manifest.v1") return `TruthPass Agent Manifest\n服务：${result.publicUrl ?? "未知"}\n状态：${result.status ?? "未知"}\n认证：${result.authMode ?? "未知"}\n数据：${result.dataClass ?? "未知"}\n`;
  if (result.command === "collaborate" || result.schemaVersion === "truthpass.agent.collaboration.v1") return `Agent 协作结果\n批次：${result.batchId ?? "未知"}\n数据：${result.dataMode ?? "未知"}\n下一步：${((result.writePlan as Record<string, unknown> | undefined)?.nextAction) ?? "查看 JSON 结果"}\n`;
  if (result.schemaVersion === "truthpass.agent.registration.v1") return `Agent 已注册：${((result.agent as Record<string, unknown> | undefined)?.agentId) ?? "未知"}\n状态：${result.status ?? "未知"}\n注册模式：${result.registryMode ?? "未知"}\n`;
  if (result.command === "discover") return `批次 ${result.batchId} 的候选服务：\n${(result.services as Array<Record<string, unknown>>).map((item) => `- ${item.id} ${item.name} (${item.kind})`).join("\n")}\n`;
  if (result.command === "anchor") return `锚定计划已生成：${result.status}\n批次：${result.batchId}\n网络：${result.network}\nrequestId：${result.requestId}\n不会发送交易。\n`;
  if (result.command === "replay") {
    const stages = result.stages as Record<string, unknown>;
    const ledger = result.ledger as Record<string, unknown>;
    return `本地回放：${result.status}\n批次：${result.batchId}\n阶段：验证 ${stages.verification}，锚定 ${stages.evidenceAnchor}，购买 ${stages.purchase}，贡献 ${stages.contribution}，争议 ${stages.dispute}，替代 ${stages.supersede}\n账本：${ledger.valid ? "有效" : "无效"}（${ledger.eventCount} 个事件）\n不会发送交易。\n`;
  }
  if (result.command === "explain") return String(result.explanation ?? agentTranslation(result));
  if (result.command === "recommend") return `批次 ${result.batchId}：${result.recommendation}\n${result.reason}\n下一步：${result.consumerNextAction}\n`;
  if (result.command === "order") return `批次 ${result.batchId}：${result.orderStatus}\n${result.reason}\n`;
  if (result.command === "inspect") {
    const chain = (result.chain ?? {}) as Record<string, unknown>;
    const verification = (result.verification ?? {}) as Record<string, unknown>;
    const batch = (result.batch ?? {}) as Record<string, unknown>;
    const assessment = (verification.assessment ?? {}) as Record<string, unknown>;
    const batchId = batch.id ?? batch.batchId ?? verification.batchId ?? result.batchId ?? "未知";
    const status = verification.status ?? result.status ?? "未知";
    const anchor = (verification.anchor ?? {}) as Record<string, unknown>;
    const lifecycle = chain.lifecycle ?? (anchor.submitted === true ? "anchored" : "anchor_pending");
    const network = chain.network ?? chain.chainName ?? (anchor.network ?? "unavailable");
    const evidenceHash = (result.evidence as Record<string, unknown> | undefined)?.evidenceHash
      ?? verification.evidenceRoot
      ?? assessment.evidenceHash
      ?? "无";
    const dataMode = result.dataMode ?? verification.dataClass ?? result.dataClass ?? "未知";
    return `批次 ${batchId}：${status}\n链上：${lifecycle}（${network}）\n证据哈希：${evidenceHash}\n数据：${dataMode}\n校验状态：${result.verificationStatus ?? status}\n下一步：${result.nextAction ?? "查看依据"}\n追踪：${result.traceId ?? "未知"}\n`;
  }
  return `批次 ${result.batchId}：${result.status}\n选择服务：${result.selectedServiceId ?? "无"}\n评分：${result.score}\n`;
}

export async function runCli(argv: string[]): Promise<CliResult> {
  const parsed = parseArgs(argv);
  if ("error" in parsed) return { exitCode: 40, value: { schemaVersion: "truthpass.cli.error.v1", code: "INVALID_INPUT", message: parsed.error } };
  if (parsed.command === "help") return { exitCode: 0, value: HELP };
  if (parsed.remoteUrl) {
    try {
      const result = await remoteCommand(parsed);
      const status = typeof result.status === "string" ? result.status : typeof (result.verification as Record<string, unknown> | undefined)?.status === "string" ? (result.verification as Record<string, unknown>).status : undefined;
      return { exitCode: status === "rejected" ? 10 : 0, value: result };
    } catch (error) {
      return { exitCode: 70, value: { schemaVersion: "truthpass.cli.error.v1", code: "REMOTE_REQUEST_FAILED", message: error instanceof Error ? error.message : String(error), remoteUrl: parsed.remoteUrl } };
    }
  }
  if (parsed.command !== "doctor" && parsed.batchId !== DEMO_BATCH_ID) {
    return { exitCode: 40, value: { schemaVersion: "truthpass.cli.error.v1", code: "BATCH_NOT_FOUND", message: `当前演示只提供 ${DEMO_BATCH_ID}` } };
  }
  try {
    let result: Record<string, unknown>;
    if (parsed.command === "doctor") result = await doctor();
    else if (parsed.command === "discover") result = { schemaVersion: "truthpass.cli.discovery.v1", command: "discover", dataClass: "demo/synthetic", batchId: parsed.batchId, services: demoServices().map(({ card }) => card) };
    else if (parsed.command === "anchor") {
      if (!parsed.dryRun) return { exitCode: 60, value: { schemaVersion: "truthpass.cli.error.v1", code: "CHAIN_ANCHOR_DISABLED", message: "当前只允许 anchor --dry-run；真实提交尚未接入。" } };
      result = await anchorPlan(parsed.batchId, parsed.network);
    } else if (parsed.command === "replay") {
      result = await replayFishOilFlow(parsed.batchId, parsed.network) as unknown as Record<string, unknown>;
    } else if (parsed.command === "recommend") {
      result = await recommendBatch(parsed.batchId);
    } else if (parsed.command === "order") {
      result = await orderPlan(parsed.batchId);
    } else if (parsed.command === "inspect") {
      result = await inspectBatch(parsed.batchId);
    } else if (parsed.command === "explain") {
      const inspection = await inspectBatch(parsed.batchId);
      result = {
        ...inspection,
        schemaVersion: "truthpass.cli.explanation.v1",
        command: "explain",
        explanation: agentTranslation(inspection),
      };
    } else {
      result = await evaluateBatch(parsed.batchId);
    }
    const exitCode = result.status === "rejected" ? 10 : result.status === "failed" ? 60 : 0;
    return { exitCode, value: result };
  } catch (error) {
    return { exitCode: 70, value: { schemaVersion: "truthpass.cli.error.v1", code: "INTERNAL_ERROR", message: error instanceof Error ? error.message : String(error) } };
  }
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  const result = await runCli(process.argv.slice(2));
  if (typeof result.value === "string") process.stdout.write(result.value);
  else {
    const json = parsed && !("error" in parsed) && parsed.json;
    process.stdout.write(json ? JSON.stringify(result.value, null, 2) + "\n" : textFor(result.value));
  }
  process.exitCode = result.exitCode;
}

const entry = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (entry === import.meta.url) await main();
