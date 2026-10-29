/**
 * 本地测试用对接层：把 src/ 的真实模块通过 HTTP 暴露给前端 web/。
 * 注意：不修改 src/ 的任何文件，仅作为前端与后端之间的适配器。
 * 运行：npm run api  （tsx api-server.ts）
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";
import { verifyMessage } from "ethers";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { MemoryDataRepository } from "./src/data/repository.js";
import { fishOilBatch, fishOilEvidence, fishOilProduct } from "./src/data/fixtures.js";
import { getPolicySnapshot } from "./src/rules/policy.js";
import { buildProductionPublicSummary } from "./src/production.js";
import { ServiceRegistry } from "./src/registry.js";
import { ConsumerParticipationRegistry } from "./src/consumer.js";
import { TruthPassTools } from "./src/tools/truthpass-tools.js";
import { TrustedIssuerKeyRegistry, type TrustedIssuerPublicKey } from "./src/security/evidence-signatures.js";
import { resolveStaticFilePath } from "./src/static-path.js";
import {
  createPostgresReplayGuard,
  getDatabasePool,
  loadPersistedChainTransactions,
  loadPersistedFeedbackDraft,
  loadPersistedLifecycleState,
  markFeedbackDraftConsumed,
  persistFeedbackDraft,
  persistChainTransaction,
  persistConsumerRun,
  persistLifecycleState,
  loadPersistedTenantSites,
  persistTenantSite,
  persistenceEnabled,
} from "./src/data/persistence.js";
import { loadExecutionEvidenceFromPostgres, loadRepositoryFromPostgres } from "./src/data/postgres-reader.js";
import { answerConsumerQuestion, type ConsumerEvidenceSnapshot } from "./src/agents/consumer-assistant.js";
import { renderConsumerFacts, runAgentCollaboration } from "./src/agents/collaboration.js";
import { createCompatibleAgentInvoker, createDeterministicAgentInvoker } from "./src/agents/compatible-invoker.js";
import { providerEndpoint, resolveAgentProvider, type ResolvedAgentProvider } from "./src/agents/provider-config.js";
import { runCliInspect } from "./src/integrations/cli-verifier.js";
import { BOT_CHAIN_MAINNET, inspectBotChain } from "./src/integrations/botchain-config.js";
import { getBotChainConfig } from "./src/chain-config.js";
import {
  buildEvidenceAnchorTransaction,
  buildRecordVerificationTransaction,
  buildRecordPurchaseTransaction,
  buildRecordContributionTransaction,
  buildRaiseDisputeTransaction,
  buildConsumerGatewayPurchaseTransaction,
  buildPaidConsumerGatewayPurchaseTransaction,
  buildConsumerGatewayContributionTransaction,
  buildConsumerGatewayDisputeTransaction,
  buildAuditEscrowOpenChallengeTransaction,
  buildAuditEscrowSubmitFindingTransaction,
  buildAuditEscrowApproveFindingTransaction,
  buildAuditEscrowResolveChallengeTransaction,
  CHALLENGE_OPENED_TOPIC,
  AUDIT_FINDING_SUBMITTED_TOPIC,
  AUDIT_VERIFIER_APPROVED_TOPIC,
  CHALLENGE_RESOLVED_TOPIC,
  EVIDENCE_ANCHORED_TOPIC,
  VERIFICATION_RECORDED_TOPIC,
  PURCHASE_RECORDED_TOPIC,
  CONTRIBUTION_RECORDED_TOPIC,
  DISPUTE_RAISED_TOPIC,
  keccak256Hex,
} from "./src/chain.js";
import { buildJevContext, buildJevRoleView, SafeJevDecisionGate } from "./src/jev/context.js";
import { providerFromEnv } from "./src/jev/http-provider.js";
import type { JevDecision, JevState } from "./src/jev/model.js";
import type { ServiceAdapter, ServiceCard, TaskRequest } from "./src/types.js";
import {
  AnonymousConsumerRegistry,
  buildCfiManifest,
  createDefaultProductPolicyRegistry,
  publicStandardDocument,
} from "./src/standards/v1_4.js";
import { DEFAULT_CLI_REFERENCE_REGISTRY } from "./src/cli-reference/v1.js";
import { EnterprisePilotStore, type EnterpriseEvidenceEnvelope } from "./src/enterprise/pilot-store.js";
import { prepareMediaEvidence, type MediaKind } from "./src/enterprise/media-intake.js";
import { reconcileBatch } from "./src/enterprise/reconciliation.js";
import { createTruthPassMcpHttpHandler } from "./src/mcp/endpoint.js";
import { handleAgentRegistration } from "./src/web-server.js";
import {
  CONSUMER_MODEL_CONTRACT_VERSION,
  CONSUMER_PROMPT_POLICY_VERSION,
  consumerSafetyFewShot,
  validateConsumerModelOutput,
  type ConsumerSafetyChainContext,
  type ConsumerSafetyResult,
} from "./src/agents/consumer-safety.js";
import {
  alipayStatus,
  createAlipayPagePayForm,
  verifyAlipayNotify,
  paypalStatus,
  createPayPalOrder,
  capturePayPalOrder,
  verifyPayPalWebhook,
  type PaymentOrderInput,
} from "./src/payments/index.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const WEB_DIST = join(__dirname, "web", "dist");
const WEB = existsSync(WEB_DIST) ? WEB_DIST : join(__dirname, "web");
const LEGACY_WEB = existsSync(join(WEB_DIST, "legacy")) ? join(WEB_DIST, "legacy") : join(__dirname, "web-demo");
const PORT = Number(process.env.PORT || 4173);
const BATCH_ID = "FO-2026-001";
const invokeAgent = createCompatibleAgentInvoker();
type SiteLifecycleStatus = "draft" | "preview" | "published" | "archived";
type ServerSiteRevision = { revisionId: string; status: SiteLifecycleStatus; createdAt: string; config: Record<string, unknown> };
const siteStore = new Map<string, { config: Record<string, unknown>; revisions: ServerSiteRevision[] }>([
  ["rice-demo", {
    config: {
      tenantId: "tenant-rice-demo", slug: "rice-demo", siteStatus: "published", templateVersion: "truthpass-site-v1",
      brand: { name: "北境稻作", mark: "稻", slogans: { zh: "一粒米，先看证据。", en: "One grain. See the record first." } },
      product: { productId: "rice-wuchang", name: "北境稻作 · 五常米", category: "粮食", demoMode: "demo/synthetic" },
      batch: { defaultBatchId: "RC-2026-001", evidenceCategories: ["产地", "天气", "土壤", "农残检测", "仓储运输"] },
      agent: { enabled: true, allowedTools: ["inspect_batch", "explain_batch", "lifecycle", "chain_status"] },
      wallet: { chainId: 677, allowedRoles: ["consumer", "producer", "inspection", "review", "logistics", "arbitration"] },
    },
    revisions: [{ revisionId: "rice-demo-r1", status: "published", createdAt: new Date().toISOString(), config: {} }],
  }],
  ["fish-oil-demo", {
    config: {
      tenantId: "tenant-fish-oil-demo", slug: "fish-oil-demo", siteStatus: "published", templateVersion: "truthpass-site-v1",
      brand: { name: "深海营养", mark: "海", slogans: { zh: "每一粒，都有依据。", en: "Every capsule has a record." } },
      product: { productId: "fish-oil", name: "深海鱼油", category: "营养食品", demoMode: "demo/synthetic" },
      batch: { defaultBatchId: "FO-2026-001", evidenceCategories: ["原料来源", "检测报告", "冷链", "出货记录"] },
      agent: { enabled: true, allowedTools: ["inspect_batch", "explain_batch", "lifecycle", "chain_status"] },
      wallet: { chainId: 677, allowedRoles: ["consumer", "producer", "inspection", "review", "logistics", "arbitration"] },
    },
    revisions: [{ revisionId: "fish-oil-demo-r1", status: "published", createdAt: new Date().toISOString(), config: {} }],
  }],
]);
let lastCustomerModelDiagnostic: { endpointHost: string; status?: number; errorType?: string; event: string; at: string } | null = null;

type CustomerModelRuntimeStatus =
  | "completed"
  | "fallback"
  | "billing_required"
  | "unauthorized"
  | "rate_limited"
  | "invalid_response"
  | "unavailable";

type CustomerModelRuntime = {
  provider: string;
  model: string;
  status: CustomerModelRuntimeStatus;
  responseStatus?: number;
  providerIssue?: ChatReplyResult["providerIssue"];
  at: string;
};

let lastCustomerModelRuntime: CustomerModelRuntime | null = null;
const publicPolicyRegistry = createDefaultProductPolicyRegistry();
const anonymousConsumers = new AnonymousConsumerRegistry();

type PaymentProvider = "alipay" | "paypal";
function paymentProviderStatus(provider: PaymentProvider) {
  const status = provider === "alipay" ? alipayStatus() : paypalStatus();
  return {
    provider,
    configured: status.configured,
    mode: status.mode,
    capabilities: provider === "alipay" ? ["page_pay", "wap_pay", "rsa2_notify_verify"] : ["create_order", "capture_order", "webhook_verify"],
    missing: status.missing,
    secretConfig: provider === "alipay"
      ? ["ALIPAY_APP_ID", "ALIPAY_PRIVATE_KEY", "ALIPAY_PUBLIC_KEY", "ALIPAY_NOTIFY_URL"]
      : ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET", "PAYPAL_WEBHOOK_ID"],
  };
}

function purchaseQuote(batchId: string) {
  const amount = Number(process.env.TRUTHPASS_PURCHASE_AMOUNT || "29.90");
  const paidGateway = configuredPaidConsumerGateway();
  return {
    batchId,
    amount: Number.isFinite(amount) && amount > 0 ? amount.toFixed(2) : "29.90",
    currency: process.env.TRUTHPASS_PURCHASE_CURRENCY || "CNY",
    status: "quote_only",
    paymentRequired: true,
    providers: [paymentProviderStatus("alipay"), paymentProviderStatus("paypal")],
    chainPayment: paidGateway
      ? { enabled: true, chainId: BOT_CHAIN_MAINNET.chainId, gatewayAddress: paidGateway.address, amountWei: paidGateway.priceWei, amountBot: "0.001", status: "quote_ready" }
      : { enabled: false, chainId: BOT_CHAIN_MAINNET.chainId, gatewayAddress: null, amountWei: "0", amountBot: "0", status: "not_configured" },
    note: "报价不代表已支付；未配置凭据或未收到官方网关回调/核验结果时不会返回成功。",
  };
}

function configuredPaidConsumerGateway(): { address: string; priceWei: string } | undefined {
  const address = process.env.TRUTHPASS_PAID_CONSUMER_GATEWAY_ADDRESS?.trim() ?? "";
  const priceWei = (process.env.TRUTHPASS_PURCHASE_PRICE_WEI?.trim() || "1000000000000000");
  if (!/^0x[0-9a-fA-F]{40}$/.test(address) || !/^\d+$/.test(priceWei) || BigInt(priceWei) <= 0n) return undefined;
  return { address, priceWei };
}

type RecommendationRecord = {
  batchId: string;
  tenantId: string;
  productId: string;
  recommendationStatus: "recommend_with_scope" | "review_before_recommendation" | "do_not_recommend";
  verificationStatus: string;
  productionEvidence: ReturnType<typeof productionProcessFor>;
  inspectionEvidence: Array<Record<string, unknown>>;
  coldChainEvidence: Array<Record<string, unknown>>;
  feedbackSummary: Record<string, unknown>;
  missingItems: string[];
  conflicts: string[];
  /** Ordered deterministic gate reasons, with concrete parameters first. */
  gateReasons: string[];
  evidenceIds: string[];
  reason: string;
  nextAction: string;
  traceId: string;
  dataMode: "demo/synthetic" | "external";
  item: Record<string, unknown>;
};

type PaymentOrderRecord = {
  orderId: string;
  provider: PaymentProvider;
  providerOrderId?: string;
  tenantId: string;
  productId: string;
  batchId: string;
  amount: string;
  currency: string;
  status: "pending" | "paid" | "failed";
  paymentStatus: "payment_pending" | "payment_verified" | "payment_failed";
  chainStatus: "not_started" | "anchor_pending" | "mainnet_receipt_verified";
  createdAt: string;
  updatedAt: string;
  rawStatus?: Record<string, unknown>;
};

const paymentOrders = new Map<string, PaymentOrderRecord>();

class PaymentPersistenceError extends Error {
  constructor(cause: unknown) {
    super("PAYMENT_PERSISTENCE_FAILED");
    this.name = "PaymentPersistenceError";
    this.cause = cause;
  }
}

let paymentSchemaReady: Promise<void> | undefined;

async function ensurePaymentOrderSchema(): Promise<void> {
  paymentSchemaReady ??= getDatabasePool().query(`
    create table if not exists truthpass_payment_orders (
      order_id text primary key,
      tenant_id text not null default 'demo',
      product_id text not null default '',
      batch_id text not null,
      provider text not null check (provider in ('alipay','paypal')),
      provider_order_id text,
      amount numeric(18,2) not null,
      currency text not null,
      status text not null check (status in ('quote_only','pending','paid','failed','refunded')) default 'quote_only',
      purchase_id text,
      tx_hash text,
      receipt_status text,
      raw_status jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create unique index if not exists truthpass_payment_provider_order_idx
      on truthpass_payment_orders (provider, provider_order_id)
      where provider_order_id is not null;
    create index if not exists truthpass_payment_orders_batch_idx
      on truthpass_payment_orders (batch_id, created_at desc);
  `).then(() => undefined).catch((error) => {
    paymentSchemaReady = undefined;
    throw error;
  });
  await paymentSchemaReady;
}

function paymentOrderId(provider: PaymentProvider, batchId: string): string {
  return `TP-${provider.toUpperCase()}-${batchId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function paymentInputFromBody(body: Record<string, unknown>, provider: PaymentProvider, origin: string): { context: Omit<PaymentOrderRecord, "providerOrderId" | "status" | "paymentStatus" | "chainStatus" | "createdAt" | "updatedAt" | "rawStatus">; input: PaymentOrderInput } {
  const batchId = typeof body.batchId === "string" ? body.batchId.trim().toUpperCase() : BATCH_ID;
  const demo = demoBatchFor(batchId);
  const dbBatch = repository.getBatch(batchId);
  if (!demo && !dbBatch) throw new Error("UNKNOWN_BATCH");
  const tenantId = isRiceBatch(batchId) ? "tenant-rice-demo" : "tenant-fish-oil-demo";
  const productId = demo ? (isRiceBatch(batchId) ? "rice-wuchang" : "fish-oil") : (dbBatch?.productId ?? "");
  if (typeof body.tenantId === "string" && body.tenantId.trim() && body.tenantId.trim() !== tenantId) throw new Error("TENANT_SCOPE_MISMATCH");
  if (typeof body.productId === "string" && body.productId.trim() && body.productId.trim() !== productId) throw new Error("PRODUCT_SCOPE_MISMATCH");
  const orderId = paymentOrderId(provider, batchId);
  const configuredAmount = provider === "alipay" ? process.env.TRUTHPASS_PURCHASE_AMOUNT : (process.env.TRUTHPASS_PAYPAL_AMOUNT || process.env.TRUTHPASS_PURCHASE_AMOUNT);
  const parsedAmount = configuredAmount === undefined ? Number.NaN : Number(configuredAmount);
  const amount = Number.isFinite(parsedAmount) && parsedAmount > 0 ? parsedAmount.toFixed(2) : "29.90";
  const currency = provider === "alipay" ? (process.env.TRUTHPASS_PURCHASE_CURRENCY || "CNY") : (process.env.TRUTHPASS_PAYPAL_CURRENCY || "USD");
  const subject = typeof body.subject === "string" && body.subject.trim() ? body.subject.trim().slice(0, 120) : `TruthPass ${productId} ${batchId}`;
  const input: PaymentOrderInput = {
    orderId,
    batchId,
    productId,
    amount,
    currency,
    subject,
    returnUrl: typeof body.returnUrl === "string" && body.returnUrl.startsWith("http") ? body.returnUrl : `${origin}/?payment=return&batch=${encodeURIComponent(batchId)}`,
    cancelUrl: typeof body.cancelUrl === "string" && body.cancelUrl.startsWith("http") ? body.cancelUrl : `${origin}/?payment=cancel&batch=${encodeURIComponent(batchId)}`,
    notifyUrl: typeof body.notifyUrl === "string" && body.notifyUrl.startsWith("http") ? body.notifyUrl : `${origin}/api/payments/alipay/notify`,
  };
  return { context: { orderId, provider, tenantId, productId, batchId, amount, currency }, input };
}

async function persistPaymentOrder(record: PaymentOrderRecord): Promise<void> {
  if (!persistenceEnabled()) return;
  try {
    await ensurePaymentOrderSchema();
    await getDatabasePool().query(
      `insert into truthpass_payment_orders (order_id, tenant_id, product_id, batch_id, provider, provider_order_id, amount, currency, status, purchase_id, tx_hash, receipt_status, raw_status, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,now())
       on conflict (order_id) do update set provider_order_id=excluded.provider_order_id, status=excluded.status, purchase_id=excluded.purchase_id, tx_hash=excluded.tx_hash, receipt_status=excluded.receipt_status, raw_status=excluded.raw_status, updated_at=now()`,
      [record.orderId, record.tenantId, record.productId, record.batchId, record.provider, record.providerOrderId ?? null, record.amount, record.currency, record.status, null, null, null, JSON.stringify({ paymentStatus: record.paymentStatus, chainStatus: record.chainStatus, ...(record.rawStatus ?? {}) })],
    );
  } catch (error) {
    console.error("支付订单持久化失败:", error instanceof Error ? error.message : String(error));
    throw new PaymentPersistenceError(error);
  }
}

async function loadPersistedPaymentOrders(filter?: { batchId?: string; orderId?: string; provider?: PaymentProvider; providerOrderId?: string; required?: boolean }): Promise<PaymentOrderRecord[]> {
  const inMemory = [...paymentOrders.values()].filter((item) =>
    (!filter?.batchId || item.batchId === filter.batchId) && (!filter?.orderId || item.orderId === filter.orderId),
  );
  if (!persistenceEnabled()) return inMemory;
  try {
    await ensurePaymentOrderSchema();
    const clauses: string[] = [];
    const values: string[] = [];
    if (filter?.batchId) { values.push(filter.batchId); clauses.push(`batch_id = $${values.length}`); }
    if (filter?.orderId) { values.push(filter.orderId); clauses.push(`order_id = $${values.length}`); }
    if (filter?.provider) { values.push(filter.provider); clauses.push(`provider = $${values.length}`); }
    if (filter?.providerOrderId) { values.push(filter.providerOrderId); clauses.push(`provider_order_id = $${values.length}`); }
    const result = await getDatabasePool().query(
      `select order_id, tenant_id, product_id, batch_id, provider, provider_order_id, amount, currency, status, raw_status, created_at, updated_at
         from truthpass_payment_orders${clauses.length ? ` where ${clauses.join(" and ")}` : ""}
        order by created_at desc`,
      values,
    );
    const persisted = result.rows.map((row) => {
      const raw = row.raw_status && typeof row.raw_status === "object" ? row.raw_status as Record<string, unknown> : {};
      const status = String(row.status) as PaymentOrderRecord["status"];
      const paymentStatus = raw.paymentStatus === "payment_verified" || status === "paid"
        ? "payment_verified"
        : raw.paymentStatus === "payment_failed" || status === "failed"
          ? "payment_failed"
          : "payment_pending";
      const chainStatus = raw.chainStatus === "mainnet_receipt_verified" ? "mainnet_receipt_verified" : "not_started";
      return {
        orderId: String(row.order_id),
        provider: String(row.provider) as PaymentProvider,
        providerOrderId: row.provider_order_id ? String(row.provider_order_id) : undefined,
        tenantId: String(row.tenant_id),
        productId: String(row.product_id),
        batchId: String(row.batch_id),
        amount: String(row.amount),
        currency: String(row.currency),
        status: ["pending", "paid", "failed"].includes(status) ? status : "pending",
        paymentStatus,
        chainStatus,
        createdAt: new Date(String(row.created_at)).toISOString(),
        updatedAt: new Date(String(row.updated_at)).toISOString(),
        rawStatus: raw,
      } satisfies PaymentOrderRecord;
    });
    if (filter?.required) return persisted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const merged = new Map<string, PaymentOrderRecord>();
    for (const item of persisted) merged.set(item.orderId, item);
    for (const item of inMemory) merged.set(item.orderId, item);
    return [...merged.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  } catch (error) {
    console.error("支付订单读取失败:", error instanceof Error ? error.message : String(error));
    if (filter?.required) throw new PaymentPersistenceError(error);
    return inMemory;
  }
}

async function findPaymentOrderByProviderOrderId(provider: PaymentProvider, providerOrderId: string): Promise<PaymentOrderRecord | undefined> {
  const normalized = providerOrderId.trim();
  if (!normalized) return undefined;
  const inMemory = [...paymentOrders.values()].find((item) => item.provider === provider && item.providerOrderId === normalized);
  if (!persistenceEnabled()) return inMemory;
  // The provider callback may arrive after a process restart. A callback is
  // not allowed to be bound from the in-memory map alone when persistence is
  // configured.
  const persisted = await loadPersistedPaymentOrders({ provider, providerOrderId: normalized, required: true });
  // Database is authoritative whenever persistence is configured. The local
  // map is only a fallback for an explicitly memory-backed demo.
  const record = persisted[0] ?? inMemory;
  if (record) paymentOrders.set(record.orderId, record);
  return record;
}

// ---------- 加载 .env（SMTP 等本地配置，不提交仓库） ----------
async function loadEnv(): Promise<void> {
  try {
    const txt = await readFile(join(__dirname, ".env"), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // .env 不存在时忽略，邮件发送会降级为跳过
  }
}
await loadEnv();

const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 465),
  secure: true,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const task: TaskRequest = {
  taskId: "task-fish-oil-2026-001",
  serviceKind: "lab",
  capability: "fish-oil-batch-quality-check",
  batchId: BATCH_ID,
  productionTime: "2026-10-06T08:00:00Z",
  acceptance: { requireSignature: true, policyId: "fish-oil-quality", policyVersion: "v1" },
};
const dataSource = process.env.TRUTHPASS_DATA_SOURCE ?? (persistenceEnabled() ? "postgres" : "fixtures");

// ---------- 初始化只读数据仓库 ----------
const repository = dataSource === "postgres" ? await loadRepositoryFromPostgres() : new MemoryDataRepository();
if (dataSource !== "postgres") {
  repository.createProduct(fishOilProduct);
  repository.createBatch(fishOilBatch);
  for (const item of fishOilEvidence) await repository.addEvidence(item);
}

if (dataSource === "postgres") {
  const executionEvidence = await loadExecutionEvidenceFromPostgres(task.taskId, task.batchId);
  for (const evidence of executionEvidence) {
    const evidenceId = `execution-${evidence.serviceId}-${evidence.reportTime.replace(/[^0-9]/g, "")}`;
    await repository.addEvidence({
      schemaVersion: "evidence.v1", evidenceId, batchId: evidence.batchId, kind: "inspection",
      issuerId: evidence.serviceId, sourceKind: "third_party", occurredAt: evidence.reportTime,
      dataMode: evidence.payload.evidenceMode === "demo/synthetic" ? "demo/synthetic" : "external",
      payload: evidence.payload,
      attestation: evidence.attestation,
    });
  }
} else {
  await repository.addEvidence({
    schemaVersion: "evidence.v1", evidenceId: "ev-test-report-001", batchId: BATCH_ID, kind: "inspection",
    issuerId: "lab-demo-001", sourceKind: "third_party", occurredAt: "2026-10-06T10:20:00Z", dataMode: "demo/synthetic",
    payload: { taskId: task.taskId, reportBatchId: BATCH_ID, logisticsGapHours: 2, signatureValid: true, epaDhaPercent: 78, peroxideValue: 2.1, totox: 11, coldChainGapHours: 2 },
  });
}

const productionSummary = await buildProductionPublicSummary(repository, BATCH_ID);

const inspectionEvidence = repository.listEvidence(BATCH_ID).find((item) => item.kind === "inspection" && item.payload.taskId === task.taskId)
  ?? repository.listEvidence(BATCH_ID).find((item) => item.kind === "inspection");
if (!inspectionEvidence) throw new Error(`批次 ${BATCH_ID} 没有可用检测证据`);
const trustedIssuerKeys = new TrustedIssuerKeyRegistry(
  JSON.parse(process.env.TRUTHPASS_TRUSTED_ISSUER_KEYS ?? "[]") as TrustedIssuerPublicKey[],
);
const enterprisePilotStore = new EnterprisePilotStore({ resolveTrustedKey: trustedIssuerKeys.resolve });
const replayGuard = persistenceEnabled() ? createPostgresReplayGuard() : undefined;
const inspectionTools = new TruthPassTools(repository, "inspection", trustedIssuerKeys.resolve, true, replayGuard);

const policy = getPolicySnapshot(
  task.acceptance.policyId ?? "fish-oil-quality",
  task.acceptance.policyVersion ?? "v1",
);
const assessment = await inspectionTools.assessProductBatch({ task, evidenceId: inspectionEvidence.evidenceId });

// ---------- 多批次展示数据（demo 编造，001 走真实验收） ----------
type HeavyMetals = { pb: number; hg: number; cd: number; as: number };
type DemoBatch = {
  name: string;
  image: string;
  epaDha: number;
  peroxide: number;
  totox: number;
  coldGap: number;
  productionDate: string;
  origin: string;
  passed: boolean;
  heavyMetals: HeavyMetals;
};

const HEAVY_METAL_LIMITS: HeavyMetals = { pb: 0.5, hg: 0.1, cd: 0.1, as: 1.0 };
const HEAVY_METAL_LABELS: Record<keyof HeavyMetals, string> = { pb: "铅 Pb", hg: "汞 Hg", cd: "镉 Cd", as: "砷 As" };

const FISH_OIL_BATCHES: Record<string, DemoBatch> = {
  "FO-2026-001": { name: "深海鱼油软胶囊", image: "/assets/fish-oil-product.png", epaDha: 78, peroxide: 2.1, totox: 11, coldGap: 2, productionDate: "2026-01-12", origin: "北太平洋海域", passed: true, heavyMetals: { pb: 0.02, hg: 0.01, cd: 0.03, as: 0.1 } },
  "FO-2026-002": { name: "高纯度 Omega-3 鱼油", image: "/assets/fish-oil-002.png", epaDha: 82, peroxide: 1.8, totox: 9, coldGap: 1.5, productionDate: "2026-02-08", origin: "挪威海域", passed: true, heavyMetals: { pb: 0.01, hg: 0.02, cd: 0.02, as: 0.15 } },
  "FO-2026-003": { name: "儿童 DHA 鱼油滴剂", image: "/assets/fish-oil-003.png", epaDha: 90, peroxide: 1.2, totox: 6, coldGap: 3, productionDate: "2026-03-15", origin: "阿拉斯加海域", passed: true, heavyMetals: { pb: 0.03, hg: 0.01, cd: 0.01, as: 0.08 } },
  "FO-2026-004": { name: "三文鱼油胶囊", image: "/assets/fish-oil-004.png", epaDha: 75, peroxide: 6.8, totox: 14, coldGap: 2.5, productionDate: "2026-04-02", origin: "智利海域", passed: false, heavyMetals: { pb: 0.04, hg: 0.03, cd: 0.05, as: 0.2 } },
  "FO-2026-005": { name: "南极磷虾油", image: "/assets/fish-oil-005.png", epaDha: 85, peroxide: 1.5, totox: 8, coldGap: 7, productionDate: "2026-05-20", origin: "南极海域", passed: false, heavyMetals: { pb: 0.05, hg: 0.02, cd: 0.18, as: 0.3 } },
  "FO-2026-006": { name: "高浓度 Omega-3 软胶囊", image: "/assets/fish-oil-006.png", epaDha: 88, peroxide: 1.6, totox: 8, coldGap: 1.5, productionDate: "2026-06-10", origin: "挪威深海", passed: true, heavyMetals: { pb: 0.02, hg: 0.01, cd: 0.02, as: 0.12 } },
  "FO-2026-007": { name: "深海鳕鱼肝油", image: "/assets/fish-oil-007.png", epaDha: 80, peroxide: 2.0, totox: 10, coldGap: 2, productionDate: "2026-06-18", origin: "北大西洋海域", passed: true, heavyMetals: { pb: 0.03, hg: 0.02, cd: 0.04, as: 0.18 } },
  "FO-2026-008": { name: "孕妇 DHA 鱼油", image: "/assets/fish-oil-008.png", epaDha: 92, peroxide: 1.2, totox: 6, coldGap: 1, productionDate: "2026-07-02", origin: "阿拉斯加海域", passed: true, heavyMetals: { pb: 0.01, hg: 0.01, cd: 0.01, as: 0.06 } },
  "FO-2026-009": { name: "鱼油凝胶软糖", image: "/assets/fish-oil-009.png", epaDha: 55, peroxide: 2.5, totox: 12, coldGap: 2.5, productionDate: "2026-07-15", origin: "南太平洋海域", passed: false, heavyMetals: { pb: 0.04, hg: 0.02, cd: 0.05, as: 0.2 } },
  "FO-2026-010": { name: "高纯度磷虾油胶囊", image: "/assets/fish-oil-010.png", epaDha: 86, peroxide: 6.5, totox: 18, coldGap: 3, productionDate: "2026-07-28", origin: "南极海域", passed: false, heavyMetals: { pb: 0.05, hg: 0.03, cd: 0.15, as: 0.3 } },
};

// Rice is the first non-fish tenant example. It intentionally stays synthetic,
// but it must exercise the same public product, evidence, lifecycle, JEV and
// Agent paths so the tenant site is not a dead visual mock.
const RICE_BATCHES: Record<string, DemoBatch> = {
  "RC-2026-001": { name: "北境稻作 · 五常米", image: "/assets/brand-mark.png", epaDha: 0, peroxide: 0, totox: 0, coldGap: 0, productionDate: "2026-09-18", origin: "黑龙江五常 · 演示产地", passed: true, heavyMetals: { pb: 0.02, hg: 0.01, cd: 0.01, as: 0.05 } },
  "RC-2026-002": { name: "北境稻作 · 复核批次", image: "/assets/brand-mark.png", epaDha: 0, peroxide: 0, totox: 0, coldGap: 0, productionDate: "2026-09-28", origin: "黑龙江五常 · 演示产地", passed: false, heavyMetals: { pb: 0.03, hg: 0.01, cd: 0.02, as: 0.08 } },
  "RC-2026-003": { name: "北境稻作 · 已通过范围批次", image: "/assets/brand-mark.png", epaDha: 0, peroxide: 0, totox: 0, coldGap: 0, productionDate: "2026-10-04", origin: "黑龙江五常 · 演示产地", passed: true, heavyMetals: { pb: 0.01, hg: 0.01, cd: 0.01, as: 0.04 } },
  "RC-2026-004": { name: "北境稻作 · 待补资料批次", image: "/assets/brand-mark.png", epaDha: 0, peroxide: 0, totox: 0, coldGap: 0, productionDate: "2026-10-10", origin: "黑龙江五常 · 演示产地", passed: false, heavyMetals: { pb: 0.04, hg: 0.02, cd: 0.03, as: 0.09 } },
  "RC-2026-005": { name: "北境稻作 · 仓储复核批次", image: "/assets/brand-mark.png", epaDha: 0, peroxide: 0, totox: 0, coldGap: 0, productionDate: "2026-10-15", origin: "黑龙江五常 · 演示产地", passed: true, heavyMetals: { pb: 0.02, hg: 0.01, cd: 0.01, as: 0.05 } },
};

function demoBatchFor(batchId: string): DemoBatch | undefined {
  return FISH_OIL_BATCHES[batchId] ?? RICE_BATCHES[batchId];
}

function isRiceBatch(batchId: string): boolean {
  return batchId.toUpperCase().startsWith("RC-");
}

type LifecycleStage = "production" | "inspection" | "cold_chain" | "shipment" | "purchase" | "after_sales" | "regulatory_review";
type LifecycleStatus = "synced" | "verified" | "pending" | "awaiting_user";
type LifecycleEvent = {
  stage: LifecycleStage;
  label: string;
  role: string;
  status: LifecycleStatus;
  detail: string;
  updatedAt: string;
  walletAction?: "evidence" | "verification" | "purchase" | "contribution" | "dispute" | "audit_finding" | "audit_approval" | "resolve_challenge";
  requiredRole?: string;
};

const LIFECYCLE_STAGE_DEFS: Array<Omit<LifecycleEvent, "status" | "updatedAt"> & { initialStatus: LifecycleStatus }> = [
  { stage: "production", label: "生产方提交", role: "生产方 Agent", initialStatus: "synced", detail: "生产记录已同步，等待机构或监管签名锚定。", walletAction: "evidence", requiredRole: "EVIDENCE_WRITER_ROLE" },
  { stage: "inspection", label: "检测机构签名", role: "检测机构 Agent", initialStatus: "synced", detail: "检测报告已关联 batchId / sampleId，签名状态可继续核验。", walletAction: "verification", requiredRole: "VERIFIER_ROLE" },
  { stage: "cold_chain", label: "冷链记录同步", role: "物流与设备 Agent", initialStatus: "synced", detail: "温度、湿度和中断时长来自演示设备同步。" },
  { stage: "shipment", label: "出货与交付", role: "物流 Agent", initialStatus: "pending", detail: "等待物流回调绑定订单和批次。" },
  { stage: "purchase", label: "消费者购买", role: "消费者 Agent", initialStatus: "awaiting_user", detail: "需要消费者钱包签名并回读 PurchaseRecorded receipt。", walletAction: "purchase", requiredRole: "CONSUMER_SELF_SERVICE" },
  { stage: "after_sales", label: "售后与反馈", role: "消费者客服 Agent", initialStatus: "pending", detail: "购买确认后开放授权反馈和争议入口。", walletAction: "contribution", requiredRole: "CONSUMER_SELF_SERVICE" },
  { stage: "regulatory_review", label: "监管复核", role: "监管 / 审核 Agent", initialStatus: "pending", detail: "监管钱包可提交核验或审核争议发现；最终状态仍由确定性规则和人工流程决定。", walletAction: "audit_approval", requiredRole: "VERIFIER_ROLE" },
];

const lifecycleSimulation = new Map<string, { revision: number; syncedAt: string; events: LifecycleEvent[] }>();

// Restore demo lifecycle revisions before serving requests.  The lifecycle
// view remains explicitly demo/synthetic; persistence only prevents a process
// restart from erasing the visible revision and stage updates.
const lifecycleHydration = (async () => {
  if (!persistenceEnabled()) return;
  const batchIds = [...new Set([...Object.keys(FISH_OIL_BATCHES), ...Object.keys(RICE_BATCHES)])];
  for (const batchId of batchIds) {
    try {
      const persisted = await loadPersistedLifecycleState(batchId);
      if (persisted && !lifecycleSimulation.has(batchId)) {
        lifecycleSimulation.set(batchId, {
          revision: persisted.revision,
          syncedAt: persisted.syncedAt,
          events: persisted.events as LifecycleEvent[],
        });
      }
    } catch (error) {
      // A database outage must not turn a read-only demo into a false claim of
      // persistence.  The route continues with the in-memory fixture and the
      // caller can inspect the service health/persistence diagnostics.
      console.error("生命周期状态恢复失败:", error instanceof Error ? error.message : String(error));
      break;
    }
  }
})();

function lifecycleStateFor(batchId: string) {
  const current = lifecycleSimulation.get(batchId);
  if (current) return current;
  const now = new Date().toISOString();
  const created = {
    revision: 1,
    syncedAt: now,
    events: LIFECYCLE_STAGE_DEFS.map(({ initialStatus, ...definition }) => ({ ...definition, status: initialStatus, updatedAt: now })),
  };
  lifecycleSimulation.set(batchId, created);
  return created;
}

/**
 * Demo-only heartbeat used by the public Agent view. It produces a new,
 * explicitly synthetic sensor observation on every polling interval without
 * pretending that a real device or production record wrote it. The actual
 * lifecycle state remains the source of truth for manual/user actions.
 */
function continuousDemoLifecycleView(batchId: string, state: { revision: number; syncedAt: string; events: LifecycleEvent[] }) {
  const enabled = process.env.TRUTHPASS_DEMO_CONTINUOUS !== "false" && process.env.TRUTHPASS_DEMO_CONTINUOUS !== "0";
  if (!enabled || !demoBatchFor(batchId)) return { ...state, simulation: undefined };
  const intervalMs = 10_000;
  const tick = Math.floor(Date.now() / intervalMs);
  const generatedAt = new Date(tick * intervalMs).toISOString();
  const temperature = (3.5 + ((tick * 13) % 18) / 10).toFixed(1);
  const humidity = (61 + ((tick * 7) % 17)).toFixed(0);
  const events = state.events.map((event) => event.stage === "cold_chain"
    ? {
        ...event,
        updatedAt: generatedAt,
        detail: `演示设备同步 #${tick}：温度 ${temperature}℃、湿度 ${humidity}%（仅用于持续演示）`,
      }
    : event);
  return {
    revision: state.revision + tick,
    syncedAt: generatedAt,
    events,
    simulation: {
      mode: "continuous_demo",
      intervalMs,
      tick,
      generatedEvidenceId: `${batchId}:demo-sensor:${tick}`,
      sourceKind: "platform_device",
      dataMode: "demo/synthetic" as const,
      note: "这是按时间生成的演示传感器数据，不代表真实设备上报。",
    },
  };
}

function lifecyclePublicView(batchId: string) {
  const state = continuousDemoLifecycleView(batchId, lifecycleStateFor(batchId));
  return {
    schemaVersion: "truthpass.lifecycle.v1",
    batchId,
    contextMode: "production_sync_simulation" as const,
    contextSource: "repository+demo_fixture" as const,
    contextRevision: state.revision,
    syncedAt: state.syncedAt,
    dataMode: "demo/synthetic" as const,
    events: state.events,
    simulation: state.simulation,
    nextAction: state.events.find((event) => event.status === "pending" || event.status === "awaiting_user")?.stage ?? "complete",
    walletRoles: state.events.filter((event) => event.walletAction).map((event) => ({ stage: event.stage, label: event.label, role: event.role, action: event.walletAction, requiredRole: event.requiredRole })),
  };
}

function simulateLifecycleStage(batchId: string, stage: LifecycleStage) {
  const state = lifecycleStateFor(batchId);
  const now = new Date().toISOString();
  const event = state.events.find((item) => item.stage === stage);
  if (!event) throw new Error("不支持的生命周期阶段: " + stage);
  event.status = "verified";
  event.updatedAt = now;
  event.detail = stage === "regulatory_review" ? "监管复核记录已同步，等待链上 receipt 或人工裁决。" : event.detail.replace("等待", "已完成");
  state.revision += 1;
  state.syncedAt = now;
  return lifecyclePublicView(batchId);
}

async function persistCurrentLifecycleState(batchId: string): Promise<void> {
  if (!persistenceEnabled()) return;
  const state = lifecycleStateFor(batchId);
  await persistLifecycleState({
    batchId,
    revision: state.revision,
    syncedAt: state.syncedAt,
    events: state.events,
  });
}

function heavyMetalStatus(metals: HeavyMetals): "pass" | "fail" {
  const keys = Object.keys(HEAVY_METAL_LIMITS) as Array<keyof HeavyMetals>;
  return keys.some((k) => metals[k] > HEAVY_METAL_LIMITS[k]) ? "fail" : "pass";
}

function heavyMetalValue(metals: HeavyMetals): string {
  const keys = Object.keys(HEAVY_METAL_LIMITS) as Array<keyof HeavyMetals>;
  const over = keys.filter((k) => metals[k] > HEAVY_METAL_LIMITS[k]).map((k) => HEAVY_METAL_LABELS[k]);
  return over.length ? `${over.join("、")}高于当前限值` : "4 项均在当前限值内";
}

function demoParameterDetail(batch: DemoBatch): string {
  if (batch.epaDha === 0) return "产地、检测和仓储运输资料仍需按该商品的专用字段补齐";
  const parameters = [
    `EPA+DHA ${batch.epaDha}%（规则范围 ≥70%）`,
    `过氧化值 ${batch.peroxide} meq/kg（规则范围 ≤5）`,
    `TOTOX ${batch.totox}（规则范围 ≤20）`,
    `冷链异常 ${batch.coldGap} 小时（规则范围 ≤6 小时）`,
    `重金属 Pb/Hg/Cd/As ${batch.heavyMetals.pb}/${batch.heavyMetals.hg}/${batch.heavyMetals.cd}/${batch.heavyMetals.as} mg/kg（限值 0.5/0.1/0.1/1.0）`,
  ];
  const differences = [
    batch.epaDha < 70 ? "EPA+DHA 低于当前规则范围" : "",
    batch.peroxide > 5 ? "过氧化值高于当前规则范围" : "",
    batch.totox > 20 ? "TOTOX 高于当前规则范围" : "",
    batch.coldGap > 6 ? "冷链异常时长高于当前规则范围" : "",
    heavyMetalStatus(batch.heavyMetals) === "fail" ? "至少一项重金属高于当前限值" : "",
  ].filter(Boolean);
  return `登记参数：${parameters.join("；")}。${differences.length ? `需要复核的差异：${differences.join("；")}。` : "当前登记参数落在公开演示规则范围内。"}`;
}

function demoParameterDetailForLocale(batch: DemoBatch, locale: "zh" | "en"): string {
  if (locale !== "en") return demoParameterDetail(batch);
  if (batch.epaDha === 0) return "Origin, inspection, storage, and transport records still need the product-specific fields.";
  const parameters = [
    `EPA+DHA ${batch.epaDha}% (rule range >= 70%)`,
    `Peroxide value ${batch.peroxide} meq/kg (rule range <= 5)`,
    `TOTOX ${batch.totox} (rule range <= 20)`,
    `Cold-chain gap ${batch.coldGap} hours (rule range <= 6 hours)`,
    `Heavy metals Pb/Hg/Cd/As ${batch.heavyMetals.pb}/${batch.heavyMetals.hg}/${batch.heavyMetals.cd}/${batch.heavyMetals.as} mg/kg (limits 0.5/0.1/0.1/1.0)`,
  ];
  const differences = [
    batch.epaDha < 70 ? "EPA+DHA is outside the current rule range" : "",
    batch.peroxide > 5 ? "peroxide value is outside the current rule range" : "",
    batch.totox > 20 ? "TOTOX is outside the current rule range" : "",
    batch.coldGap > 6 ? "cold-chain gap is outside the current rule range" : "",
    heavyMetalStatus(batch.heavyMetals) === "fail" ? "at least one heavy-metal value is above the current limit" : "",
  ].filter(Boolean);
  return `Registered parameters: ${parameters.join("; ")}.${differences.length ? ` Differences requiring review: ${differences.join("; ")}.` : " The registered parameters are within the public demo rule range."}`;
}

function publicFactForLocale(value: string, locale: "zh" | "en"): string {
  if (locale !== "en") return value;
  const stageNames: Record<string, string> = {
    "原料验收": "raw-material intake",
    "浓缩": "concentration",
    "脱臭": "deodorization",
    "灌装": "filling",
    "包装": "packaging",
    "仓储": "storage",
    "天气或农残补充资料": "weather or pesticide records",
    "仓储运输覆盖": "storage and shipment coverage",
  };
  const missingStage = value.match(/^生产阶段“([^”]+)”资料未覆盖$/);
  if (missingStage) return `Production stage "${stageNames[missingStage[1]] ?? "the listed stage"}" is not covered.`;
  if (stageNames[value]) return stageNames[value];
  const translations: Array<[RegExp, string]> = [
    [/生产记录由生产方提交，目前属于厂商自报信息。/g, "The production record was submitted by the producer and is currently self-reported."],
    [/第三方检测来自第三方机构，签名尚未核验。/g, "The third-party test record is linked, but its signature has not been verified."],
    [/第三方检测来自第三方机构，签名已核验。/g, "The third-party test record is linked and its signature is verified."],
    [/冷链资料来自平台设备同步。/g, "The cold-chain record comes from a platform device sync."],
    [/当前批次登记信息/g, "the current batch record"],
  ];
  let translated = value;
  for (const [pattern, replacement] of translations) translated = translated.replace(pattern, replacement);
  // Do not expose untranslated internal Chinese fact text in an English answer.
  return /[\u3400-\u9fff]/.test(translated) ? "A registered fact from the current batch evidence card." : translated;
}

function parameterDetailsFor(batchId: string) {
  if (isRiceBatch(batchId)) {
    const rice = RICE_BATCHES[batchId];
    if (!rice) return [];
    return [
      { key: "origin", label: "产地与土壤", observed: rice.passed ? 1 : undefined, unit: "记录集", rule: "需绑定产地、批次和责任方", status: rice.passed ? "within_range" : "missing" },
      { key: "weather", label: "天气记录", observed: rice.passed ? 1 : undefined, unit: "覆盖状态", rule: "需覆盖播种至收获时间段", status: rice.passed ? "within_range" : "missing" },
      { key: "pesticide", label: "农残检测", observed: rice.passed ? 1 : undefined, unit: "检测结果集", rule: "按登记的检测方法和限值核对", status: rice.passed ? "within_range" : "outside_range" },
      { key: "logistics", label: "仓储运输", observed: rice.passed ? 1 : undefined, unit: "记录集", rule: "需绑定仓储、出货、运输记录", status: rice.passed ? "within_range" : "missing" },
    ];
  }
  const b = FISH_OIL_BATCHES[batchId];
  if (!b) {
    const dbBatch = repository.getBatch(batchId);
    const inspection = [...repository.listEvidence(batchId)].reverse().find((item) => item.kind === "inspection")?.payload ?? {};
    const observed = (key: string) => numberValue((inspection as Record<string, unknown>)[key]);
    const epa = observed("epaDhaPercent");
    const peroxide = observed("peroxideValue");
    const totox = observed("totox");
    const cold = observed("coldChainGapHours") ?? observed("maxGapHours");
    if (!dbBatch) return [];
    return [
      { key: "epa-dha", label: "EPA+DHA", observed: epa, unit: "%", rule: `≥ ${policy.thresholds.minEpaDhaPercent}%`, status: epa === undefined ? "missing" : epa >= policy.thresholds.minEpaDhaPercent ? "within_range" : "outside_range" },
      { key: "peroxide", label: "过氧化值", observed: peroxide, unit: "meq/kg", rule: `≤ ${policy.thresholds.maxPeroxideValue} meq/kg`, status: peroxide === undefined ? "missing" : peroxide <= policy.thresholds.maxPeroxideValue ? "within_range" : "outside_range" },
      { key: "totox", label: "TOTOX", observed: totox, unit: "指数", rule: `≤ ${policy.thresholds.maxTotox}`, status: totox === undefined ? "missing" : totox <= policy.thresholds.maxTotox ? "within_range" : "outside_range" },
      { key: "cold-chain", label: "冷链异常时长", observed: cold, unit: "小时", rule: `≤ ${policy.thresholds.maxLogisticsGapHours} 小时`, status: cold === undefined ? "missing" : cold <= policy.thresholds.maxLogisticsGapHours ? "within_range" : "outside_range" },
    ];
  }
  const rows = [
    { key: "epa-dha", label: "EPA+DHA", observed: b.epaDha, unit: "%", rule: "≥ 70%", status: b.epaDha >= 70 ? "within_range" : "outside_range", difference: b.epaDha - 70 },
    { key: "peroxide", label: "过氧化值", observed: b.peroxide, unit: "meq/kg", rule: "≤ 5 meq/kg", status: b.peroxide <= 5 ? "within_range" : "outside_range", difference: 5 - b.peroxide },
    { key: "totox", label: "TOTOX", observed: b.totox, unit: "指数", rule: "≤ 20", status: b.totox <= 20 ? "within_range" : "outside_range", difference: 20 - b.totox },
    { key: "cold-chain", label: "冷链异常时长", observed: b.coldGap, unit: "小时", rule: "≤ 6 小时", status: b.coldGap <= 6 ? "within_range" : "outside_range", difference: 6 - b.coldGap },
  ];
  for (const key of Object.keys(HEAVY_METAL_LIMITS) as Array<keyof HeavyMetals>) {
    rows.push({
      key: `heavy-metal-${key}`,
      label: HEAVY_METAL_LABELS[key],
      observed: b.heavyMetals[key],
      unit: "mg/kg",
      rule: `≤ ${HEAVY_METAL_LIMITS[key]} mg/kg`,
      status: b.heavyMetals[key] <= HEAVY_METAL_LIMITS[key] ? "within_range" : "outside_range",
      difference: HEAVY_METAL_LIMITS[key] - b.heavyMetals[key],
    });
  }
  return rows;
}

function metricsFor(batchId: string) {
  const dbBatch = repository.getBatch(batchId);
  if (dbBatch) {
    const records = repository.listEvidence(batchId);
    const inspection = batchId === BATCH_ID ? inspectionEvidence!.payload : [...records].reverse().find((item) => item.kind === "inspection")?.payload ?? {};
    const coldChain = [...records].reverse().find((item) => item.kind === "cold_chain")?.payload ?? {};
    const epa = numberValue(inspection.epaDhaPercent);
    const peroxide = numberValue(inspection.peroxideValue);
    const coldGap = numberValue(inspection.coldChainGapHours) ?? numberValue(coldChain.maxGapHours);
    return [
      { key: "epa-dha", icon: "fish", label: "EPA+DHA", value: epa === undefined ? "未登记" : String(epa) + "%", unit: "检测结果（占总脂肪酸）", rule: "≥ 70%", bar: epa === undefined ? 0 : Math.min(100, epa), status: epa === undefined ? "missing" : epa >= 70 ? "pass" : "fail" },
      { key: "peroxide", icon: "warning", label: "过氧化值", value: peroxide === undefined ? "未登记" : String(peroxide), unit: "meq/kg", rule: "≤ 5 meq/kg", bar: peroxide === undefined ? 0 : Math.min(100, Math.round((peroxide / 5) * 100)), status: peroxide === undefined ? "missing" : peroxide <= 5 ? "pass" : "fail" },
      { key: "cold-chain", icon: "snowflake", label: "冷链", value: coldGap === undefined ? "未登记" : String(coldGap) + "小时", unit: "全程温度异常时长", rule: "≤ 6 小时", bar: coldGap === undefined ? 0 : Math.min(100, Math.round((coldGap / 6) * 100)), status: coldGap === undefined ? "missing" : coldGap <= 6 ? "pass" : "fail" },
      { key: "heavy-metal", icon: "alert", label: "重金属报告", value: "当前批次未登记", unit: "铅 / 汞 / 镉 / 砷", rule: "Pb ≤ 0.5 · Hg ≤ 0.1 · Cd ≤ 0.1 · As ≤ 1.0 mg/kg", bar: 0, status: "missing" },
    ];
  }
  if (isRiceBatch(batchId)) {
    const rice = RICE_BATCHES[batchId] ?? RICE_BATCHES["RC-2026-001"];
    return [
      { key: "origin", icon: "sensor", label: "产地与土壤", value: rice.passed ? "已登记" : "待补资料", unit: "产地、土壤和种植记录", rule: "需绑定产地、批次和责任方", bar: rice.passed ? 92 : 56, status: rice.passed ? "pass" : "missing" },
      { key: "weather", icon: "fish", label: "天气记录", value: rice.passed ? "已关联" : "部分缺失", unit: "播种至收获的气候记录", rule: "需覆盖播种至收获时间段", bar: rice.passed ? 88 : 45, status: rice.passed ? "pass" : "missing" },
      { key: "pesticide", icon: "warning", label: "农残检测", value: rice.passed ? "在当前范围内" : "待复核", unit: "第三方检测指标", rule: "按登记的检测方法和限值核对", bar: rice.passed ? 86 : 62, status: rice.passed ? "pass" : "fail" },
      { key: "logistics", icon: "snowflake", label: "仓储运输", value: rice.passed ? "已覆盖" : "有缺口", unit: "仓储、出货与运输记录", rule: "需绑定仓储、出货、运输记录", bar: rice.passed ? 80 : 48, status: rice.passed ? "pass" : "missing" },
    ];
  }
  const b = FISH_OIL_BATCHES[batchId] ?? FISH_OIL_BATCHES[BATCH_ID];
  const hm = heavyMetalStatus(b.heavyMetals);
  return [
    { key: "epa-dha", icon: "fish", label: "EPA+DHA", value: `${b.epaDha}%`, unit: "检测结果（占总脂肪酸）", rule: "≥ 70%", bar: Math.min(100, b.epaDha), status: b.epaDha >= 70 ? "pass" : "fail" },
    { key: "peroxide", icon: "warning", label: "过氧化值", value: `${b.peroxide}`, unit: "meq/kg", rule: "≤ 5 meq/kg", bar: Math.min(100, Math.round((b.peroxide / 5) * 100)), status: b.peroxide <= 5 ? "pass" : "fail" },
    { key: "cold-chain", icon: "snowflake", label: "冷链", value: `${b.coldGap}小时`, unit: "全程温度异常时长", rule: "≤ 6 小时", bar: Math.min(100, Math.round((b.coldGap / 6) * 100)), status: b.coldGap <= 6 ? "pass" : "fail" },
    { key: "heavy-metal", icon: "alert", label: "重金属报告", value: heavyMetalValue(b.heavyMetals), unit: "铅 / 汞 / 镉 / 砷", rule: "Pb ≤ 0.5 · Hg ≤ 0.1 · Cd ≤ 0.1 · As ≤ 1.0 mg/kg", bar: hm === "pass" ? 15 : 85, status: hm },
  ];
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function journeyFor(batchId: string) {
  if (isRiceBatch(batchId)) {
    const b = RICE_BATCHES[batchId] ?? RICE_BATCHES["RC-2026-001"];
    return [
      { step: 1, icon: "sensor", title: "产地与种植", desc: `${b.origin} · 种植记录` },
      { step: 2, icon: "fish", title: "天气与土壤", desc: `${b.productionDate} · 田间资料关联` },
      { step: 3, icon: "rule", title: "农残检测", desc: "第三方检测报告 · 当前范围核验" },
      { step: 4, icon: "snowflake", title: "仓储运输", desc: "仓储、出货和运输记录 · 演示数据" },
      { step: 5, icon: "chain", title: "批次摘要", desc: "Evidence Root · 等待外部钱包签名" },
    ];
  }
  const b = FISH_OIL_BATCHES[batchId] ?? FISH_OIL_BATCHES[BATCH_ID];
  return [
    { step: 1, icon: "fish", title: "产地捕捞", desc: `${b.origin} · 纯净深海` },
    { step: 2, icon: "sensor", title: "提炼生产", desc: `${b.productionDate} · 低温提炼灌装` },
    { step: 3, icon: "rule", title: "第三方检测", desc: `SGS 检测报告 · EPA+DHA ${b.epaDha}%` },
    { step: 4, icon: "snowflake", title: "全程冷链", desc: `全程低温运输 · 温度异常 ${b.coldGap} 小时` },
    { step: 5, icon: "chain", title: "跨境到货", desc: "海关清关 · 保税仓出库" },
  ];
}

function evidenceHash(seed: string): string {
  return "0x" + createHash("sha256").update(seed).digest("hex").slice(0, 32);
}

function evidenceFor(batchId: string) {
  if (isRiceBatch(batchId)) {
    const b = RICE_BATCHES[batchId] ?? RICE_BATCHES["RC-2026-001"];
    const stamp = `${b.productionDate}T`;
    return [
      { step: 1, icon: "sensor", title: "种植资料", source: "生产方 · 产地 / 天气 / 土壤", description: "记录产地、播种、天气和土壤字段，绑定到当前大米批次。", hash: evidenceHash(`${batchId}:origin`), verifiedAt: `${stamp}08:30:00Z` },
      { step: 2, icon: "agent", title: "Agent 关联", source: "TruthPass Agent · 批次关系整理", description: "Agent 只整理当前批次的生产、检测和物流资料，不替代规则核验。", hash: evidenceHash(`${batchId}:agent`), verifiedAt: `${stamp}12:00:00Z` },
      { step: 3, icon: "jev", title: "JEV 判别", source: "JEV 决策门 · route_to_rule · 0.94", description: "识别缺失字段和冲突，决定继续解释、补资料或转人工复核。", hash: evidenceHash(`${batchId}:jev`), verifiedAt: `${stamp}13:40:00Z` },
      { step: 4, icon: "rule", title: "规则验收", source: "rice-origin-policy@v1", description: "按批次、时间、样品和检测报告关系执行确定性检查。", hash: evidenceHash(`${batchId}:rule`), verifiedAt: `${stamp}14:00:00Z` },
      { step: 5, icon: "chain", title: "链上摘要计划", source: "BOT Chain Mainnet (677) · anchor_pending", description: "原始报告留在链下，批次证据根等待外部钱包签名后锚定。", hash: evidenceHash(`${batchId}:root`), verifiedAt: `${stamp}14:05:00Z` },
    ].map((item) => ({ ...item, evidenceId: `${batchId}:evidence:${item.step}` }));
  }
  const b = FISH_OIL_BATCHES[batchId];
  if (!b) return [];
  const stamp = `${b.productionDate}T`;
  const historicalReplay = BOT_CHAIN_MAINNET.verifiedTransactions.find((item) => item.batchId === batchId);
  const chainEvidence = historicalReplay
    ? {
        step: 5,
        icon: "chain",
        title: "历史回放记录",
        source: "BOT Chain Mainnet (677) · replay_verified",
        description: "这是部署阶段保存的历史回放凭证，只证明该摘要在回放中被验证；不表示当前批次已经有实时 receipt。",
        hash: historicalReplay.txHash,
        verifiedAt: `${stamp}14:05:00Z`,
        explorerUrl: historicalReplay.explorerUrl,
        contractAddress: historicalReplay.contractAddress,
        status: "replay_verified",
      }
    : {
        step: 5,
        icon: "chain",
        title: "链上摘要计划",
        source: "BOT Chain Mainnet (677) · anchor_pending",
        description: "当前批次还没有通过服务端核验的真实 receipt。原始资料留在链下，证据根等待外部钱包签名后再锚定。",
        hash: evidenceHash(`${batchId}:root`),
        verifiedAt: `${stamp}14:05:00Z`,
        status: "anchor_pending",
      };
  return [
    { step: 1, icon: "sensor", title: "设备采集", source: "船舱传感器 · 温度 / 湿度 / 定位", description: "船上与加工环节的传感器数据，记录捕捞、加工、温度等关键信息。", hash: evidenceHash(`${batchId}:sensor`), verifiedAt: `${stamp}08:30:00Z` },
    { step: 2, icon: "agent", title: "Agent 关联", source: "TruthPass Agent · 多源数据关联", description: "TruthPass Agent 将多源数据关联，形成可验证的证据包。", hash: evidenceHash(`${batchId}:agent`), verifiedAt: `${stamp}12:00:00Z` },
    { step: 3, icon: "jev", title: "JEV 判别", source: "JEV 决策门 · route_to_rule · 0.94", description: "用固定类型输出识别证据缺口、冲突和下一步路由。", hash: evidenceHash(`${batchId}:jev`), verifiedAt: `${stamp}13:40:00Z` },
    { step: 4, icon: "rule", title: "规则验收", source: `规则引擎 ${policy.policyId}@${policy.version}`, description: "按食品安全与质量规则进行自动化验收，生成结论与置信范围。", hash: evidenceHash(`${batchId}:rule`), verifiedAt: `${stamp}14:00:00Z` },
    chainEvidence,
  ].map((item) => ({ ...item, evidenceId: `${batchId}:evidence:${item.step}` }));
}

function productionProcessFor(batchId: string) {
  if (batchId === BATCH_ID) return productionSummary;
  if (isRiceBatch(batchId)) {
    const b = RICE_BATCHES[batchId] ?? RICE_BATCHES["RC-2026-001"];
    return {
      schemaVersion: "production.public.v1" as const,
      dataMode: "demo/synthetic" as const,
      status: b.passed ? "conformant" as const : "review" as const,
      originRegion: b.origin,
      sourceKinds: ["manufacturer", "third_party", "platform_device"] as const,
      observedStageCount: b.passed ? 5 : 3,
      requiredStageCount: 5,
      stages: [
        { stage: "origin", label: "产地登记", status: "observed" as const },
        { stage: "weather", label: "天气记录", status: b.passed ? "observed" as const : "missing" as const },
        { stage: "soil", label: "土壤记录", status: "observed" as const },
        { stage: "pesticide", label: "农残检测", status: b.passed ? "observed" as const : "missing" as const },
        { stage: "logistics", label: "仓储运输", status: b.passed ? "observed" as const : "not_covered" as const },
      ],
      missingStages: b.passed ? [] : ["天气或农残补充资料", "仓储运输覆盖"],
      facts: [
        { label: "产地", value: b.origin, stage: "origin", sourceKind: "manufacturer" },
        { label: "生产日期", value: b.productionDate, stage: "origin", sourceKind: "manufacturer" },
        { label: "检测模式", value: "演示第三方资料", stage: "pesticide", sourceKind: "third_party" },
      ],
    };
  }
  const b = FISH_OIL_BATCHES[batchId];
  return { ...productionSummary, originRegion: b?.origin };
}

/**
 * Shared deterministic gate for fixture batches. The parameter gate and the
 * production coverage gate are both required before a fixture can be treated
 * as accepted. This keeps the public overview, CLI, MCP, and Agent on the
 * same status vocabulary instead of allowing one surface to overstate a
 * partially documented batch.
 */
function demoVerificationGate(batchId: string, item: DemoBatch) {
  const details = parameterDetailsFor(batchId);
  const productionEvidence = productionProcessFor(batchId);
  // Keep parameter-level facts first in the public reason list. Consumers
  // need to see the observed value and rule range before the higher-level
  // production coverage gaps; a generic stage gap must not hide a concrete
  // measurement such as EPA+DHA 55%.
  const parameterReasons = details.flatMap((detail) => {
    if (detail.status === "missing") return [`${detail.label} 未登记实测值`];
    if (detail.status !== "outside_range") return [];
    const observed = detail.observed === undefined ? "未登记" : `${detail.observed}${detail.unit}`;
    const difference = "difference" in detail && typeof detail.difference === "number" ? `，差值 ${detail.difference}${detail.unit}` : "";
    return [`${detail.label} 实测 ${observed}（规则范围 ${detail.rule}${difference}）`];
  });
  const productionReasons = productionEvidence.missingStages.map((stage) => `生产阶段“${stage}”资料未覆盖`);
  const missingItems = [
    ...details.filter((detail) => detail.status === "missing").map((detail) => `${detail.label} 未登记实测值`),
    ...productionReasons,
  ];
  const conflicts = details
    .filter((detail) => detail.status === "outside_range")
    .map((detail) => `${detail.label} 实测值与当前规则范围存在差异`);
  const status = conflicts.length > 0
    ? "rejected" as const
    : missingItems.length > 0
      ? "missing_evidence" as const
      : item.passed
        ? "accepted" as const
        : "rejected" as const;
  return { status, details, productionEvidence, missingItems, conflicts, reasons: [...parameterReasons, ...productionReasons] };
}

async function buildRecommendationContract(batchId: string, traceId: string): Promise<RecommendationRecord> {
  const item = isRiceBatch(batchId) ? RICE_BATCHES[batchId] : FISH_OIL_BATCHES[batchId];
  if (!item) throw new Error("BATCH_NOT_FOUND");
  const tenantId = isRiceBatch(batchId) ? "tenant-rice-demo" : "tenant-fish-oil-demo";
  const productId = isRiceBatch(batchId) ? "rice-wuchang" : "fish-oil";
  const gate = demoVerificationGate(batchId, item);
  const { details, productionEvidence, missingItems, conflicts } = gate;
  // Parameter rules and production coverage are separate gates. A batch can
  // have in-range inspection values while still lacking key manufacturing,
  // packaging, or storage evidence. Never present that partial record as a
  // recommendation until both gates are satisfied.
  const verificationStatus = conflicts.length > 0
    ? "rejected"
    : missingItems.length > 0
      ? "review"
      : item.passed
        ? "accepted"
        : "review";
  const recommendationStatus = conflicts.length > 0
    ? "do_not_recommend"
    : missingItems.length > 0
      ? "review_before_recommendation"
      : item.passed
        ? "recommend_with_scope"
        : "do_not_recommend";
  const evidence = evidenceFor(batchId).map((entry) => ({
    evidenceId: entry.evidenceId,
    kind: entry.title,
    source: entry.source,
    dataMode: "demo/synthetic",
    status: "registered",
  }));
  const inspectionEvidence = evidence.filter((entry) => /检测|规则|quality|inspection/i.test(`${entry.kind} ${entry.source}`));
  const coldChainEvidence = evidence.filter((entry) => /冷链|温度|sensor|chain/i.test(`${entry.kind} ${entry.source}`));
  const evidenceIds = evidence.map((entry) => entry.evidenceId).filter((entry): entry is string => typeof entry === "string");
  const feedbackSummary = await feedbackSummaryFor(batchId);
  const reason = conflicts.length > 0
    ? `${demoParameterDetail(item)}当前存在超出规则范围的参数，不能据此推荐。`
    : missingItems.length > 0
      ? `${demoParameterDetail(item)}参数检查本身不等于生产链完整；当前仍缺少${missingItems.join("、")}。`
      : item.passed
        ? `${demoParameterDetail(item)}当前登记参数落在演示规则范围内。推荐只表示当前登记参数与规则的比较结果，不表示安全、疗效或真实认证。`
        : `${demoParameterDetail(item)}当前资料还不能支持推荐。`;
  const nextAction = conflicts.length > 0 || missingItems.length > 0
    ? "由生产方或检测机构补齐缺失资料或复核异常参数，再重新运行确定性核验。"
    : item.passed
      ? "查看参数和来源，再由外部钱包确认购买。"
      : "由生产方或检测机构补齐资料，再重新运行确定性核验。";
  const itemPayload = {
    batchId,
    name: item.name,
    origin: item.origin,
    productionDate: item.productionDate,
    imageUrl: item.image,
    dataMode: "demo/synthetic" as const,
    epaDha: item.epaDha,
    peroxide: item.peroxide,
    coldGap: item.coldGap,
    recommendationStatus,
    reason,
    nextAction,
    productionEvidence,
    parameterDetails: details,
    missingItems,
    conflicts,
    gateReasons: gate.reasons,
    evidenceIds,
    feedbackSummary,
    traceId,
  };
  return {
    batchId,
    tenantId,
    productId,
    recommendationStatus,
    verificationStatus,
    productionEvidence,
    inspectionEvidence,
    coldChainEvidence,
    feedbackSummary,
    missingItems,
    conflicts,
    gateReasons: gate.reasons,
    evidenceIds,
    reason,
    nextAction,
    traceId,
    dataMode: "demo/synthetic",
    item: itemPayload,
  };
}

// ---------- 服务注册（评委观察台用，三个候选服务） ----------
function adapterFor(card: ServiceCard, mode: "valid" | "wrong-batch" | "offline"): ServiceAdapter {
  return {
    async probe() {
      if (mode === "offline") {
        return {
          serviceId: card.id,
          status: "offline" as const,
          latencyMs: 0,
          capabilityMatch: false,
          schemaValid: false,
          checkedAt: new Date().toISOString(),
          reason: "连接超时",
        };
      }
      return {
        serviceId: card.id,
        status: mode === "valid" ? ("healthy" as const) : ("degraded" as const),
        latencyMs: mode === "valid" ? 420 : 980,
        capabilityMatch: true,
        schemaValid: true,
        checkedAt: new Date().toISOString(),
      };
    },
    async execute() {
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
        payload: { product: fishOilProduct.name, dataMode: "demo/synthetic" },
      };
    },
  };
}

const services: Array<[ServiceCard, "valid" | "wrong-batch" | "offline"]> = [
  [
    { id: "lab-a", name: "山野检测服务", kind: "lab", endpoint: "https://example.test/lab-a", capabilities: ["fish-oil-batch-quality-check"], signer: "0x1111...aaaa", historicalScore: 92, feedbackCount: 14 },
    "wrong-batch",
  ],
  [
    { id: "lab-b", name: "快速检测服务", kind: "lab", endpoint: "https://example.test/lab-b", capabilities: ["fish-oil-batch-quality-check"], signer: "0x2222...bbbb", historicalScore: 96, feedbackCount: 9 },
    "offline",
  ],
  [
    { id: "lab-c", name: "可信实验室", kind: "lab", endpoint: "https://example.test/lab-c", capabilities: ["fish-oil-batch-quality-check"], signer: "0x3333...cccc", historicalScore: 88, feedbackCount: 21 },
    "valid",
  ],
];

const registry = new ServiceRegistry(trustedIssuerKeys.resolve, replayGuard);
for (const [card, mode] of services) registry.register(card, adapterFor(card, mode), "demo/synthetic");

// ---------- 消费者共建 ----------
const consumers = new ConsumerParticipationRegistry();
const consumerId = "consumer-demo-001";

// ---------- BOT Chain Mainnet (Chain ID 677) 链上状态与钱包交易编排 ----------
export interface SessionChainTransaction {
  id: string;
  action: string;
  event: string;
  batchId: string;
  wallet: string;
  providerName?: string;
  contractAddress: string;
  txHash: string;
  blockNumber?: number;
  calldata?: string;
  signature?: string;
  mode?: string;
  receiptStatus?: string;
  eventVerified?: boolean;
  paymentValueWei?: string;
  ids?: Record<string, string>;
  explorerUrl: string;
  createdAt: string;
}

const sessionChainTxs: SessionChainTransaction[] = [];

// Receipts are durable facts once the RPC verifier has accepted them. Restore
// the service-side index on startup so purchase/feedback checks do not depend
// on the lifetime of a single Node process.
const chainTxHydration = (async () => {
  if (!persistenceEnabled()) return;
  try {
    const persisted = await loadPersistedChainTransactions();
    for (const item of persisted) {
      if (!sessionChainTxs.some((current) => current.txHash.toLowerCase() === item.txHash.toLowerCase())) {
        sessionChainTxs.push(item as SessionChainTransaction);
      }
    }
  } catch (error) {
    console.error("链上交易索引恢复失败:", error instanceof Error ? error.message : String(error));
  }
})();

// 运行时第一次探测完成前不把回放凭证冒充为实时 RPC 状态。
let cachedRpcReachable = false;
let cachedRpcCheckedAt: string | undefined;
let rpcCheckInFlight = false;

function refreshBotChainRpcInBackground(): void {
  if (rpcCheckInFlight) return;
  rpcCheckInFlight = true;
  inspectBotChain()
    .then((res) => {
      cachedRpcReachable = res.contractCodePresent;
      cachedRpcCheckedAt = new Date().toISOString();
    })
    .catch(() => {
      // RPC 不可达时保持未知/不可用，不能用历史回放凭证替代实时状态。
      cachedRpcReachable = false;
      cachedRpcCheckedAt = new Date().toISOString();
    })
    .finally(() => {
      rpcCheckInFlight = false;
    });
}

function sha256Hex32(value: string): string {
  return `0x${createHash("sha256").update(value, "utf8").digest("hex")}`;
}

function bytes32OrHash(value: unknown, field: string, fallback?: string): string {
  const raw = typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
  if (!raw) throw new Error(`${field} 不能为空`);
  const normalized = raw.startsWith("0x") && /^0x[0-9a-fA-F]{64}$/.test(raw) ? raw : sha256Hex32(raw);
  return normalized;
}

function weiQuantity(value: unknown, field: string, fallback = "0x38d7ea4c68000"): string {
  const raw = typeof value === "string" && value.trim() ? value.trim() : fallback;
  let amount: bigint;
  try {
    amount = BigInt(raw);
  } catch {
    throw new Error(`${field} 必须是 wei 十进制或十六进制数量`);
  }
  if (amount <= 0n) throw new Error(`${field} 必须大于 0`);
  return `0x${amount.toString(16)}`;
}

async function getBotChainMainnetStatus() {
  // Serverless 实例没有可靠的跨请求内存。首次请求同步探测一次，
  // 后续请求才使用短暂缓存并后台刷新，避免把“尚未探测”误报成在线。
  if (!cachedRpcCheckedAt) {
    try {
      const res = await inspectBotChain();
      cachedRpcReachable = res.contractCodePresent;
    } catch {
      cachedRpcReachable = false;
    }
    cachedRpcCheckedAt = new Date().toISOString();
  } else {
    refreshBotChainRpcInBackground();
  }
  const rpcReady = cachedRpcReachable;
  return {
    network: BOT_CHAIN_MAINNET.network,
    chainId: BOT_CHAIN_MAINNET.chainId,
    chainIdHex: BOT_CHAIN_MAINNET.chainIdHex,
    chainName: "BOT Chain Mainnet",
    nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
    rpcUrl: BOT_CHAIN_MAINNET.rpcUrl,
    explorerUrl: BOT_CHAIN_MAINNET.explorerUrl,
    status: rpcReady ? "reachable" : "unavailable",
    rpcLive: rpcReady,
    liveRpc: {
      reachable: rpcReady,
      latestBlockNumber: undefined,
      ...(rpcReady ? {
        rpcChainId: 677,
        contractsDeployed: {
          evidenceAnchor: true,
          consumerGateway: true,
          auditEscrow: true,
        },
      } : {}),
      checkedAt: cachedRpcCheckedAt ?? null,
    },
    // verifiedTransactions 是部署时保存的回放/历史凭证，不代表本次请求实时读到 receipt。
    anchored: false,
    replayVerified: true,
    deploymentStatus: "replay_verified",
    businessStatus: "replay_verified",
    contractAddress: BOT_CHAIN_MAINNET.contractAddress,
    consumerGatewayAddress: BOT_CHAIN_MAINNET.consumerGatewayAddress,
    auditEscrowAddress: BOT_CHAIN_MAINNET.auditEscrowAddress,
    domainSeparator: BOT_CHAIN_MAINNET.domainSeparator,
    contracts: BOT_CHAIN_MAINNET.contracts,
    verifiedTransactions: BOT_CHAIN_MAINNET.verifiedTransactions,
    sessionTransactions: sessionChainTxs,
  };
}

function prepareWalletTransaction(body: Record<string, unknown>) {
  const rawAction = typeof body.action === "string" ? body.action.trim() : "";
  const action =
    rawAction === "recordPurchase" ? "purchase" :
    rawAction === "recordContribution" ? "contribution" :
    rawAction === "raiseDispute" ? "dispute" :
    rawAction === "anchorEvidence" ? "evidence" :
    rawAction === "recordVerification" ? "verification" :
    rawAction === "submitAuditFinding" ? "audit_finding" :
    rawAction === "approveAuditFinding" ? "audit_approval" :
    rawAction === "resolveChallenge" ? "resolve_challenge" :
    rawAction;
  const rawWallet = typeof body.wallet === "string" ? body.wallet.trim() : "";
  const suppliedWallet = /^0x[0-9a-fA-F]{40}$/.test(rawWallet) ? rawWallet : "";
  if (["purchase", "contribution", "dispute"].includes(action) && !suppliedWallet) {
    throw new Error("消费者钱包地址 wallet 为必填项；不能为消费者交易生成部署钱包回退交易");
  }
  const wallet = suppliedWallet || process.env.TRUTHPASS_DEPLOYER_ADDRESS || "0x2eBdb6C7617d27999cFDEa61C38cAc1647183c08";
  const batchId = typeof body.batchId === "string" && body.batchId.trim() ? body.batchId.trim().toUpperCase() : BATCH_ID;
  const clientNonce = typeof body.clientNonce === "string" && body.clientNonce.trim()
    ? body.clientNonce.trim()
    : `wallet-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const contractAddress = BOT_CHAIN_MAINNET.contractAddress;
  const gatewayAddress = BOT_CHAIN_MAINNET.consumerGatewayAddress;
  const domainSeparator = BOT_CHAIN_MAINNET.domainSeparator;
  const chainId = BOT_CHAIN_MAINNET.chainId;
  const explorerUrl = BOT_CHAIN_MAINNET.explorerUrl;
  const config = getBotChainConfig("mainnet", { contractAddress });

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
    return {
      schemaVersion: "truthpass.wallet.transaction.v1",
      action,
      eventName: "EvidenceAnchored",
      batchId,
      network: "bot-mainnet",
      chainId,
      contractAddress,
      explorerUrl,
      signer: wallet,
      requiredRole: "EVIDENCE_WRITER_ROLE",
      ids: { requestId, evidenceRoot },
      transaction,
    };
  }

  if (action === "verification") {
    const evidenceRoot = bytes32OrHash(body.evidenceRoot, "evidenceRoot", `evidence-root:${batchId}`);
    const requestId = bytes32OrHash(body.requestId, "requestId", `verification-request:${wallet}:${batchId}:${clientNonce}`);
    const transaction = buildRecordVerificationTransaction({
      requestId,
      evidenceRoot,
      taskHash: bytes32OrHash(body.taskHash, "taskHash", `task:${batchId}`),
      policyHash: bytes32OrHash(body.policyHash, "policyHash", `${policy.policyId}-${policy.version}`),
      verifierVersionHash: bytes32OrHash(body.verifierVersionHash, "verifierVersionHash", "truthpass-verifier-v1"),
      resultHash: bytes32OrHash(body.resultHash, "resultHash", `accepted:${batchId}`),
      state: 1,
      scope: Number.isInteger(body.scope) ? Number(body.scope) : 15,
      domainSeparator,
      contractAddress,
    }, config);
    return {
      schemaVersion: "truthpass.wallet.transaction.v1",
      action,
      eventName: "VerificationRecorded",
      batchId,
      network: "bot-mainnet",
      chainId,
      contractAddress,
      explorerUrl,
      requiredRole: "VERIFIER_ROLE",
      ids: { requestId, evidenceRoot },
      transaction,
    };
  }

  if (action === "purchase") {
    const purchaseId = bytes32OrHash(body.purchaseId, "purchaseId", `purchase:${wallet}:${batchId}:${clientNonce}`);
    const batchCommitment = bytes32OrHash(body.batchCommitment, "batchCommitment", `batch:${batchId}`);
    const purchaseProofHash = bytes32OrHash(body.purchaseProofHash, "purchaseProofHash", `purchase-proof:${wallet}:${batchId}:${clientNonce}`);
    const consentHash = bytes32OrHash(body.consentHash, "consentHash", `consent:${wallet}:${batchId}`);
    const paidGateway = configuredPaidConsumerGateway();
    if (paidGateway) {
      const transaction = buildPaidConsumerGatewayPurchaseTransaction({
        purchaseId,
        batchCommitment,
        purchaseProofHash,
        consentHash,
        gatewayAddress: paidGateway.address,
        priceWei: paidGateway.priceWei,
      }, config);
      return {
        schemaVersion: "truthpass.wallet.transaction.v1",
        action,
        eventName: "PurchaseRecorded",
        batchId,
        network: "bot-mainnet",
        chainId,
        contractAddress: paidGateway.address,
        anchorAddress: contractAddress,
        explorerUrl,
        signer: wallet,
        requiredRole: "CONSUMER_SELF_SERVICE",
        gateway: true,
        payment: { asset: "BOT", amountWei: paidGateway.priceWei, amountBot: "0.001", merchantGateway: paidGateway.address },
        ids: { purchaseId, batchCommitment, purchaseProofHash, consentHash },
        transaction,
      };
    }
    if (gatewayAddress) {
      const transaction = buildConsumerGatewayPurchaseTransaction({
        purchaseId,
        batchCommitment,
        purchaseProofHash,
        consentHash,
        gatewayAddress,
      }, config);
      return {
        schemaVersion: "truthpass.wallet.transaction.v1",
        action,
        eventName: "PurchaseRecorded",
        batchId,
        network: "bot-mainnet",
        chainId,
        contractAddress: gatewayAddress,
        anchorAddress: contractAddress,
        explorerUrl,
        signer: wallet,
        requiredRole: "CONSUMER_SELF_SERVICE",
        gateway: true,
        payment: { asset: "BOT", amountWei: "0", amountBot: "0", merchantGateway: gatewayAddress, status: "record_only_gateway" },
        ids: { purchaseId, batchCommitment, purchaseProofHash, consentHash },
        transaction,
      };
    }
    const transaction = buildRecordPurchaseTransaction({
      purchaseId,
      consumerCommitment: bytes32OrHash(body.consumerCommitment, "consumerCommitment", `consumer:${wallet}`),
      batchCommitment,
      purchaseProofHash,
      consentHash,
      domainSeparator,
      contractAddress,
    }, config);
    return {
      schemaVersion: "truthpass.wallet.transaction.v1",
      action,
      eventName: "PurchaseRecorded",
      batchId,
      network: "bot-mainnet",
      chainId,
      contractAddress,
      explorerUrl,
      requiredRole: "PURCHASE_WRITER_ROLE",
      ids: { purchaseId },
      transaction,
    };
  }

  if (action === "contribution") {
    if (typeof body.purchaseId !== "string" || !body.purchaseId.trim()) {
      throw new Error("贡献必须绑定当前消费者钱包已经确认的 purchaseId");
    }
    const purchaseId = bytes32OrHash(body.purchaseId, "purchaseId", `purchase:${wallet}:${batchId}`);
    const contributionId = bytes32OrHash(body.contributionId, "contributionId", `contribution:${wallet}:${purchaseId}:${clientNonce}`);
    const evidenceHashVal = bytes32OrHash(body.evidenceHash, "evidenceHash", `feedback-evidence:${wallet}:${batchId}:${clientNonce}`);
    const contributionHash = bytes32OrHash(body.contributionHash, "contributionHash", `feedback:${wallet}:${batchId}:${clientNonce}`);
    const score = Number.isInteger(body.score) ? Math.max(0, Math.min(100, Number(body.score))) : 92;
    const contributionGatewayAddress = configuredPaidConsumerGateway()?.address ?? gatewayAddress;
    if (contributionGatewayAddress) {
      const transaction = buildConsumerGatewayContributionTransaction({
        contributionId,
        purchaseId,
        evidenceHash: evidenceHashVal,
        contributionHash,
        score,
        gatewayAddress: contributionGatewayAddress,
      }, config);
      return {
        schemaVersion: "truthpass.wallet.transaction.v1",
        action,
        eventName: "ContributionRecorded",
        batchId,
        network: "bot-mainnet",
        chainId,
        contractAddress: contributionGatewayAddress,
        anchorAddress: contractAddress,
        explorerUrl,
        signer: wallet,
        requiredRole: "CONSUMER_SELF_SERVICE",
        gateway: true,
        ids: { contributionId, purchaseId, evidenceHash: evidenceHashVal, contributionHash },
        transaction,
      };
    }
    const transaction = buildRecordContributionTransaction({
      contributionId,
      purchaseId,
      evidenceHash: evidenceHashVal,
      contributionHash,
      score,
      domainSeparator,
      contractAddress,
    }, config);
    return {
      schemaVersion: "truthpass.wallet.transaction.v1",
      action,
      eventName: "ContributionRecorded",
      batchId,
      network: "bot-mainnet",
      chainId,
      contractAddress,
      explorerUrl,
      signer: wallet,
      requiredRole: "CONTRIBUTION_WRITER_ROLE",
      ids: { contributionId, purchaseId },
      transaction,
    };
  }

  if (action === "dispute") {
    const targetKind = Number.isInteger(body.targetKind) ? Number(body.targetKind) : 1;
    if (![1, 2, 3, 4].includes(targetKind)) throw new Error("targetKind 必须是 1, 2, 3 或 4");
    const targetId = bytes32OrHash(body.targetId, "targetId", `batch:${batchId}`);
    const disputeId = bytes32OrHash(body.disputeId, "disputeId", `dispute:${wallet}:${targetId}:${clientNonce}`);
    const reasonHash = bytes32OrHash(body.reasonHash, "reasonHash", `consumer-dispute:${batchId}:${clientNonce}`);
    const auditEscrowAddress = BOT_CHAIN_MAINNET.auditEscrowAddress;
    const stake = weiQuantity(body.stake, "stake", process.env.TRUTHPASS_AUDIT_MIN_STAKE || "1000000000000000");
    const agentRunHash = bytes32OrHash(body.agentRunHash, "agentRunHash", `consumer-agent-run:${wallet}:${batchId}:${clientNonce}`);
    const transaction = buildAuditEscrowOpenChallengeTransaction({
      challengeId: disputeId,
      targetKind: targetKind as 1 | 2 | 3 | 4,
      targetId,
      reasonHash,
      agentRunHash,
      stake,
      escrowAddress: auditEscrowAddress,
    }, config);
    return {
      schemaVersion: "truthpass.wallet.transaction.v1",
      action,
      eventName: "ChallengeOpened",
      batchId,
      network: "bot-mainnet",
      chainId,
      contractAddress: auditEscrowAddress,
      anchorAddress: contractAddress,
      explorerUrl,
      signer: wallet,
      requiredRole: "CONSUMER_SELF_SERVICE",
      auditEscrow: true,
      stake,
      ids: { challengeId: disputeId, disputeId, targetKind, targetId, reasonHash, agentRunHash },
      transaction,
    };
  }

  if (action === "audit_finding") {
    const challengeId = bytes32OrHash(body.challengeId, "challengeId", `challenge:${batchId}`);
    const escrowAddress = BOT_CHAIN_MAINNET.auditEscrowAddress;
    const transaction = buildAuditEscrowSubmitFindingTransaction({
      challengeId,
      evidenceRoot: bytes32OrHash(body.evidenceRoot, "evidenceRoot", `evidence-root:${batchId}`),
      auditResultHash: bytes32OrHash(body.auditResultHash, "auditResultHash", `audit-result:${batchId}`),
      verifierVersionHash: bytes32OrHash(body.verifierVersionHash, "verifierVersionHash", "truthpass-verifier-v1"),
      agentAttestationHash: bytes32OrHash(body.agentAttestationHash, "agentAttestationHash", `audit-agent:${batchId}`),
      escrowAddress,
    }, config);
    return {
      schemaVersion: "truthpass.wallet.transaction.v1",
      action,
      eventName: "AuditFindingSubmitted",
      batchId,
      network: "bot-mainnet",
      chainId,
      contractAddress: escrowAddress,
      anchorAddress: contractAddress,
      explorerUrl,
      signer: wallet,
      requiredRole: "AUDIT_AGENT_ROLE",
      auditEscrow: true,
      ids: { challengeId },
      transaction,
    };
  }

  if (action === "audit_approval") {
    const challengeId = bytes32OrHash(body.challengeId, "challengeId", `challenge:${batchId}`);
    const escrowAddress = BOT_CHAIN_MAINNET.auditEscrowAddress;
    const transaction = buildAuditEscrowApproveFindingTransaction({ challengeId, escrowAddress }, config);
    return {
      schemaVersion: "truthpass.wallet.transaction.v1",
      action,
      eventName: "AuditVerifierApproved",
      batchId,
      network: "bot-mainnet",
      chainId,
      contractAddress: escrowAddress,
      anchorAddress: contractAddress,
      explorerUrl,
      signer: wallet,
      requiredRole: "VERIFIER_ROLE",
      auditEscrow: true,
      ids: { challengeId },
      transaction,
    };
  }

  if (action === "resolve_challenge") {
    const challengeId = bytes32OrHash(body.challengeId, "challengeId", `challenge:${batchId}`);
    const escrowAddress = BOT_CHAIN_MAINNET.auditEscrowAddress;
    const transaction = buildAuditEscrowResolveChallengeTransaction({
      challengeId,
      upheld: body.upheld !== false,
      resolutionHash: bytes32OrHash(body.resolutionHash, "resolutionHash", `resolution:${batchId}`),
      escrowAddress,
    }, config);
    return {
      schemaVersion: "truthpass.wallet.transaction.v1",
      action,
      eventName: "ChallengeResolved",
      batchId,
      network: "bot-mainnet",
      chainId,
      contractAddress: escrowAddress,
      anchorAddress: contractAddress,
      explorerUrl,
      signer: wallet,
      requiredRole: "ARBITER_ROLE",
      auditEscrow: true,
      ids: { challengeId },
      transaction,
    };
  }

  throw new Error(`不支持的链上操作类型: ${action}`);
}

// ---------- HTTP 工具 ----------
function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk.toString();
    if (raw.length > 16_384) throw new Error("请求体过大");
  }
  if (!raw) return {};
  const contentType = typeof req.headers["content-type"] === "string" ? req.headers["content-type"] : "";
  if (contentType.includes("application/x-www-form-urlencoded")) {
    return Object.fromEntries(new URLSearchParams(raw).entries());
  }
  return JSON.parse(raw);
}

type RpcReceipt = {
  transactionHash?: string;
  blockNumber?: string;
  status?: string;
  to?: string | null;
  logs?: Array<{ address?: string; topics?: string[]; data?: string }>;
};

type RpcTransaction = {
  from?: string;
  to?: string | null;
  chainId?: string;
  value?: string;
  nonce?: string;
};

async function readMainnetReceipt(txHash: string): Promise<RpcReceipt> {
  const response = await fetch(BOT_CHAIN_MAINNET.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "eth_getTransactionReceipt", params: [txHash] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`BOT Chain RPC HTTP ${response.status}`);
  const payload = await response.json() as { result?: RpcReceipt | null; error?: { message?: string } };
  if (payload.error) throw new Error(payload.error.message || "BOT Chain RPC error");
  if (!payload.result) throw new Error("交易尚未产生可验证回执");
  return payload.result;
}

async function readMainnetTransaction(txHash: string): Promise<RpcTransaction> {
  const response = await fetch(BOT_CHAIN_MAINNET.rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method: "eth_getTransactionByHash", params: [txHash] }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`BOT Chain RPC HTTP ${response.status}`);
  const payload = await response.json() as { result?: RpcTransaction | null; error?: { message?: string } };
  if (payload.error) throw new Error(payload.error.message || "BOT Chain RPC error");
  if (!payload.result) throw new Error("交易尚未产生可验证详情");
  return payload.result;
}

function receiptHasEvent(
  receipt: RpcReceipt,
  topic: string,
  address?: string,
  indexed?: string[],
): boolean {
  return (receipt.logs ?? []).some((log) => {
    if (address && String(log.address || "").toLowerCase() !== address.toLowerCase()) return false;
    const topics = Array.isArray(log.topics) ? log.topics : [];
    if (!topics[0] || topics[0].toLowerCase() !== topic.toLowerCase()) return false;
    return (indexed ?? []).every((value, index) => {
      const actual = topics[index + 1];
      return Boolean(actual) && actual.toLowerCase() === value.toLowerCase();
    });
  });
}

function receiptBlockNumber(receipt: RpcReceipt): number | undefined {
  return typeof receipt.blockNumber === "string" && /^0x[0-9a-f]+$/i.test(receipt.blockNumber)
    ? Number.parseInt(receipt.blockNumber.slice(2), 16)
    : undefined;
}

function parseRpcQuantity(value: string | undefined): bigint | undefined {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) return undefined;
  try { return BigInt(value); } catch { return undefined; }
}

function expectedReceiptEventCheck(
  receipt: RpcReceipt,
  event: string,
  targetAddress: string,
  ids: Record<string, unknown> = {},
): { ok: boolean; reason?: string } {
  if (receipt.status !== "0x1" && receipt.status !== "1") {
    return { ok: false, reason: `receipt.status=${String(receipt.status)}` };
  }
  if (!receipt.to || receipt.to.toLowerCase() !== targetAddress.toLowerCase()) {
    return { ok: false, reason: "receipt.to 与预期交易目标不一致" };
  }
  const id = (name: string): string | undefined => typeof ids[name] === "string" ? String(ids[name]) : undefined;
  const challengeId = id("challengeId") || id("disputeId");
  if (event === "PurchaseRecorded") {
    const purchaseId = id("purchaseId");
    if (!receiptHasEvent(receipt, `0x${keccakTopic("ConsumerPurchaseSubmitted(bytes32,bytes32,address,bool)")}`, targetAddress, purchaseId ? [purchaseId] : [])) {
      return { ok: false, reason: "缺少 ConsumerPurchaseSubmitted 事件" };
    }
    const paidGateway = configuredPaidConsumerGateway();
    if (paidGateway && paidGateway.address.toLowerCase() === targetAddress.toLowerCase()
      && !receiptHasEvent(receipt, `0x${keccakTopic("PaymentReceived(bytes32,address,address,uint256,uint256)")}`, targetAddress, purchaseId ? [purchaseId] : [])) {
      return { ok: false, reason: "缺少 Paid Gateway PaymentReceived 事件" };
    }
    if (!receiptHasEvent(receipt, PURCHASE_RECORDED_TOPIC, BOT_CHAIN_MAINNET.contractAddress, purchaseId ? [purchaseId] : [])) {
      return { ok: false, reason: "缺少 Anchor PurchaseRecorded 事件" };
    }
  } else if (event === "ContributionRecorded") {
    const contributionId = id("contributionId");
    if (!receiptHasEvent(receipt, `0x${keccakTopic("ConsumerContributionSubmitted(bytes32,bytes32,address,bool)")}`, targetAddress, contributionId ? [contributionId] : [])) {
      return { ok: false, reason: "缺少 ConsumerContributionSubmitted 事件" };
    }
    if (!receiptHasEvent(receipt, CONTRIBUTION_RECORDED_TOPIC, BOT_CHAIN_MAINNET.contractAddress, contributionId ? [contributionId] : [])) {
      return { ok: false, reason: "缺少 Anchor ContributionRecorded 事件" };
    }
  } else if (event === "ChallengeOpened") {
    if (!challengeId || !receiptHasEvent(receipt, CHALLENGE_OPENED_TOPIC, BOT_CHAIN_MAINNET.auditEscrowAddress, [challengeId])) {
      return { ok: false, reason: "缺少 Audit Escrow ChallengeOpened 事件" };
    }
    if (!receiptHasEvent(receipt, DISPUTE_RAISED_TOPIC, BOT_CHAIN_MAINNET.contractAddress, challengeId ? [challengeId] : [])) {
      return { ok: false, reason: "缺少 Anchor DisputeRaised 事件" };
    }
  } else if (event === "EvidenceAnchored") {
    const requestId = id("requestId");
    const evidenceRoot = id("evidenceRoot");
    if (!requestId || !evidenceRoot || !receiptHasEvent(receipt, EVIDENCE_ANCHORED_TOPIC, BOT_CHAIN_MAINNET.contractAddress, [requestId, evidenceRoot])) {
      return { ok: false, reason: "缺少 EvidenceAnchored 事件" };
    }
  } else if (event === "VerificationRecorded") {
    const requestId = id("requestId");
    const evidenceRoot = id("evidenceRoot");
    if (!requestId || !evidenceRoot || !receiptHasEvent(receipt, VERIFICATION_RECORDED_TOPIC, BOT_CHAIN_MAINNET.contractAddress, [requestId, evidenceRoot])) {
      return { ok: false, reason: "缺少 VerificationRecorded 事件" };
    }
  } else if (event === "AuditFindingSubmitted") {
    if (!receiptHasEvent(receipt, AUDIT_FINDING_SUBMITTED_TOPIC, BOT_CHAIN_MAINNET.auditEscrowAddress, challengeId ? [challengeId] : [])) {
      return { ok: false, reason: "缺少 AuditFindingSubmitted 事件" };
    }
  } else if (event === "AuditVerifierApproved") {
    if (!receiptHasEvent(receipt, AUDIT_VERIFIER_APPROVED_TOPIC, BOT_CHAIN_MAINNET.auditEscrowAddress, challengeId ? [challengeId] : [])) {
      return { ok: false, reason: "缺少 AuditVerifierApproved 事件" };
    }
  } else if (event === "ChallengeResolved") {
    if (!receiptHasEvent(receipt, CHALLENGE_RESOLVED_TOPIC, BOT_CHAIN_MAINNET.auditEscrowAddress, challengeId ? [challengeId] : [])) {
      return { ok: false, reason: "缺少 ChallengeResolved 事件" };
    }
  } else {
    return { ok: false, reason: `未登记的业务事件 ${event}` };
  }
  return { ok: true };
}

function keccakTopic(signature: string): string {
  return keccak256Hex(signature);
}

function extractBatchId(text: string): string {
  const full = text.match(/([A-Z]{2,3}-\d{4}-\d{3})/i);
  if (full) return full[1].toUpperCase();
  const short = text.match(/\b0*(\d{1,2})\b/);
  if (short) {
    const n = parseInt(short[1], 10);
    const id = `FO-2026-${String(n).padStart(3, "0")}`;
    if (FISH_OIL_BATCHES[id]) return id;
  }
  return "";
}


type ChatServiceStatus = "model_assisted" | "deterministic_fallback" | "provider_unavailable" | "rate_limited" | "maintenance";

type ChatReplyResult = {
  lines: Array<{ cls: string; text: string }>;
  status: ChatServiceStatus;
  /** The deterministic answer was emitted after a model/provider failure. */
  fallbackApplied?: boolean;
  /** The rule verifier already ran before the model was asked to explain. */
  verifierStatus?: string;
  verifierReasons?: string[];
  providerUsed?: string;
  modelUsed?: string;
  /** Safe public classification only; provider response bodies and credentials stay server-side. */
  providerIssue?: "unauthorized" | "billing_required" | "rate_limited" | "invalid_response" | "unavailable";
  /** HTTP status returned by the configured provider, when one was received. */
  providerResponseStatus?: number;
  /** Detailed runtime classification used by the model_completed stage. */
  runtimeStatus?: CustomerModelRuntimeStatus;
  dataMode?: "demo/synthetic" | "external";
  sources?: string[];
  evidenceIds?: string[];
  retrieval?: { query: string; hitCount: number; hitIds: string[] };
  chainContext?: ChainQueryContext;
  /** JEV routing result after provider validation or deterministic fallback. */
  jev?: { decision: JevDecision; provider: string; model: string; live: boolean };
  safety?: Pick<ConsumerSafetyResult, "status" | "reasons" | "citations">;
};

type ChainQueryContext = {
  queried: true;
  chainId: number;
  chainName: string;
  rpcReachable: boolean;
  latestBlockNumber?: number;
  anchorStatus: string;
  explorerUrl: string;
  batchId: string | null;
  transaction?: { txHash: string; event: string; explorerUrl: string; blockNumber?: number };
};

type ChatMeta = {
  agentMode: "model_assisted" | "deterministic_fallback";
  serviceStatus: ChatServiceStatus;
  dataMode: "demo/synthetic" | "external";
  batchId: string | null;
  traceId: string;
  /** Public provider label only; never expose credentials or request payloads. */
  provider?: string;
  /** Public model identifier only; never expose credentials or prompt text. */
  model?: string;
  providerIssue?: "unauthorized" | "billing_required" | "rate_limited" | "invalid_response" | "unavailable";
  providerResponseStatus?: number;
  runtimeStatus?: CustomerModelRuntimeStatus;
  modelAssisted?: boolean;
  fallbackApplied?: boolean;
  evidenceIds?: string[];
  pipeline?: string[];
  pipelineDetail?: {
    verifier: { status: string; reasons?: string[] };
    jev: { decision: string; confidence?: number };
    deepseek: { status: "completed" | "fallback" | "unavailable" };
  };
  contextMode?: "production_sync_simulation" | "external_production";
  contextSource?: string;
  contextRevision?: number;
  syncedAt?: string;
  sources?: string[];
  chainContext?: ChainQueryContext;
  promptPolicyVersion?: string;
  modelContractVersion?: string;
  validationStatus?: ConsumerSafetyResult["status"];
  validationReasons?: string[];
  citedEvidenceIds?: string[];
  retrieval?: { query: string; hitCount: number; hitIds: string[] };
};

const CUSTOMER_CHAT_PIPELINE = ["verifier", "jev", "deepseek"] as const;

function publicCustomerProvider(): string {
  const configured = resolveAgentProvider();
  // A status probe may run in a fresh serverless invocation, so fall back to
  // the configured candidate when no successful model call is known locally.
  return lastCustomerModelRuntime?.status === "completed"
    ? lastCustomerModelRuntime.provider
    : configured.configured
      ? configured.provider
      : "deterministic";
}

function publicCustomerModel(): string {
  const configured = resolveAgentProvider();
  return lastCustomerModelRuntime?.status === "completed"
    ? lastCustomerModelRuntime.model
    : configured.model;
}

function streamChat(res: ServerResponse, intent: string, script: Array<{ cls: string; text: string }>, meta?: ChatMeta): void {
  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const batchId = meta?.batchId ?? null;
  const traceId = meta?.traceId ?? null;
  const dataMode = meta?.dataMode ?? "demo/synthetic";
  const evidenceIds = meta?.evidenceIds ?? [];
  const send = (event: unknown) => res.write("data: " + JSON.stringify(event) + "\n\n");
  send({ kind: "begin", intent, batchId, traceId, dataMode, evidenceIds });
  // Keep the compatibility stream on the same public stage contract as the
  // model-backed path. This branch is used for unknown batches and must never
  // look like an unstructured answer or silently lose its trace context.
  send({ kind: "stage", stage: "reading_batch", status: "completed", traceId, batchId, evidenceIds, dataMode });
  send({ kind: "stage", stage: "verifier_checked", status: "fallback", detail: "not_run", traceId, batchId, evidenceIds, dataMode });
  send({ kind: "stage", stage: "jev_routed", status: "fallback", detail: "request_more_evidence", traceId, batchId, evidenceIds, dataMode });
  send({ kind: "stage", stage: "model_started", status: "fallback", traceId, batchId, evidenceIds, dataMode });
  send({ kind: "stage", stage: "model_completed", status: "fallback", detail: "deterministic_fallback", traceId, batchId, evidenceIds, dataMode });
  if (meta) {
    send({
      kind: "meta",
      ...meta,
      provider: meta.provider ?? publicCustomerProvider(),
      model: meta.model ?? publicCustomerModel(),
      modelAssisted: meta.modelAssisted ?? meta.serviceStatus === "model_assisted",
      evidenceIds: meta.evidenceIds ?? [],
      pipeline: meta.pipeline ?? [...CUSTOMER_CHAT_PIPELINE],
      pipelineDetail: meta.pipelineDetail ?? {
        verifier: { status: "not_run", reasons: ["batch_not_found"] },
        jev: { decision: "request_more_evidence", confidence: 1 },
        deepseek: { status: "fallback" },
      },
      promptPolicyVersion: meta.promptPolicyVersion ?? CONSUMER_PROMPT_POLICY_VERSION,
      modelContractVersion: meta.modelContractVersion ?? CONSUMER_MODEL_CONTRACT_VERSION,
      validationStatus: meta.validationStatus ?? "fallback",
      validationReasons: meta.validationReasons ?? ["batch_not_found"],
      fallbackApplied: meta.fallbackApplied ?? true,
    });
  }
  let i = 0;
  const next = () => {
    if (res.writableEnded || res.destroyed) return;
    if (i >= script.length) {
      send({ kind: "done", traceId, batchId, dataMode, evidenceIds });
      res.end();
      return;
    }
    const line = script[i++];
    send({ kind: "line", cls: line.cls, text: line.text, traceId, batchId, dataMode, evidenceIds });
    setTimeout(next, 0);
  };
  next();
}

async function streamChatWithReply(
  res: ServerResponse,
  intent: string,
  script: Array<{ cls: string; text: string }>,
  reply: Promise<ChatReplyResult>,
  baseMeta: Omit<ChatMeta, "agentMode" | "serviceStatus" | "dataMode" | "sources" | "provider" | "model" | "modelAssisted" | "evidenceIds" | "pipeline"> & { dataMode?: "demo/synthetic" | "external" },
): Promise<void> {
  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const send = (event: unknown) => res.write("data: " + JSON.stringify(event) + "\n\n");
  const initialDataMode = baseMeta.dataMode ?? "demo/synthetic";
  const initialEvidenceIds: string[] = [];
  send({ kind: "begin", intent, traceId: baseMeta.traceId, batchId: baseMeta.batchId, dataMode: initialDataMode, evidenceIds: initialEvidenceIds });
  const replyPromise = reply;
  send({ kind: "stage", stage: "reading_batch", status: "active", traceId: baseMeta.traceId, batchId: baseMeta.batchId, evidenceIds: initialEvidenceIds, dataMode: initialDataMode });
  // These active markers make the backend execution visible while the model
  // promise is in flight. Completion markers below carry the final verifier,
  // JEV, and model status after the deterministic checks and model guard run.
  send({ kind: "stage", stage: "verifier_checked", status: "active", traceId: baseMeta.traceId, batchId: baseMeta.batchId, evidenceIds: initialEvidenceIds, dataMode: initialDataMode });
  send({ kind: "stage", stage: "jev_routed", status: "active", traceId: baseMeta.traceId, batchId: baseMeta.batchId, evidenceIds: initialEvidenceIds, dataMode: initialDataMode });
  send({ kind: "stage", stage: "model_started", status: "active", traceId: baseMeta.traceId, batchId: baseMeta.batchId, evidenceIds: initialEvidenceIds, dataMode: initialDataMode });
  const result = await replyPromise;
  const resultDataMode = result.dataMode ?? baseMeta.dataMode ?? "demo/synthetic";
  const resultEvidenceIds = result.evidenceIds ?? [];
  const verifierStatus = result.verifierStatus === "not_run"
    ? "fallback"
    : (result.verifierStatus ?? (baseMeta.batchId ? "checked" : "not_run"));
  const verifierStageStatus = !baseMeta.batchId || result.verifierStatus === "not_run" ? "fallback" : "completed";
  const jevDecision = result.jev?.decision.decision
    ?? (!baseMeta.batchId || (result.verifierStatus && result.verifierStatus !== "accepted") ? "request_more_evidence" : "route_to_rule");
  const modelRuntimeStatus = result.runtimeStatus ?? (result.status === "model_assisted" ? "completed" : result.providerIssue ?? "fallback");
  send({ kind: "stage", stage: "reading_batch", status: "completed", traceId: baseMeta.traceId, batchId: baseMeta.batchId, evidenceIds: resultEvidenceIds, dataMode: resultDataMode });
  send({ kind: "stage", stage: "verifier_checked", status: verifierStageStatus, detail: result.verifierStatus ?? "checked", traceId: baseMeta.traceId, batchId: baseMeta.batchId, evidenceIds: resultEvidenceIds, dataMode: resultDataMode });
  send({ kind: "stage", stage: "jev_routed", status: "completed", detail: jevDecision, traceId: baseMeta.traceId, batchId: baseMeta.batchId, evidenceIds: resultEvidenceIds, dataMode: resultDataMode });
  send({ kind: "stage", stage: "model_started", status: "active", detail: result.providerUsed ?? publicCustomerProvider(), traceId: baseMeta.traceId, batchId: baseMeta.batchId, evidenceIds: resultEvidenceIds, dataMode: resultDataMode });
  send({ kind: "stage", stage: "model_completed", status: modelRuntimeStatus, detail: [result.providerIssue, result.providerResponseStatus ? `HTTP ${result.providerResponseStatus}` : undefined, ...(result.safety?.reasons ?? [])].filter(Boolean).join(" · ") || undefined, traceId: baseMeta.traceId, batchId: baseMeta.batchId, evidenceIds: resultEvidenceIds, dataMode: resultDataMode });
  if (baseMeta.batchId) {
    const auditRun = {
      schemaVersion: "truthpass.agent.audit.v2",
      runId: baseMeta.traceId,
      traceId: baseMeta.traceId,
      batchId: baseMeta.batchId,
      tenantId: isRiceBatch(baseMeta.batchId) ? "tenant-rice-demo" : "tenant-fish-oil-demo",
      agentId: "truthpass.consumer-agent",
      agentVersion: "truthpass-consumer-v2",
      modelVersion: publicCustomerModel(),
      promptPolicyVersion: CONSUMER_PROMPT_POLICY_VERSION,
      modelContractVersion: CONSUMER_MODEL_CONTRACT_VERSION,
      validationStatus: result.safety?.status ?? (result.status === "model_assisted" ? "accepted" : "fallback"),
      validationReasons: result.safety?.reasons ?? [],
      inputEvidenceIds: result.evidenceIds ?? [],
      citedEvidenceIds: result.safety?.citations ?? [],
      chainContext: baseMeta.chainContext ?? result.chainContext ?? null,
      jev: result.jev ? { decision: result.jev.decision, provider: result.jev.provider, model: result.jev.model, live: result.jev.live } : null,
      verificationStatus: result.status === "model_assisted" ? "model_assisted" : "deterministic_fallback",
      providerIssue: result.providerIssue ?? null,
      providerResponseStatus: result.providerResponseStatus ?? null,
      runtimeStatus: modelRuntimeStatus,
      createdAt: new Date().toISOString(),
    };
    agentAuditRuns.set(baseMeta.traceId, auditRun);
    try {
      await persistAgentAuditRun(baseMeta.traceId, String(auditRun.tenantId), auditRun);
    } catch (error) {
      console.error("消费者 Agent 审计持久化失败:", error instanceof Error ? error.message : String(error));
    }
  }
  console.info(JSON.stringify({ event: "customer_service_response", intent, traceId: baseMeta.traceId, batchId: baseMeta.batchId, serviceStatus: result.status, dataMode: result.dataMode ?? baseMeta.dataMode ?? "demo/synthetic" }));
  send({
    kind: "meta",
    agentMode: result.status === "model_assisted" ? "model_assisted" : "deterministic_fallback",
    serviceStatus: result.status,
    dataMode: result.dataMode ?? baseMeta.dataMode ?? "demo/synthetic",
    batchId: baseMeta.batchId,
    traceId: baseMeta.traceId,
    provider: result.providerUsed ?? (result.status === "model_assisted" ? publicCustomerProvider() : "deterministic"),
    model: result.modelUsed ?? (result.status === "model_assisted" ? publicCustomerModel() : "deterministic-fallback"),
    ...(result.providerIssue ? { providerIssue: result.providerIssue } : {}),
    ...(result.providerResponseStatus !== undefined ? { providerResponseStatus: result.providerResponseStatus } : {}),
    runtimeStatus: modelRuntimeStatus,
    modelAssisted: result.status === "model_assisted",
    evidenceIds: result.evidenceIds ?? [],
    pipeline: [...CUSTOMER_CHAT_PIPELINE],
    pipelineDetail: {
      verifier: { status: result.verifierStatus ?? (baseMeta.batchId ? "checked" : "not_run"), reasons: result.verifierReasons },
      jev: {
        decision: jevDecision,
        confidence: result.jev?.decision.confidence ?? 0.94,
        status: result.jev?.live ? "live" : "fallback",
        provider: result.jev?.provider ?? "deterministic",
        model: result.jev?.model ?? "deterministic-fallback",
        nextAction: result.jev?.decision.nextAction,
        missingEvidenceCodes: result.jev?.decision.missingEvidenceCodes ?? [],
        conflictCodes: result.jev?.decision.conflictCodes ?? [],
      },
      deepseek: { status: result.status === "model_assisted" ? "completed" : result.status === "deterministic_fallback" ? "fallback" : "unavailable" },
    },
    promptPolicyVersion: CONSUMER_PROMPT_POLICY_VERSION,
    modelContractVersion: CONSUMER_MODEL_CONTRACT_VERSION,
    validationStatus: result.safety?.status ?? (result.status === "model_assisted" ? "accepted" : "fallback"),
    validationReasons: result.safety?.reasons ?? [],
    citedEvidenceIds: result.safety?.citations ?? [],
    ...(result.retrieval ? { retrieval: result.retrieval } : {}),
    fallbackApplied: result.fallbackApplied === true,
    ...(baseMeta.contextMode ? { contextMode: baseMeta.contextMode } : {}),
    ...(baseMeta.contextSource ? { contextSource: baseMeta.contextSource } : {}),
    ...(baseMeta.contextRevision !== undefined ? { contextRevision: baseMeta.contextRevision } : {}),
    ...(baseMeta.syncedAt ? { syncedAt: baseMeta.syncedAt } : {}),
    ...(result.sources?.length ? { sources: result.sources } : {}),
    ...(baseMeta.chainContext ? { chainContext: baseMeta.chainContext } : {}),
    ...(result.chainContext ? { chainContext: result.chainContext } : {}),
  });
  for (const line of script) send({ kind: "line", ...line, traceId: baseMeta.traceId, batchId: baseMeta.batchId, dataMode: resultDataMode, evidenceIds: resultEvidenceIds });
  for (const line of result.lines) {
    if (res.writableEnded || res.destroyed) return;
    send({ kind: "line", ...line, traceId: baseMeta.traceId, batchId: baseMeta.batchId, dataMode: resultDataMode, evidenceIds: resultEvidenceIds });
  }
  send({ kind: "done", traceId: baseMeta.traceId, batchId: baseMeta.batchId, dataMode: resultDataMode, evidenceIds: resultEvidenceIds });
  res.end();
}


type ConsumerModelContract = {
  batchId?: string;
  dataMode: "demo/synthetic" | "external";
  chainContext?: ChainQueryContext;
  verifier?: { status: string; reasons?: string[] };
  jev?: { decision: string; confidence?: number; nextAction?: string; missingEvidenceCodes?: string[]; conflictCodes?: string[]; modelAssisted?: boolean; provider?: string; model?: string };
  evidenceIds?: string[];
  allowedCitations?: string[];
  allowedNumbers?: string[];
  locale?: "zh" | "en";
  /** Stable, non-secret conversation identifier forwarded to OpenCode Go. */
  sessionId?: string;
};

function normalizeConsumerModelText(raw: string, contract?: ConsumerModelContract): string | null {
  const english = contract?.locale === "en";
  const labels = english
    ? { conclusion: "Conclusion", evidence: "Evidence", uncertainty: "Uncertainty", next: "Next step" }
    : { conclusion: "结论", evidence: "依据", uncertainty: "不确定", next: "下一步" };
  let value = raw.trim().replace(/^```(?:json|text)?\s*/i, "").replace(/\s*```$/i, "").trim();
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    const conclusion = typeof parsed.conclusion === "string" ? parsed.conclusion : typeof parsed.headline === "string" ? parsed.headline : "";
    const evidence = typeof parsed.evidence === "string" ? parsed.evidence : typeof parsed.basis === "string" ? parsed.basis : "";
    const uncertainty = typeof parsed.uncertainty === "string" ? parsed.uncertainty : typeof parsed.uncertain === "string" ? parsed.uncertain : "";
    const next = typeof parsed.nextAction === "string" ? parsed.nextAction : typeof parsed.next_step === "string" ? parsed.next_step : typeof parsed.next === "string" ? parsed.next : "";
    if (conclusion && evidence && uncertainty && next) value = `${labels.conclusion}：${conclusion} ${labels.evidence}：${evidence} ${labels.uncertainty}：${uncertainty} ${labels.next}：${next}`;
  } catch {
    // The public contract is plain text; JSON is accepted only as a formatting convenience.
  }
  value = value
    .replace(/\*+/g, "")
    .replace(/(结论|依据|不确定|下一步)\s*:/g, "$1：")
    .replace(/\b(Conclusion|Verdict)\s*:/gi, `${labels.conclusion}：`)
    .replace(/\b(Evidence|Basis)\s*:/gi, `${labels.evidence}：`)
    .replace(/\b(Uncertainty|Unknowns?)\s*:/gi, `${labels.uncertainty}：`)
    .replace(/\b(Next\s*step|Next\s*action)\s*:/gi, `${labels.next}：`)
    .replace(/结论：/g, `${labels.conclusion}：`)
    .replace(/依据：/g, `${labels.evidence}：`)
    .replace(/不确定：/g, `${labels.uncertainty}：`)
    .replace(/下一步：/g, `${labels.next}：`)
    .replace(/\s*\n+\s*/g, " ")
    .trim();
  return validConsumerModelText(value, contract) ? value : null;
}

function hasUnsupportedDemoClaim(text: string): boolean {
  // 安全免责声明可以出现这些词，但只能在同一句明确否定时放行。
  const forbidden = /(真实认证|官方认证|已证明安全|安全无疑|real certification|official certification|proven safe|guaranteed safe)/gi;
  const negation = /(不能|不可|无法|不等于|不是|尚未|未能|未提供|没有|暂无|不代表|不应|不得|不能把|不能直接|cannot|can't|not|no|without|does not|doesn't|not a)/i;
  for (const match of text.matchAll(forbidden)) {
    const index = match.index ?? 0;
    const sentenceStart = Math.max(0, text.slice(0, index).search(/[^。！？；;\n]*$/));
    const prefix = text.slice(sentenceStart, index);
    if (!negation.test(prefix)) return true;
  }
  return false;
}

function validConsumerModelText(text: string, contract?: ConsumerModelContract): boolean {
  const value = text.trim();
  if (!value || value.length > 2_000) return false;
  // Keep the public answer machine-readable and short enough for a consumer.
  const sectionBoundary = "(?:^|[\\s。；;、])";
  const labels = contract?.locale === "en"
    ? ["Conclusion", "Evidence", "Uncertainty", "Next step"]
    : ["结论", "依据", "不确定", "下一步"];
  if (labels.some((label) => !new RegExp(sectionBoundary + label.replace(" ", "\\s+") + "：", "i").test(value))) return false;
  if (contract?.dataMode === "demo/synthetic" && hasUnsupportedDemoClaim(value)) return false;
  if (contract?.batchId) {
    const batchIds = value.match(/\b[A-Z]{2,12}-\d{4}-\d{2,6}\b/g) ?? [];
    if (batchIds.some((id) => id !== contract.batchId)) return false;
  }
  if (contract?.chainContext && /(已上链|交易成功|receipt 已确认|交易已确认|anchored|transaction succeeded|receipt confirmed|purchase confirmed)/i.test(value) && !contract.chainContext.transaction) return false;
  return true;
}

async function callCustomerModel(systemPrompt: string, userPrompt: string, sources: string[], contract?: ConsumerModelContract): Promise<ChatReplyResult> {
  const provider = resolveAgentProvider();
  if (!provider.configured) return {
    lines: [],
    status: "deterministic_fallback",
    runtimeStatus: "fallback",
    dataMode: "demo/synthetic",
    sources,
    safety: { status: "fallback", citations: [], reasons: ["provider_not_configured"] },
  };
  // Keep the configured provider authoritative. If it fails or returns an
  // invalid answer, the request falls back to deterministic evidence text
  // instead of silently switching to a different provider.
  const providers: ResolvedAgentProvider[] = [provider];
  let providerIssue: ChatReplyResult["providerIssue"] = "unavailable";
  let providerResponseStatus: number | undefined;
  let runtimeStatus: CustomerModelRuntimeStatus = "unavailable";
  const safetyContract = {
    batchId: contract?.batchId,
    dataMode: contract?.dataMode ?? "demo/synthetic",
    evidenceIds: contract?.evidenceIds ?? [],
    allowedCitations: contract?.allowedCitations ?? [...new Set([...sources, "product_policy", "chain_status", "customer_policy"])],
    allowedNumbers: contract?.allowedNumbers ?? [],
    chainContext: contract?.chainContext as ConsumerSafetyChainContext | undefined,
    locale: contract?.locale ?? "zh",
  };
  const guardedSystemPrompt = [
    systemPrompt,
    `安全策略版本：${CONSUMER_PROMPT_POLICY_VERSION}；输出契约版本：${CONSUMER_MODEL_CONTRACT_VERSION}。`,
    "只输出 JSON，不要输出 Markdown 代码围栏。字段必须是 conclusion、evidence、uncertainty、nextAction、citations。citations 必须是当前输入允许的来源。没有依据就明确说不知道，不要猜型号、灯号或动作结果。",
    "不要新增任何日期、数量、百分比、型号或编号；如果某个数字不在允许值列表中，请改用“不确定”说明，不要自行补全。",
    `当前运行上下文：${JSON.stringify({
      batchId: safetyContract.batchId ?? null,
      evidenceIds: safetyContract.evidenceIds,
      verifier: contract?.verifier ?? null,
      jev: contract?.jev ?? null,
      chainContext: safetyContract.chainContext ?? null,
      dataMode: safetyContract.dataMode,
      allowedSources: safetyContract.allowedCitations,
    })}`,
    `允许引用：${JSON.stringify(safetyContract.allowedCitations)}。`,
    consumerSafetyFewShot(safetyContract.locale),
  ].join("\n");

  for (const candidate of providers) {
    const endpoint = providerEndpoint(candidate.baseUrl);
    try {
      const requestHeaders: Record<string, string> = {
        Authorization: "Bearer " + candidate.apiKey,
        "Content-Type": "application/json",
        "User-Agent": "TruthPass-Agent/1.0 (+https://truthpass-service.vercel.app)",
      };
      // OpenCode Go uses the session header to identify a stable coding-agent
      // conversation for routing and prompt caching. Keep it non-secret and
      // batch-scoped; never forward a wallet, API key, or private evidence.
      if (candidate.provider === "opencode") {
        requestHeaders["x-opencode-session"] = contract?.sessionId
          ?? `truthpass:${contract?.batchId ?? "public-chat"}:${contract?.locale ?? "zh"}`;
      }
      const res = await fetch(endpoint, {
        method: "POST",
        headers: requestHeaders,
        signal: AbortSignal.timeout(20_000),
        body: JSON.stringify({
          model: candidate.model,
          messages: [
            { role: "system", content: guardedSystemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.2,
          max_tokens: 500,
          stream: false,
        }),
      });
      if (!res.ok) {
        providerIssue = res.status === 401 || res.status === 403
          ? "unauthorized"
          : res.status === 402
            ? "billing_required"
            : res.status === 429
              ? "rate_limited"
              : "unavailable";
        providerResponseStatus = res.status;
        runtimeStatus = providerIssue === "billing_required"
          ? "billing_required"
          : providerIssue === "unauthorized"
            ? "unauthorized"
            : providerIssue === "rate_limited"
              ? "rate_limited"
              : "unavailable";
        const diagnostic = { event: "customer_service_provider_unavailable", endpointHost: new URL(endpoint).host, status: res.status, at: new Date().toISOString(), providerIssue } as const;
        lastCustomerModelDiagnostic = diagnostic;
        console.warn(JSON.stringify(diagnostic));
        continue;
      }
      const data = (await res.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
      const content = data.choices?.[0]?.message?.content;
      const safety = typeof content === "string" ? validateConsumerModelOutput(content, safetyContract) : { status: "rejected" as const, citations: [], reasons: ["model_content_missing"] };
      if (safety.status !== "accepted" || !safety.text) {
        providerIssue = "invalid_response";
        runtimeStatus = "invalid_response";
        providerResponseStatus = res.status;
        const text = typeof content === "string" ? content.trim() : "";
        const diagnostic = {
          event: "customer_service_provider_invalid_response",
          endpointHost: new URL(endpoint).host,
          at: new Date().toISOString(),
          hasContent: typeof content === "string",
          length: text.length,
          hasConclusion: /结论：/.test(text),
          hasEvidence: /依据：/.test(text),
          hasUncertainty: /不确定：/.test(text),
          hasNextAction: /下一步：/.test(text),
          containsForbiddenClaim: hasUnsupportedDemoClaim(text),
          validationReasons: safety.reasons,
        } as const;
        lastCustomerModelDiagnostic = diagnostic;
        console.warn(JSON.stringify(diagnostic));
        continue;
      }
      // The configured provider succeeded; clear any prior diagnostic so status
      // reflects the current successful call.
      lastCustomerModelDiagnostic = null;
      providerResponseStatus = res.status;
      runtimeStatus = "completed";
      lastCustomerModelRuntime = {
        provider: candidate.provider,
        model: candidate.model,
        status: runtimeStatus,
        responseStatus: providerResponseStatus,
        at: new Date().toISOString(),
      };
      return {
        lines: [{ cls: "plain", text: safety.text }],
        status: "model_assisted",
        providerUsed: candidate.provider,
        modelUsed: candidate.model,
        providerResponseStatus,
        runtimeStatus,
        dataMode: "demo/synthetic",
        sources,
        evidenceIds: safety.citations.filter((item) => safetyContract.evidenceIds.includes(item)),
        safety: { status: "accepted", citations: safety.citations, reasons: [] },
      };
    } catch (error) {
      runtimeStatus = "unavailable";
      const diagnostic = { event: "customer_service_provider_error", endpointHost: new URL(endpoint).host, errorType: error instanceof Error ? error.name : "unknown", at: new Date().toISOString(), providerIssue: "unavailable" } as const;
      lastCustomerModelDiagnostic = diagnostic;
      console.warn(JSON.stringify(diagnostic));
      // No alternate provider is attempted; the caller receives deterministic
      // fallback after this configured provider fails.
    }
  }

  lastCustomerModelRuntime = {
    provider: provider.provider,
    model: provider.model,
    status: runtimeStatus,
    responseStatus: providerResponseStatus,
    providerIssue,
    at: new Date().toISOString(),
  };
  return {
    lines: [],
    status: providerIssue === "rate_limited" ? "rate_limited" : "provider_unavailable",
    providerUsed: provider.provider,
    modelUsed: provider.model,
    providerIssue,
    providerResponseStatus,
    runtimeStatus,
    dataMode: "demo/synthetic",
    sources,
    safety: { status: "rejected", citations: [], reasons: ["model_output_rejected_or_unavailable"] },
  };
}

function isChainStatusQuestion(question: string): boolean {
  return /(链上|交易|receipt|区块|主网|确认|合约|钱包广播|锚定|上链|rpc)/i.test(question);
}

async function buildChainQueryContext(batchId: string | null): Promise<ChainQueryContext> {
  const chain = await getBotChainMainnetStatus();
  let anchorStatus = "anchor_pending";
  let transaction: ChainQueryContext["transaction"];
  if (batchId) {
    try {
      const inspection = await mcpInspectBatch(batchId, requestTraceId({ headers: {} } as IncomingMessage));
      anchorStatus = String((inspection.verification as Record<string, unknown>).anchor && ((inspection.verification as Record<string, unknown>).anchor as Record<string, unknown>).status || "anchor_pending");
    } catch {
      // Keep the safe pending state when a batch cannot be inspected.
    }
    const receiptIndex = await receiptIndexForVerification();
    // A batch can have purchase, feedback, dispute, and evidence receipts.
    // Only a purchase/anchor event is allowed to appear as the current
    // consumer transaction in the public Agent context.
    const session = receiptIndex.find((item) =>
      item.batchId === batchId
      && (item.action === "purchase" || item.action === "recordPurchase" || item.action === "anchor" || item.action === "evidence")
      && /^(PurchaseRecorded|ConsumerPurchaseSubmitted|EvidenceAnchored|EvidenceSubmitted)$/i.test(item.event)
      && item.eventVerified === true
      && (item.receiptStatus === "0x1" || item.receiptStatus === "1"),
    );
    if (session) transaction = { txHash: session.txHash, event: session.event, explorerUrl: session.explorerUrl, blockNumber: session.blockNumber };
  }
  return {
    queried: true,
    chainId: chain.chainId,
    chainName: chain.chainName,
    rpcReachable: Boolean(chain.liveRpc?.reachable),
    latestBlockNumber: chain.liveRpc?.latestBlockNumber,
    anchorStatus,
    explorerUrl: chain.explorerUrl,
    batchId,
    transaction,
  };
}

async function freeChatReply(question: string, chainContext?: ChainQueryContext, locale: "zh" | "en" = "zh"): Promise<ChatReplyResult> {
  const english = locale === "en";
  const chainPrompt = chainContext
    ? (english
      ? "If the user asks about chain status, cite only the supplied chain status. Distinguish RPC reachability, batch anchoring, a real receipt, and historical replay. Never invent a transaction result."
      : "如果用户问链状态，只能引用提供的链状态；明确区分 RPC 可达、批次锚定、真实 receipt 和历史记录，不得编造交易结果。")
    : "";
  return callCustomerModel(
    english
      ? `You are the TruthPass product assistant. Use plain language and output exactly four short sections in this order: “Conclusion: … Evidence: … Uncertainty: … Next step: …”. Name the source in Evidence and cite only the current input; never combine batches. Be direct and restrained. Use only the supplied product policy, after-sales policy, and public evidence. Do not invent test values, efficacy, medical diagnoses, orders, payments, or transaction hashes. If evidence is missing, say so and suggest human review. ${chainPrompt}`
      : `你是 TruthPass 商品客服。说人话，用四段短句回答，且必须严格按“结论：… 依据：… 不确定：… 下一步：…”顺序输出。依据必须写明来源（例如商品说明、售后政策、公开证据或链状态）；只引用当前输入，禁止跨批次拼接。语气直接、克制，不堆术语，不制造紧迫感。只能依据商品说明、售后政策和公开证据回答；不得编造检测值、疗效、医疗诊断、订单、支付或交易 Hash。没有证据就直说不知道，并建议转人工。${chainPrompt}`,
    chainContext ? JSON.stringify({ question, chainContext, dataMode: "demo/synthetic" }) : question,
    ["customer_policy", ...(chainContext ? ["chain_status"] : [])],
    { dataMode: "demo/synthetic", chainContext, locale, allowedCitations: ["customer_policy", ...(chainContext ? ["chain_status"] : [])] },
  );
}

async function routeBatchWithJev(
  batchId: string,
  batch: DemoBatch,
  retrievalHits: AgentSearchHit[],
  verificationStatus: string,
): Promise<{ decision: JevDecision; provider: string; model: string; live: boolean }> {
  const providerConfig = providerFromEnv();
  const requestedChecks = isRiceBatch(batchId) ? ["batch_identity"] : ["epa_dha", "oxidation", "totox", "cold_chain"];
  const evidenceRefs = retrievalHits.flatMap((hit, index) => {
    const ids = hit.evidenceIds.length ? hit.evidenceIds : [hit.hitId];
    return ids.map((evidenceId, refIndex) => ({
      eventId: evidenceId,
      kind: hit.sourceType || `retrieval-${index + 1}`,
      payloadHash: evidenceHash(`${batchId}:${evidenceId}:${refIndex}`),
    }));
  });
  const state: JevState = {
    taskId: `consumer-agent-${batchId}`,
    batchId,
    policyId: isRiceBatch(batchId) ? "rice-origin-policy" : "fish-oil-quality",
    requestedChecks,
    evidenceRefs,
    stateSummary: {
      reportBatchMatches: retrievalHits.every((hit) => hit.batchId === batchId),
      epaDhaPresent: isRiceBatch(batchId) || Number.isFinite(batch.epaDha),
      peroxidePresent: isRiceBatch(batchId) || Number.isFinite(batch.peroxide),
      totoxPresent: isRiceBatch(batchId) || Number.isFinite(batch.totox),
      coldChainPresent: isRiceBatch(batchId) || (verificationStatus === "accepted" && Number.isFinite(batch.coldGap)),
      heavyMetalsPresent: true,
      serviceOnline: true,
      signatureValid: true,
      conflictCodes: [],
    },
    inputHash: evidenceHash(JSON.stringify({
      batchId,
      requestedChecks,
      evidenceRefs,
      verificationStatus,
    })),
    schemaVersion: "jev-truthpass-state-v1",
    createdAt: new Date().toISOString(),
  };
  const gate = new SafeJevDecisionGate({
    provider: providerConfig.provider,
    modelId: providerConfig.source === "none" ? "deterministic-fallback" : providerConfig.source,
    modelVersion: providerConfig.source === "none" ? "rules-v1" : `${providerConfig.source}-live`,
  });
  const decision = await gate.decide(state);
  const live = providerConfig.enabled && decision.modelAssisted === true;
  return {
    decision,
    provider: live ? providerConfig.source : "deterministic",
    model: decision.modelId,
    live,
  };
}

async function demoConsumerChat(batchId: string, b: DemoBatch, question: string, chainContext?: ChainQueryContext, locale: "zh" | "en" = "zh", retrievalHits: AgentSearchHit[] = []): Promise<ChatReplyResult> {
  const english = locale === "en";
  let collaboration: Record<string, unknown> | undefined;
  try {
    collaboration = await runPublicAgentCollaboration(batchId, question);
  } catch {
    collaboration = undefined;
  }
  const selectedFacts = Array.isArray(collaboration?.selectedFacts) ? collaboration.selectedFacts.filter((item): item is string => typeof item === "string") : [];
  const verification = collaboration?.verification && typeof collaboration.verification === "object" ? collaboration.verification as Record<string, unknown> : {};
  const assessment = verification.assessment && typeof verification.assessment === "object" ? verification.assessment as Record<string, unknown> : {};
  const evidenceCard = collaboration?.evidenceCard && typeof collaboration.evidenceCard === "object" ? collaboration.evidenceCard as Record<string, unknown> : {};
  const evidenceIdsFromCard = Array.isArray(evidenceCard.evidenceIds)
    ? evidenceCard.evidenceIds.filter((item): item is string => typeof item === "string")
    : [];
  // Fixture-only batches (for example FO-2026-009) do not enter the
  // repository-backed collaboration path. They still expose stable,
  // batch-scoped public evidence references so the Agent trace can show what
  // was read without inventing a database evidence record.
  // The collaboration store still contains legacy `ev-*` identifiers. The
  // public Agent contract uses the batch-scoped IDs from evidenceFor so the
  // retrieval result, model citations, audit record and UI all refer to the
  // same evidence namespace. Never expose a legacy ID as a citation for a
  // different batch.
  const canonicalEvidenceIds = evidenceFor(batchId)
    .map((item) => item.evidenceId)
    .filter((item): item is string => typeof item === "string");
  const evidenceIds = canonicalEvidenceIds.length ? canonicalEvidenceIds : evidenceIdsFromCard;
  const evidenceCardForModel = collaboration?.evidenceCard && typeof collaboration.evidenceCard === "object"
    ? { ...(collaboration.evidenceCard as Record<string, unknown>), evidenceIds }
    : null;
  const productionEvidence = productionProcessFor(batchId);
  const selectedFactsForOutput = selectedFacts.map((fact) => publicFactForLocale(fact, locale));
  const missingStagesForOutput = productionEvidence.missingStages.map((stage) => publicFactForLocale(stage, locale));
  const productionGapText = productionEvidence.missingStages.length
    ? (english
      ? `The production record currently covers ${productionEvidence.observedStageCount}/${productionEvidence.requiredStageCount} stages; missing: ${missingStagesForOutput.join(", ")}`
      : `生产过程当前只记录 ${productionEvidence.observedStageCount}/${productionEvidence.requiredStageCount} 道工序，尚未覆盖：${productionEvidence.missingStages.join("、")}`)
    : (english ? "The public production record covers the required stages" : "生产过程公开记录已覆盖当前要求的工序");
  const baseVerificationStatus = String(verification.status ?? (b.passed ? "accepted" : "rejected"));
  const overallVerificationStatus = baseVerificationStatus === "rejected"
    ? "rejected"
    : productionEvidence.missingStages.length > 0
      ? "review"
      : baseVerificationStatus;
  const overallVerificationReasons = [
    ...(Array.isArray(assessment.reasons) ? assessment.reasons.filter((item): item is string => typeof item === "string") : []),
    ...(Array.isArray(verification.reasons) ? verification.reasons.filter((item): item is string => typeof item === "string") : []),
    ...productionEvidence.missingStages.map((stage) => `生产阶段“${stage}”资料未覆盖`),
  ];
  const overallVerificationReasonsForOutput = overallVerificationReasons.map((reason) => publicFactForLocale(reason, locale));
  const jev = await routeBatchWithJev(batchId, b, retrievalHits, overallVerificationStatus);
  const sourceText = selectedFacts.length
    ? (english ? "Source: the current batch evidence card and deterministic verifier" : "来源：当前批次 evidence_card 与 deterministic_verifier")
    : (english ? "Source: the current batch record" : "来源：当前批次登记信息");
  const fallbackText = english
    ? selectedFacts.length
      ? `Conclusion: ${overallVerificationStatus === "accepted" ? "These records can be reviewed further" : "These records need review before purchase preparation"}. Evidence: ${selectedFactsForOutput.slice(0, 2).join("; ")}; ${productionGapText}; ${sourceText}. Uncertainty: This is demo/synthetic data and is not a substitute for real product certification. Next step: ${overallVerificationStatus === "accepted" ? "Open the evidence card to confirm sources, then prepare a purchase" : "Ask the producer or testing body to complete the missing production records and rerun verification"}.`
      : b.passed
        ? `Conclusion: ${overallVerificationStatus === "accepted" ? `${b.name} (${batchId}) is within the current demo rule range for further review` : `${b.name} (${batchId}) is within the current demo rule range, but the production record still needs review`}. Evidence: ${demoParameterDetailForLocale(b, locale)}; ${productionGapText}; ${sourceText}. Uncertainty: This is demo/synthetic data and is not a substitute for real product certification. Next step: ${overallVerificationStatus === "accepted" ? "Open the evidence card to check the sources" : "Ask the producer to complete the production record and rerun verification"}.`
        : `Conclusion: ${b.name} (${batchId}) needs parameter review before deciding whether to order. Evidence: ${demoParameterDetailForLocale(b, locale)}; ${sourceText}; deterministic verifier. Uncertainty: This is demo/synthetic data and is not a substitute for real product certification. Next step: Ask the producer or testing body to complete the relevant records and check again.`
    : selectedFacts.length
      ? `结论：${overallVerificationStatus === "accepted" ? "这批资料可以继续了解" : "这批资料需要先复核，暂不进入购买准备"}。依据：${selectedFacts.slice(0, 2).join("；")}；${productionGapText}；${sourceText}。不确定：当前是 demo/synthetic，不能替代真实商品认证。下一步：${overallVerificationStatus === "accepted" ? "先打开证据卡确认来源，再生成购买准备" : "由生产方或检测机构补齐生产阶段资料后重新核验"}。`
      : b.passed
        ? `结论：${overallVerificationStatus === "accepted" ? `${b.name}（${batchId}）的登记参数落在当前演示规则范围内，可以继续了解` : `${b.name}（${batchId}）的参数虽在当前演示规则范围内，但生产资料仍需复核`}。依据：${demoParameterDetail(b)}${productionGapText}；${sourceText}。不确定：当前是 demo/synthetic，不能替代真实商品认证。下一步：${overallVerificationStatus === "accepted" ? "打开证据卡核对来源" : "由生产方补齐生产阶段资料后重新核验"}。`
        : `结论：${b.name}（${batchId}）需要先复核参数再决定是否下单。依据：${demoParameterDetail(b)}${sourceText}；deterministic_verifier。不确定：当前是 demo/synthetic，不能替代真实商品认证。下一步：由企业或检测机构补齐对应资料后重新核对。`;
  const allowedNumbers = [
    String(b.epaDha), `${b.epaDha}%`,
    String(b.peroxide), `${b.peroxide}mg`,
    String(b.totox),
    String(b.coldGap), `${b.coldGap}小时`, `${b.coldGap}h`,
    String(productionEvidence.observedStageCount), String(productionEvidence.requiredStageCount),
    ...productionEvidence.facts.flatMap((fact) => fact.value.match(/\d+(?:\.\d+)?/g) ?? []),
    ...b.productionDate.split(/[^0-9]+/).filter(Boolean),
    ...Object.values(b.heavyMetals).flatMap((value) => [String(value)]),
  ];
  const retrievalMeta = { query: question, hitCount: retrievalHits.length, hitIds: retrievalHits.map((hit) => hit.hitId) };
  const modelResult = await callCustomerModel(
    english
      ? "You are the TruthPass product assistant. Use plain language and output exactly four short sections: “Conclusion: … Evidence: … Uncertainty: … Next step: …”. Name the source in Evidence. Use only the current batch's deterministic verification result and evidence card; never combine batches. Do not invent metrics, efficacy, diagnoses, orders, payments, or transaction hashes. Say when information is missing. Do not turn “within current rules” into “safe” or “officially certified”. Chain content may cite only chainContext; without a transaction, do not claim a confirmed transaction or receipt."
      : "你是 TruthPass 的商品客服。说人话，严格输出四段短句：“结论：… 依据：… 不确定：… 下一步：…”。依据必须写明来源。只能使用下面当前批次的确定性验证结果和证据卡，禁止跨批次拼接；不得创造新指标、疗效、医疗诊断、订单、支付或交易 Hash；资料不足时必须直说。不要把“通过当前规则”说成“商品安全”或“官方认证”。链上内容只能引用 chainContext；没有 transaction 时不得声称交易或 receipt 已确认。",
    JSON.stringify({
      batchId,
      dataMode: "demo/synthetic",
      evidenceCard: evidenceCardForModel,
      selectedFacts: selectedFactsForOutput,
      verification: { status: overallVerificationStatus, reasons: overallVerificationReasonsForOutput },
      productionEvidence: {
        ...productionEvidence,
        missingStages: missingStagesForOutput,
      },
      deterministicFacts: isRiceBatch(batchId)
        ? { product: b.name, category: "rice", production: productionEvidence.facts, productionStages: productionEvidence.stages }
        : { product: b.name, category: "fish_oil", epaDhaPercent: b.epaDha, peroxideValue: b.peroxide, totox: b.totox, coldChainGapHours: b.coldGap, heavyMetals: b.heavyMetals },
      chainContext: chainContext ?? null,
       retrievalHits,
       question,
    }),
    [...evidenceIds, "evidence_card", "deterministic_verifier"],
    {
      batchId,
      dataMode: "demo/synthetic",
      chainContext,
      verifier: {
        status: overallVerificationStatus,
        reasons: overallVerificationReasonsForOutput,
      },
      jev: {
        decision: jev.decision.decision,
        confidence: jev.decision.confidence,
        nextAction: jev.decision.nextAction,
        missingEvidenceCodes: jev.decision.missingEvidenceCodes,
        conflictCodes: jev.decision.conflictCodes,
        modelAssisted: jev.decision.modelAssisted === true,
        provider: jev.provider,
        model: jev.model,
      },
      evidenceIds,
      allowedCitations: [...new Set([...evidenceIds, "evidence_card", "deterministic_verifier", "product_policy", ...(chainContext ? ["chain_status"] : [])])],
      allowedNumbers,
      locale,
    },
  );
  const verifierStatus = overallVerificationStatus;
  const verifierReasons = overallVerificationReasonsForOutput;
  if (modelResult.lines.length) {
    return {
      ...modelResult,
      evidenceIds,
      verifierStatus,
      verifierReasons,
      retrieval: retrievalMeta,
      jev,
      ...(chainContext ? { chainContext } : {}),
    };
  }
  const fallbackCitations = [
    ...evidenceIds,
    "evidence_card",
    "deterministic_verifier",
    ...(chainContext ? ["chain_status"] : []),
  ];
  const chainFallback = chainContext
    ? english
      ? `Conclusion: The chain node is ${chainContext.rpcReachable ? "reachable" : "temporarily unavailable"}, and this batch has chain status “${chainContext.anchorStatus}”. Evidence: Source is chain_status (Chain ${chainContext.chainId} · ${chainContext.chainName})${chainContext.transaction ? `; this session's transaction event is ${chainContext.transaction.event}` : "; there is no receipt for this session"}. Uncertainty: A reachable node does not prove that the batch is anchored; dataMode is demo/synthetic. Next step: ${chainContext.transaction ? "Open the block explorer and verify the receipt" : "Prepare the write and confirm it in an external wallet if needed"}.`
      : `结论：${chainContext.rpcReachable ? "链节点当前可读取" : "链节点当前暂时无法读取"}，这批资料的链上状态是“${chainContext.anchorStatus}”。依据：来源为 chain_status（Chain ${chainContext.chainId} · ${chainContext.chainName}）${chainContext.transaction ? `，本次会话交易为 ${chainContext.transaction.event}` : "，没有本次会话交易 receipt"}。不确定：链节点可读取不等于批次已锚定；当前 dataMode 为 demo/synthetic。下一步：${chainContext.transaction ? "打开区块浏览器核对 receipt" : "如需写入，请先准备操作并由钱包确认"}。`
    : fallbackText;
  return {
    ...modelResult,
    lines: [{ cls: "conclusion", text: chainFallback }],
    fallbackApplied: true,
    evidenceIds,
    verifierStatus,
    verifierReasons,
    retrieval: retrievalMeta,
    jev,
    safety: {
      status: "fallback",
      citations: fallbackCitations,
      reasons: modelResult.safety?.reasons ?? ["model_output_rejected_or_unavailable"],
    },
    ...(chainContext ? { chainContext } : {}),
  };
}

/**
 * Request-driven Agent executions are intentionally short lived. Keep a
 * process-local guard so one Vercel function instance cannot fan out more
 * than the supported number of model runs at once. A multi-instance
 * deployment must back this with Redis or another shared limiter for a
 * fleet-wide cap.
 */
const AGENT_MAX_CONCURRENCY = (() => {
  const configured = Number.parseInt(process.env.TRUTHPASS_AGENT_MAX_CONCURRENCY ?? "10", 10);
  return Number.isFinite(configured) && configured > 0 ? Math.min(configured, 10) : 10;
})();
let activeAgentRuns = 0;

function tryAcquireAgentSlot(): { allowed: true; active: number } | { allowed: false; active: number; retryAfterSeconds: number } {
  if (activeAgentRuns >= AGENT_MAX_CONCURRENCY) {
    return { allowed: false, active: activeAgentRuns, retryAfterSeconds: 1 };
  }
  activeAgentRuns += 1;
  return { allowed: true, active: activeAgentRuns };
}

function releaseAgentSlot(): void {
  // Defensive clamp keeps a provider/client error from making the process
  // permanently unavailable if a future path accidentally releases twice.
  activeAgentRuns = Math.max(0, activeAgentRuns - 1);
}

async function consumerChat(req: IncomingMessage, batchId: string, question: string, res: ServerResponse, locale: "zh" | "en" = "zh"): Promise<void> {
  const traceId = requestTraceId(req);
  const rate = consumeChatRateLimit(req);
  if (!rate.allowed) {
    console.info(JSON.stringify({ event: "customer_service_rate_limited", traceId, status: "rate_limited" }));
    res.writeHead(429, { "Content-Type": "application/json; charset=utf-8", "Retry-After": String(rate.retryAfterSeconds), "Cache-Control": "no-store" });
    res.end(JSON.stringify({ error: "CHAT_RATE_LIMITED", status: "rate_limited", traceId, retryAfterSeconds: rate.retryAfterSeconds }));
    return;
  }

  const slot = tryAcquireAgentSlot();
  if (!slot.allowed) {
    console.info(JSON.stringify({ event: "customer_service_concurrency_limited", traceId, status: "rate_limited", active: slot.active, limit: AGENT_MAX_CONCURRENCY }));
    res.writeHead(429, {
      "Content-Type": "application/json; charset=utf-8",
      "Retry-After": String(slot.retryAfterSeconds),
      "Cache-Control": "no-store",
      "X-TruthPass-Agent-Limit": String(AGENT_MAX_CONCURRENCY),
    });
    res.end(JSON.stringify({
      error: "AGENT_CONCURRENCY_LIMITED",
      status: "rate_limited",
      reason: "agent_concurrency_limit",
      traceId,
      active: slot.active,
      limit: AGENT_MAX_CONCURRENCY,
      retryAfterSeconds: slot.retryAfterSeconds,
    }));
    return;
  }

  try {
    await consumerChatWithSlot(req, batchId, question, res, traceId, locale);
  } finally {
    releaseAgentSlot();
  }
}

async function consumerChatWithSlot(req: IncomingMessage, batchId: string, question: string, res: ServerResponse, traceId: string, locale: "zh" | "en" = "zh"): Promise<void> {
  const english = locale === "en";
  const chainContext = isChainStatusQuestion(question) ? await buildChainQueryContext(batchId || null) : undefined;

  if (!batchId) {
    const available = [...Object.keys(FISH_OIL_BATCHES), ...Object.keys(RICE_BATCHES)].filter((id) => repository.getBatch(id) || demoBatchFor(id));
    const fallback: ChatReplyResult = {
      lines: [{ cls: "plain", text: english
        ? (available.length ? "Conclusion: I can check a product and batch. Evidence: The service has registered batches available for lookup; source: customer_fallback. Uncertainty: Without a batch ID I cannot verify the specific evidence. Next step: Provide the product name and batch ID." : "Conclusion: I cannot verify a specific batch yet. Evidence: No valid batch ID was received; source: customer_fallback. Uncertainty: Without a batch ID I cannot determine the evidence status. Next step: Provide the product name and batch ID.")
        : (available.length ? "结论：我可以帮你查商品和批次。依据：当前服务已登记可查询批次；来源：customer_fallback。不确定：未提供批次号时无法核对具体证据。下一步：请提供商品名和批次号。" : "结论：目前不能核对具体批次。依据：系统未收到有效批次号；来源：customer_fallback。不确定：没有批次号就不能判断证据状态。下一步：请提供商品名和批次号。") }],
      status: "deterministic_fallback",
      dataMode: "demo/synthetic",
      sources: ["customer_fallback"],
      safety: { status: "fallback", citations: ["customer_fallback"], reasons: ["batch_id_required"] },
    };
    const reply = freeChatReply(question, chainContext, locale).then((result) => result.lines.length ? { ...result, ...(chainContext ? { chainContext } : {}) } : fallback);
    await streamChatWithReply(res, "consumer_query", [], reply, { batchId: null, traceId });
    return;
  }

  const b = demoBatchFor(batchId);
  if (!b) {
    streamChat(res, "consumer_query", [{ cls: "disclaimer", text: english ? `Conclusion: I cannot determine batch ${batchId} yet. Evidence: This batch has no registered evidence; source: batch_lookup. Uncertainty: I will not substitute data from another batch. Next step: Check the batch ID or ask a human to register the evidence.` : "结论：暂时不能判断批次 " + batchId + "。依据：当前批次没有已登记证据；来源：batch_lookup。不确定：不会用其他批次的数据代替。下一步：请核对批次号，或转人工登记证据。" }], {
      agentMode: "deterministic_fallback",
      serviceStatus: "deterministic_fallback",
      dataMode: "demo/synthetic",
      batchId,
      traceId,
      // Unknown batches are rejected before any provider call. Keep the
      // public metadata deterministic even when a model provider is
      // configured globally for other requests.
      provider: "deterministic",
      model: "deterministic-fallback",
      modelAssisted: false,
      sources: ["batch_lookup"],
      validationStatus: "fallback",
      validationReasons: ["batch_not_found"],
    });
    return;
  }

  const retrieval = searchBatchKnowledge(batchId, question);
  const reply = demoConsumerChat(batchId, b, question, chainContext, locale, retrieval);
  const lifecycle = lifecyclePublicView(batchId);
  await streamChatWithReply(res, "consumer_evidence", [], reply, {
    batchId,
    traceId,
    contextMode: lifecycle.contextMode,
    contextSource: lifecycle.contextSource,
    contextRevision: lifecycle.contextRevision,
    syncedAt: lifecycle.syncedAt,
    ...(chainContext ? { chainContext } : {}),
  });
}


function agentMode(): "model_assisted" | "deterministic_fallback" {
  return resolveAgentProvider().configured ? "model_assisted" : "deterministic_fallback";
}


function agentGatewayAuthorized(req: IncomingMessage): { authorized: boolean; authMode: "configured" | "unconfigured" } {
  const expected = process.env.TRUTHPASS_AGENT_GATEWAY_TOKEN?.trim();
  if (!expected) return { authorized: true, authMode: "unconfigured" };
  const header = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
  return { authorized: header === "Bearer " + expected, authMode: "configured" };
}

type EnterpriseRequestContext = {
  authorized: boolean;
  tenantId: string;
  requestId: string;
  error?: string;
  authMode?: "gateway_token" | "supabase_session";
  userId?: string;
};

type SupabaseAuthUser = {
  id?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
};

function supabaseAuthConfig(): { url: string; anonKey: string } | undefined {
  const url = (process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim() || "").replace(/\/+$/, "");
  const anonKey = (process.env.SUPABASE_ANON_KEY?.trim() || process.env.VITE_SUPABASE_ANON_KEY?.trim() || "");
  return url && anonKey ? { url, anonKey } : undefined;
}

function supabaseServiceConfig(): { url: string; serviceKey: string; bucket: string } | undefined {
  const url = (process.env.SUPABASE_URL?.trim() || process.env.VITE_SUPABASE_URL?.trim() || "").replace(/\/+$/, "");
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() || process.env.SUPABASE_SECRET_KEY?.trim() || "");
  const bucket = (process.env.TRUTHPASS_MEDIA_BUCKET?.trim() || "truthpass-evidence").replace(/[^A-Za-z0-9._-]/g, "");
  return url && serviceKey && bucket ? { url, serviceKey, bucket } : undefined;
}

let supabaseStorageAdmin: SupabaseClient | undefined;
function getSupabaseStorageAdmin(): { client: SupabaseClient; bucket: string } | undefined {
  const config = supabaseServiceConfig();
  if (!config) return undefined;
  supabaseStorageAdmin ??= createClient(config.url, config.serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
  return { client: supabaseStorageAdmin, bucket: config.bucket };
}

async function resolveSupabaseUser(req: IncomingMessage): Promise<SupabaseAuthUser | undefined> {
  const authorization = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
  if (!authorization.startsWith("Bearer ")) return undefined;
  const token = authorization.slice("Bearer ".length).trim();
  const config = supabaseAuthConfig();
  if (!token || !config) return undefined;
  try {
    const response = await fetch(`${config.url}/auth/v1/user`, {
      headers: { apikey: config.anonKey, Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) return undefined;
    const user = await response.json() as SupabaseAuthUser;
    return typeof user.id === "string" && user.id ? user : undefined;
  } catch {
    return undefined;
  }
}

function claimedTenantIds(user: SupabaseAuthUser): string[] {
  const claims = [user.app_metadata?.tenantId, user.app_metadata?.tenant_id, user.user_metadata?.tenantId, user.user_metadata?.tenant_id];
  return claims.filter((value): value is string => typeof value === "string" && validTenantId(value)).map((value) => value.trim());
}

async function isSupabaseTenantMember(userId: string, tenantId: string): Promise<boolean> {
  if (!persistenceEnabled()) return false;
  try {
    await getDatabasePool().query(`
      create table if not exists truthpass_tenant_members (
        user_id text not null,
        tenant_id text not null,
        role text not null default 'member',
        status text not null default 'active',
        created_at timestamptz not null default now(),
        primary key (user_id, tenant_id)
      );
      create index if not exists truthpass_tenant_members_tenant_idx on truthpass_tenant_members (tenant_id, status);
    `);
    const result = await getDatabasePool().query(
      `select 1 from truthpass_tenant_members where user_id = $1 and tenant_id = $2 and status = 'active' limit 1`,
      [userId, tenantId],
    );
    return result.rowCount === 1;
  } catch {
    return false;
  }
}

async function enterpriseRequestContext(req: IncomingMessage, tenantId: string): Promise<EnterpriseRequestContext> {
  const configured = Boolean(process.env.TRUTHPASS_AGENT_GATEWAY_TOKEN?.trim());
  const headerTenant = typeof req.headers["x-truthpass-tenant"] === "string" ? req.headers["x-truthpass-tenant"].trim() : "";
  const requestId = typeof req.headers["x-truthpass-request-id"] === "string" ? req.headers["x-truthpass-request-id"].trim() : "";
  const authorization = typeof req.headers.authorization === "string" ? req.headers.authorization : "";
  const supabaseConfig = supabaseAuthConfig();
  if (!configured && !supabaseConfig) return { authorized: false, tenantId, requestId, error: "TENANT_AUTH_NOT_CONFIGURED" };
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(tenantId) || headerTenant !== tenantId) {
    return { authorized: false, tenantId, requestId, error: "TENANT_SCOPE_MISMATCH" };
  }
  if (!/^[A-Za-z0-9._:-]{3,128}$/.test(requestId)) {
    return { authorized: false, tenantId, requestId, error: "REQUEST_ID_REQUIRED" };
  }
  if (configured && authorization === "Bearer " + process.env.TRUTHPASS_AGENT_GATEWAY_TOKEN!.trim()) {
    return { authorized: true, tenantId, requestId, authMode: "gateway_token" };
  }
  const user = await resolveSupabaseUser(req);
  if (user) {
    const claimedTenants = claimedTenantIds(user);
    if (!claimedTenants.includes(tenantId) && !(user.id && await isSupabaseTenantMember(user.id, tenantId))) {
      return { authorized: false, tenantId, requestId, error: "TENANT_SCOPE_MISMATCH", userId: user.id };
    }
    return { authorized: true, tenantId, requestId, authMode: "supabase_session", userId: user.id };
  }
  return { authorized: false, tenantId, requestId, error: configured ? "AGENT_AUTH_REQUIRED" : "SUPABASE_SESSION_REQUIRED" };
}

function requestTraceId(req: IncomingMessage): string {
  const supplied = req.headers["x-truthpass-request-id"];
  if (typeof supplied === "string" && /^[A-Za-z0-9._:-]{8,128}$/.test(supplied)) return supplied;
  return sha256Hex32("truthpass:agent-request:" + Date.now() + ":" + Math.random());
}

type WalletBindingRole = "consumer" | "producer" | "inspection" | "logistics" | "review" | "arbitration" | "enterprise_agent";
type WalletBindingRecord = { address: string; tenantId: string; role: WalletBindingRole; boundAt: string; bindingId: string; dataMode: "demo/synthetic" | "external" };
const walletBindingChallenges = new Map<string, { message: string; expiresAt: number }>();
const walletBindings = new Map<string, WalletBindingRecord>();
const walletBindingRoles = new Set<WalletBindingRole>(["consumer", "producer", "inspection", "logistics", "review", "arbitration", "enterprise_agent"]);
const walletActionRoles: Record<string, WalletBindingRole[]> = {
  purchase: ["consumer"],
  contribution: ["consumer"],
  dispute: ["consumer"],
  evidence: ["producer", "inspection", "logistics"],
  verification: ["review"],
  audit_finding: ["review"],
  audit_approval: ["review"],
  resolve_challenge: ["arbitration"],
};

function validTenantId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{2,128}$/.test(value.trim());
}

function walletBindingInput(body: Record<string, unknown>): { address: string; tenantId: string; role: WalletBindingRole; message: string; signature: string } {
  const address = typeof body.address === "string" ? body.address.trim() : "";
  const tenantId = typeof body.tenantId === "string" ? body.tenantId.trim() : "demo";
  const role = typeof body.role === "string" ? body.role.trim() as WalletBindingRole : "consumer";
  const message = typeof body.message === "string" ? body.message : "";
  const signature = typeof body.signature === "string" ? body.signature : "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error("WALLET_ADDRESS_INVALID");
  if (!validTenantId(tenantId)) throw new Error("TENANT_ID_INVALID");
  if (!walletBindingRoles.has(role)) throw new Error("WALLET_ROLE_INVALID");
  if (!message || message.length > 512 || !signature) throw new Error("WALLET_BINDING_PROOF_REQUIRED");
  return { address: address.toLowerCase(), tenantId, role, message, signature };
}

function walletBindingKey(address: string, tenantId: string, role: WalletBindingRole): string {
  return `${tenantId}:${role}:${address.toLowerCase()}`;
}

function walletBindingMessage(address: string, tenantId: string, role: WalletBindingRole, nonce: string): string {
  return [
    "TruthPass 钱包身份绑定",
    `钱包：${address.toLowerCase()}`,
    `租户：${tenantId}`,
    `身份：${role}`,
    `一次性编号：${nonce}`,
    "此签名只用于证明当前钱包控制权，不会发起交易或授权转账。",
  ].join("\n");
}

async function persistWalletBinding(record: WalletBindingRecord): Promise<void> {
  walletBindings.set(walletBindingKey(record.address, record.tenantId, record.role), record);
  if (!persistenceEnabled()) return;
  await getDatabasePool().query(
    `create table if not exists truthpass_wallet_bindings (
       address text not null, tenant_id text not null, role text not null,
       bound_at timestamptz not null, binding_id text not null,
       data_mode text not null, updated_at timestamptz not null default now(),
       primary key (address, tenant_id, role)
     )`,
  );
  await getDatabasePool().query(
    `insert into truthpass_wallet_bindings (address, tenant_id, role, bound_at, binding_id, data_mode)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (address, tenant_id, role) do update set bound_at = excluded.bound_at, binding_id = excluded.binding_id, data_mode = excluded.data_mode, updated_at = now()`,
    [record.address, record.tenantId, record.role, record.boundAt, record.bindingId, record.dataMode],
  );
}

async function findWalletBinding(address: string, tenantId: string, roles?: WalletBindingRole[]): Promise<WalletBindingRecord | undefined> {
  const local = [...walletBindings.values()].find((item) => item.address === address.toLowerCase() && item.tenantId === tenantId && (!roles || roles.includes(item.role)));
  if (local || !persistenceEnabled()) return local;
  await getDatabasePool().query(
    `create table if not exists truthpass_wallet_bindings (
       address text not null, tenant_id text not null, role text not null,
       bound_at timestamptz not null, binding_id text not null,
       data_mode text not null, updated_at timestamptz not null default now(),
       primary key (address, tenant_id, role)
     )`,
  );
  const result = await getDatabasePool().query(
    `select address, tenant_id, role, bound_at, binding_id, data_mode
       from truthpass_wallet_bindings
      where address = $1 and tenant_id = $2
        and ($3::text[] is null or role = any($3::text[]))
      order by bound_at desc limit 1`,
    [address.toLowerCase(), tenantId, roles && roles.length > 0 ? roles : null],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  const record: WalletBindingRecord = {
    address: String(row.address).toLowerCase(),
    tenantId: String(row.tenant_id),
    role: String(row.role) as WalletBindingRole,
    boundAt: new Date(String(row.bound_at)).toISOString(),
    bindingId: String(row.binding_id),
    dataMode: row.data_mode === "external" ? "external" : "demo/synthetic",
  };
  walletBindings.set(walletBindingKey(record.address, record.tenantId, record.role), record);
  return record;
}

async function assertWalletActionAuthorized(body: Record<string, unknown>, action: string): Promise<WalletBindingRecord | undefined> {
  if (process.env.TRUTHPASS_ENFORCE_WALLET_BINDING !== "true") return undefined;
  const wallet = typeof body.wallet === "string" ? body.wallet.trim().toLowerCase() : "";
  const tenantId = typeof body.tenantId === "string" && body.tenantId.trim() ? body.tenantId.trim() : "demo";
  if (!/^0x[0-9a-f]{40}$/.test(wallet)) throw new Error("WALLET_BINDING_REQUIRED");
  if (!validTenantId(tenantId)) throw new Error("TENANT_ID_INVALID");
  const roles = walletActionRoles[action];
  if (!roles) throw new Error("WALLET_ACTION_ROLE_UNKNOWN");
  const binding = await findWalletBinding(wallet, tenantId, roles);
  if (!binding) throw new Error(`WALLET_ROLE_REQUIRED:${roles.join(",")}`);
  return binding;
}

async function persistWalletChallenge(key: string, message: string, expiresAt: number): Promise<void> {
  walletBindingChallenges.set(key, { message, expiresAt });
  if (!persistenceEnabled()) return;
  await getDatabasePool().query(
    `create table if not exists truthpass_wallet_challenges (
       challenge_key text primary key, message text not null,
       expires_at timestamptz not null, consumed_at timestamptz
     )`,
  );
  await getDatabasePool().query(
    `insert into truthpass_wallet_challenges (challenge_key, message, expires_at, consumed_at)
     values ($1, $2, to_timestamp($3 / 1000.0), null)
     on conflict (challenge_key) do update set message = excluded.message, expires_at = excluded.expires_at, consumed_at = null`,
    [key, message, expiresAt],
  );
}

async function consumeWalletChallenge(key: string): Promise<{ message: string; expiresAt: number } | undefined> {
  const local = walletBindingChallenges.get(key);
  if (local) {
    walletBindingChallenges.delete(key);
    return local;
  }
  if (!persistenceEnabled()) return undefined;
  const result = await getDatabasePool().query(
    `update truthpass_wallet_challenges
        set consumed_at = now()
      where challenge_key = $1 and consumed_at is null and expires_at > now()
      returning message, extract(epoch from expires_at) * 1000 as expires_at`,
    [key],
  );
  const row = result.rows[0];
  return row ? { message: String(row.message), expiresAt: Number(row.expires_at) } : undefined;
}

function walletBindingMode(): "postgres" | "memory_demo" {
  return persistenceEnabled() ? "postgres" : "memory_demo";
}


const chatRateLimits = new Map<string, { startedAt: number; count: number }>();
const CHAT_RATE_WINDOW_MS = 60_000;
const CHAT_RATE_LIMIT = 30;

function customerServiceStatus(): "ready" | "degraded" {
  return resolveAgentProvider().configured ? "ready" : "degraded";
}

function requestClientIdentifiers(req: IncomingMessage): string[] {
  const forwarded = typeof req.headers["x-forwarded-for"] === "string" ? req.headers["x-forwarded-for"].split(",")[0]?.trim() : "";
  const ip = forwarded || req.socket.remoteAddress || "unknown";
  const session = typeof req.headers["x-truthpass-session"] === "string" && /^[A-Za-z0-9._:-]{3,128}$/.test(req.headers["x-truthpass-session"])
    ? req.headers["x-truthpass-session"]
    : "";
  return session ? [`ip:${ip}`, `session:${session}`] : [`ip:${ip}`];
}

function consumeChatRateLimit(req: IncomingMessage): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  let retryAfterSeconds = 0;
  for (const key of requestClientIdentifiers(req)) {
    const current = chatRateLimits.get(key);
    if (!current || now - current.startedAt >= CHAT_RATE_WINDOW_MS) {
      chatRateLimits.set(key, { startedAt: now, count: 1 });
      continue;
    }
    if (current.count >= CHAT_RATE_LIMIT) {
      retryAfterSeconds = Math.max(retryAfterSeconds, Math.ceil((CHAT_RATE_WINDOW_MS - (now - current.startedAt)) / 1000));
      continue;
    }
    current.count += 1;
  }
  return { allowed: retryAfterSeconds === 0, retryAfterSeconds };
}

const agentAuditRuns = new Map<string, Record<string, unknown>>();
const mediaUploadSessions = new Map<string, {
  tenantId: string;
  rawObjectRef: string;
  expectedHash?: string;
  expiresAt: number;
  fileName: string;
  contentType: string;
  size: number;
  storageMode: "object_storage" | "presign_preview";
  storagePath?: string;
  storageBucket?: string;
  receivedAt?: string;
  receivedHash?: string;
}>();

async function persistAgentAuditRun(runId: string, tenantId: string, run: Record<string, unknown>): Promise<void> {
  if (!persistenceEnabled()) return;
  await getDatabasePool().query(`
    create table if not exists truthpass_agent_audit_runs (
      run_id text primary key,
      tenant_id text not null,
      batch_id text not null,
      trace_id text,
      run jsonb not null,
      created_at timestamptz not null default now()
    );
    create index if not exists truthpass_agent_audit_runs_tenant_idx
      on truthpass_agent_audit_runs (tenant_id, created_at desc);
  `);
  await getDatabasePool().query(
    `insert into truthpass_agent_audit_runs (run_id, tenant_id, batch_id, trace_id, run, created_at)
     values ($1, $2, $3, $4, $5, $6)
     on conflict (run_id) do nothing`,
    [runId, tenantId, String(run.batchId ?? ""), typeof run.traceId === "string" ? run.traceId : null, JSON.stringify(run), new Date(String(run.createdAt ?? new Date().toISOString()))],
  );
}

async function loadAgentAuditRun(tenantId: string, runId: string): Promise<Record<string, unknown> | undefined> {
  const memory = agentAuditRuns.get(runId);
  if (memory && memory.tenantId === tenantId) return structuredClone(memory);
  if (!persistenceEnabled()) return undefined;
  await getDatabasePool().query(`
    create table if not exists truthpass_agent_audit_runs (
      run_id text primary key,
      tenant_id text not null,
      batch_id text not null,
      trace_id text,
      run jsonb not null,
      created_at timestamptz not null default now()
    )
  `);
  const result = await getDatabasePool().query(`select run from truthpass_agent_audit_runs where tenant_id = $1 and run_id = $2`, [tenantId, runId]);
  const row = result.rows[0];
  return row?.run && typeof row.run === "object" ? structuredClone(row.run as Record<string, unknown>) : undefined;
}

async function runPublicAgentCollaboration(batchId: string, question: string, tenantId = "demo"): Promise<Record<string, unknown>> {
  const batch = repository.getBatch(batchId);
  if (!batch) {
    const rice = RICE_BATCHES[batchId];
    if (!rice) throw new Error("批次不存在: " + batchId);
    const evidence: ConsumerEvidenceSnapshot["evidence"] = [
      { evidenceId: `${batchId}:evidence:origin`, kind: "production", issuerId: "rice-merchant-demo", sourceKind: "manufacturer", status: "submitted", dataMode: "demo/synthetic", signature: "not_checked" },
      { evidenceId: `${batchId}:evidence:inspection`, kind: "inspection", issuerId: "rice-lab-demo", sourceKind: "third_party", status: "submitted", dataMode: "demo/synthetic", signature: "not_checked" },
      ...(rice.passed ? [{ evidenceId: `${batchId}:evidence:storage`, kind: "cold_chain" as const, issuerId: "rice-logistics-demo", sourceKind: "platform_device" as const, status: "submitted" as const, dataMode: "demo/synthetic" as const, signature: "not_checked" as const }] : []),
      ...(rice.passed ? [{ evidenceId: `${batchId}:evidence:shipment`, kind: "shipment" as const, issuerId: "rice-logistics-demo", sourceKind: "platform_device" as const, status: "submitted" as const, dataMode: "demo/synthetic" as const, signature: "not_checked" as const }] : []),
    ];
    const snapshot: ConsumerEvidenceSnapshot = {
      batchId,
      dataMode: "demo/synthetic",
      decision: rice.passed ? "accepted" : "not_assessed",
      decisionReasons: rice.passed ? [] : ["天气、农残或仓储运输资料仍有缺口"],
      evidence,
    };
    const card = answerConsumerQuestion(question, snapshot);
    const selectedFactIds = card.facts.map((_, index) => `F${index}`);
    const findings = [
      { code: "batch_scoped", summary: "当前资料只绑定到这个大米批次。", sourceIds: evidence.slice(0, 1).map((item) => item.evidenceId) },
      { code: rice.passed ? "scope_passed" : "evidence_gap", summary: rice.passed ? "当前演示规则范围内资料齐全。" : "当前演示批次仍有资料缺口，不能直接形成完整结论。", sourceIds: evidence.map((item) => item.evidenceId) },
    ];
    const verification = {
      schemaVersion: "truthpass.cli.verification.v1",
      status: rice.passed ? "accepted" : "missing_evidence",
      dataClass: "demo/synthetic",
      policy: { id: "rice-origin-policy", version: "v1" },
      assessment: { status: rice.passed ? "accepted" : "missing_evidence", reasons: snapshot.decisionReasons },
      reasons: snapshot.decisionReasons,
      evidence: evidence.map((item) => ({ evidenceId: item.evidenceId, kind: item.kind, sourceKind: item.sourceKind, status: item.status, dataMode: item.dataMode })),
      evidenceRoot: evidenceHash(`${batchId}:root`),
      anchor: { status: "anchor_pending", network: BOT_CHAIN_MAINNET.network, submitted: false, chainId: BOT_CHAIN_MAINNET.chainId, contractAddress: BOT_CHAIN_MAINNET.contractAddress },
    };
    const lifecycle = lifecyclePublicView(batchId);
    const reportHash = evidenceHash(JSON.stringify({ batchId, question, verification, findings }));
    const agentAudit = {
      schemaVersion: "truthpass.agent.audit.v1",
      runId: reportHash,
      verifierVersion: "deterministic-verifier-v1",
      records: [
        { role: "production", inputEvidenceIds: evidence.filter((item) => item.kind === "production").map((item) => item.evidenceId), citedEvidenceIds: findings[0].sourceIds, outputStatus: "contract_validated", writeBoundary: "read_only_analysis" },
        { role: "inspection", inputEvidenceIds: evidence.filter((item) => item.kind !== "production").map((item) => item.evidenceId), citedEvidenceIds: evidence.map((item) => item.evidenceId), outputStatus: "contract_validated", writeBoundary: "read_only_analysis" },
        { role: "consumer", inputEvidenceIds: card.evidenceIds, selectedFactIds, outputStatus: "fact_selection_validated", writeBoundary: "no_purchase_or_payment" },
      ],
      finalDecisionSource: "deterministic_verifier",
    };
    const auditRun = { ...agentAudit, tenantId, batchId, question, dataMode: "demo/synthetic", createdAt: new Date().toISOString() };
    agentAuditRuns.set(reportHash, auditRun);
    await persistAgentAuditRun(reportHash, tenantId, auditRun);
    return {
      schemaVersion: "truthpass.agent.collaboration.v1",
      batchId,
      question,
      agentMode: "deterministic_fallback",
      dataMode: "demo/synthetic",
      contextMode: lifecycle.contextMode,
      contextSource: "tenant_demo_fixture",
      contextRevision: lifecycle.contextRevision,
      syncedAt: lifecycle.syncedAt,
      verifierVersion: "deterministic-verifier-v1",
      agentAudit,
      writePlan: {
        status: rice.passed ? "pending_wallet_signature" : "blocked_by_verifier",
        action: "verification",
        eventName: "VerificationRecorded",
        requiredRole: "VERIFIER_ROLE",
        evidenceRoot: verification.evidenceRoot,
        reportHash,
        nextAction: rice.passed ? "连接审核机构钱包，准备批次摘要签名。" : "先补齐大米批次资料，再提交机构复核。",
      },
      verification,
      evidenceCard: card,
      selectedFacts: card.facts,
      analyses: {
        production: { schemaVersion: "agent.output.v1", role: "production", batchId, findings: findings.slice(0, 1) },
        inspection: { schemaVersion: "agent.output.v1", role: "inspection", batchId, findings: findings.slice(1) },
      },
    };
  }
  const inspection = await runCliInspect(repository, { ...task, batchId }, { id: policy.policyId, version: policy.version });
  const verification = inspection.verification;
  const assessment = verification.assessment;
  const decision: ConsumerEvidenceSnapshot["decision"] = verification.status === "accepted"
    ? "accepted"
    : verification.status === "missing_evidence"
      ? "not_assessed"
      : "rejected";
  const snapshot: ConsumerEvidenceSnapshot = {
    batchId,
    dataMode: verification.dataClass,
    decision,
    decisionReasons: assessment?.reasons ?? verification.reasons ?? [],
    evidence: verification.evidence.map((item) => {
      const record = repository.getEvidence(item.evidenceId);
      const signature = record?.payload.signatureValid === true ? "verified" : record?.payload.signatureValid === false ? "invalid" : "not_checked";
      return {
        evidenceId: item.evidenceId,
        kind: item.kind as ConsumerEvidenceSnapshot["evidence"][number]["kind"],
        issuerId: record?.issuerId ?? item.sourceKind,
        sourceKind: item.sourceKind as ConsumerEvidenceSnapshot["evidence"][number]["sourceKind"],
        status: item.status as ConsumerEvidenceSnapshot["evidence"][number]["status"],
        dataMode: item.dataMode,
        signature,
      };
    }),
  };
  const card = answerConsumerQuestion(question, snapshot);
  const lifecycle = lifecyclePublicView(batchId);
  const context = buildJevContext(repository, batchId);
  const productionInput = { schemaVersion: "agent.input.v1" as const, role: "production" as const, view: buildJevRoleView(context, "production") };
  const inspectionInput = {
    schemaVersion: "agent.input.v1" as const,
    role: "inspection" as const,
    view: buildJevRoleView(context, "inspection"),
    policy: getPolicySnapshot(policy.policyId, policy.version),
  };
  let effectiveMode = agentMode();
  let collaboration: Awaited<ReturnType<typeof runAgentCollaboration>>;
  try {
    const invoker = effectiveMode === "model_assisted" ? invokeAgent : createDeterministicAgentInvoker();
    collaboration = await runAgentCollaboration(productionInput, inspectionInput, question, card, invoker);
  } catch (error) {
    if (effectiveMode !== "model_assisted") throw error;
    effectiveMode = "deterministic_fallback";
    collaboration = await runAgentCollaboration(productionInput, inspectionInput, question, card, createDeterministicAgentInvoker());
  }
  const reportHash = evidenceHash(JSON.stringify({ batchId, question, verification, production: collaboration.production, inspection: collaboration.inspection }));
  const writePlan = verification.status === "accepted"
    ? {
        status: "pending_wallet_signature",
        action: "verification",
        eventName: "VerificationRecorded",
        requiredRole: "VERIFIER_ROLE",
        evidenceRoot: verification.evidenceRoot,
        reportHash,
        nextAction: "连接检测机构或监管审核钱包，调用 /api/wallet/prepare 后签名并回读 receipt。",
      }
    : {
        status: "blocked_by_verifier",
        action: "verification",
        eventName: "VerificationRecorded",
        requiredRole: "VERIFIER_ROLE",
        evidenceRoot: verification.evidenceRoot,
        reportHash,
        nextAction: "先补充缺失或冲突证据，确定性验证通过后才能生成可上链核验计划。",
      };
  const agentAudit = {
    schemaVersion: "truthpass.agent.audit.v1",
    runId: reportHash,
    verifierVersion: assessment ? "deterministic-verifier-v1" : null,
    records: [
      {
        role: "production",
        inputEvidenceIds: productionInput.view.context.evidence.map((item) => item.evidenceId),
        citedEvidenceIds: collaboration.production.findings.flatMap((finding) => finding.sourceIds),
        outputStatus: "contract_validated",
        writeBoundary: "read_only_analysis",
      },
      {
        role: "inspection",
        inputEvidenceIds: inspectionInput.view.context.evidence.map((item) => item.evidenceId),
        citedEvidenceIds: collaboration.inspection.findings.flatMap((finding) => finding.sourceIds),
        outputStatus: "contract_validated",
        writeBoundary: "read_only_analysis",
      },
      {
        role: "consumer",
        inputEvidenceIds: card.evidenceIds,
        selectedFactIds: collaboration.consumer.selectedFactIds,
        outputStatus: "fact_selection_validated",
        writeBoundary: "no_purchase_or_payment",
      },
    ],
    finalDecisionSource: "deterministic_verifier",
  };
  const auditRun = { ...agentAudit, tenantId, batchId, question, dataMode: verification.dataClass, createdAt: new Date().toISOString() };
  agentAuditRuns.set(reportHash, auditRun);
  await persistAgentAuditRun(reportHash, tenantId, auditRun);
  return {
    schemaVersion: "truthpass.agent.collaboration.v1",
    batchId,
    question,
    agentMode: effectiveMode,
    dataMode: verification.dataClass,
    contextMode: lifecycle.contextMode,
    contextSource: lifecycle.contextSource,
    contextRevision: lifecycle.contextRevision,
    syncedAt: lifecycle.syncedAt,
    verifierVersion: assessment ? "deterministic-verifier-v1" : null,
    agentAudit,
    writePlan,
    verification,
    evidenceCard: card,
    selectedFacts: renderConsumerFacts(card, collaboration.consumer.selectedFactIds),
    analyses: { production: collaboration.production, inspection: collaboration.inspection },
  };
}

async function mcpInspectBatch(batchId: string, traceId: string) {
  const fixture = demoBatchFor(batchId);
  if (fixture) {
    const gate = demoVerificationGate(batchId, fixture);
    const status = gate.status;
    const reasons = gate.reasons.length > 0
      ? gate.reasons
      : fixture.passed
        ? []
        : isRiceBatch(batchId)
          ? ["演示批次仍有产地、检测或运输资料缺口，需人工复核"]
          : [demoParameterDetail(fixture)];
    const fixturePolicy = isRiceBatch(batchId) ? { id: "rice-origin-policy", version: "v1" } : { id: policy.policyId, version: "v1" };
    const fixtureEvidence = evidenceFor(batchId).map((item) => ({
      evidenceId: item.evidenceId ?? `${batchId}:evidence:${item.step}`,
      kind: item.title,
      sourceKind: item.source,
      status: "registered",
      dataMode: "demo/synthetic" as const,
    }));
    return {
    schemaVersion: "truthpass.cli.inspect.v1",
    command: "inspect",
    batchId,
    traceId,
    dataMode: "demo/synthetic",
    stages: [
      { name: "读取演示批次", status: "completed", detail: "已加载 demo/synthetic 批次数据" },
      { name: "确定性验收", status: "completed", detail: status },
      { name: "链上锚定计划", status: "pending", detail: "dry-run：未广播交易，需外部签名" },
    ],
    verification: {
      schemaVersion: "truthpass.cli.verification.v1",
      command: "verify",
      batchId,
      status,
      dataClass: "demo/synthetic",
       policy: fixturePolicy,
      assessment: { status, reasons, epaDhaPercent: fixture.epaDha, peroxideValue: fixture.peroxide, coldChainGapHours: fixture.coldGap },
      reasons,
      // Keep fixture inspection useful to external MCP/Codex callers. These
      // are public demo references only; they are still explicitly scoped to
      // this batch and never imply a signed or live production record.
      evidence: fixtureEvidence,
      evidenceRoot: evidenceHash(`${batchId}:root`),
      anchor: { status: "anchor_pending", network: BOT_CHAIN_MAINNET.network, submitted: false, chainId: BOT_CHAIN_MAINNET.chainId, contractAddress: BOT_CHAIN_MAINNET.contractAddress },
    },
    };
  }
  if (repository.getBatch(batchId)) {
    const result = await runCliInspect(repository, { ...task, batchId }, { id: policy.policyId, version: policy.version });
    return { ...result, traceId, dataMode: result.verification.dataClass };
  }
  throw new Error("BATCH_NOT_FOUND");
}

type AgentSearchHit = {
  hitId: string;
  title: string;
  snippet: string;
  sourceType: "batch" | "parameter" | "production" | "lifecycle" | "chain";
  evidenceIds: string[];
  dataMode: "demo/synthetic" | "external";
  tenantId: string;
  productId: string;
  batchId: string;
  stage?: string;
};

function searchBatchKnowledge(batchId: string, query = ""): AgentSearchHit[] {
  const batch = demoBatchFor(batchId);
  if (!batch) throw new Error("BATCH_NOT_FOUND");
  const tenantId = isRiceBatch(batchId) ? "tenant-rice-demo" : "tenant-fish-oil-demo";
  const productId = isRiceBatch(batchId) ? "rice-wuchang" : "fish-oil-concentrate";
  const evidenceIds = evidenceFor(batchId).map((item) => item.evidenceId).filter((item): item is string => typeof item === "string");
  const parameters = parameterDetailsFor(batchId);
  const production = productionProcessFor(batchId);
  const lifecycle = lifecyclePublicView(batchId);
  const records: AgentSearchHit[] = [
    {
      hitId: `${batchId}:batch`,
      title: `${batch.name} · ${batchId}`,
      snippet: `批次 ${batchId}，数据模式 demo/synthetic；来源为当前登记批次资料。`,
      sourceType: "batch",
      evidenceIds,
      dataMode: "demo/synthetic",
      tenantId,
      productId,
      batchId,
    },
    ...parameters.map((item, index) => ({
      hitId: `${batchId}:parameter:${index}`,
      title: item.label,
      snippet: `${item.label}：${item.observed ?? "未登记"}${item.unit ? ` ${item.unit}` : ""}；状态：${item.status}；规则：${item.rule ?? "确定性规则"}。`,
      sourceType: "parameter" as const,
      evidenceIds,
      dataMode: "demo/synthetic" as const,
      tenantId,
      productId,
      batchId,
    })),
    ...production.stages.map((item, index) => ({
      hitId: `${batchId}:production:${index}`,
      title: item.label,
      snippet: `生产阶段“${item.label}”：${item.status}。`,
      sourceType: "production" as const,
      evidenceIds,
      dataMode: "demo/synthetic" as const,
      tenantId,
      productId,
      batchId,
      stage: item.stage,
    })),
    ...lifecycle.events.map((item) => ({
      hitId: `${batchId}:lifecycle:${item.stage}`,
      title: item.label,
      snippet: `${item.label}：${item.status}；${item.detail}`,
      sourceType: "lifecycle" as const,
      evidenceIds,
      dataMode: "demo/synthetic" as const,
      tenantId,
      productId,
      batchId,
      stage: item.stage,
    })),
  ];
  const normalized = query.trim().toLowerCase();
  const tokens = [...new Set([
    ...(normalized.match(/[a-z0-9_+-]+/gi) ?? []),
    ...(normalized.match(/[\\u4e00-\\u9fff]{2}/g) ?? []),
  ])];
  const ranked = records.map((record, index) => {
    const haystack = (record.title + " " + record.snippet + " " + (record.stage ?? "")).toLowerCase();
    const score = tokens.length ? tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0) : 0;
    return { record, score, index };
  }).sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = (tokens.length && ranked.some((item) => item.score > 0))
    ? ranked.filter((item) => item.score > 0).slice(0, 12)
    : ranked.slice(0, 12);
  return selected.map((item) => item.record);
}

async function runUnifiedAgentQuery(batchId: string, question: string, traceId: string, locale: "zh" | "en" = "zh") {
  const batch = demoBatchFor(batchId);
  if (!batch) throw new Error("BATCH_NOT_FOUND");
  const retrieval = searchBatchKnowledge(batchId, question);
  const chainContext = isChainStatusQuestion(question) ? await buildChainQueryContext(batchId) : undefined;
  const reply = await demoConsumerChat(batchId, batch, question, chainContext, locale, retrieval);
  const lifecycle = lifecyclePublicView(batchId);
  const status = reply.status ?? "deterministic_fallback";
  const modelCompletedStatus = reply.runtimeStatus
    ?? (status === "model_assisted" ? "completed" : reply.providerIssue ?? "fallback");
  return {
    schemaVersion: "truthpass.agent.query.v1",
    traceId,
    batchId,
    tenantId: retrieval[0]?.tenantId ?? (isRiceBatch(batchId) ? "tenant-rice-demo" : "tenant-fish-oil-demo"),
    productId: retrieval[0]?.productId ?? (isRiceBatch(batchId) ? "rice-wuchang" : "fish-oil-concentrate"),
    dataMode: reply.dataMode ?? "demo/synthetic",
    stages: [
      { stage: "reading_batch", status: "completed", hitCount: retrieval.length },
      { stage: "retrieval_completed", status: "completed", hitCount: retrieval.length },
      { stage: "verifier_checked", status: reply.verifierStatus ?? "checked", reasons: reply.verifierReasons ?? [] },
      { stage: "jev_routed", status: reply.jev?.decision.decision ?? (reply.verifierStatus === "accepted" ? "route_to_rule_verifier" : "request_more_evidence"), source: reply.jev?.provider ?? "deterministic", model: reply.jev?.model ?? "deterministic-fallback", live: reply.jev?.live === true },
      { stage: "model_completed", status: modelCompletedStatus, providerIssue: reply.providerIssue ?? null, providerResponseStatus: reply.providerResponseStatus ?? null },
    ],
    retrieval: { query: question, hits: retrieval },
    answer: reply.lines.map((line) => line.text).join(" "),
    citations: reply.safety?.citations ?? [],
    evidenceIds: reply.evidenceIds ?? retrieval.flatMap((item) => item.evidenceIds),
    model: {
      status,
      provider: reply.providerUsed ?? "deterministic",
      model: reply.modelUsed ?? "deterministic-fallback",
      runtimeStatus: modelCompletedStatus,
      providerIssue: reply.providerIssue ?? null,
      providerResponseStatus: reply.providerResponseStatus ?? null,
    },
    modelAssisted: status === "model_assisted",
    validationStatus: reply.safety?.status ?? (status === "model_assisted" ? "accepted" : "fallback"),
    validationReasons: reply.safety?.reasons ?? [],
    providerIssue: reply.providerIssue ?? null,
    providerResponseStatus: reply.providerResponseStatus ?? null,
    runtimeStatus: modelCompletedStatus,
    pipelineDetail: {
      verifier: { status: reply.verifierStatus ?? "checked", reasons: reply.verifierReasons ?? [] },
      jev: {
        decision: reply.jev?.decision.decision ?? (reply.verifierStatus === "accepted" ? "route_to_rule_verifier" : "request_more_evidence"),
        confidence: reply.jev?.decision.confidence ?? 0.94,
        status: reply.jev?.live ? "live" : "fallback",
        provider: reply.jev?.provider ?? "deterministic",
        model: reply.jev?.model ?? "deterministic-fallback",
        nextAction: reply.jev?.decision.nextAction,
        missingEvidenceCodes: reply.jev?.decision.missingEvidenceCodes ?? [],
        conflictCodes: reply.jev?.decision.conflictCodes ?? [],
      },
      deepseek: { status: status === "model_assisted" ? "completed" : "fallback" },
    },
    lifecycle: { revision: lifecycle.contextRevision, syncedAt: lifecycle.syncedAt, nextAction: lifecycle.nextAction },
    chainContext: chainContext ?? null,
    writeBoundary: { walletRequired: true, submitted: false, nextAction: "如需购买、反馈或上链，请调用 prepare 命令并由外部钱包确认。" },
  };
}

const mcpHttpHandler = createTruthPassMcpHttpHandler({
  origin: () => "*",
  defaultBatchId: BATCH_ID,
  knownBatch: (batchId) => Boolean(demoBatchFor(batchId) || repository.getBatch(batchId)),
  manifest: (origin) => ({
    schemaVersion: "truthpass.agent.manifest.v1",
    service: "truthpass-integrated-api",
    protocol: "MCP_JSON_RPC",
    origin,
    dataMode: "demo/synthetic",
    readOnly: true,
    capabilities: ["truthpass.manifest", "truthpass.inspect_batch", "truthpass.explain_batch", "truthpass.lifecycle", "truthpass.search", "truthpass.ask"],
    writeBoundary: "protected_tools_return_pending_confirmation",
  }),
  inspectBatch: mcpInspectBatch,
  explainBatch: async (batchId, question, traceId) => {
    const result = await mcpInspectBatch(batchId, traceId);
    const verification = result.verification;
    const reasons = verification.assessment?.reasons ?? verification.reasons ?? [];
    const accepted = verification.status === "accepted";
    return {
      schemaVersion: "truthpass.mcp.explanation.v1",
      batchId,
      question: question ?? "当前批次为什么是这个结论？",
      status: verification.status,
      explanation: accepted ? "当前批次通过确定性规则验收；链上写入仍需外部钱包确认。" : "当前批次未形成可接受的确定性结论，请先查看原因并补充证据。",
      reasons,
      nextAction: accepted ? "如需上链，请请求用户确认并使用外部钱包签名。" : "补充缺失或冲突证据后重新检查。",
      verification,
      dataMode: verification.dataClass,
      traceId,
    };
  },
  lifecycle: async (batchId, traceId) => ({ ...lifecyclePublicView(batchId), traceId }),
  searchBatch: async (batchId, query, traceId) => ({ schemaVersion: "truthpass.mcp.search.v1", traceId, batchId, dataMode: "demo/synthetic", hits: searchBatchKnowledge(batchId, query) }),
  askBatch: async (batchId, question, traceId) => runUnifiedAgentQuery(batchId, question, traceId),
  protectedAuthorized: (request) => agentGatewayAuthorized(request).authorized,
});

// ---------- 路由 ----------
async function feedbackSummaryFor(batchId: string) {
  const memory = consumers.listFeedback(batchId);
  let rows: Array<{ feedback_id?: string; rating: number; categories?: string[]; data_mode?: string; created_at?: string }> = [];
  if (persistenceEnabled()) {
    try {
      const result = await getDatabasePool().query(
        "select feedback_id, rating, categories, data_mode, created_at from consumer_feedbacks where batch_id = $1 order by created_at desc limit 500",
        [batchId],
      );
      rows = result.rows as Array<{ feedback_id?: string; rating: number; categories?: string[]; data_mode?: string; created_at?: string }>;
    } catch (error) {
      console.error("反馈汇总读取失败:", error instanceof Error ? error.message : String(error));
    }
  }
  const records = new Map<string, { rating: number; categories: string[]; dataMode: "demo/synthetic" | "external"; createdAt?: string }>();
  for (const item of memory) {
    records.set(item.feedbackId, { rating: item.rating, categories: item.categories, dataMode: item.dataMode ?? "demo/synthetic", createdAt: item.createdAt });
  }
  for (const item of rows) {
    const id = item.feedback_id ?? `db:${item.created_at ?? ""}:${item.rating}:${JSON.stringify(item.categories ?? [])}`;
    records.set(id, {
      rating: Number(item.rating),
      categories: Array.isArray(item.categories) ? item.categories.map(String) : [],
      dataMode: item.data_mode === "demo/synthetic" ? "demo/synthetic" : "external",
      createdAt: item.created_at,
    });
  }
  const entries = [...records.values()].filter((item) => Number.isFinite(item.rating));
  const ratings = entries.map((item) => item.rating);
  const categoryCounts: Record<string, number> = {};
  for (const item of entries) for (const category of item.categories) categoryCounts[category] = (categoryCounts[category] ?? 0) + 1;
  const modes = new Set(entries.map((item) => item.dataMode));
  const sampleMode = modes.size > 1 ? "mixed" : (modes.values().next().value ?? "demo/synthetic");
  const lastUpdated = entries.map((item) => item.createdAt).filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
  return {
    count: ratings.length,
    averageRating: ratings.length ? Number((ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toFixed(2)) : null,
    categoryCounts,
    returnRate: null,
    deliveryIssueRate: null,
    lastUpdated,
    sampleMode,
    dataMode: modes.has("external") ? "external" : "demo/synthetic",
    verifiedPurchaseOnly: true,
    note: ratings.length ? "仅统计已绑定购买记录的反馈；退货和物流异常需接入专门事件字段后计算。" : "当前没有已核验购买反馈。",
  };
}

type ProductionImprovementReport = {
  schemaVersion: "truthpass.production.improvement-report.v1";
  reportId: string;
  tenantId: string;
  batchId: string;
  readOnly: true;
  dataMode: "demo/synthetic" | "external";
  generatedAt: string;
  findings: Array<{ id: string; severity: "medium"; reason: string; status: "open" }>;
  recommendations: string[];
  evidenceRoot: string;
  feedbackSummary: Record<string, unknown>;
  persisted: boolean;
  disclaimer: string;
};

async function buildProductionImprovementReport(tenantId: string, batchId: string): Promise<ProductionImprovementReport> {
  const inspection = await mcpInspectBatch(batchId, requestTraceId({ headers: {} } as IncomingMessage));
  const unresolved = inspection.verification.status !== "accepted" ? inspection.verification.reasons : [];
  const generatedAt = new Date().toISOString();
  const reportId = `improvement-${sha256Hex32(`${tenantId}:${batchId}:${inspection.verification.evidenceRoot}`).slice(0, 24)}`;
  return {
    schemaVersion: "truthpass.production.improvement-report.v1",
    reportId,
    tenantId,
    batchId,
    readOnly: true,
    dataMode: inspection.verification.dataClass === "external" ? "external" : "demo/synthetic",
    generatedAt,
    findings: unresolved.map((reason, index) => ({ id: `${reportId}-finding-${index + 1}`, severity: "medium" as const, reason, status: "open" as const })),
    recommendations: unresolved.length
      ? ["补齐缺失证据并重新运行确定性验收", "由授权生产或检测方提交可核验原始记录"]
      : ["保持当前采集频率并持续回读链上 receipt"],
    evidenceRoot: inspection.verification.evidenceRoot,
    feedbackSummary: await feedbackSummaryFor(batchId),
    persisted: false,
    disclaimer: "该报告是只读改进建议，不改变验收结论、不代表生产已完成整改。",
  };
}

async function persistProductionImprovementReport(report: ProductionImprovementReport): Promise<void> {
  if (!persistenceEnabled()) return;
  await getDatabasePool().query(`
    create table if not exists truthpass_production_improvement_reports (
      report_id text primary key,
      tenant_id text not null,
      batch_id text not null,
      data_mode text not null,
      evidence_root text,
      findings jsonb not null default '[]'::jsonb,
      recommendations jsonb not null default '[]'::jsonb,
      feedback_summary jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
    alter table truthpass_production_improvement_reports add column if not exists tenant_id text;
    alter table truthpass_production_improvement_reports add column if not exists feedback_summary jsonb not null default '{}'::jsonb;
    create index if not exists truthpass_improvement_reports_tenant_idx on truthpass_production_improvement_reports(tenant_id, created_at desc);
  `);
  await getDatabasePool().query(
    `insert into truthpass_production_improvement_reports
      (report_id, tenant_id, batch_id, data_mode, evidence_root, findings, recommendations, feedback_summary)
     values ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8::jsonb)
     on conflict (report_id) do update set
       tenant_id = excluded.tenant_id,
       batch_id = excluded.batch_id,
       data_mode = excluded.data_mode,
       evidence_root = excluded.evidence_root,
       findings = excluded.findings,
       recommendations = excluded.recommendations,
       feedback_summary = excluded.feedback_summary`,
    [report.reportId, report.tenantId, report.batchId, report.dataMode, report.evidenceRoot, JSON.stringify(report.findings), JSON.stringify(report.recommendations), JSON.stringify(report.feedbackSummary)],
  );
}

type FeedbackDraft = {
  prepareId: string;
  batchId: string;
  purchaseId: string;
  purchaseTxHash: string;
  walletAddress?: string;
  rating: number;
  categories: string[];
  comment: string;
  feedbackHash: string;
  dataMode: "demo/synthetic" | "external";
  createdAt: string;
  expiresAt: string;
  consumed: boolean;
};

// A draft is deliberately not a feedback record. It only carries the exact
// payload that the user will confirm after the purchase receipt (and, in
// production, the contribution receipt) has been read back by the server.
const pendingFeedbackDrafts = new Map<string, FeedbackDraft>();
const FEEDBACK_CATEGORIES = ["包装完好", "无明显腥味", "批次可查", "口感不错", "日期新鲜", "物流快速", "保存方便"] as const;

async function feedbackDraftForRequest(prepareId: string): Promise<FeedbackDraft | undefined> {
  const local = pendingFeedbackDrafts.get(prepareId);
  if (local) return local;
  if (!persistenceEnabled()) return undefined;
  const persisted = await loadPersistedFeedbackDraft(prepareId);
  if (!persisted) return undefined;
  const draft = persisted satisfies FeedbackDraft;
  pendingFeedbackDrafts.set(prepareId, draft);
  return draft;
}

function feedbackProductionMode(): boolean {
  return process.env.TRUTHPASS_FEEDBACK_MODE === "production"
    || process.env.TRUTHPASS_PRODUCTION_MODE === "true"
    || process.env.NODE_ENV === "production";
}

function normalizedFeedbackTxHash(body: Record<string, unknown>): string {
  const value = typeof body.purchaseTxHash === "string"
    ? body.purchaseTxHash.trim()
    : typeof body.txHash === "string" ? body.txHash.trim() : "";
  return value;
}

async function receiptIndexForVerification(): Promise<SessionChainTransaction[]> {
  if (!persistenceEnabled()) return sessionChainTxs;
  try {
    const persisted = await loadPersistedChainTransactions();
    for (const item of persisted) {
      if (!sessionChainTxs.some((current) => current.txHash.toLowerCase() === item.txHash.toLowerCase())) {
        sessionChainTxs.push(item as SessionChainTransaction);
      }
    }
  } catch {
    // A missing durable index must fail closed. The in-memory index may still
    // contain a receipt verified by this instance, but it cannot be used to
    // manufacture a success after a persistence outage.
    return [];
  }
  return sessionChainTxs;
}

async function verifiedPurchaseReceipt(purchaseId: string, purchaseTxHash: string, batchId: string, walletAddress?: string): Promise<SessionChainTransaction | undefined> {
  const normalizedWallet = walletAddress?.trim().toLowerCase();
  const receipts = await receiptIndexForVerification();
  return receipts.find((item) => {
    const action = item.action === "recordPurchase" ? "purchase" : item.action;
    if (action !== "purchase" || item.batchId !== batchId) return false;
    if (!/^(PurchaseRecorded|ConsumerPurchaseSubmitted)$/i.test(item.event)) return false;
    if (item.txHash.toLowerCase() !== purchaseTxHash.toLowerCase()) return false;
    if (item.receiptStatus !== "0x1" && item.receiptStatus !== "1") return false;
    if (item.eventVerified !== true) return false;
    if (!item.ids?.purchaseId || item.ids.purchaseId.toLowerCase() !== purchaseId.toLowerCase()) return false;
    if (normalizedWallet && item.wallet.toLowerCase() !== normalizedWallet) return false;
    return true;
  });
}

async function verifiedContributionReceipt(contributionTxHash: string, contributionId: string | undefined, purchaseId: string, batchId: string): Promise<SessionChainTransaction | undefined> {
  const receipts = await receiptIndexForVerification();
  return receipts.find((item) => {
    const action = item.action === "recordContribution" ? "contribution" : item.action;
    if (action !== "contribution" || item.batchId !== batchId) return false;
    if (!/^(ContributionRecorded|ConsumerContributionSubmitted)$/i.test(item.event)) return false;
    if (item.txHash.toLowerCase() !== contributionTxHash.toLowerCase()) return false;
    if (item.receiptStatus !== "0x1" && item.receiptStatus !== "1") return false;
    if (item.eventVerified !== true) return false;
    if (!item.ids?.purchaseId || item.ids.purchaseId.toLowerCase() !== purchaseId.toLowerCase()) return false;
    if (contributionId && item.ids?.contributionId && item.ids.contributionId.toLowerCase() !== contributionId.toLowerCase()) return false;
    return true;
  });
}

function validateFeedbackFields(body: Record<string, unknown>): { batchId: string; purchaseId: string; purchaseTxHash: string; walletAddress?: string; rating: number; categories: string[]; comment: string; dataMode: "demo/synthetic" | "external" } | { error: string; status: number } {
  const batchId = typeof body.batchId === "string" ? body.batchId.trim().toUpperCase() : "";
  const purchaseId = typeof body.purchaseId === "string" ? body.purchaseId.trim() : "";
  const purchaseTxHash = normalizedFeedbackTxHash(body);
  const walletAddressRaw = typeof body.walletAddress === "string" ? body.walletAddress.trim() : typeof body.wallet === "string" ? body.wallet.trim() : "";
  const walletAddress = walletAddressRaw ? walletAddressRaw.toLowerCase() : undefined;
  const rating = body.rating;
  const categories = Array.isArray(body.categories) ? body.categories.filter((value): value is string => typeof value === "string") : [];
  const comment = typeof body.comment === "string" ? body.comment.trim() : "";
  const requestedDemo = body.dataMode === "demo/synthetic" || body.demoMode === true;
  const production = feedbackProductionMode();
  if (production && requestedDemo) return { error: "生产模式禁止提交 demo/synthetic 反馈", status: 403 };
  const dataMode = requestedDemo ? "demo/synthetic" : "external";
  if (!batchId || (!demoBatchFor(batchId) && !repository.getBatch(batchId))) return { error: "批次不存在或没有登记记录", status: 404 };
  if (!/^0x[0-9a-fA-F]{64}$/.test(purchaseId)) return { error: "purchaseId 必须是 32 字节标识", status: 400 };
  if (!/^0x[0-9a-fA-F]{64}$/.test(purchaseTxHash)) return { error: "必须提供购买交易 txHash", status: 400 };
  if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) return { error: "评分必须是 1 到 5 的整数", status: 400 };
  if (!categories.length || categories.length > FEEDBACK_CATEGORIES.length || categories.some((category) => !FEEDBACK_CATEGORIES.includes(category as typeof FEEDBACK_CATEGORIES[number])) || new Set(categories).size !== categories.length) return { error: "反馈标签无效", status: 400 };
  if (comment.length > 1000) return { error: "补充反馈最多 1000 字符", status: 400 };
  return { batchId, purchaseId, purchaseTxHash, walletAddress, rating, categories, comment, dataMode };
}

export async function handleApi(url: URL, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const p = url.pathname;
  // Ensure the first request observes persisted lifecycle revisions after a
  // process restart.  This promise is already resolved in memory-demo mode.
  await lifecycleHydration;
  await chainTxHydration;

  // Configuration driven tenant sites. This in-memory adapter keeps the
  // preview and publish contract usable before the Supabase tenant tables are
  // enabled; production persistence can replace this store without changing
  // the public API.
  const siteMatch = p.match(/^\/api\/sites\/([^/]+)(?:\/([^/]+))?$/);
  if (p === "/api/sites" && req.method === "POST") {
    try {
      const input = await readBody(req);
      const slug = String(input.slug ?? "").trim().toLowerCase().replace(/[^a-z0-9-]/g, "-");
      if (!slug) { sendJson(res, 422, { error: "site_slug_required" }); return true; }
      if (siteStore.has(slug)) { sendJson(res, 409, { error: "site_already_exists", slug }); return true; }
      const config = { ...input, slug, tenantId: String(input.tenantId ?? `tenant-${slug}`), siteStatus: "draft", templateVersion: "truthpass-site-v1" } as Record<string, unknown>;
      const revision: ServerSiteRevision = { revisionId: `${slug}-r1`, status: "draft", createdAt: new Date().toISOString(), config };
      siteStore.set(slug, { config, revisions: [revision] });
      sendJson(res, 201, { schemaVersion: "truthpass.site.v1", config, revision });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : "invalid_site_payload" });
    }
    return true;
  }
  if (siteMatch) {
    const slug = decodeURIComponent(siteMatch[1]);
    const action = siteMatch[2];
    const record = siteStore.get(slug);
    if (!record) { sendJson(res, 404, { error: "site_not_found", slug }); return true; }
    if (!action && req.method === "GET") {
      sendJson(res, 200, { schemaVersion: "truthpass.site.v1", config: record.config, revision: record.revisions[record.revisions.length - 1] });
      return true;
    }
    if (action === "revisions" && req.method === "GET") {
      sendJson(res, 200, { schemaVersion: "truthpass.site.revisions.v1", slug, revisions: record.revisions });
      return true;
    }
    if (action === "preview" && req.method === "POST") {
      const input = await readBody(req);
      const revision: ServerSiteRevision = { revisionId: `${slug}-preview-${Date.now()}`, status: "preview", createdAt: new Date().toISOString(), config: { ...record.config, ...input, siteStatus: "preview" } };
      record.revisions.push(revision);
      sendJson(res, 200, { schemaVersion: "truthpass.site.preview.v1", preview: revision });
      return true;
    }
    if (action === "publish" && req.method === "POST") {
      const current = record.revisions[record.revisions.length - 1];
      if (!current || (current.status !== "preview" && current.status !== "draft")) {
        sendJson(res, 409, { error: "site_revision_not_ready", slug }); return true;
      }
      const revision: ServerSiteRevision = { ...current, revisionId: `${slug}-published-${Date.now()}`, status: "published", createdAt: new Date().toISOString(), config: { ...current.config, siteStatus: "published" } };
      record.config = revision.config;
      record.revisions.push(revision);
      sendJson(res, 200, { schemaVersion: "truthpass.site.publish.v1", config: record.config, revision });
      return true;
    }
    if (action === "rollback" && req.method === "POST") {
      const input = await readBody(req);
      const target = record.revisions.find((item) => item.revisionId === String(input.revisionId ?? ""));
      if (!target) { sendJson(res, 404, { error: "revision_not_found", slug }); return true; }
      const revision: ServerSiteRevision = { ...target, revisionId: `${slug}-rollback-${Date.now()}`, status: "published", createdAt: new Date().toISOString(), config: { ...target.config, siteStatus: "published" } };
      record.config = revision.config;
      record.revisions.push(revision);
      sendJson(res, 200, { schemaVersion: "truthpass.site.rollback.v1", config: record.config, revision });
      return true;
    }
  }

  if (p === "/mcp" || p === "/api/mcp") {
    await mcpHttpHandler(req, res);
    return true;
  }

  // Keep the local integrated API and the Vercel BFF on the same Agent
  // registration contract. The registration handler persists to Postgres
  // when configured and falls back to the explicit local demo registry.
  if (p === "/api/agent/register") {
    return handleAgentRegistration(req, res);
  }

  if (p === "/api/health" && req.method === "GET") {
    sendJson(res, 200, {
      status: "ok",
      service: "truthpass-integrated-api",
      version: "1.4.0",
      batchId: BATCH_ID,
      chainId: BOT_CHAIN_MAINNET.chainId,
      customerServiceStatus: customerServiceStatus(),
      customerAgentMode: agentMode(),
      dataClass: "demo/synthetic",
    });
    return true;
  }

  if (p === "/api/agent/status" && req.method === "GET") {
    const configuredProvider = resolveAgentProvider();
    const jevProviderConfig = providerFromEnv();
    sendJson(res, 200, {
      schemaVersion: "truthpass.agent.status.v1",
      status: customerServiceStatus(),
      agentMode: agentMode(),
      providerConfigured: configuredProvider.configured,
      // provider/model describe the last successful model call when this
      // runtime has one; otherwise they describe the configured candidate.
      // configuredProvider/configuredModel make that distinction explicit.
      provider: publicCustomerProvider(),
      model: publicCustomerModel(),
      configuredProvider: configuredProvider.configured ? configuredProvider.provider : "deterministic",
      configuredModel: configuredProvider.model,
      providerSource: configuredProvider.source,
      jevProviderConfigured: jevProviderConfig.enabled,
      jevProvider: jevProviderConfig.source,
      jevModel: jevProviderConfig.source === "deepseek" ? (process.env.DEEPSEEK_MODEL ?? "deepseek-chat") : jevProviderConfig.source === "jev" ? (process.env.JEV_MODEL ?? "jev") : null,
      jevFallbackReason: jevProviderConfig.reason ?? null,
      lastSuccessfulProvider: lastCustomerModelRuntime?.status === "completed" ? lastCustomerModelRuntime.provider : null,
      lastSuccessfulModel: lastCustomerModelRuntime?.status === "completed" ? lastCustomerModelRuntime.model : null,
      lastModelRuntimeStatus: lastCustomerModelRuntime?.status ?? null,
      lastProviderResponseStatus: lastCustomerModelRuntime?.responseStatus ?? null,
      lastProviderIssue: lastCustomerModelRuntime?.providerIssue ?? null,
      configured: configuredProvider.configured,
      lastRequestVerified: lastCustomerModelRuntime?.status === "completed",
      lastRequestFallback: Boolean(lastCustomerModelRuntime && lastCustomerModelRuntime.status !== "completed"),
      runtimeStatus: lastCustomerModelRuntime?.status ?? "runtime_unknown",
      dataMode: "demo/synthetic",
      fallbackAvailable: true,
      chatEndpoint: "/api/agent/chat",
      queryEndpoint: "/api/agent/query",
      queryStreamEndpoint: "/api/agent/query/stream",
      searchEndpoint: "/api/agent/search",
      ...(url.searchParams.get("diagnostics") === "true" ? { providerDiagnostic: lastCustomerModelDiagnostic } : {}),
    });
    return true;
  }

  if (p === "/api/agent/manifest" && req.method === "GET") {
    const origin = `${url.protocol}//${url.host}`;
    sendJson(res, 200, {
      schemaVersion: "truthpass.agent.manifest.v1",
      service: "truthpass",
      name: "TruthPass Consumer Agent Gateway",
      version: "1.4.0",
      status: customerServiceStatus(),
      agentMode: agentMode(),
      authMode: process.env.TRUTHPASS_AGENT_GATEWAY_TOKEN ? "bearer_token" : "unconfigured_demo",
      registrationAuthMode: process.env.TRUTHPASS_AGENT_REGISTRATION_TOKEN ? "bearer_token" : "unconfigured_demo",
      dataClass: "demo/synthetic",
      publicUrl: origin,
      capabilities: ["agent.mcp", "agent.collaborate", "agent.report", "agent.register", "consumer.inspect", "cli.inspect", "cli.explain", "lifecycle.read", "lifecycle.simulate", "chain.status", "wallet.prepare", "wallet.broadcast", "wallet.bind", "evidence.anchor", "verification.record", "audit.finding", "audit.approval", "audit.resolve", "consumer.purchase", "consumer.contribution", "consumer.dispute", "public.standard.read", "public.policy.read", "consumer.credential.issue", "consumer.feedback.submit", "consumer.feedback.prepare", "consumer.feedback.confirm", "agent.search", "agent.query", "agent.query.stream", "consumer.payment.quote", "consumer.payment.alipay", "consumer.payment.paypal"],
      endpoints: {
        sites: `${origin}/api/sites`,
        site: `${origin}/api/sites/{slug}`,
        sitePreview: `${origin}/api/sites/{slug}/preview`,
        sitePublish: `${origin}/api/sites/{slug}/publish`,
        siteRollback: `${origin}/api/sites/{slug}/rollback`,
        inspection: `${origin}/api/cli/inspect?batchId={batchId}`,
        explanation: `${origin}/api/cli/explain?batchId={batchId}`,
        jevDetection: `${origin}/api/jev/detection?batchId={batchId}`,
        chainStatus: `${origin}/api/chain/status`,
        walletPrepare: `${origin}/api/wallet/prepare`,
        health: `${origin}/api/health`,
        status: `${origin}/api/agent/status`,
        collaboration: `${origin}/api/agent/v1/collaborate`,
        lifecycle: `${origin}/api/products/{batchId}/lifecycle`,
        lifecycleSimulation: `${origin}/api/simulator/lifecycle`,
        recommendation: `${origin}/api/recommendation?batchId={batchId}`,
        registration: `${origin}/api/agent/register`,
        mcp: `${origin}/mcp`,
        walletBindingChallenge: `${origin}/api/wallet/bind/challenge?address={address}&tenantId={tenantId}&role={role}`,
        walletBinding: `${origin}/api/wallet/bind`,
        paymentStatus: `${origin}/api/payments/status`,
        purchaseQuote: `${origin}/api/public/batches/{batchId}/purchase-quote`,
        purchaseStatus: `${origin}/api/public/batches/{batchId}/purchase-status`,
        feedbackPrepare: `${origin}/api/feedback/prepare`,
        feedbackConfirm: `${origin}/api/feedback/confirm`,
        feedbackSummary: `${origin}/api/feedback/summary?batchId={batchId}`,
        alipayCreate: `${origin}/api/payments/alipay/create`,
        alipayNotify: `${origin}/api/payments/alipay/notify`,
        paypalCreateOrder: `${origin}/api/payments/paypal/create-order`,
        paypalCapture: `${origin}/api/payments/paypal/capture`,
        paypalWebhook: `${origin}/api/payments/paypal/webhook`,
        enterpriseEvidenceImport: `${origin}/api/tenants/{tenantId}/evidence/import`,
        enterpriseMediaPresign: `${origin}/api/tenants/{tenantId}/media/presign`,
        enterpriseMediaUpload: `${origin}/api/tenants/{tenantId}/media/upload/{uploadId}`,
        enterpriseMediaIntake: `${origin}/api/tenants/{tenantId}/evidence/intake`,
        enterpriseEvidenceReconcile: `${origin}/api/tenants/{tenantId}/evidence/reconcile`,
        enterpriseEvidenceValidate: `${origin}/api/tenants/{tenantId}/evidence/validate`,
        enterpriseEvidenceCard: `${origin}/api/tenants/{tenantId}/batches/{batchId}/evidence-card`,
        enterpriseAuditExport: `${origin}/api/tenants/{tenantId}/audit/export`,
        productionImprovementReport: `${origin}/api/tenants/{tenantId}/production-improvement-report?batchId={batchId}`,
        cfiManifest: `${origin}/api/cfi/manifest`,
        publicStandard: `${origin}/api/standards`,
      },
      chain: {
        network: BOT_CHAIN_MAINNET.network,
        chainId: BOT_CHAIN_MAINNET.chainId,
        consumerGateway: BOT_CHAIN_MAINNET.consumerGatewayAddress,
        auditEscrow: BOT_CHAIN_MAINNET.auditEscrowAddress,
      },
      publicDataBoundary: { rawReports: "off_chain", personalData: "off_chain", privateKeys: "off_chain" },
    });
    return true;
  }

  if (p === "/api/wallet/bind/challenge" && req.method === "GET") {
    const address = (url.searchParams.get("address") || "").trim().toLowerCase();
    const tenantId = (url.searchParams.get("tenantId") || "demo").trim();
    const role = (url.searchParams.get("role") || "consumer").trim() as WalletBindingRole;
    if (!/^0x[0-9a-f]{40}$/.test(address) || !validTenantId(tenantId) || !walletBindingRoles.has(role)) {
      sendJson(res, 400, { error: "WALLET_BINDING_INPUT_INVALID" });
      return true;
    }
    const nonce = createHash("sha256").update(`wallet-binding:${address}:${tenantId}:${role}:${Date.now()}:${Math.random()}`).digest("hex").slice(0, 24);
    const message = walletBindingMessage(address, tenantId, role, nonce);
    const expiresAt = Date.now() + 5 * 60_000;
    await persistWalletChallenge(`${address}:${tenantId}:${role}:${nonce}`, message, expiresAt);
    sendJson(res, 200, { schemaVersion: "truthpass.wallet.binding-challenge.v1", address, tenantId, role, nonce, message, expiresAt, dataMode: "demo/synthetic" });
    return true;
  }

  if (p === "/api/wallet/bind" && req.method === "POST") {
    const body = await readBody(req);
    try {
      const input = walletBindingInput(body);
      const institutionalRole = input.role !== "consumer";
      if (institutionalRole && process.env.TRUTHPASS_ENFORCE_WALLET_BINDING === "true" && process.env.TRUTHPASS_ALLOW_SELF_REGISTERED_INSTITUTION_ROLES !== "true") {
        const expectedInvitation = process.env.TRUTHPASS_WALLET_ROLE_BINDING_TOKEN?.trim();
        const providedInvitation = typeof body.authorizationToken === "string" ? body.authorizationToken.trim() : "";
        if (!expectedInvitation || providedInvitation !== expectedInvitation) throw new Error("WALLET_ROLE_INVITATION_REQUIRED");
      }
      const nonceMatch = input.message.match(/一次性编号：([^\n]+)/);
      const nonce = nonceMatch?.[1]?.trim() ?? "";
      const challengeKey = `${input.address}:${input.tenantId}:${input.role}:${nonce}`;
      const challenge = await consumeWalletChallenge(challengeKey);
      if (!challenge || challenge.expiresAt < Date.now() || challenge.message !== input.message) throw new Error("WALLET_BINDING_CHALLENGE_EXPIRED");
      const recovered = verifyMessage(input.message, input.signature).toLowerCase();
      if (recovered !== input.address) throw new Error("WALLET_SIGNATURE_ADDRESS_MISMATCH");
      walletBindingChallenges.delete(challengeKey);
      const boundAt = new Date().toISOString();
      const bindingId = `bind-${createHash("sha256").update(`${input.address}:${input.tenantId}:${input.role}:${boundAt}`).digest("hex").slice(0, 24)}`;
      const record: WalletBindingRecord = { address: input.address, tenantId: input.tenantId, role: input.role, boundAt, bindingId, dataMode: "demo/synthetic" };
      await persistWalletBinding(record);
      sendJson(res, 200, { schemaVersion: "truthpass.wallet.binding.v1", status: "bound_verified", bindingMode: walletBindingMode(), binding: record, permissions: { role: input.role, canSign: true, canPrepareTransactions: true }, traceId: requestTraceId(req) });
    } catch (error) {
      sendJson(res, 401, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (p === "/api/wallet/bind" && req.method === "GET") {
    const address = (url.searchParams.get("address") || "").trim().toLowerCase();
    const tenantId = (url.searchParams.get("tenantId") || "demo").trim();
    const roles = (await Promise.all([...walletBindingRoles].map((role) => findWalletBinding(address, tenantId, [role]))))
      .filter((item): item is WalletBindingRecord => Boolean(item));
    sendJson(res, 200, { schemaVersion: "truthpass.wallet.binding-list.v1", address, tenantId, bindingMode: walletBindingMode(), bindings: roles });
    return true;
  }

  const enterpriseSummaryMatch = p.match(/^\/api\/tenants\/([^/]+)\/summary$/);
  if (enterpriseSummaryMatch && req.method === "GET") {
    const tenantId = decodeURIComponent(enterpriseSummaryMatch[1]!);
    const ctx = await enterpriseRequestContext(req, tenantId);
    if (!ctx.authorized) {
      sendJson(res, ctx.error === "TENANT_AUTH_NOT_CONFIGURED" ? 503 : 401, { error: ctx.error, tenantId });
      return true;
    }
    const audit = await enterprisePilotStore.exportAudit(tenantId);
    const recordsByBatch = new Map<string, typeof audit.evidence>();
    for (const record of audit.evidence) {
      const list = recordsByBatch.get(record.batchId) ?? [];
      list.push(record);
      recordsByBatch.set(record.batchId, list);
    }
    const batches = [];
    for (const [batchId, records] of recordsByBatch) {
      let verification: Awaited<ReturnType<typeof enterprisePilotStore.validateBatch>> | undefined;
      try { verification = await enterprisePilotStore.validateBatch(tenantId, batchId, ctx.requestId); } catch { /* summary remains review */ }
      const status = verification?.status ?? "review";
      const issueStatus = (record: (typeof records)[number]): "passed" | "review" | "missing" | "revoked" => record.status === "revoked" ? "revoked" : (verification?.checks.find((check) => check.evidenceIds.includes(record.evidenceId))?.status === "passed" ? "passed" : "review");
      const title: Record<string, string> = { production: "生产记录", inspection: "第三方检测", cold_chain: "冷链记录", shipment: "出货记录" };
      const issues = records.map((record) => ({
        id: record.evidenceId,
        batchId,
        kind: record.kind as "production" | "inspection" | "cold_chain" | "shipment",
        title: title[record.kind] ?? record.kind,
        status: issueStatus(record),
        issuer: record.issuerId,
        signature: "not_checked" as const,
        hash: record.payloadHash,
        detail: record.status === "revoked" ? "该证据已撤销，不能恢复为有效资料。" : "资料已进入企业证据库，等待当前规则和机构状态确认。",
        nextAction: issueStatus(record) === "passed" ? "保持批次号和来源记录一致。" : "补充来源签名或交由机构复核。",
      }));
      const completeness = Math.round(((verification?.checks.filter((check) => check.status === "passed").length ?? 0) / 4) * 100);
      batches.push({
        batchId,
        productName: records[0]?.productId || "未命名商品",
        policy: "enterprise-evidence-gate-v1",
        status,
        completeness,
        source: records.some((record) => record.dataMode === "demo/synthetic") ? "demo/synthetic" : "external",
        lastUpdated: records.map((record) => record.createdAt).sort().at(-1) ?? new Date().toISOString(),
        issues,
      });
    }
    const source = batches.some((batch) => batch.source === "demo/synthetic") ? "demo/synthetic" : "external";
    sendJson(res, 200, {
      tenantId,
      brandName: tenantId,
      productCount: new Set(batches.map((batch) => batch.productName)).size,
      batchCount: batches.length,
      reviewCount: batches.filter((batch) => batch.status === "review").length,
      revokedCount: batches.filter((batch) => batch.status === "rejected").length,
      feedbackCount: 0,
      source,
      dataMode: source,
      batches,
      authMode: ctx.authMode,
      userId: ctx.userId,
    });
    return true;
  }

  const enterpriseImportMatch = p.match(/^\/api\/tenants\/([^/]+)\/evidence\/import$/);
  if (enterpriseImportMatch && req.method === "POST") {
    const tenantId = decodeURIComponent(enterpriseImportMatch[1]!);
    const ctx = await enterpriseRequestContext(req, tenantId);
    if (!ctx.authorized) {
      sendJson(res, ctx.error === "TENANT_AUTH_NOT_CONFIGURED" ? 503 : 401, { error: ctx.error, tenantId });
      return true;
    }
    const body = await readBody(req);
    const input = (body.evidence && typeof body.evidence === "object" && !Array.isArray(body.evidence)
      ? body.evidence as Record<string, unknown>
      : body);
    const envelope: EnterpriseEvidenceEnvelope = {
      schemaVersion: input.schemaVersion as EnterpriseEvidenceEnvelope["schemaVersion"],
      tenantId,
      brandId: typeof input.brandId === "string" ? input.brandId : "",
      productId: typeof input.productId === "string" ? input.productId : "",
      batchId: typeof input.batchId === "string" ? input.batchId : "",
      sampleId: typeof input.sampleId === "string" ? input.sampleId : undefined,
      evidenceId: typeof input.evidenceId === "string" ? input.evidenceId : "",
      kind: input.kind as EnterpriseEvidenceEnvelope["kind"],
      issuerId: typeof input.issuerId === "string" ? input.issuerId : "",
      sourceKind: input.sourceKind as EnterpriseEvidenceEnvelope["sourceKind"],
      occurredAt: typeof input.occurredAt === "string" ? input.occurredAt : "",
      payload: input.payload && typeof input.payload === "object" && !Array.isArray(input.payload) ? input.payload as Record<string, unknown> : {},
      dataMode: input.dataMode === "external" ? "external" : "demo/synthetic",
      attestation: input.attestation as EnterpriseEvidenceEnvelope["attestation"],
      rawObjectRef: typeof input.rawObjectRef === "string" ? input.rawObjectRef : undefined,
    };
    try {
      const result = await enterprisePilotStore.importEvidence(envelope, ctx.requestId);
      sendJson(res, result.idempotent ? 200 : 201, {
        schemaVersion: "truthpass.enterprise.evidence-import.v1",
        tenantId,
        requestId: ctx.requestId,
        traceId: requestTraceId(req),
        idempotent: result.idempotent,
        evidence: { ...result.record, payload: undefined },
      });
    } catch (error) {
      sendJson(res, 422, { error: error instanceof Error ? error.message : String(error), tenantId, requestId: ctx.requestId });
    }
    return true;
  }

  const enterpriseMediaUploadMatch = p.match(/^\/api\/tenants\/([^/]+)\/media\/upload\/([^/]+)$/);
  if (enterpriseMediaUploadMatch && req.method === "PUT") {
    const tenantId = decodeURIComponent(enterpriseMediaUploadMatch[1]!);
    const uploadId = decodeURIComponent(enterpriseMediaUploadMatch[2]!);
    const session = mediaUploadSessions.get(uploadId);
    if (!session || session.tenantId !== tenantId) {
      sendJson(res, 404, { error: "MEDIA_UPLOAD_NOT_FOUND", tenantId, uploadId });
      return true;
    }
    if (session.expiresAt < Date.now()) {
      mediaUploadSessions.delete(uploadId);
      sendJson(res, 410, { error: "MEDIA_UPLOAD_EXPIRED", tenantId, uploadId });
      return true;
    }
    const hash = createHash("sha256");
    let total = 0;
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of req) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array);
        total += buffer.length;
        if (total > session.size || total > 50 * 1024 * 1024) throw new Error("MEDIA_SIZE_MISMATCH");
        hash.update(buffer);
        chunks.push(buffer);
      }
      const receivedHash = `0x${hash.digest("hex")}`;
      if (total !== session.size || (session.expectedHash && session.expectedHash !== receivedHash)) {
        sendJson(res, 422, { error: "MEDIA_HASH_MISMATCH", tenantId, uploadId, expectedHash: session.expectedHash ?? null, receivedHash, size: total });
        return true;
      }
      if (session.storageMode === "object_storage") {
        const storage = getSupabaseStorageAdmin();
        if (!storage || !session.storagePath || !session.storageBucket) {
          sendJson(res, 503, { error: "MEDIA_STORAGE_NOT_CONFIGURED", tenantId, uploadId });
          return true;
        }
        const { error } = await storage.client.storage.from(session.storageBucket).upload(session.storagePath, Buffer.concat(chunks), { contentType: session.contentType, upsert: false });
        if (error) {
          sendJson(res, 502, { error: "MEDIA_STORAGE_UPLOAD_FAILED", message: error.message, tenantId, uploadId });
          return true;
        }
      }
      session.receivedAt = new Date().toISOString();
      session.receivedHash = receivedHash;
      mediaUploadSessions.set(uploadId, session);
      sendJson(res, 200, { schemaVersion: "truthpass.media.upload.v1", status: "uploaded", tenantId, uploadId, rawObjectRef: session.rawObjectRef, contentHash: receivedHash, dataMode: session.storageMode === "object_storage" ? "external" : "demo/synthetic", storageMode: session.storageMode, nextAction: "调用 evidence/intake 生成待确认证据。" });
    } catch (error) {
      sendJson(res, 422, { error: error instanceof Error ? error.message : "MEDIA_UPLOAD_FAILED", tenantId, uploadId });
    }
    return true;
  }

  const enterpriseMediaPresignMatch = p.match(/^\/api\/tenants\/([^/]+)\/media\/presign$/);
  if (enterpriseMediaPresignMatch && req.method === "POST") {
    const tenantId = decodeURIComponent(enterpriseMediaPresignMatch[1]!);
    const ctx = await enterpriseRequestContext(req, tenantId);
    if (!ctx.authorized) {
      sendJson(res, ctx.error === "TENANT_AUTH_NOT_CONFIGURED" ? 503 : 401, { error: ctx.error, tenantId });
      return true;
    }
    const body = await readBody(req);
    const fileName = typeof body.fileName === "string" ? body.fileName.trim().slice(0, 160) : "";
    const contentType = typeof body.contentType === "string" ? body.contentType.trim().toLowerCase() : "application/octet-stream";
    const size = typeof body.size === "number" && Number.isFinite(body.size) ? Math.floor(body.size) : 0;
    const contentHash = typeof body.contentHash === "string" ? body.contentHash.trim().toLowerCase() : "";
    if (!fileName || size <= 0 || size > 50 * 1024 * 1024) {
      sendJson(res, 422, { error: "MEDIA_METADATA_INVALID", message: "请提供文件名和 1-50MB 的文件大小", tenantId });
      return true;
    }
    if (contentHash && !/^0x[0-9a-f]{64}$/.test(contentHash)) {
      sendJson(res, 422, { error: "MEDIA_HASH_INVALID", message: "contentHash 必须是 32 字节 SHA-256 哈希", tenantId });
      return true;
    }
    const uploadId = createHash("sha256").update(`media-upload:${tenantId}:${fileName}:${size}:${contentHash}:${Date.now()}:${Math.random()}`).digest("hex").slice(0, 32);
    const storage = getSupabaseStorageAdmin();
    const storageMode: "object_storage" | "presign_preview" = storage ? "object_storage" : "presign_preview";
    const safeFileName = fileName.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120) || "upload.bin";
    const storagePath = storage ? `${tenantId}/${uploadId}-${safeFileName}` : undefined;
    const rawObjectRef = storage && storagePath ? `supabase://${storage.bucket}/${storagePath}` : `demo://media/${tenantId}/${uploadId}/${encodeURIComponent(fileName)}`;
    const expiresAt = Date.now() + 15 * 60_000;
    mediaUploadSessions.set(uploadId, { tenantId, rawObjectRef, expectedHash: contentHash || undefined, expiresAt, fileName, contentType, size, storageMode, storagePath, storageBucket: storage?.bucket });
    const origin = `${url.protocol}//${url.host}`;
    sendJson(res, 200, {
      schemaVersion: "truthpass.media.presign.v1",
      tenantId,
      uploadId,
      method: "PUT",
      uploadUrl: `${origin}/api/tenants/${encodeURIComponent(tenantId)}/media/upload/${uploadId}`,
      headers: { "content-type": contentType, "x-truthpass-content-hash": contentHash || undefined },
      rawObjectRef,
      expiresAt: new Date(expiresAt).toISOString(),
      dataMode: storageMode === "object_storage" ? "external" : "demo/synthetic",
      storageMode,
      nextAction: storageMode === "object_storage" ? "文件已由服务端复核 Hash 后写入 Supabase Storage；继续调用 evidence/intake 生成待确认证据。" : "演示模式只校验本次上传 Hash；接入 Supabase Storage 后再写入正式对象存储。",
      requestId: ctx.requestId,
      traceId: requestTraceId(req),
    });
    return true;
  }

  const enterpriseMediaIntakeMatch = p.match(/^\/api\/tenants\/([^/]+)\/evidence\/intake$/);
  if (enterpriseMediaIntakeMatch && req.method === "POST") {
    const tenantId = decodeURIComponent(enterpriseMediaIntakeMatch[1]!);
    const ctx = await enterpriseRequestContext(req, tenantId);
    if (!ctx.authorized) {
      sendJson(res, ctx.error === "TENANT_AUTH_NOT_CONFIGURED" ? 503 : 401, { error: ctx.error, tenantId });
      return true;
    }
    const body = await readBody(req);
    try {
      const prepared = prepareMediaEvidence({
        tenantId,
        brandId: typeof body.brandId === "string" ? body.brandId : "",
        productId: typeof body.productId === "string" ? body.productId : "",
        batchId: typeof body.batchId === "string" ? body.batchId : "",
        sampleId: typeof body.sampleId === "string" ? body.sampleId : undefined,
        evidenceId: typeof body.evidenceId === "string" ? body.evidenceId : undefined,
        evidenceKind: body.evidenceKind as "production" | "inspection" | "cold_chain" | "shipment",
        mediaKind: body.mediaKind as MediaKind,
        issuerId: typeof body.issuerId === "string" ? body.issuerId : "",
        sourceKind: body.sourceKind as "manufacturer" | "third_party" | "platform_device" | "consumer",
        capturedAt: typeof body.capturedAt === "string" ? body.capturedAt : "",
        contentHash: typeof body.contentHash === "string" ? body.contentHash : "",
        rawObjectRef: typeof body.rawObjectRef === "string" ? body.rawObjectRef : undefined,
        dataMode: body.dataMode === "external" ? "external" : "demo/synthetic",
        note: typeof body.note === "string" ? body.note : undefined,
      });
      sendJson(res, 200, {
        schemaVersion: "truthpass.enterprise.media-intake.v1",
        tenantId,
        requestId: ctx.requestId,
        traceId: requestTraceId(req),
        status: "awaiting_confirmation",
        nextAction: "由商家确认后调用 /evidence/import；原始媒体仍保留在链下对象存储。",
        evidence: prepared,
      });
    } catch (error) {
      sendJson(res, 422, { error: error instanceof Error ? error.message : String(error), tenantId, requestId: ctx.requestId });
    }
    return true;
  }

  const enterpriseValidateMatch = p.match(/^\/api\/tenants\/([^/]+)\/evidence\/validate$/);
  if (enterpriseValidateMatch && req.method === "POST") {
    const tenantId = decodeURIComponent(enterpriseValidateMatch[1]!);
    const ctx = await enterpriseRequestContext(req, tenantId);
    if (!ctx.authorized) {
      sendJson(res, ctx.error === "TENANT_AUTH_NOT_CONFIGURED" ? 503 : 401, { error: ctx.error, tenantId });
      return true;
    }
    const body = await readBody(req);
    const batchId = typeof body.batchId === "string" ? body.batchId.trim() : "";
    if (!batchId) {
      sendJson(res, 400, { error: "BATCH_ID_REQUIRED", tenantId, requestId: ctx.requestId });
      return true;
    }
    try {
      sendJson(res, 200, await enterprisePilotStore.validateBatch(tenantId, batchId, ctx.requestId));
    } catch (error) {
      sendJson(res, 404, { error: error instanceof Error ? error.message : String(error), tenantId, batchId });
    }
    return true;
  }

  const enterpriseReconcileMatch = p.match(/^\/api\/tenants\/([^/]+)\/evidence\/reconcile$/);
  if (enterpriseReconcileMatch && req.method === "POST") {
    const tenantId = decodeURIComponent(enterpriseReconcileMatch[1]!);
    const ctx = await enterpriseRequestContext(req, tenantId);
    if (!ctx.authorized) {
      sendJson(res, ctx.error === "TENANT_AUTH_NOT_CONFIGURED" ? 503 : 401, { error: ctx.error, tenantId });
      return true;
    }
    const body = await readBody(req);
    const batchId = typeof body.batchId === "string" ? body.batchId.trim() : "";
    if (!batchId) {
      sendJson(res, 400, { error: "BATCH_ID_REQUIRED", tenantId, requestId: ctx.requestId });
      return true;
    }
    const records = await enterprisePilotStore.listEvidence(tenantId, batchId);
    sendJson(res, 200, { ...reconcileBatch(batchId, records), tenantId, requestId: ctx.requestId, traceId: requestTraceId(req) });
    return true;
  }

  const enterpriseCardMatch = p.match(/^\/api\/tenants\/([^/]+)\/batches\/([^/]+)\/evidence-card$/);
  if (enterpriseCardMatch && req.method === "GET") {
    const tenantId = decodeURIComponent(enterpriseCardMatch[1]!);
    const batchId = decodeURIComponent(enterpriseCardMatch[2]!);
    const ctx = await enterpriseRequestContext(req, tenantId);
    if (!ctx.authorized) {
      sendJson(res, ctx.error === "TENANT_AUTH_NOT_CONFIGURED" ? 503 : 401, { error: ctx.error, tenantId });
      return true;
    }
    try {
      const result = await enterprisePilotStore.evidenceCard(tenantId, batchId, url.searchParams.get("question") || "请解释当前批次证据状态。", ctx.requestId);
      sendJson(res, 200, { ...result, tenantId, traceId: requestTraceId(req) });
    } catch (error) {
      sendJson(res, 404, { error: error instanceof Error ? error.message : String(error), tenantId, batchId });
    }
    return true;
  }

  const enterpriseAuditMatch = p.match(/^\/api\/tenants\/([^/]+)\/audit\/export$/);
  if (enterpriseAuditMatch && req.method === "GET") {
    const tenantId = decodeURIComponent(enterpriseAuditMatch[1]!);
    const ctx = await enterpriseRequestContext(req, tenantId);
    if (!ctx.authorized) {
      sendJson(res, ctx.error === "TENANT_AUTH_NOT_CONFIGURED" ? 503 : 401, { error: ctx.error, tenantId });
      return true;
    }
    sendJson(res, 200, { schemaVersion: "truthpass.enterprise.audit-export.v1", ...(await enterprisePilotStore.exportAudit(tenantId)), traceId: requestTraceId(req) });
    return true;
  }

  const enterpriseRevokeMatch = p.match(/^\/api\/tenants\/([^/]+)\/evidence\/([^/]+)\/revoke$/);
  if (enterpriseRevokeMatch && req.method === "POST") {
    const tenantId = decodeURIComponent(enterpriseRevokeMatch[1]!);
    const evidenceId = decodeURIComponent(enterpriseRevokeMatch[2]!);
    const ctx = await enterpriseRequestContext(req, tenantId);
    if (!ctx.authorized) {
      sendJson(res, ctx.error === "TENANT_AUTH_NOT_CONFIGURED" ? 503 : 401, { error: ctx.error, tenantId });
      return true;
    }
    const revoked = await enterprisePilotStore.revoke(tenantId, evidenceId, ctx.requestId);
    sendJson(res, revoked ? 200 : 404, { schemaVersion: "truthpass.enterprise.revocation.v1", tenantId, evidenceId, status: revoked ? "revoked" : "not_found", traceId: requestTraceId(req) });
    return true;
  }

  if (p === "/api/agent/v1/collaborate" && req.method === "POST") {
    const body = await readBody(req);
    const batchId = typeof body.batchId === "string" && body.batchId.trim() ? body.batchId.trim().toUpperCase() : BATCH_ID;
    const question = typeof body.question === "string" && body.question.trim() ? body.question.trim() : "请解释当前批次证据状态。";
    const headerTenant = typeof req.headers["x-truthpass-tenant"] === "string" ? req.headers["x-truthpass-tenant"] : "";
    const tenantId = headerTenant || (typeof body.tenantId === "string" ? body.tenantId : "demo");
    // 生产环境启用网关或 Supabase 后，协作请求必须同时带租户和 request-id，
    // 防止调用方只在 body 中伪造 tenantId。未配置的本地 Demo 保留匿名演示路径。
    const enterpriseConfigured = Boolean(process.env.TRUTHPASS_AGENT_GATEWAY_TOKEN?.trim() || supabaseAuthConfig());
    const access = enterpriseConfigured
      ? await enterpriseRequestContext(req, tenantId)
      : agentGatewayAuthorized(req);
    if (!access.authorized) {
      sendJson(res, enterpriseConfigured && "error" in access ? 401 : 401, { error: enterpriseConfigured && "error" in access ? access.error : "AGENT_AUTH_REQUIRED", message: "需要有效的 Agent Gateway 令牌、租户范围和请求 ID" });
      return true;
    }
    const result = await runPublicAgentCollaboration(batchId, question, tenantId);
    sendJson(res, 200, { ...result, traceId: requestTraceId(req), authMode: access.authMode, tenantId });
    return true;
  }

  const agentRunMatch = p.match(/^\/api\/tenants\/([^/]+)\/agent-runs\/([^/]+)$/);
  if (agentRunMatch && req.method === "GET") {
    const tenantId = decodeURIComponent(agentRunMatch[1]!);
    const runId = decodeURIComponent(agentRunMatch[2]!);
    const ctx = await enterpriseRequestContext(req, tenantId);
    if (!ctx.authorized) {
      sendJson(res, ctx.error === "TENANT_AUTH_NOT_CONFIGURED" ? 503 : 401, { error: ctx.error, tenantId });
      return true;
    }
    const run = await loadAgentAuditRun(tenantId, runId);
    if (!run || run.tenantId !== tenantId) {
      sendJson(res, 404, { error: "AGENT_RUN_NOT_FOUND", tenantId, runId });
      return true;
    }
    sendJson(res, 200, { schemaVersion: "truthpass.agent.audit-read.v1", tenantId, runId, traceId: requestTraceId(req), run });
    return true;
  }

  if (p === "/api/cli/explain" && req.method === "GET") {
    const batchId = (url.searchParams.get("batchId") || BATCH_ID).trim().toUpperCase();
    const requestedBatch = repository.getBatch(batchId);
    if (!requestedBatch) {
      sendJson(res, 404, { error: `批次不存在: ${batchId}` });
      return true;
    }
    const inspection = await runCliInspect(repository, { ...task, batchId }, { id: policy.policyId, version: policy.version });
    const assessment = inspection.verification.assessment;
    const mode = inspection.verification.dataClass;
    const explanation = assessment
      ? `批次 ${batchId} 的确定性验收状态为 ${inspection.verification.status}，${assessment.reasons.join("；") || "规则检查已完成"}。当前数据模式为 ${mode}，链上状态仍为 anchor_pending，真实主网交易需要由用户钱包签名并回读 receipt。`
      : `批次 ${batchId} 当前缺少足够检测证据，不能给出质量结论。当前数据模式为 ${mode}，请补充检测报告、冷链记录和来源签名。`;
    sendJson(res, 200, {
      schemaVersion: "truthpass.cli.explain.v1",
      command: "explain",
      batchId,
      dataClass: mode,
      status: inspection.verification.status,
      explanation,
      inspection,
    });
    return true;
  }

  if (p === "/api/cfi/manifest" && req.method === "GET") {
    sendJson(res, 200, buildCfiManifest(`${url.protocol}//${url.host}`, publicPolicyRegistry));
    return true;
  }

  if (p === "/api/standards" && req.method === "GET") {
    sendJson(res, 200, publicStandardDocument());
    return true;
  }

  if (p === "/api/standards/policies" && req.method === "GET") {
    const category = url.searchParams.get("category") as "fish-oil" | "honey" | null;
    sendJson(res, 200, {
      schemaVersion: "truthpass.product-policy.index.v1",
      standardVersion: "1.4.0",
      policies: publicPolicyRegistry.list(category ? { category, status: "active" } : { status: "active" }),
    });
    return true;
  }

  const policyMatch = p.match(/^\/api\/standards\/policies\/([^/]+)\/([^/]+)$/);
  if (policyMatch && req.method === "GET") {
    try {
      sendJson(res, 200, publicPolicyRegistry.get(decodeURIComponent(policyMatch[1]), decodeURIComponent(policyMatch[2])));
    } catch (error) {
      sendJson(res, 404, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (p === "/api/consumer/credentials" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const credential = anonymousConsumers.issue({
        nonce: typeof body.nonce === "string" ? body.nonce : "",
        scopes: Array.isArray(body.scopes) ? body.scopes as Array<"purchase" | "feedback" | "public-reputation"> : undefined,
        issuedAt: typeof body.issuedAt === "string" ? body.issuedAt : undefined,
        expiresAt: typeof body.expiresAt === "string" ? body.expiresAt : undefined,
      });
      sendJson(res, 201, { ...credential, privacy: { nonce: "never_stored", personalData: "not_collected" } });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (p === "/api/consumer/feedback" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const feedback = anonymousConsumers.submitFeedback({
        credentialId: typeof body.credentialId === "string" ? body.credentialId : "",
        batchId: typeof body.batchId === "string" ? body.batchId : "",
        rating: Number(body.rating),
        categories: Array.isArray(body.categories) ? body.categories.filter((item): item is string => typeof item === "string") : undefined,
        evidenceRefs: Array.isArray(body.evidenceRefs) ? body.evidenceRefs.filter((item): item is string => typeof item === "string") : undefined,
        commentHash: typeof body.commentHash === "string" ? body.commentHash : undefined,
        createdAt: typeof body.createdAt === "string" ? body.createdAt : undefined,
      });
      sendJson(res, 201, { ...feedback, privacy: { credential: "pseudonymous", rawComment: "not_collected" }, chainStatus: "anchor_pending" });
    } catch (error) {
      sendJson(res, 422, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (p === "/api/cli/reference/manifest" && req.method === "GET") {
    sendJson(res, 200, DEFAULT_CLI_REFERENCE_REGISTRY.manifest(url.protocol + "//" + url.host));
    return true;
  }

  if (p === "/api/cli/reference/products" && req.method === "GET") {
    sendJson(res, 200, { schemaVersion: "truthpass.cli.reference.product-index.v1", products: DEFAULT_CLI_REFERENCE_REGISTRY.listProducts() });
    return true;
  }

  const cliReferenceProductMatch = p.match(/^\/api\/cli\/reference\/products\/([^/]+)(?:\/(assistant))?$/);
  if (cliReferenceProductMatch && req.method === "GET") {
    try {
      const productId = decodeURIComponent(cliReferenceProductMatch[1]);
      sendJson(res, 200, cliReferenceProductMatch[2] === "assistant" ? DEFAULT_CLI_REFERENCE_REGISTRY.assistant(productId) : DEFAULT_CLI_REFERENCE_REGISTRY.getProduct(productId));
    } catch (error) {
      sendJson(res, 404, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  const cliReferenceVerificationMatch = p.match(/^\/api\/cli\/reference\/batches\/([^/]+)\/verification$/);
  if (cliReferenceVerificationMatch && req.method === "GET") {
    try {
      sendJson(res, 200, DEFAULT_CLI_REFERENCE_REGISTRY.verifyBatch(decodeURIComponent(cliReferenceVerificationMatch[1])));
    } catch (error) {
      sendJson(res, 404, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  const cliReferenceBatchMatch = p.match(/^\/api\/cli\/reference\/batches\/([^/]+)$/);
  if (cliReferenceBatchMatch && req.method === "GET") {
    try {
      sendJson(res, 200, DEFAULT_CLI_REFERENCE_REGISTRY.getBatch(decodeURIComponent(cliReferenceBatchMatch[1])));
    } catch (error) {
      sendJson(res, 404, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (p === "/api/cli/reference/orders/prepare" && req.method === "POST") {
    try {
      const body = await readBody(req);
      sendJson(res, 200, DEFAULT_CLI_REFERENCE_REGISTRY.prepareOrder({
        batchId: typeof body.batchId === "string" ? body.batchId.trim().toUpperCase() : "",
        quantity: typeof body.quantity === "number" ? body.quantity : undefined,
        clientRequestId: typeof body.clientRequestId === "string" ? body.clientRequestId : undefined,
        checkoutBaseUrl: url.protocol + "//" + url.host + "/api",
      }));
    } catch (error) {
      sendJson(res, 422, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (p === "/api/chain/status" && req.method === "GET") {
    sendJson(res, 200, await getBotChainMainnetStatus());
    return true;
  }

  if (p === "/api/wallet/prepare" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const rawAction = typeof body.action === "string" ? body.action.trim() : "";
      const normalizedAction = rawAction === "recordPurchase" ? "purchase"
        : rawAction === "recordContribution" ? "contribution"
          : rawAction === "raiseDispute" ? "dispute"
            : rawAction === "anchorEvidence" ? "evidence"
              : rawAction === "recordVerification" ? "verification"
                : rawAction === "submitAuditFinding" ? "audit_finding"
                  : rawAction === "approveAuditFinding" ? "audit_approval"
                    : rawAction === "resolveChallenge" ? "resolve_challenge" : rawAction;
      const binding = await assertWalletActionAuthorized(body, normalizedAction);
      const prepared = prepareWalletTransaction(body);
      sendJson(res, 200, {
        ok: true,
        tenantId: typeof body.tenantId === "string" ? body.tenantId : "demo",
        binding: binding ? { bindingId: binding.bindingId, role: binding.role, address: binding.address } : undefined,
        ...prepared,
        event: prepared.eventName,
        txRequest: {
          to: prepared.transaction.to,
          data: prepared.transaction.data,
          value: prepared.transaction.value,
          chainId: prepared.chainId,
          chainIdHex: "0x2a5",
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const status = message.startsWith("WALLET_") || message.startsWith("TENANT_") ? 403 : 400;
      sendJson(res, status, { error: message, status: status === 403 ? "wallet_authorization_required" : "invalid_request" });
    }
    return true;
  }

  if (p === "/api/chain/tx-confirm" && req.method === "POST") {
    const body = await readBody(req);
    const txHash = typeof body.txHash === "string" ? body.txHash.trim() : "";
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      sendJson(res, 400, { error: "无效的交易哈希 txHash" });
      return true;
    }
    const expectedContract = typeof body.contractAddress === "string" ? body.contractAddress.trim() : "";
    const eventName = typeof body.event === "string" ? body.event : "";
    if (!/^0x[0-9a-fA-F]{40}$/.test(expectedContract) || !eventName) {
      sendJson(res, 400, { error: "必须提供预期合约地址和业务事件" });
      return true;
    }
    const requestedAction = typeof body.action === "string" ? body.action.trim() : "purchase";
    const normalizedAction = requestedAction === "recordPurchase" ? "purchase"
      : requestedAction === "recordContribution" ? "contribution"
        : requestedAction === "raiseDispute" ? "dispute"
          : requestedAction;
    const consumerWrite = ["purchase", "contribution", "dispute"].includes(normalizedAction);
    try {
      await assertWalletActionAuthorized(body, normalizedAction);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Consumer writes always need an explicit external wallet. The feature
      // flag may relax the institution binding lookup for local demos, but it
      // must never turn a purchase/contribution/dispute receipt into an
      // anonymous write.
      if (consumerWrite || process.env.TRUTHPASS_ENFORCE_WALLET_BINDING === "true") {
        sendJson(res, 403, { error: message, status: "wallet_authorization_required" });
        return true;
      }
    }
    const suppliedWallet = typeof body.wallet === "string" ? body.wallet.trim().toLowerCase() : "";
    if (consumerWrite && !/^0x[0-9a-f]{40}$/.test(suppliedWallet)) {
      sendJson(res, 403, { error: "消费者写操作必须提供外部钱包地址", status: "wallet_authorization_required" });
      return true;
    }
    let receipt: RpcReceipt;
    try {
      receipt = await readMainnetReceipt(txHash);
    } catch (error) {
      sendJson(res, 409, {
        error: error instanceof Error ? error.message : String(error),
        status: "pending_or_unverified",
        txHash,
        explorerUrl: `${BOT_CHAIN_MAINNET.explorerUrl}/tx/${txHash}`,
      });
      return true;
    }
    // A receipt alone does not identify the signer or the intended contract.
    // Always read the transaction and verify the domain before accepting any
    // business event. This check is independent of institution-role binding.
    let chainTransaction: RpcTransaction;
    try {
      const transaction = await readMainnetTransaction(txHash);
      chainTransaction = transaction;
      if (consumerWrite && String(transaction.from ?? "").toLowerCase() !== suppliedWallet) {
        sendJson(res, 422, { error: "transaction.from 与消费者钱包不一致", status: "transaction_sender_mismatch", txHash });
        return true;
      }
      if (!transaction.to || transaction.to.toLowerCase() !== expectedContract.toLowerCase()) {
        sendJson(res, 422, { error: "transaction.to 与预期交易目标不一致", status: "transaction_target_mismatch", txHash });
        return true;
      }
      if (!transaction.chainId || Number.parseInt(transaction.chainId.replace(/^0x/i, ""), 16) !== BOT_CHAIN_MAINNET.chainId) {
        sendJson(res, 422, { error: "交易 Chain ID 与 BOT Chain Mainnet 不一致", status: "transaction_chain_mismatch", txHash });
        return true;
      }
      const paidGateway = configuredPaidConsumerGateway();
      if (normalizedAction === "purchase" && paidGateway && expectedContract.toLowerCase() === paidGateway.address.toLowerCase()) {
        const actualValue = parseRpcQuantity(transaction.value);
        if (actualValue === undefined || actualValue !== BigInt(paidGateway.priceWei)) {
          sendJson(res, 422, {
            error: "支付金额与当前购买报价不一致",
            status: "payment_amount_mismatch",
            txHash,
            expectedValueWei: paidGateway.priceWei,
            actualValueWei: actualValue?.toString() ?? null,
          });
          return true;
        }
      }
    } catch (error) {
      sendJson(res, 409, { error: error instanceof Error ? error.message : String(error), status: "transaction_unverified", txHash });
      return true;
    }
    const expectedIds = (body.ids && typeof body.ids === "object" ? body.ids : {}) as Record<string, unknown>;
    const validation = expectedReceiptEventCheck(receipt, eventName, expectedContract, expectedIds);
    if (!validation.ok) {
      sendJson(res, 422, {
        error: validation.reason || "交易回执未通过业务事件校验",
        status: "receipt_event_mismatch",
        txHash,
        receiptStatus: receipt.status,
        receiptTo: receipt.to,
        explorerUrl: `${BOT_CHAIN_MAINNET.explorerUrl}/tx/${txHash}`,
      });
      return true;
    }
    const record: SessionChainTransaction = {
      id: `session-tx-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      action: normalizedAction,
      event: eventName,
      batchId: typeof body.batchId === "string" && body.batchId ? body.batchId.trim().toUpperCase() : BATCH_ID,
      wallet: suppliedWallet || (typeof body.wallet === "string" ? body.wallet : "0x2eBdb6C7617d27999cFDEa61C38cAc1647183c08"),
      providerName: typeof body.providerName === "string" ? body.providerName : undefined,
      contractAddress: typeof body.contractAddress === "string" && body.contractAddress
        ? body.contractAddress
        : BOT_CHAIN_MAINNET.contracts.consumerGateway.address,
      txHash,
      blockNumber: receiptBlockNumber(receipt) ?? (typeof body.blockNumber === "number" ? body.blockNumber : undefined),
      calldata: typeof body.calldata === "string" ? body.calldata : undefined,
      signature: typeof body.signature === "string" ? body.signature : undefined,
      mode: typeof body.mode === "string" ? body.mode : "wallet_broadcast",
      receiptStatus: receipt.status,
      eventVerified: true,
      ids: Object.fromEntries(Object.entries(expectedIds).filter(([, value]) => typeof value === "string").map(([key, value]) => [key, String(value)])),
      explorerUrl: `${BOT_CHAIN_MAINNET.explorerUrl}/tx/${txHash}`,
      createdAt: new Date().toISOString(),
      ...(chainTransaction.value ? { paymentValueWei: chainTransaction.value } : {}),
    };
    // A verified receipt is not enough for the application to claim a
    // completed purchase: the server must also persist the receipt index. In
    // production, fail closed when the write cannot be completed so a caller
    // can retry the readback without seeing a false success state.
    if (persistenceEnabled()) {
      try {
        await persistChainTransaction(record);
      } catch (error) {
        sendJson(res, 503, {
          error: "receipt 已核验，但服务端未能持久化交易记录；请稍后重试读取该 txHash",
          status: "persistence_failed",
          txHash,
          receiptStatus: receipt.status,
          explorerUrl: `${BOT_CHAIN_MAINNET.explorerUrl}/tx/${txHash}`,
          detail: error instanceof Error ? error.message : String(error),
        });
        return true;
      }
    }
    if (!sessionChainTxs.some((item) => item.txHash.toLowerCase() === record.txHash.toLowerCase())) {
      sessionChainTxs.unshift(record);
    }
    const lifecycleStageByAction: Partial<Record<string, LifecycleStage>> = {
      evidence: "production",
      verification: "regulatory_review",
      audit_finding: "regulatory_review",
      audit_approval: "regulatory_review",
      resolve_challenge: "regulatory_review",
      purchase: "purchase",
      contribution: "after_sales",
      dispute: "regulatory_review",
    };
    const lifecycleStage = lifecycleStageByAction[record.action];
    if (lifecycleStage && FISH_OIL_BATCHES[record.batchId]) {
      simulateLifecycleStage(record.batchId, lifecycleStage);
      if (persistenceEnabled()) {
        try {
          await persistCurrentLifecycleState(record.batchId);
        } catch (error) {
          sendJson(res, 503, {
            error: "receipt 已核验，但生命周期状态未能持久化；请稍后重试读取该 txHash",
            status: "persistence_failed",
            txHash,
            receiptStatus: receipt.status,
            explorerUrl: `${BOT_CHAIN_MAINNET.explorerUrl}/tx/${txHash}`,
            detail: error instanceof Error ? error.message : String(error),
          });
          return true;
        }
      }
    }
    sendJson(res, 201, {
      ok: true,
      status: "mainnet_receipt_verified",
      receipt: { status: receipt.status, to: receipt.to, blockNumber: receipt.blockNumber },
      transaction: record,
    });
    return true;
  }

  if (p === "/api/jev/detection" && req.method === "GET") {
    const batchId = (url.searchParams.get("batchId") || BATCH_ID).trim().toUpperCase();
    const b = demoBatchFor(batchId);
    if (!b) {
      sendJson(res, 404, { error: "unknown_batch", batchId, status: "unknown_batch", chainStatus: "unknown_batch" });
      return true;
    }
    // Only a transaction accepted by this process after a live receipt and
    // business-event check is a current mainnet receipt. The static
    // BOT_CHAIN_MAINNET transactions are replay evidence and must never be
    // returned as the current request's txHash. Durable receipts are loaded
    // as well, so a restart does not erase a verified current transaction.
    const receiptIndex = await receiptIndexForVerification();
    const currentReceipt = receiptIndex.find((item) =>
      item.batchId === batchId
      && (item.action === "purchase" || item.action === "recordPurchase" || item.action === "anchor" || item.action === "evidence")
      && /^(PurchaseRecorded|ConsumerPurchaseSubmitted|EvidenceAnchored|EvidenceSubmitted)$/i.test(item.event)
      && item.eventVerified === true
      && (item.receiptStatus === "0x1" || item.receiptStatus === "1"),
    );
    const historicalReplay = BOT_CHAIN_MAINNET.verifiedTransactions.some((item) => item.batchId === batchId);
    const chainStatus = currentReceipt ? "mainnet_receipt_verified" : historicalReplay ? "replay_verified" : "anchor_pending";
    const gate = demoVerificationGate(batchId, b);
    sendJson(res, 200, {
      batchId,
      routeDecision: "route_to_rule",
      confidence: 0.94,
      mode: agentMode(),
      modelAssisted: agentMode() === "model_assisted",
      passed: gate.status === "accepted",
      verificationStatus: gate.status,
      verificationReasons: gate.reasons,
      ...(isRiceBatch(batchId)
        ? { origin: b.origin, pesticideStatus: b.passed ? "within_declared_scope" : "review_required", storageCoverage: b.passed ? "covered" : "missing" }
        : { epaDhaPercent: b.epaDha, peroxideValue: b.peroxide, totox: b.totox, coldChainGapHours: b.coldGap }),
      evidenceRoot: evidenceHash(`${batchId}:root`),
      contractAddress: BOT_CHAIN_MAINNET.contractAddress,
      status: chainStatus,
      chainStatus,
      anchorStatus: chainStatus,
      ...(currentReceipt ? { txHash: currentReceipt.txHash, explorerUrl: currentReceipt.explorerUrl } : {}),
    });
    return true;
  }

  if (p === "/api/cli/inspect" && req.method === "GET") {
    const batchId = (url.searchParams.get("batchId") || BATCH_ID).trim().toUpperCase();
    const demoBatch = demoBatchFor(batchId);
    const primaryTx = BOT_CHAIN_MAINNET.verifiedTransactions[0];
    const verifyTx = BOT_CHAIN_MAINNET.verifiedTransactions[1];
    if (demoBatch) {
      const gate = demoVerificationGate(batchId, demoBatch);
      const status = gate.status;
      const reasons = gate.reasons.length > 0
        ? gate.reasons
        : demoBatch.passed ? [] : [demoParameterDetail(demoBatch)];
      const fixtureEvidence = evidenceFor(batchId).map((item) => ({
        evidenceId: item.evidenceId ?? `${batchId}:evidence:${item.step}`,
        kind: item.title,
        sourceKind: item.source,
        status: "registered",
        dataMode: "demo/synthetic" as const,
      }));
      sendJson(res, 200, {
        schemaVersion: "truthpass.cli.inspect.v1",
        command: "inspect",
        batchId,
        stages: [
          { name: "读取批次数据", status: "completed", detail: `${isRiceBatch(batchId) ? "大米" : "鱼油"} demo/synthetic 批次数据` },
          { name: "确定性验收", status: "completed", detail: status },
          { name: "证据根哈希", status: "completed", detail: evidenceHash(`${batchId}:root`) },
          { name: "链上锚定计划", status: "pending", detail: "dry-run：未广播交易，需外部签名" },
        ],
        verification: {
          schemaVersion: "truthpass.cli.verify.v1",
          dataClass: "demo/synthetic",
          command: "verify",
          batchId,
          status,
          policy: { id: policy.policyId, version: policy.version },
          evidenceRoot: evidenceHash(`${batchId}:root`),
          evidence: fixtureEvidence,
          assessment: status === "accepted" ? undefined : { score: status === "rejected" ? 61 : 89, checks: {}, reasons },
          anchor: {
            status: "anchor_pending",
            submitted: false,
            network: "bot-mainnet",
            chainId: BOT_CHAIN_MAINNET.chainId,
            contractAddress: BOT_CHAIN_MAINNET.contractAddress,
          },
          reasons,
        },
        chain: {
          chainId: BOT_CHAIN_MAINNET.chainId,
          chainName: "BOT Chain Mainnet",
          explorerUrl: BOT_CHAIN_MAINNET.explorerUrl,
          contracts: BOT_CHAIN_MAINNET.contracts,
          verifiedTransactions: BOT_CHAIN_MAINNET.verifiedTransactions,
        },
      });
      return true;
    }
    try {
      const inspectResult = await runCliInspect(repository, { ...task, batchId }, { id: policy.policyId, version: policy.version });
      const synthetic = inspectResult.verification.dataClass === "demo/synthetic";
      sendJson(res, 200, {
        ...inspectResult,
        stages: inspectResult.stages.map((stage, idx) =>
          idx === inspectResult.stages.length - 1
            ? synthetic
              ? { ...stage, status: "pending", detail: "dry-run：未广播交易，需外部签名" }
              : { ...stage, status: "completed", detail: `BOT Chain Mainnet (677) 已锚定 · Tx ${primaryTx.txHash.slice(0, 14)}…` }
            : stage
        ),
        verification: {
          ...inspectResult.verification,
          anchor: synthetic
            ? {
                ...inspectResult.verification.anchor,
                status: "anchor_pending",
                submitted: false,
                contractAddress: BOT_CHAIN_MAINNET.contractAddress,
                txHash: undefined,
                verificationTxHash: undefined,
                explorerUrl: undefined,
              }
            : {
                ...inspectResult.verification.anchor,
                status: "anchored",
                submitted: true,
                contractAddress: BOT_CHAIN_MAINNET.contractAddress,
                txHash: primaryTx.txHash,
                verificationTxHash: verifyTx.txHash,
                explorerUrl: primaryTx.explorerUrl,
              },
        },
        chain: {
          chainId: BOT_CHAIN_MAINNET.chainId,
          chainName: "BOT Chain Mainnet",
          explorerUrl: BOT_CHAIN_MAINNET.explorerUrl,
          contracts: BOT_CHAIN_MAINNET.contracts,
          verifiedTransactions: BOT_CHAIN_MAINNET.verifiedTransactions,
        },
      });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (p === "/api/simulator/lifecycle" && req.method === "POST") {
    const body = await readBody(req);
    const batchId = typeof body.batchId === "string" ? body.batchId.trim().toUpperCase() : BATCH_ID;
    const rawStage = typeof body.stage === "string" ? body.stage : "";
    const stage = LIFECYCLE_STAGE_DEFS.some((item) => item.stage === rawStage) ? rawStage as LifecycleStage : undefined;
    if (!demoBatchFor(batchId)) {
      sendJson(res, 404, { error: "batch not found" });
      return true;
    }
    try {
      if (!stage) throw new Error("不支持的生命周期阶段: " + rawStage);
      const view = simulateLifecycleStage(batchId, stage);
      try {
        await persistCurrentLifecycleState(batchId);
      } catch (error) {
        sendJson(res, 503, {
          error: "生命周期已在当前进程更新，但未能持久化；请稍后重试",
          status: "persistence_failed",
          batchId,
          detail: error instanceof Error ? error.message : String(error),
        });
        return true;
      }
      sendJson(res, 200, { ok: true, ...view });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
    }
    return true;
  }

  if (p === "/api/simulator/iot" && req.method === "POST") {
    const body = await readBody(req);
    const batchId = typeof body.batchId === "string" ? body.batchId.trim().toUpperCase() : "";
    const mode = body.mode === "cold_chain_gap" || body.mode === "device_offline" ? body.mode : "normal";
    const demoBatch = demoBatchFor(batchId);
    if (!batchId || (!repository.getBatch(batchId) && !demoBatch)) {
      sendJson(res, 400, { error: "批次不存在" });
      return true;
    }
    const now = new Date().toISOString();
    const suffix = now.replace(/[^0-9]/g, "");
    const payload = {
      deviceId: "iot-simulator-001", sequence: Number.isSafeInteger(body.sequence) ? body.sequence : Date.now(),
      temperatureC: mode === "cold_chain_gap" ? 18.5 : mode === "device_offline" ? null : 4.2,
      humidityPercent: mode === "device_offline" ? null : 61,
      latitude: mode === "device_offline" ? null : 35.6812,
      longitude: mode === "device_offline" ? null : 139.7671,
      offline: mode === "device_offline", maxGapHours: mode === "cold_chain_gap" ? 6 : 0,
      simulationMode: mode, evidenceMode: "demo/synthetic",
    };
    if (repository.getBatch(batchId)) {
      const evidence = await repository.addEvidence({
        schemaVersion: "evidence.v1", evidenceId: `iot-${batchId}-${suffix}`, batchId, kind: "cold_chain",
        issuerId: payload.deviceId, sourceKind: "platform_device", occurredAt: now, dataMode: "demo/synthetic", payload,
      });
      const inspection = await runCliInspect(repository, { ...task, batchId }, { id: policy.policyId, version: policy.version });
      const simulatedStatus = mode === "cold_chain_gap" ? "rejected" : mode === "device_offline" ? "missing_evidence" : inspection.verification.status;
      const simulatedReasons = mode === "cold_chain_gap" ? ["模拟温控中断 6 小时，超过当前批次冷链规则"] : mode === "device_offline" ? ["设备离线，当前没有新的温控证据"] : inspection.verification.reasons;
      sendJson(res, 201, {
        ok: true,
        persisted: false,
        evidenceId: evidence.evidenceId,
        batchId,
        mode,
        payloadHash: evidence.payloadHash,
        message: "模拟 IoT 数据已到达服务器，并完成批次关联与确定性校验；标记为 demo/synthetic。",
        pipeline: ["设备发送", "服务端接收", "批次关联", "确定性校验"],
        verification: { status: simulatedStatus, dataMode: inspection.verification.dataClass, evidenceRoot: inspection.verification.evidenceRoot, reasons: simulatedReasons },
      });
    } else {
      // The guard above ensures a demo batch exists when no repository batch is found.
      // Keep an explicit narrowing here so the synthetic branch remains fail-closed if
      // that invariant changes in a future refactor.
      if (!demoBatch) {
        sendJson(res, 404, { error: "批次不存在" });
        return true;
      }
      demoBatch.coldGap = mode === "cold_chain_gap" ? 6 : mode === "normal" ? 1.5 : demoBatch.coldGap;
      const syntheticId = `iot-${batchId}-${suffix}`;
      const syntheticHash = evidenceHash(`${syntheticId}:${JSON.stringify(payload)}`);
      const simulatedStatus = mode === "cold_chain_gap" ? "rejected" : mode === "device_offline" ? "missing_evidence" : demoBatch.passed ? "accepted" : "rejected";
      sendJson(res, 201, { ok: true, persisted: false, evidenceId: syntheticId, batchId, mode, payloadHash: syntheticHash, message: "模拟 IoT 数据已到达服务器，并完成规则校验；标记为 demo/synthetic。", pipeline: ["设备发送", "服务端接收", "批次关联", "确定性校验"], verification: { status: simulatedStatus, dataMode: "demo/synthetic", reasons: simulatedStatus === "accepted" ? [] : [mode === "device_offline" ? "设备离线，当前没有新的温控证据" : "冷链模拟数据超出当前规则"] } });
    }
    return true;
  }

  if (p === "/api/recommend" && req.method === "GET") {
    const requestedBatchId = (url.searchParams.get("batchId") || "").trim().toUpperCase();
    // Keep the legacy array endpoint on the same batch-scoped contract when a
    // caller asks for one batch. This prevents older clients from bypassing
    // production-coverage and evidence gates enforced by /api/recommendation.
    if (requestedBatchId) {
      try {
        const contract = await buildRecommendationContract(requestedBatchId, requestTraceId(req));
        sendJson(res, 200, [contract.item]);
      } catch (error) {
        sendJson(res, 404, { error: "batch not found", batchId: requestedBatchId });
      }
      return true;
    }
    const items = Object.entries(FISH_OIL_BATCHES)
      .filter(([batchId, item]) => requestedBatchId ? batchId === requestedBatchId : item.passed)
      .map(([batchId, item]) => ({ batchId, ...item }))
      .sort((a, b) => b.epaDha - a.epaDha || a.peroxide - b.peroxide || a.coldGap - b.coldGap)
      .slice(0, requestedBatchId ? 1 : 3)
      .map((item) => ({
        batchId: item.batchId,
        name: item.name,
        origin: item.origin,
        productionDate: item.productionDate,
        imageUrl: item.image,
        dataMode: "demo/synthetic",
        epaDha: item.epaDha,
        peroxide: item.peroxide,
        coldGap: item.coldGap,
        recommendationStatus: item.passed ? "recommend_with_scope" : "do_not_recommend",
        reason: `${demoParameterDetail(item)}推荐只表示登记参数与当前演示规则的比较结果，不表示安全、疗效或真实认证。`,
        expertise: "EPA+DHA、过氧化值、TOTOX 和冷链异常时长分别取自当前批次登记资料；Agent 只解释核对结果，不替代检测机构。",
        nextAction: item.passed ? "查看参数明细和来源，再由外部钱包确认购买" : "补齐或复核异常参数后再决定是否购买",
        productionEvidence: productionProcessFor(item.batchId),
        parameterDetails: parameterDetailsFor(item.batchId),
        missingItems: item.passed ? [] : ["需要复核的参数或生产资料"],
        conflicts: [],
        traceId: requestTraceId(req),
        evidence: {
          dataMode: "demo/synthetic",
          verificationStatus: item.passed ? "accepted" : "rejected",
          evidenceRefs: [`${item.batchId}:inspection`, `${item.batchId}:cold-chain`, `${item.batchId}:quality`],
          metrics: { epaDhaPercent: item.epaDha, peroxideValue: item.peroxide, coldChainGapHours: item.coldGap },
          policy: { id: policy.policyId, version: policy.version },
        },
        purchaseQuote: purchaseQuote(item.batchId),
      }));
    sendJson(res, 200, items);
    return true;
  }

  // Contract-first recommendation endpoint.  The legacy /api/recommend array
  // remains available for older clients; new Agent and CLI clients should use
  // this single batch-scoped object so recommendation, evidence and feedback
  // cannot drift into separately assembled states.
  if (p === "/api/recommendation" && req.method === "GET") {
    const batchId = (url.searchParams.get("batchId") || BATCH_ID).trim().toUpperCase();
    try {
      sendJson(res, 200, {
        schemaVersion: "truthpass.recommendation.v1",
        ...(await buildRecommendationContract(batchId, requestTraceId(req))),
      });
    } catch (error) {
      sendJson(res, 404, { error: error instanceof Error ? error.message : "BATCH_NOT_FOUND", batchId });
    }
    return true;
  }

  if (p === "/api/orders" && req.method === "POST") {
    const body = await readBody(req);
    const batchId = typeof body.batchId === "string" ? body.batchId.trim().toUpperCase() : "";
    const b = demoBatchFor(batchId);
    if (!b) {
      sendJson(res, 404, { error: "批次不存在" });
      return true;
    }
    const orderId = "TP-" + new Date().toISOString().slice(0, 10).replace(/-/g, "") + "-" + Math.random().toString(36).slice(2, 8).toUpperCase();
    sendJson(res, 200, {
      orderId,
      batchId,
      productName: b.name,
      imageUrl: b.image,
      quantity: 1,
      createdAt: new Date().toISOString(),
      status: "prepared_pending_checkout",
      paymentStatus: "not_started",
      chainStatus: "anchor_pending",
      nextAction: "send_to_checkout_adapter",
      dataMode: "demo/synthetic",
    });
    return true;
  }

  if (p === "/api/payments/status" && req.method === "GET") {
    const orderId = (url.searchParams.get("orderId") || "").trim();
    const order = orderId ? (await loadPersistedPaymentOrders({ orderId }))[0] : undefined;
    sendJson(res, 200, {
      schemaVersion: "truthpass.payment.status.v1",
      providers: [paymentProviderStatus("alipay"), paymentProviderStatus("paypal")],
      ...(order ? { order } : {}),
      paymentAndChainAreSeparate: true,
      note: "payment_verified 只表示官方网关支付已核验；链上购买仍需外部钱包签名和真实 receipt。",
    });
    return true;
  }

  const paymentAction = p.match(/^\/api\/payments\/(alipay|paypal)\/(create|create-order|capture|notify|webhook)$/);
  if (paymentAction && req.method === "POST") {
    const provider = paymentAction[1] as PaymentProvider;
    const action = paymentAction[2];
    const status = paymentProviderStatus(provider);
    if (!status.configured) {
      sendJson(res, 503, { error: "provider_unconfigured", status: "provider_unconfigured", provider, action, requiredEnv: status.secretConfig, missing: status.missing });
      return true;
    }
    try {
      const body = await readBody(req);
      const origin = `${url.protocol}//${url.host}`;

      if (provider === "alipay" && action === "create") {
        const { context, input } = paymentInputFromBody(body, provider, origin);
        const order = createAlipayPagePayForm(input);
        const now = new Date().toISOString();
        const record: PaymentOrderRecord = { ...context, providerOrderId: order.providerOrderId, status: "pending", paymentStatus: "payment_pending", chainStatus: "not_started", createdAt: now, updatedAt: now };
        await persistPaymentOrder(record);
        paymentOrders.set(record.orderId, record);
        sendJson(res, 201, { schemaVersion: "truthpass.payment.order.v1", provider, orderId: record.orderId, providerOrderId: record.providerOrderId, tenantId: record.tenantId, productId: record.productId, batchId: record.batchId, amount: record.amount, currency: record.currency, status: record.paymentStatus, chainStatus: record.chainStatus, formHtml: order.formHtml, note: "请提交表单到支付宝官方网关；支付成功以异步通知验签为准。" });
        return true;
      }

      if (provider === "alipay" && action === "notify") {
        const result = verifyAlipayNotify(Object.fromEntries(Object.entries(body).map(([key, value]) => [key, String(value)])));
        if (!result.ok || !result.orderId) {
          sendJson(res, 400, { status: "payment_failed", provider, reason: result.reason ?? "notify_verification_failed" });
          return true;
        }
        const record = await findPaymentOrderByProviderOrderId("alipay", result.orderId);
        if (!record || record.provider !== "alipay") {
          sendJson(res, 404, { status: "payment_unbound", provider, orderId: result.orderId });
          return true;
        }
        if (result.amount && result.amount !== record.amount) {
          sendJson(res, 422, { status: "payment_amount_mismatch", provider, orderId: record.orderId, expectedAmount: record.amount, receivedAmount: result.amount });
          return true;
        }
        const updatedRecord: PaymentOrderRecord = {
          ...record,
          status: "paid",
          paymentStatus: "payment_verified",
          updatedAt: new Date().toISOString(),
          rawStatus: { tradeStatus: result.status, amount: result.amount },
        };
        await persistPaymentOrder(updatedRecord);
        paymentOrders.set(updatedRecord.orderId, updatedRecord);
        res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
        res.end("success");
        return true;
      }

      if (provider === "paypal" && action === "create-order") {
        const { context, input } = paymentInputFromBody(body, provider, origin);
        const order = await createPayPalOrder(input);
        const now = new Date().toISOString();
        const record: PaymentOrderRecord = { ...context, providerOrderId: order.providerOrderId, status: "pending", paymentStatus: "payment_pending", chainStatus: "not_started", createdAt: now, updatedAt: now };
        await persistPaymentOrder(record);
        paymentOrders.set(record.orderId, record);
        sendJson(res, 201, { schemaVersion: "truthpass.payment.order.v1", provider, orderId: record.orderId, providerOrderId: record.providerOrderId, tenantId: record.tenantId, productId: record.productId, batchId: record.batchId, amount: record.amount, currency: record.currency, status: record.paymentStatus, chainStatus: record.chainStatus, approvalUrl: order.approvalUrl, note: "用户在 PayPal 官方页面批准后，再调用 capture；capture 完成前不产生购买凭证。" });
        return true;
      }

      if (provider === "paypal" && action === "capture") {
        const providerOrderId = typeof body.providerOrderId === "string" ? body.providerOrderId.trim() : "";
        const record = await findPaymentOrderByProviderOrderId("paypal", providerOrderId);
        if (!record || !providerOrderId) { sendJson(res, 404, { status: "payment_unbound", provider, providerOrderId }); return true; }
        if (typeof body.orderId === "string" && body.orderId.trim() !== record.orderId) { sendJson(res, 422, { status: "order_scope_mismatch", provider, orderId: body.orderId }); return true; }
        const captured = await capturePayPalOrder(providerOrderId);
        const capturedStatus = typeof captured.status === "string" ? captured.status : "";
        const verified = capturedStatus === "COMPLETED";
        const updatedRecord: PaymentOrderRecord = {
          ...record,
          status: verified ? "paid" : "failed",
          paymentStatus: verified ? "payment_verified" : "payment_failed",
          updatedAt: new Date().toISOString(),
          rawStatus: { status: capturedStatus, providerOrderId },
        };
        await persistPaymentOrder(updatedRecord);
        paymentOrders.set(updatedRecord.orderId, updatedRecord);
        sendJson(res, verified ? 200 : 409, { schemaVersion: "truthpass.payment.capture.v1", provider, orderId: updatedRecord.orderId, providerOrderId, status: updatedRecord.paymentStatus, chainStatus: updatedRecord.chainStatus, rawStatus: captured });
        return true;
      }

      if (provider === "paypal" && action === "webhook") {
        const event = body as Record<string, unknown>;
        const headers = req.headers;
        const header = (name: string) => typeof headers[name] === "string" ? headers[name] as string : "";
        const verified = await verifyPayPalWebhook({ transmissionId: header("paypal-transmission-id"), transmissionTime: header("paypal-transmission-time"), certUrl: header("paypal-cert-url"), authAlgo: header("paypal-auth-algo"), transmissionSig: header("paypal-transmission-sig"), webhookId: process.env.PAYPAL_WEBHOOK_ID?.trim() ?? "", webhookEvent: event });
        if (!verified) { sendJson(res, 400, { status: "payment_failed", provider, reason: "webhook_signature_invalid" }); return true; }
        const resource = (event.resource && typeof event.resource === "object") ? event.resource as Record<string, unknown> : {};
        const related = resource.supplementary_data && typeof resource.supplementary_data === "object" ? resource.supplementary_data as Record<string, unknown> : {};
        const relatedIds = related.related_ids && typeof related.related_ids === "object" ? related.related_ids as Record<string, unknown> : {};
        const providerOrderId = typeof relatedIds.order_id === "string" ? relatedIds.order_id : (typeof resource.order_id === "string" ? resource.order_id : "");
        const record = await findPaymentOrderByProviderOrderId("paypal", providerOrderId);
        if (!record) { sendJson(res, 404, { status: "payment_unbound", provider, providerOrderId }); return true; }
        const eventType = typeof event.event_type === "string" ? event.event_type : "";
        const completed = eventType === "PAYMENT.CAPTURE.COMPLETED" || eventType === "CHECKOUT.ORDER.COMPLETED";
        const updatedRecord: PaymentOrderRecord = {
          ...record,
          status: completed ? "paid" : "pending",
          paymentStatus: completed ? "payment_verified" : "payment_pending",
          updatedAt: new Date().toISOString(),
          rawStatus: { eventType, resourceId: resource.id },
        };
        await persistPaymentOrder(updatedRecord);
        paymentOrders.set(updatedRecord.orderId, updatedRecord);
        sendJson(res, 200, { provider, orderId: updatedRecord.orderId, providerOrderId, status: updatedRecord.paymentStatus, chainStatus: updatedRecord.chainStatus, verified: true });
        return true;
      }

      sendJson(res, 400, { status: "unsupported_payment_action", provider, action });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const persistenceFailure = error instanceof PaymentPersistenceError || message === "PAYMENT_PERSISTENCE_FAILED";
      const statusCode = persistenceFailure ? 503 : message === "UNKNOWN_BATCH" ? 404 : message.includes("SCOPE_MISMATCH") ? 403 : 502;
      sendJson(res, statusCode, { status: persistenceFailure ? "persistence_failed" : "payment_adapter_error", provider, action, error: persistenceFailure ? "支付订单状态未能持久化，请稍后重试" : message });
    }
    return true;
  }

  const publicOverviewMatch = p.match(/^\/api\/public\/batches\/([^/]+)\/overview\/?$/);
  if (publicOverviewMatch && req.method === "GET") {
    const batchId = decodeURIComponent(publicOverviewMatch[1]).trim().toUpperCase();
    const demoBatch = demoBatchFor(batchId);
    const dbBatch = repository.getBatch(batchId);
    if (!demoBatch && !dbBatch) {
      sendJson(res, 404, { error: "unknown_batch", batchId });
      return true;
    }
    const tenant = siteStore.get(isRiceBatch(batchId) ? "rice-demo" : "fish-oil-demo")?.config;
    const inspection = await mcpInspectBatch(batchId, requestTraceId(req));
    const recommendation = demoBatch
      ? await buildRecommendationContract(batchId, requestTraceId(req))
      : undefined;
    const lifecycle = lifecyclePublicView(batchId);
    const chainContext = await buildChainQueryContext(batchId);
    const parameterDetails = parameterDetailsFor(batchId);
    const parameterStatus = demoBatch
      ? parameterDetails.some((detail) => detail.status === "outside_range")
        ? "rejected"
        : parameterDetails.some((detail) => detail.status === "missing")
          ? "review"
          : "accepted"
      : inspection.verification.status;
    const product = demoBatch
      ? {
          productId: isRiceBatch(batchId) ? "rice-wuchang" : "fish-oil",
          name: demoBatch.name,
          category: isRiceBatch(batchId) ? "粮食" : "营养食品",
          origin: demoBatch.origin,
          productionDate: demoBatch.productionDate,
          dataMode: "demo/synthetic",
        }
      : {
          productId: dbBatch?.productId,
          name: repository.getProduct(dbBatch!.productId)?.name ?? "未命名商品",
          category: repository.getProduct(dbBatch!.productId)?.category ?? "未分类",
          origin: "已登记生产资料",
          productionDate: dbBatch?.productionAt?.slice(0, 10),
          dataMode: dbBatch?.dataMode ?? "demo/synthetic",
        };
    const evidence = demoBatch
      ? evidenceFor(batchId).map((item) => ({ ...item, batchId, dataMode: "demo/synthetic" }))
      : repository.listEvidence(batchId).map((item) => ({ evidenceId: item.evidenceId, kind: item.kind, issuerId: item.issuerId, sourceKind: item.sourceKind, occurredAt: item.occurredAt, dataMode: item.dataMode, payloadHash: item.payloadHash }));
    sendJson(res, 200, {
      schemaVersion: "truthpass.public.batch.overview.v1",
      tenant: {
        tenantId: tenant?.tenantId ?? (isRiceBatch(batchId) ? "tenant-rice-demo" : "tenant-fish-oil-demo"),
        slug: tenant?.slug ?? (isRiceBatch(batchId) ? "rice-demo" : "fish-oil-demo"),
        brand: tenant?.brand ?? null,
      },
      product,
      // `inspection.verification.status` is the parameter/evidence gate only.
      // The public batch status must use the same overall gate that is shown
      // below, otherwise a batch with missing production stages appears as
      // accepted in one card and review in another.
      batch: {
        batchId,
        dataMode: demoBatch ? "demo/synthetic" : (dbBatch?.dataMode ?? "demo/synthetic"),
        status: recommendation?.verificationStatus ?? inspection.verification.status,
        parameterStatus,
      },
      lifecycle,
      evidence,
      verification: {
        ...inspection.verification,
        ...(recommendation ? {
          status: recommendation.verificationStatus,
          // Use the recommendation contract's ordered gate reasons as the
          // public source of truth. It keeps concrete parameter observations
          // (for example EPA+DHA 55% against the registered rule) visible
          // before production coverage gaps, and avoids duplicate or stale
          // verifier messages from a separately assembled inspection view.
          reasons: [
            ...recommendation.gateReasons,
            ...recommendation.missingItems,
            ...recommendation.conflicts,
          ].filter((reason, index, list) => list.indexOf(reason) === index),
        } : {}),
      },
      parameterDetails,
      chainContext,
      purchasePolicy: {
        readOnly: true,
        walletRequired: true,
        chainId: BOT_CHAIN_MAINNET.chainId,
        status: "prepared_pending_checkout",
        note: "购买准备不等于支付成功；只有外部钱包签名并回读真实 receipt 后才会写入购买记录。",
      },
      purchaseQuote: purchaseQuote(batchId),
      batchId,
      tenantId: tenant?.tenantId ?? (isRiceBatch(batchId) ? "tenant-rice-demo" : "tenant-fish-oil-demo"),
      productId: product.productId,
      feedbackSummary: await feedbackSummaryFor(batchId),
      dataMode: demoBatch ? "demo/synthetic" : (dbBatch?.dataMode ?? "demo/synthetic"),
    });
    return true;
  }

  const purchaseQuoteMatch = p.match(/^\/api\/public\/batches\/([^/]+)\/purchase-quote\/?$/);
  if (purchaseQuoteMatch && req.method === "GET") {
    const batchId = decodeURIComponent(purchaseQuoteMatch[1]).trim().toUpperCase();
    const demo = demoBatchFor(batchId);
    const dbBatch = repository.getBatch(batchId);
    if (!demo && !dbBatch) { sendJson(res, 404, { error: "unknown_batch", batchId }); return true; }
    const tenantId = isRiceBatch(batchId) ? "tenant-rice-demo" : "tenant-fish-oil-demo";
    const productId = demo ? (isRiceBatch(batchId) ? "rice-wuchang" : "fish-oil") : (dbBatch?.productId ?? "");
    const base = purchaseQuote(batchId);
    const expiresAt = new Date(Date.now() + 5 * 60_000).toISOString();
    sendJson(res, 200, {
      schemaVersion: "truthpass.purchase.quote.v1",
      quoteId: sha256Hex32(`purchase-quote:${tenantId}:${productId}:${batchId}:${base.amount}:${base.currency}`).slice(0, 18),
      tenantId,
      productId,
      batchId,
      amount: base.amount,
      currency: base.currency,
      providers: base.providers,
      chainPayment: base.chainPayment,
      expiresAt,
      status: "quote_ready",
      paymentStatus: "payment_pending",
      chainStatus: "not_started",
      note: "支付平台回调与链上购买 receipt 分开核验；任何一个环节未验证都不会显示购买成功。",
      dataMode: demo ? "demo/synthetic" : (dbBatch?.dataMode ?? "demo/synthetic"),
    });
    return true;
  }

  const purchaseStatusMatch = p.match(/^\/api\/public\/batches\/([^/]+)\/purchase-status\/?$/);
  if (purchaseStatusMatch && req.method === "GET") {
    const batchId = decodeURIComponent(purchaseStatusMatch[1]).trim().toUpperCase();
    if (!demoBatchFor(batchId) && !repository.getBatch(batchId)) { sendJson(res, 404, { error: "unknown_batch", batchId }); return true; }
    const payment = await loadPersistedPaymentOrders({ batchId });
    // Receipts survive a service restart through the persisted transaction
    // index. Keep replay fixtures out of this current purchase list.
    const receiptIndex = await receiptIndexForVerification();
    const chain = receiptIndex.filter((item) => item.batchId === batchId && (item.action === "purchase" || item.action === "recordPurchase")).map((item) => ({ txHash: item.txHash, status: item.receiptStatus === "0x1" || item.receiptStatus === "1" ? "mainnet_receipt_verified" : "review_required", eventVerified: item.eventVerified, createdAt: item.createdAt, explorerUrl: item.explorerUrl }));
    sendJson(res, 200, { schemaVersion: "truthpass.purchase.status.v1", batchId, payments: payment, chain, purchaseConfirmed: chain.some((item) => item.status === "mainnet_receipt_verified"), dataMode: "demo/synthetic" });
    return true;
  }

  if (p === "/api/agent/search" && req.method === "GET") {
    const batchId = (url.searchParams.get("batchId") ?? BATCH_ID).trim().toUpperCase();
    const query = url.searchParams.get("q") ?? "";
    const traceId = requestTraceId(req);
    try {
      sendJson(res, 200, { schemaVersion: "truthpass.agent.search.v1", traceId, batchId, dataMode: "demo/synthetic", hits: searchBatchKnowledge(batchId, query) });
    } catch (error) {
      sendJson(res, 404, { error: error instanceof Error ? error.message : String(error), traceId, batchId });
    }
    return true;
  }

  if (p === "/api/agent/query/stream" && req.method === "POST") {
    const body = await readBody(req);
    const batchId = (typeof body.batchId === "string" ? body.batchId : BATCH_ID).trim().toUpperCase();
    const question = typeof body.question === "string" ? body.question.trim() : "";
    const locale = body.locale === "en" ? "en" : "zh";
    const traceId = requestTraceId(req);
    if (!question) { sendJson(res, 400, { error: "question_required", traceId, batchId }); return true; }
    const slot = tryAcquireAgentSlot();
    if (!slot.allowed) {
      res.writeHead(429, { "Content-Type": "application/json; charset=utf-8", "Retry-After": String(slot.retryAfterSeconds), "Cache-Control": "no-store", "X-TruthPass-Agent-Limit": String(AGENT_MAX_CONCURRENCY) });
      res.end(JSON.stringify({ error: "AGENT_CONCURRENCY_LIMITED", status: "rate_limited", traceId, active: slot.active, limit: AGENT_MAX_CONCURRENCY, retryAfterSeconds: slot.retryAfterSeconds }));
      return true;
    }
    try {
      res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive", "X-TruthPass-Trace-Id": traceId });
      const send = (event: unknown) => {
        if (!res.writableEnded && !res.destroyed) res.write("data: " + JSON.stringify(event) + "\n\n");
      };
      const base = { traceId, batchId, dataMode: "demo/synthetic" as const };
      send({ kind: "begin", intent: "agent_query", ...base });
      send({ kind: "stage", stage: "reading_batch", status: "active", detail: "读取当前批次和公开资料", ...base });
      const retrieval = searchBatchKnowledge(batchId, question);
      send({ kind: "stage", stage: "reading_batch", status: "completed", detail: `检索到 ${retrieval.length} 条当前批次资料`, evidenceIds: [...new Set(retrieval.flatMap((hit) => hit.evidenceIds))], ...base });
      send({ kind: "stage", stage: "retrieval_completed", status: "completed", detail: `已完成当前批次检索：${retrieval.length} 条命中`, evidenceIds: [...new Set(retrieval.flatMap((hit) => hit.evidenceIds))], ...base });
      send({ kind: "stage", stage: "verifier_checked", status: "active", ...base });
      send({ kind: "stage", stage: "jev_routed", status: "active", ...base });
      send({ kind: "stage", stage: "model_started", status: "active", ...base });
      const result = await runUnifiedAgentQuery(batchId, question, traceId, locale);
      send({ kind: "stage", stage: "verifier_checked", status: "completed", detail: result.stages.find((stage) => stage.stage === "verifier_checked")?.status, evidenceIds: result.evidenceIds, ...base });
      send({ kind: "stage", stage: "jev_routed", status: "completed", detail: result.stages.find((stage) => stage.stage === "jev_routed")?.status, evidenceIds: result.evidenceIds, ...base });
      send({
        kind: "stage",
        stage: "model_completed",
        status: result.runtimeStatus ?? (result.model.status === "model_assisted" ? "completed" : "fallback"),
        detail: result.providerIssue ? `${result.providerIssue}${result.providerResponseStatus ? ` · HTTP ${result.providerResponseStatus}` : ""}` : undefined,
        evidenceIds: result.evidenceIds,
        ...base,
      });
      send({ ...result, kind: "meta", agentMode: result.model.status === "model_assisted" ? "model_assisted" : "deterministic_fallback", serviceStatus: result.model.status, modelAssisted: result.model.status === "model_assisted", validationStatus: result.validationStatus ?? (result.model.status === "model_assisted" ? "accepted" : "fallback"), validationReasons: result.validationReasons ?? [], pipeline: ["verifier", "jev", "deepseek"], pipelineDetail: result.pipelineDetail });
      send({ kind: "answer", cls: "plain", text: result.answer, ...base, evidenceIds: result.evidenceIds });
      send({ kind: "done", ...base, evidenceIds: result.evidenceIds });
      res.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) {
        sendJson(res, message === "BATCH_NOT_FOUND" ? 404 : 500, { error: message, traceId, batchId });
      } else {
        res.write("data: " + JSON.stringify({ kind: "error", error: message, traceId, batchId }) + "\n\n");
        res.end();
      }
    } finally {
      releaseAgentSlot();
    }
    return true;
  }

  if (p === "/api/agent/query" && req.method === "POST") {
    const body = await readBody(req);
    const batchId = (typeof body.batchId === "string" ? body.batchId : BATCH_ID).trim().toUpperCase();
    const question = typeof body.question === "string" ? body.question.trim() : "";
    const locale = body.locale === "en" ? "en" : "zh";
    const traceId = requestTraceId(req);
    if (!question) { sendJson(res, 400, { error: "question_required", traceId, batchId }); return true; }
    const slot = tryAcquireAgentSlot();
    if (!slot.allowed) {
      res.writeHead(429, {
        "Content-Type": "application/json; charset=utf-8",
        "Retry-After": String(slot.retryAfterSeconds),
        "Cache-Control": "no-store",
        "X-TruthPass-Agent-Limit": String(AGENT_MAX_CONCURRENCY),
      });
      res.end(JSON.stringify({
        error: "AGENT_CONCURRENCY_LIMITED",
        status: "rate_limited",
        reason: "agent_concurrency_limit",
        traceId,
        active: slot.active,
        limit: AGENT_MAX_CONCURRENCY,
        retryAfterSeconds: slot.retryAfterSeconds,
      }));
      return true;
    }
    try {
      sendJson(res, 200, await runUnifiedAgentQuery(batchId, question, traceId, locale));
    } catch (error) {
      const status = error instanceof Error && error.message === "BATCH_NOT_FOUND" ? 404 : 500;
      sendJson(res, status, { error: error instanceof Error ? error.message : String(error), traceId, batchId });
    } finally {
      releaseAgentSlot();
    }
    return true;
  }

  if (p === "/api/agent/chat" && req.method === "POST") {
    const body = await readBody(req);
    const messages = Array.isArray(body.messages) ? body.messages as Array<{ content?: unknown }> : [];
    const last = typeof messages[messages.length - 1]?.content === "string" ? messages[messages.length - 1].content as string : "";
    const requestedBatch = typeof body.batchId === "string" ? body.batchId.trim().toUpperCase() : "";
    const locale = body.locale === "en" ? "en" : "zh";
    await consumerChat(req, requestedBatch || extractBatchId(last), last, res, locale);
    return true;
  }

  const productMatch = p.match(/^\/api\/products\/([^/]+)\/?$/);
  if (productMatch && req.method === "GET") {
    const batchId = productMatch[1].trim().toUpperCase();
    const b = demoBatchFor(batchId);
    const dbBatch = repository.getBatch(batchId);
    const dbProduct = dbBatch ? repository.getProduct(dbBatch.productId) : undefined;
    if (!b && !dbBatch) {
      sendJson(res, 404, { error: "batch not found" });
      return true;
    }
    const display = b ?? {
      name: dbProduct?.name ?? "演示批次",
      origin: "数据库已登记，原料来源待核实",
      productionDate: dbBatch?.productionAt.slice(0, 10) ?? "未登记",
      image: "/assets/fish-oil-product.png",
      passed: false,
    };
    const productParameters = parameterDetailsFor(batchId);
    const productProcess = productionProcessFor(batchId);
    const parameterOutsideRange = productParameters.some((item) => item.status === "outside_range");
    const productionIncomplete = productProcess.missingStages.length > 0;
    const productVerificationStatus = parameterOutsideRange
      ? "rejected"
      : productionIncomplete
        ? "review"
        : batchId === BATCH_ID
          ? (assessment.status === "accepted" ? "accepted" : "rejected")
          : (display.passed ? "accepted" : "rejected");
    const productVerificationSummary = parameterOutsideRange
      ? (b ? demoParameterDetail(b) : "存在需要复核的参数差异")
      : productionIncomplete
        ? `参数核验已完成，但生产过程仍缺少：${productProcess.missingStages.join("、")}`
        : batchId === BATCH_ID
          ? "基于数据库登记证据和确定性规则"
          : (display.passed ? "基于演示数据的综合判断" : (isRiceBatch(batchId) ? "大米演示资料仍有缺口" : b ? demoParameterDetail(b) : "当前批次缺少可展示的参数记录"));
    sendJson(res, 200, {
      batchId,
      // Demo fixtures and the public overview are the same batch source. Do
      // not let a repository seed with a different product label or date
      // silently override the fixture that the consumer is inspecting.
      name: b ? display.name : (dbProduct?.name ?? display.name),
      category: isRiceBatch(batchId) ? "粮食" : "鱼油",
      origin: display.origin,
      productionDate: b ? display.productionDate : (dbBatch?.productionAt.slice(0, 10) ?? display.productionDate),
      dataSource: b ? "fixtures" : "postgres",
      dataMode: dbBatch?.dataMode ?? "demo/synthetic",
      supplyChainTags: isRiceBatch(batchId)
        ? ["产地可查", "天气与土壤", "农残检测", "批次摘要待确认"]
        : ["来自纯净海域", "全程冷链", "多重检测", BOT_CHAIN_MAINNET.verifiedTransactions.some((item) => item.batchId === batchId) ? "历史回放可查" : "链上摘要待确认"],
      imageUrl: display.image,
      verification: {
        status: productVerificationStatus,
        summary: productVerificationSummary,
        scope: `${batchId} 批次及当前公开的规则 ${policy.version}`,
      },
      parameterDetails: productParameters,
      productionProcess: productProcess,
      keyMetrics: metricsFor(batchId),
    });
    return true;
  }

  const evidenceLinkMatch = p.match(/^\/api\/products\/([^/]+)\/evidence-link\/?$/);
  if (evidenceLinkMatch && req.method === "GET") {
    const batchId = evidenceLinkMatch[1].trim().toUpperCase();
    if (!demoBatchFor(batchId)) {
      sendJson(res, 404, { error: "batch not found" });
      return true;
    }
    sendJson(res, 200, evidenceFor(batchId));
    return true;
  }

  const productionMatch = p.match(/^\/api\/products\/([^/]+)\/production\/?$/);
  if (productionMatch && req.method === "GET") {
    const batchId = productionMatch[1].trim().toUpperCase();
    if (!demoBatchFor(batchId)) {
      sendJson(res, 404, { error: "batch not found" });
      return true;
    }
    sendJson(res, 200, productionProcessFor(batchId));
    return true;
  }

  const journeyMatch = p.match(/^\/api\/products\/([^/]+)\/journey\/?$/);
  if (journeyMatch && req.method === "GET") {
    const batchId = journeyMatch[1].trim().toUpperCase();
    const b = demoBatchFor(batchId);
    if (!b) {
      sendJson(res, 404, { error: "batch not found" });
      return true;
    }
    sendJson(res, 200, { batchId, status: b.passed ? "verified" : "review", steps: journeyFor(batchId) });
    return true;
  }

  const lifecycleMatch = p.match(/^\/api\/products\/([^/]+)\/lifecycle\/?$/);
  if (lifecycleMatch && req.method === "GET") {
    const batchId = lifecycleMatch[1].trim().toUpperCase();
    if (!demoBatchFor(batchId)) {
      sendJson(res, 404, { error: "batch not found" });
      return true;
    }
    sendJson(res, 200, lifecyclePublicView(batchId));
    return true;
  }

  const metricMatch = p.match(/^\/api\/products\/([^/]+)\/metrics\/([^/]+)\/?$/);
  if (metricMatch && req.method === "GET") {
    const batchId = metricMatch[1].trim().toUpperCase();
    const key = metricMatch[2];
    const b = demoBatchFor(batchId);
    if (!b) {
      sendJson(res, 404, { error: "batch not found" });
      return true;
    }
    const view = metricsFor(batchId).find((m) => m.key === key);
    if (!view) {
      sendJson(res, 404, { error: "metric not found" });
      return true;
    }
    const thresholds = policy.thresholds;
    sendJson(res, 200, {
      label: view.label,
      value: view.value,
      unit: view.unit,
      threshold: isRiceBatch(batchId)
        ? key === "pesticide" ? "按公开农残标准核验" : key === "origin" ? "必须绑定产地和批次" : "需要当前批次对应记录"
        : key === "epa-dha" ? `≥ ${thresholds.minEpaDhaPercent}%`
          : key === "peroxide" ? `≤ ${thresholds.maxPeroxideValue}`
          : key === "cold-chain" ? `≤ ${thresholds.maxLogisticsGapHours} 小时`
          : "Pb ≤ 0.5 · Hg ≤ 0.1 · Cd ≤ 0.1 · As ≤ 1.0 mg/kg",
      rule: view.rule,
      status: view.status,
      heavyMetals:
        key === "heavy-metal"
          ? (Object.keys(HEAVY_METAL_LIMITS) as Array<keyof HeavyMetals>).map((k) => ({
              name: HEAVY_METAL_LABELS[k],
              value: b.heavyMetals[k],
              limit: HEAVY_METAL_LIMITS[k],
              passed: b.heavyMetals[k] <= HEAVY_METAL_LIMITS[k],
            }))
          : undefined,
      sources: [
        {
          name: isRiceBatch(batchId) ? (key === "origin" ? "产地与土壤登记" : key === "weather" ? "田间天气记录" : key === "pesticide" ? "第三方农残报告" : "仓储运输记录") : (key === "cold-chain" ? "冷链温度传感器" : "SGS 检测报告"),
          method: isRiceBatch(batchId) ? "演示资料字段核验" : (key === "cold-chain" ? "每 5 分钟采样" : "第三方检测"),
          reportNo: isRiceBatch(batchId) ? `RICE-${batchId}` : (key === "cold-chain" ? "IOT-FO-2026-001" : "SGS-2026-1015-042"),
          pdf: isRiceBatch(batchId) ? "demo://rice-evidence" : "ipfs://QmDemo.../report.pdf",
          time: isRiceBatch(batchId) ? `${b.productionDate}T10:20:00Z` : inspectionEvidence!.occurredAt,
          signature: "0x...demo-signature",
        },
      ],
    });
    return true;
  }

  if (p === "/api/verification" && req.method === "GET") {
    const t = policy.thresholds;
    const batchId = (url.searchParams.get("batchId") || BATCH_ID).trim().toUpperCase();
    const b = demoBatchFor(batchId);
    if (!b) {
      sendJson(res, 404, { error: "unknown_batch", batchId });
      return true;
    }
    const rice = isRiceBatch(batchId);
    const riceMetrics = rice ? metricsFor(batchId) : [];
    const gate = demoVerificationGate(batchId, b);
    const verificationStatus = gate.status === "accepted" ? "accepted" : gate.status === "missing_evidence" ? "review" : "rejected";
    const allPassed = verificationStatus === "accepted";
    sendJson(res, 200, {
      batchId,
      productName: b.name,
      policy: { id: rice ? "rice-origin-policy" : policy.policyId, version: policy.version, dataMode: "demo/synthetic" },
      status: verificationStatus,
      score: rice ? (allPassed ? 92 : 61) : (allPassed ? 100 : 89),
      evidenceHash: evidenceHash(`${batchId}:verification`),
      serviceExecution: { status: verificationStatus, score: rice ? (allPassed ? 92 : 61) : (allPassed ? 100 : 75), evidenceHash: evidenceHash(`${batchId}:verification`) },
      reasons: gate.reasons,
      parameterDetails: gate.details,
      productionProcess: gate.productionEvidence,
      rules: [
        { name: rice ? "批次关系" : "任务匹配", desc: rice ? "产地、检测和物流资料绑定到同一批次" : "证据 taskId 与任务一致", passed: true },
        { name: "批次匹配", desc: `报告批次与请求批次一致（${batchId}）`, passed: true },
        { name: "时间逻辑", desc: "报告时间 ≥ 生产时间", passed: true },
        { name: rice ? "来源签发" : "签名有效", desc: rice ? "演示来源已登记，密码学签名尚未接入" : "实验室签名验证通过", passed: !rice },
        ...(rice
          ? riceMetrics.map((metric) => ({ name: metric.label, desc: `${metric.value} · ${metric.unit}`, passed: metric.status === "pass" }))
          : [
              { name: "物流连续", desc: `冷链 gap ${b.coldGap}h ≤ ${t.maxLogisticsGapHours}h`, passed: b.coldGap <= t.maxLogisticsGapHours },
              { name: "EPA+DHA", desc: `${b.epaDha}% ≥ ${t.minEpaDhaPercent}%`, passed: b.epaDha >= t.minEpaDhaPercent },
              { name: "过氧化值", desc: `${b.peroxide} ≤ ${t.maxPeroxideValue}`, passed: b.peroxide <= t.maxPeroxideValue },
              { name: "TOTOX", desc: `${b.totox} ≤ ${t.maxTotox}`, passed: b.totox <= t.maxTotox },
              { name: "冷链中断", desc: `${b.coldGap}h ≤ ${t.maxLogisticsGapHours}h`, passed: b.coldGap <= t.maxLogisticsGapHours },
            ]),
      ],
      evidence: rice
        ? evidenceFor(batchId).map((e) => ({
            evidenceId: `${batchId}-${e.step}`,
            kind: e.title,
            issuerId: e.source,
            sourceKind: "demo",
            payloadHash: e.hash,
            status: allPassed ? "submitted" : e.step > 3 ? "missing" : "submitted",
            occurredAt: e.verifiedAt,
          }))
      : repository.listEvidence(batchId).map((e) => ({
        evidenceId: e.evidenceId,
        kind: e.kind,
        issuerId: e.issuerId,
        sourceKind: e.sourceKind,
        payloadHash: e.payloadHash,
        status: e.status,
        occurredAt: e.occurredAt,
      })),
    });
    return true;
  }

  if (p === "/api/observer" && req.method === "GET") {
    const batchId = (url.searchParams.get("batchId") || BATCH_ID).trim().toUpperCase();
    const demoBatch = demoBatchFor(batchId);
    if (!demoBatch && !repository.getBatch(batchId)) {
      sendJson(res, 404, { error: "unknown_batch", batchId });
      return true;
    }
    const batchPassed = demoBatch?.passed ?? false;
    const ranking = await registry.evaluate(task);
    const receiptIndex = await receiptIndexForVerification();
    const liveReceipt = receiptIndex.find((item) =>
      item.batchId === batchId
      && (item.action === "purchase" || item.action === "recordPurchase" || item.action === "anchor" || item.action === "evidence")
      && /^(PurchaseRecorded|ConsumerPurchaseSubmitted|EvidenceAnchored|EvidenceSubmitted)$/i.test(item.event)
      && item.eventVerified === true
      && (item.receiptStatus === "0x1" || item.receiptStatus === "1"),
    );
    const replayReceipt = BOT_CHAIN_MAINNET.verifiedTransactions.find((item) => item.batchId === batchId);
    const chainStatus = liveReceipt ? "mainnet_receipt_verified" : replayReceipt ? "replay_verified" : "anchor_pending";
    sendJson(res, 200, {
      task: `task-${batchId.toLowerCase()}`,
      policy: `${policy.policyId}-${policy.version}`,
      jev: "route_to_rule · 0.94 · demo",
      evidenceRoot: evidenceHash(`${batchId}:root`).slice(0, 10) + "…",
      chainStatus: `BOT Chain Mainnet (677) · ${chainStatus}`,
      chainId: BOT_CHAIN_MAINNET.chainId,
      contractAddress: BOT_CHAIN_MAINNET.contractAddress,
      consumerGatewayAddress: BOT_CHAIN_MAINNET.contracts.consumerGateway.address,
      auditEscrowAddress: BOT_CHAIN_MAINNET.contracts.auditEscrow.address,
      explorerUrl: BOT_CHAIN_MAINNET.explorerUrl,
      verifiedTransactions: replayReceipt ? [replayReceipt] : [],
      currentReceipt: liveReceipt ? { txHash: liveReceipt.txHash, event: liveReceipt.event, explorerUrl: liveReceipt.explorerUrl, blockNumber: liveReceipt.blockNumber } : null,
      sessionTransactions: sessionChainTxs,
      services: ranking.map((r) => {
        const live = r.probe.status === "healthy" ? "online" : r.probe.status === "degraded" ? "degraded" : "offline";
        let verdict: string;
        if (r.probe.status === "offline") verdict = "not-called";
        else if (r.service.id === "lab-c") verdict = batchPassed ? "passed" : "rejected";
        else verdict = r.execution?.status === "accepted" ? "passed" : "rejected";
        return { id: r.service.id, history: r.service.historicalScore, live, verdict };
      }),
    });
    return true;
  }

  const feedbackSummaryMatch = p.match(/^\/api\/feedback\/summary\/?$/);
  if (feedbackSummaryMatch && req.method === "GET") {
    const batchId = (url.searchParams.get("batchId") || BATCH_ID).trim().toUpperCase();
    if (!demoBatchFor(batchId) && !repository.getBatch(batchId)) {
      sendJson(res, 404, { error: "批次不存在", batchId });
      return true;
    }
    sendJson(res, 200, { batchId, ...(await feedbackSummaryFor(batchId)), schemaVersion: "truthpass.feedback.summary.v1" });
    return true;
  }

  const tenantImprovementMatch = p.match(/^\/api\/tenants\/([^/]+)\/production-improvement-report\/?$/);
  if (tenantImprovementMatch && req.method === "GET") {
    const tenantId = decodeURIComponent(tenantImprovementMatch[1]);
    const ctx = await enterpriseRequestContext(req, tenantId);
    if (!ctx.authorized) {
      sendJson(res, ctx.error === "TENANT_AUTH_NOT_CONFIGURED" ? 503 : 401, { error: ctx.error, tenantId });
      return true;
    }
    const site = [...siteStore.values()].find((record) => String(record.config.tenantId) === tenantId);
    if (!site) {
      sendJson(res, 404, { error: "tenant_not_found", tenantId });
      return true;
    }
    const requestedBatch = (url.searchParams.get("batchId") || String((site.config.batch as Record<string, unknown> | undefined)?.defaultBatchId ?? BATCH_ID)).trim().toUpperCase();
    const siteBatch = String((site.config.batch as Record<string, unknown> | undefined)?.defaultBatchId ?? "").toUpperCase();
    if (!siteBatch || (isRiceBatch(siteBatch) !== isRiceBatch(requestedBatch))) {
      sendJson(res, 403, { error: "TENANT_BATCH_SCOPE_MISMATCH", tenantId, batchId: requestedBatch });
      return true;
    }
    try {
      const report = await buildProductionImprovementReport(tenantId, requestedBatch);
      try {
        await persistProductionImprovementReport(report);
      } catch (error) {
        sendJson(res, 503, { error: "improvement_report_persistence_failed", status: "persistence_failed", tenantId, batchId: requestedBatch, detail: error instanceof Error ? error.message : String(error) });
        return true;
      }
      sendJson(res, 200, { ...report, persisted: persistenceEnabled(), traceId: requestTraceId(req) });
    } catch (error) {
      sendJson(res, 404, { error: error instanceof Error ? error.message : "BATCH_NOT_FOUND", tenantId, batchId: requestedBatch });
    }
    return true;
  }

  if (p === "/api/production/improvement-report" && req.method === "GET") {
    const batchId = (url.searchParams.get("batchId") || BATCH_ID).trim().toUpperCase();
    const inspection = await mcpInspectBatch(batchId, requestTraceId(req));
    const unresolved = inspection.verification.status !== "accepted" ? inspection.verification.reasons : [];
    sendJson(res, 200, await buildProductionImprovementReport(isRiceBatch(batchId) ? "tenant-rice-demo" : "tenant-fish-oil-demo", batchId));
    return true;
  }

  if (p === "/api/feedback/prepare" && req.method === "POST") {
    try {
      const body = await readBody(req);
      if (body.consent !== true || body.purchaseConfirmed !== true) {
        sendJson(res, 400, { error: "准备反馈需要明确授权并确认已购买该批次", status: "consent_required" });
        return true;
      }
      const fields = validateFeedbackFields(body);
      if ("error" in fields) {
        sendJson(res, fields.status, { error: fields.error, status: "invalid_feedback" });
        return true;
      }
      const now = new Date();
      const createdAt = now.toISOString();
      const expiresAt = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
      const prepareId = sha256Hex32(`feedback-draft:${fields.batchId}:${fields.purchaseId}:${fields.purchaseTxHash}:${createdAt}:${Math.random()}`);
      const feedbackHash = sha256Hex32(JSON.stringify({
        batchId: fields.batchId,
        purchaseId: fields.purchaseId,
        purchaseTxHash: fields.purchaseTxHash,
        rating: fields.rating,
        categories: fields.categories,
        comment: fields.comment,
      }));
      const draft: FeedbackDraft = {
        prepareId,
        ...fields,
        feedbackHash,
        createdAt,
        expiresAt,
        consumed: false,
      };
      if (persistenceEnabled()) {
        try {
          await persistFeedbackDraft(draft);
        } catch (error) {
          sendJson(res, 503, {
            error: "反馈准备载荷未能持久化，请稍后重试",
            status: "persistence_failed",
            detail: error instanceof Error ? error.message : String(error),
          });
          return true;
        }
      }
      pendingFeedbackDrafts.set(prepareId, draft);
      const purchaseReceipt = await verifiedPurchaseReceipt(fields.purchaseId, fields.purchaseTxHash, fields.batchId, fields.walletAddress);
      sendJson(res, 200, {
        schemaVersion: "truthpass.feedback.prepare.v1",
        status: "pending_confirmation",
        prepareId,
        batchId: fields.batchId,
        purchaseId: fields.purchaseId,
        purchaseTxHash: fields.purchaseTxHash,
        walletAddress: fields.walletAddress,
        rating: fields.rating,
        categories: fields.categories,
        comment: fields.comment,
        feedbackHash,
        createdAt,
        expiresAt,
        purchaseReceiptStatus: purchaseReceipt ? "mainnet_receipt_verified" : "pending_or_unverified",
        contribution: {
          required: feedbackProductionMode() || fields.dataMode === "external",
          nextAction: "用户签名 Contribution 后，将 contributionTxHash 与 prepareId 一起提交 confirm。",
        },
        dataMode: fields.dataMode,
        note: "prepare 只生成待确认反馈载荷，不写入成功反馈；confirm 会重新核验同一 purchaseId、购买 txHash 和 receipt。",
      });
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error), status: "invalid_feedback" });
    }
    return true;
  }

  if (p === "/api/feedback/confirm" && req.method === "POST") {
    try {
      const body = await readBody(req);
      const prepareId = typeof body.prepareId === "string" ? body.prepareId.trim() : typeof body.draftId === "string" ? body.draftId.trim() : "";
      let draft: FeedbackDraft | undefined;
      if (prepareId) {
        try {
          draft = await feedbackDraftForRequest(prepareId);
        } catch (error) {
          sendJson(res, 503, {
            error: "反馈准备载荷读取失败，请稍后重试",
            status: "persistence_failed",
            detail: error instanceof Error ? error.message : String(error),
          });
          return true;
        }
      }
      if (prepareId && !draft) {
        sendJson(res, 404, { error: "反馈准备载荷不存在或已过期", status: "feedback_prepare_not_found" });
        return true;
      }
      if (draft && draft.consumed) {
        sendJson(res, 409, { error: "同一反馈准备载荷不能重复确认", status: "feedback_already_confirmed" });
        return true;
      }
      if (draft && Date.parse(draft.expiresAt) <= Date.now()) {
        pendingFeedbackDrafts.delete(draft.prepareId);
        sendJson(res, 410, { error: "反馈准备载荷已过期，请重新准备", status: "feedback_prepare_expired" });
        return true;
      }
      const mergedBody: Record<string, unknown> = {
        ...(draft ? {
          batchId: draft.batchId,
          purchaseId: draft.purchaseId,
          purchaseTxHash: draft.purchaseTxHash,
          walletAddress: draft.walletAddress,
          rating: draft.rating,
          categories: draft.categories,
          comment: draft.comment,
          dataMode: draft.dataMode,
        } : {}),
        ...body,
      };
      if (body.consent !== true || body.purchaseConfirmed !== true) {
        sendJson(res, 400, { error: "确认反馈需要明确授权并确认已购买该批次", status: "consent_required" });
        return true;
      }
      const fields = validateFeedbackFields(mergedBody);
      if ("error" in fields) {
        sendJson(res, fields.status, { error: fields.error, status: "invalid_feedback" });
        return true;
      }
      if (draft) {
        const sameDraft = fields.batchId === draft.batchId
          && fields.purchaseId.toLowerCase() === draft.purchaseId.toLowerCase()
          && fields.purchaseTxHash.toLowerCase() === draft.purchaseTxHash.toLowerCase()
          && fields.rating === draft.rating
          && fields.comment === draft.comment
          && JSON.stringify(fields.categories) === JSON.stringify(draft.categories)
          && fields.dataMode === draft.dataMode
          && (fields.walletAddress ?? "") === (draft.walletAddress ?? "");
        if (!sameDraft) {
          sendJson(res, 409, { error: "确认载荷与 prepare 返回内容不一致", status: "feedback_payload_mismatch" });
          return true;
        }
        if (typeof body.feedbackHash === "string" && body.feedbackHash.trim().toLowerCase() !== draft.feedbackHash.toLowerCase()) {
          sendJson(res, 409, { error: "feedbackHash 与 prepare 返回内容不一致", status: "feedback_hash_mismatch" });
          return true;
        }
      }
      const purchaseReceipt = await verifiedPurchaseReceipt(fields.purchaseId, fields.purchaseTxHash, fields.batchId, fields.walletAddress);
      if (!purchaseReceipt) {
        sendJson(res, 422, {
          error: "confirm 必须绑定同一 purchaseId、购买 txHash 和已核验 PurchaseRecorded receipt",
          status: "purchase_receipt_unverified",
          purchaseId: fields.purchaseId,
          purchaseTxHash: fields.purchaseTxHash,
          explorerUrl: `${BOT_CHAIN_MAINNET.explorerUrl}/tx/${fields.purchaseTxHash}`,
        });
        return true;
      }
      const contributionTxHash = typeof body.contributionTxHash === "string" ? body.contributionTxHash.trim() : "";
      const contributionId = typeof body.contributionId === "string" ? body.contributionId.trim() : undefined;
      const contributionRequired = feedbackProductionMode() || fields.dataMode === "external";
      if (contributionRequired && !/^0x[0-9a-fA-F]{64}$/.test(contributionTxHash)) {
        sendJson(res, 400, { error: "生产反馈确认必须提供已核验 contributionTxHash", status: "contribution_receipt_required" });
        return true;
      }
      const contributionReceipt = contributionTxHash
        ? await verifiedContributionReceipt(contributionTxHash, contributionId, fields.purchaseId, fields.batchId)
        : undefined;
      if (contributionTxHash && !contributionReceipt) {
        sendJson(res, 422, { error: "contributionTxHash 未在本服务中通过同一 purchaseId 的 receipt 核验", status: "contribution_receipt_unverified", contributionTxHash, explorerUrl: `${BOT_CHAIN_MAINNET.explorerUrl}/tx/${contributionTxHash}` });
        return true;
      }
      const consentRecord = await consumers.grantConsent({
        consumerId,
        batchId: fields.batchId,
        scopes: ["purchase", "packaging", "odor", "storage", "quality-feedback"],
        grantedAt: new Date().toISOString(),
      });
      const purchase = await consumers.recordPurchase({
        purchaseId: fields.purchaseId,
        consumerId,
        batchId: fields.batchId,
        purchaseProofHash: fields.purchaseTxHash,
        createdAt: new Date().toISOString(),
      });
      const feedback = await consumers.recordFeedback({
        purchaseId: purchase.purchaseId,
        rating: fields.rating,
        categories: fields.categories,
        evidence: {
          source: "verified_purchase_receipt",
          purchaseConfirmedByConsumer: true,
          purchaseTxHash: fields.purchaseTxHash,
          contributionTxHash: contributionTxHash || undefined,
          walletAddress: fields.walletAddress ?? purchaseReceipt.wallet,
          feedbackHash: draft?.feedbackHash ?? (typeof body.feedbackHash === "string" ? body.feedbackHash : undefined),
          comment: fields.comment,
          dataMode: fields.dataMode,
        },
      });
      const persisted = persistenceEnabled() && Boolean(repository.getBatch(fields.batchId));
      if (persisted) {
        try {
          await persistConsumerRun(consentRecord, purchase, feedback);
        } catch (error) {
          sendJson(res, 503, { error: "反馈已校验但未能持久化，请稍后重试", status: "persistence_failed" });
          return true;
        }
      }
      if (draft) {
        draft.consumed = true;
        try {
          if (persistenceEnabled()) await markFeedbackDraftConsumed(draft.prepareId);
          pendingFeedbackDrafts.set(draft.prepareId, draft);
        } catch (error) {
          sendJson(res, 503, {
            error: "反馈已写入但准备载荷状态未能持久化，请稍后重试读取结果",
            status: "persistence_failed",
            detail: error instanceof Error ? error.message : String(error),
          });
          return true;
        }
      }
      sendJson(res, 201, {
        schemaVersion: "truthpass.feedback.confirm.v1",
        ok: true,
        status: "feedback_confirmed",
        feedbackId: feedback.feedbackId,
        purchaseId: purchase.purchaseId,
        purchaseTxHash: fields.purchaseTxHash,
        contributionTxHash: contributionReceipt?.txHash,
        contributionReceiptStatus: contributionReceipt ? "mainnet_receipt_verified" : "not_provided_demo",
        evidenceHash: feedback.evidenceHash,
        feedbackHash: draft?.feedbackHash ?? body.feedbackHash,
        persisted,
        dataMode: fields.dataMode,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const duplicate = message.includes("同一购买记录只能提交一次") || message.includes("幂等键冲突");
      sendJson(res, duplicate ? 409 : 422, { error: message, status: duplicate ? "feedback_already_confirmed" : "feedback_confirm_failed" });
    }
    return true;
  }

  if (p === "/api/feedback" && req.method === "POST") {
    const body = await readBody(req);
    const batchId = typeof body.batchId === "string" ? body.batchId : "";
    const b = FISH_OIL_BATCHES[batchId];
    const rating = body.rating;
    const allowedCategories = ["包装完好", "无明显腥味", "批次可查", "口感不错", "日期新鲜", "物流快速", "保存方便"];
    const categories = Array.isArray(body.categories) ? body.categories.filter((value): value is string => typeof value === "string") : [];
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";
    const requestedDemoMode = body.dataMode === "demo/synthetic" || body.demoMode === true;
    if (feedbackProductionMode() && requestedDemoMode) {
      sendJson(res, 403, { error: "生产模式禁止使用旧接口提交 demo/synthetic 反馈，请使用 /api/feedback/prepare 和 /api/feedback/confirm", status: "production_feedback_requires_receipt" });
      return true;
    }
    const demoMode = requestedDemoMode && !feedbackProductionMode();
    const purchaseId = typeof body.purchaseId === "string" ? body.purchaseId.trim() : "";
    const txHash = typeof body.txHash === "string" ? body.txHash.trim() : "";
    if (body.consent !== true || body.purchaseConfirmed !== true) {
      sendJson(res, 400, { error: "提交反馈需要明确授权并确认已购买该批次" });
      return true;
    }
    if (!demoMode && (!/^0x[0-9a-fA-F]{64}$/.test(purchaseId) || !/^0x[0-9a-fA-F]{64}$/.test(txHash))) {
      sendJson(res, 400, { error: "生产反馈必须提供已核验 purchaseId 和 txHash；如为演示请显式标记 dataMode=demo/synthetic", status: "verified_purchase_required" });
      return true;
    }
    if (!b && !repository.getBatch(batchId)) {
      sendJson(res, 404, { error: "批次不存在或没有登记记录" });
      return true;
    }
    if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      sendJson(res, 400, { error: "评分必须是 1 到 5 的整数" });
      return true;
    }
    if (!categories.length || categories.length > allowedCategories.length || categories.some((category) => !allowedCategories.includes(category)) || new Set(categories).size !== categories.length) {
      sendJson(res, 400, { error: "反馈标签无效" });
      return true;
    }
    if (comment.length > 1000) {
      sendJson(res, 400, { error: "补充反馈最多 1000 字符" });
      return true;
    }
    const verifiedPurchase = demoMode || Boolean(await verifiedPurchaseReceipt(purchaseId, txHash, batchId));
    if (!demoMode && !verifiedPurchase) {
      sendJson(res, 422, { error: "txHash 未在本服务中通过 PurchaseRecorded receipt 核验", status: "purchase_receipt_unverified", txHash, explorerUrl: `${BOT_CHAIN_MAINNET.explorerUrl}/tx/${txHash}` });
      return true;
    }
    const consentRecord = await consumers.grantConsent({
      consumerId,
      batchId,
      scopes: ["purchase", "packaging", "odor", "storage", "quality-feedback"],
      grantedAt: new Date().toISOString(),
    });
    const freshPurchase = await consumers.recordPurchase({
      purchaseId: demoMode ? undefined : purchaseId,
      consumerId,
      batchId,
      purchaseProofHash: demoMode
        ? createHash("sha256").update("demo-purchase-proof:" + batchId + ":" + Date.now() + ":" + Math.random()).digest("hex")
        : txHash,
      createdAt: new Date().toISOString(),
    });
    const feedback = await consumers.recordFeedback({
      purchaseId: freshPurchase.purchaseId,
      rating,
      categories,
      evidence: { source: demoMode ? "demo/synthetic" : "verified_purchase_receipt", purchaseConfirmedByConsumer: true, txHash: demoMode ? undefined : txHash, comment, dataMode: demoMode ? "demo/synthetic" : "external" },
    });
    const persisted = persistenceEnabled() && Boolean(repository.getBatch(batchId));
    if (persisted) {
      try {
        await persistConsumerRun(consentRecord, freshPurchase, feedback);
      } catch (error) {
        console.error("消费者反馈持久化失败:", error instanceof Error ? error.message : String(error));
        sendJson(res, 503, { error: "反馈已生成但未能持久化，请稍后重试" });
        return true;
      }
    }
    if (b) {
      try {
        await mailer.sendMail({
          from: `"TruthPass" <${process.env.SMTP_USER}>`,
          to: process.env.FEEDBACK_EMAIL,
          subject: `TruthPass 消费者质量反馈 · ${batchId}`,
          text: [
            `批次号：${batchId}`,
            `商品：${b.name}`,
            `验证结论：${b.passed ? "通过验收" : "未通过验收"}`,
            `产地：${b.origin}`,
            `生产日期：${b.productionDate}`,
            `EPA+DHA：${b.epaDha}%（≥70%）`,
            `过氧化值：${b.peroxide} meq/kg（≤5）`,
            `冷链中断：${b.coldGap} 小时（≤6）`,
            `评分：${rating}`,
            `反馈标签：${categories.length ? categories.join("、") : "无"}`,
            `补充反馈：${comment || "无"}`,
            `共建积分：${feedback.contributionPoints}`,
            `证据哈希：${feedback.evidenceHash}`,
            `反馈编号：${feedback.feedbackId}`,
            "",
            demoMode ? "演示反馈：购买声明未作外部核验。" : `生产反馈：已核验 purchaseId=${freshPurchase.purchaseId}，txHash=${txHash}`,
          ].join("\n"),
        });
      } catch (error) {
        console.error("反馈邮件发送失败:", error instanceof Error ? error.message : String(error));
      }
    }
    sendJson(res, 200, {
      ok: true,
      persisted,
      feedbackId: feedback.feedbackId,
      purchaseId: freshPurchase.purchaseId,
      verifiedPurchaseId: demoMode ? undefined : purchaseId,
      contributionPoints: feedback.contributionPoints,
      evidenceHash: feedback.evidenceHash,
      dataMode: demoMode ? "demo/synthetic" : "external",
      chain: {
        chainId: BOT_CHAIN_MAINNET.chainId,
        consumerGatewayAddress: BOT_CHAIN_MAINNET.contracts.consumerGateway.address,
        evidenceAnchorAddress: BOT_CHAIN_MAINNET.contractAddress,
        explorerUrl: BOT_CHAIN_MAINNET.explorerUrl,
      },
    });
    return true;
  }

  return false;
}

export async function handleStatic(url: URL, res: ServerResponse): Promise<void> {
  const pathname = decodeURIComponent(url.pathname);
  const isLegacy = pathname === "/web-demo" || pathname.startsWith("/web-demo/");
  const root = isLegacy ? LEGACY_WEB : WEB;
  const relativePath = isLegacy ? pathname.slice("/web-demo".length) || "/" : pathname;
  const requestedFilePath = resolveStaticFilePath(root, relativePath);
  if (!requestedFilePath) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  const filePath = existsSync(requestedFilePath)
    ? requestedFilePath
    : (!isLegacy ? resolveStaticFilePath(root, "/index.html") : null);
  if (!filePath || !existsSync(filePath)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  try {
    const data = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    const mime: Record<string, string> = {
      ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
      ".jpg": "image/jpeg", ".ico": "image/x-icon",
    };
    res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

export function createApiServer(): ReturnType<typeof createServer> {
  return createServer(async (req, res) => {
  try {
    const forwardedProto = typeof req.headers["x-forwarded-proto"] === "string" ? req.headers["x-forwarded-proto"].split(",")[0]?.trim() : "";
    const protocol = forwardedProto === "https" ? "https" : "http";
    const host = typeof req.headers.host === "string" && req.headers.host ? req.headers.host : `localhost:${PORT}`;
    const url = new URL(req.url ?? "/", `${protocol}://${host}`);
    if (url.pathname === "/mcp" || url.pathname === "/api/mcp") {
      await mcpHttpHandler(req, res);
      return;
    }
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(url, req, res);
      if (!handled) sendJson(res, 404, { error: "not found" });
      return;
    }
    await handleStatic(url, res);
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
  });
}

const isDirectExecution = process.argv[1] !== undefined
  && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isDirectExecution && process.env.TRUTHPASS_DISABLE_LISTEN !== "1") {
  createApiServer().listen(PORT, () => {
    console.log(`TruthPass API 对接层已启动: http://localhost:${PORT}`);
  });
}
