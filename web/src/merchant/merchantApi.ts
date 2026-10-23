import type { AgentAuditRun, AuditExport, EvidenceIssue, MediaIntakePreview, MediaPresignResponse, MerchantBatchSummary, MerchantSource, MerchantSummary, ReconciliationResult } from "./types";
import { supabase } from "../lib/supabase";

const TENANT_ID = "demo-tenant";
const DEMO_BATCH = "FO-2026-001";
const MERCHANT_API_ENABLED = import.meta.env.VITE_TRUTHPASS_MERCHANT_API_ENABLED === "true";

export interface MerchantDemoConfig {
  tenantId?: string;
  brandName?: string;
  productId?: string;
  productName?: string;
  defaultBatchId?: string;
}

const demoIssues: EvidenceIssue[] = [
  { id: "ev-production-001", batchId: DEMO_BATCH, kind: "production", title: "生产记录", status: "passed", issuer: "合作工厂 A", signature: "not_checked", hash: "0x7a31…4c20", detail: "已关联成品批次和生产时间。", nextAction: "保持批次号和生产记录一致。" },
  { id: "ev-inspection-001", batchId: DEMO_BATCH, kind: "inspection", title: "第三方检测", status: "passed", issuer: "实验室 C", signature: "not_checked", hash: "0x4b29…aa18", detail: "报告指标已进入当前政策范围。", nextAction: "配置机构公钥后完成签名核验。" },
  { id: "ev-cold-chain-001", batchId: DEMO_BATCH, kind: "cold_chain", title: "冷链记录", status: "passed", issuer: "冷链服务 D", signature: "not_checked", hash: "0xc8f1…920e", detail: "当前 Demo 记录显示最大中断 2 小时。", nextAction: "接入真实温控记录。" },
  { id: "ev-shipment-001", batchId: DEMO_BATCH, kind: "shipment", title: "出货记录", status: "review", issuer: "物流服务 D", signature: "missing", hash: "0x91e2…b7d4", detail: "出货记录缺少真实机构签名。", nextAction: "补充物流机构公钥和签名材料。" },
];

const riceDemoIssues: EvidenceIssue[] = [
  { id: "ev-origin-001", batchId: "RC-2026-001", kind: "production", title: "产地与种植记录", status: "passed", issuer: "北境稻作农场", signature: "not_checked", hash: "0xrice…0r01", detail: "产地、土壤和种植时间已关联到当前批次。", nextAction: "接入真实农场签名和地块凭证。" },
  { id: "ev-pesticide-001", batchId: "RC-2026-001", kind: "inspection", title: "农残检测报告", status: "passed", issuer: "北境食品实验室", signature: "not_checked", hash: "0xrice…0r02", detail: "当前演示范围内的农残指标已登记。", nextAction: "配置检测机构公钥后完成签名核验。" },
  { id: "ev-storage-001", batchId: "RC-2026-001", kind: "cold_chain", title: "仓储记录", status: "passed", issuer: "北境仓储服务", signature: "not_checked", hash: "0xrice…0r03", detail: "仓储和温湿度记录已关联到当前批次。", nextAction: "接入真实仓储设备和出入库凭证。" },
  { id: "ev-shipment-001", batchId: "RC-2026-001", kind: "shipment", title: "出货与运输记录", status: "review", issuer: "北境物流服务", signature: "missing", hash: "0xrice…0r04", detail: "出货记录缺少真实物流机构签名。", nextAction: "补充物流机构公钥和运输交接材料。" },
];

const demoSummary: MerchantSummary = {
  tenantId: TENANT_ID,
  brandName: "海蓝营养",
  productCount: 1,
  batchCount: 3,
  reviewCount: 1,
  revokedCount: 0,
  feedbackCount: 18,
  source: "demo/synthetic",
  batches: [
    { batchId: DEMO_BATCH, productName: "深海鱼油软胶囊", policy: "fish-oil-quality@v1", status: "review", completeness: 75, source: "demo/synthetic", lastUpdated: "2026-10-15 08:00", issues: demoIssues },
    { batchId: "FO-2026-002", productName: "深海鱼油软胶囊", policy: "fish-oil-quality@v1", status: "rejected", completeness: 50, source: "demo/synthetic", lastUpdated: "2026-10-14 16:20", issues: [{ ...demoIssues[1], id: "ev-inspection-002", batchId: "FO-2026-002", status: "revoked", detail: "检测报告批次号与当前商品不匹配。", nextAction: "重新提交与批次一致的检测报告。" }] },
    { batchId: "FO-2026-003", productName: "深海鱼油软胶囊", policy: "fish-oil-quality@v1", status: "accepted_with_scope", completeness: 100, source: "demo/synthetic", lastUpdated: "2026-10-13 11:42", issues: demoIssues.map((item) => ({ ...item, batchId: "FO-2026-003", status: "passed" })) },
  ],
};

function demoConfig(config: MerchantDemoConfig = {}) {
  const defaultBatchId = config.defaultBatchId ?? DEMO_BATCH;
  const prefix = defaultBatchId.split("-")[0] || "FO";
  const brandName = config.brandName ?? "海蓝营养";
  const productName = config.productName ?? "深海鱼油软胶囊";
  const productId = config.productId ?? "product-fish-oil";
  const batchId = (suffix: string) => `${prefix}-2026-${suffix}`;
  return { ...config, tenantId: config.tenantId ?? TENANT_ID, brandName, productName, productId, defaultBatchId, prefix, batchId };
}

function buildDemoIssues(config: MerchantDemoConfig = {}): EvidenceIssue[] {
  const current = demoConfig(config);
  const template = current.productId === "rice-wuchang" || current.prefix === "RC" ? riceDemoIssues : demoIssues;
  return template.map((issue, index) => ({
    ...issue,
    id: `${current.prefix ?? current.defaultBatchId.split("-")[0].toLowerCase()}-${issue.kind}-${index + 1}`,
    batchId: current.defaultBatchId,
  }));
}

function buildDemoSummary(config: MerchantDemoConfig = {}): MerchantSummary {
  const current = demoConfig(config);
  const issues = buildDemoIssues(config);
  const batch2 = current.batchId("002");
  const batch3 = current.batchId("003");
  const rice = current.productId === "rice-wuchang" || current.prefix === "RC";
  const productPolicy = rice ? "rice-origin-policy@v1" : `${current.productId}-quality@v1`;
  const defaultStatus: MerchantBatchSummary["status"] = rice ? "accepted_with_scope" : "review";
  const defaultCompleteness = rice ? 82 : 75;
  const defaultIssues = rice ? issues.map((item) => item.kind === "shipment" ? item : { ...item, status: "passed" as const }) : issues;
  return {
    ...demoSummary,
    tenantId: current.tenantId,
    brandName: current.brandName,
    batches: [
      { batchId: current.defaultBatchId, productName: current.productName, policy: productPolicy, status: defaultStatus, completeness: defaultCompleteness, source: "demo/synthetic", lastUpdated: "2026-10-15 08:00", issues: defaultIssues },
      { batchId: batch2, productName: current.productName, policy: productPolicy, status: "rejected", completeness: rice ? 56 : 50, source: "demo/synthetic", lastUpdated: "2026-10-14 16:20", issues: [{ ...issues[1], id: `${current.defaultBatchId}-inspection-2`, batchId: batch2, status: "revoked", detail: rice ? "农残检测报告批次号与当前商品不匹配。" : "检测报告批次号与当前商品不匹配。", nextAction: rice ? "重新提交与批次一致的农残检测报告。" : "重新提交与批次一致的检测报告。" }] },
      { batchId: batch3, productName: current.productName, policy: productPolicy, status: "accepted_with_scope", completeness: 100, source: "demo/synthetic", lastUpdated: "2026-10-13 11:42", issues: issues.map((item) => ({ ...item, batchId: batch3, status: "passed" })) },
    ],
  };
}

export class MerchantApiError extends Error {
  readonly status: number;
  readonly code?: string;

  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = "MerchantApiError";
    this.status = status;
    this.code = code;
  }
}

function requestId(): string {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2);
  return `merchant-web-${Date.now().toString(36)}-${random}`.replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 120);
}

async function resolveTenantId(defaultTenantId: string): Promise<string> {
  if (!supabase) return defaultTenantId;
  const { data } = await supabase.auth.getSession();
  const metadata = data.session?.user.app_metadata ?? {};
  const userMetadata = data.session?.user.user_metadata ?? {};
  const claimed = metadata.tenantId ?? metadata.tenant_id ?? userMetadata.tenantId ?? userMetadata.tenant_id;
  return typeof claimed === "string" && /^[A-Za-z0-9._:-]{2,128}$/.test(claimed.trim()) ? claimed.trim() : defaultTenantId;
}

/** Enterprise calls carry the Supabase access token and the tenant scope.
 * The gateway token never enters browser code. */
export async function merchantRequestHeaders(tenantId: string, includeContentType = false): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    "X-TruthPass-Tenant": tenantId,
    "X-TruthPass-Request-Id": requestId(),
  };
  if (includeContentType) headers["Content-Type"] = "application/json";
  if (supabase) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function request<T>(url: string, init: RequestInit & { tenantId?: string } = {}): Promise<T> {
  const { tenantId, headers: requestHeaders, ...requestInit } = init;
  const authHeaders = tenantId ? await merchantRequestHeaders(tenantId) : {};
  const response = await fetch(url, { ...requestInit, headers: { ...authHeaders, ...(requestHeaders ?? {}) } });
  if (!response.ok) {
    let body: { error?: string; message?: string } = {};
    try { body = await response.json() as typeof body; } catch { /* non-json error */ }
    const message = body.message || body.error || `HTTP ${response.status}`;
    throw new MerchantApiError(response.status, message, body.error);
  }
  return response.json() as Promise<T>;
}

export async function loadMerchantSummary(tenantId = TENANT_ID, config: MerchantDemoConfig = {}): Promise<MerchantSummary> {
  const effectiveTenantId = await resolveTenantId(tenantId);
  const fallback = buildDemoSummary({ ...config, tenantId: effectiveTenantId });
  if (!MERCHANT_API_ENABLED) return { ...fallback, tenantId: effectiveTenantId, source: "demo/synthetic" };
  try {
    const result = await request<MerchantSummary>(`/api/tenants/${encodeURIComponent(effectiveTenantId)}/summary`, { tenantId: effectiveTenantId });
    return { ...result, source: "external" };
  } catch (error) {
    if (error instanceof MerchantApiError && [401, 403, 503].includes(error.status)) throw error;
    return { ...fallback, tenantId: effectiveTenantId, source: "demo/synthetic" };
  }
}

export async function validateMerchantBatch(tenantId: string, batchId: string, config: MerchantDemoConfig = {}): Promise<MerchantBatchSummary> {
  const fallbackSummary = buildDemoSummary({ ...config, tenantId });
  const fallback = fallbackSummary.batches.find((batch) => batch.batchId === batchId) ?? fallbackSummary.batches[0];
  if (!MERCHANT_API_ENABLED) return { ...fallback, source: "demo/synthetic" };
  try {
    const result = await request<{ batchId: string; status: MerchantBatchSummary["status"]; dataMode: MerchantSource; checks: Array<{ code: string; status: string; evidenceIds: string[] }>; reasons: string[] }>(`/api/tenants/${encodeURIComponent(tenantId)}/evidence/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batchId }),
      tenantId,
    });
    return { ...fallback, batchId: result.batchId, status: result.status, source: result.dataMode, lastUpdated: new Date().toLocaleString("zh-CN") };
  } catch (error) {
    if (error instanceof MerchantApiError && [401, 403, 503].includes(error.status)) throw error;
    return { ...fallback, source: "demo/synthetic", lastUpdated: new Date().toLocaleString("zh-CN") };
  }
}

export async function importDemoEvidence(tenantId: string, batchId: string, kind: EvidenceIssue["kind"], config: MerchantDemoConfig = {}): Promise<{ ok: boolean; source: MerchantSource; message: string }> {
  const item = buildDemoIssues(config).find((issue) => issue.kind === kind) ?? buildDemoIssues(config)[0];
  if (!MERCHANT_API_ENABLED) return { ok: true, source: "demo/synthetic", message: `已在 Demo 模式导入${item.title}，未写入真实企业数据。` };
  try {
    await request(`/api/tenants/${encodeURIComponent(tenantId)}/evidence/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      tenantId,
      body: JSON.stringify({
        schemaVersion: "evidence.v1",
        brandId: "brand-demo",
        productId: config.productId ?? "product-fish-oil",
        batchId,
        evidenceId: `${item.id}-${Date.now()}`,
        kind,
        issuerId: item.issuer,
        sourceKind: kind === "inspection" ? "third_party" : "manufacturer",
        occurredAt: new Date().toISOString(),
        payload: { source: "merchant-ui", demo: true, batchId },
        dataMode: "external",
      }),
    });
    return { ok: true, source: "external", message: "证据已提交到企业 API。" };
  } catch (error) {
    if (error instanceof MerchantApiError && [401, 403, 503].includes(error.status)) throw error;
    return { ok: true, source: "demo/synthetic", message: `已在 Demo 模式导入${item.title}，未写入真实企业数据。` };
  }
}

export async function exportMerchantAudit(tenantId: string, config: MerchantDemoConfig = {}): Promise<AuditExport> {
  const fallback = buildDemoSummary({ ...config, tenantId });
  const fallbackIssues = fallback.batches.flatMap((batch) => batch.issues);
  if (!MERCHANT_API_ENABLED) {
    return {
      tenantId,
      exportedAt: new Date().toISOString(),
      evidence: fallbackIssues.map((issue) => ({ evidenceId: issue.id, batchId: issue.batchId, kind: issue.kind, payloadHash: issue.hash, status: issue.status, payloadRef: null })),
      events: [{ eventId: "demo-audit-001", eventType: "batch_validated", requestId: "demo-request", batchId: fallback.batches[0]?.batchId, createdAt: new Date().toISOString() }],
    };
  }
  try {
    return await request<AuditExport>(`/api/tenants/${encodeURIComponent(tenantId)}/audit/export`, { tenantId });
  } catch (error) {
    if (error instanceof MerchantApiError && [401, 403, 503].includes(error.status)) throw error;
    return {
      tenantId,
      exportedAt: new Date().toISOString(),
      evidence: fallbackIssues.map((issue) => ({ evidenceId: issue.id, batchId: issue.batchId, kind: issue.kind, payloadHash: issue.hash, status: issue.status, payloadRef: null })),
      events: [{ eventId: "demo-audit-001", eventType: "batch_validated", requestId: "demo-request", batchId: fallback.batches[0]?.batchId, createdAt: new Date().toISOString() }],
    };
  }
}

export async function requestMediaPresign(
  tenantId: string,
  input: { fileName: string; contentType: string; size: number; contentHash?: string },
): Promise<MediaPresignResponse> {
  return request<MediaPresignResponse>(`/api/tenants/${encodeURIComponent(tenantId)}/media/presign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    tenantId,
  });
}

export async function prepareMediaIntake(
  tenantId: string,
  input: { brandId: string; productId: string; batchId: string; evidenceKind: "production" | "inspection" | "cold_chain" | "shipment"; mediaKind: "photo" | "video" | "pdf" | "voice" | "sensor"; issuerId: string; sourceKind: string; capturedAt: string; contentHash: string; rawObjectRef?: string; dataMode?: MerchantSource },
): Promise<MediaIntakePreview> {
  return request<MediaIntakePreview>(`/api/tenants/${encodeURIComponent(tenantId)}/evidence/intake`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    tenantId,
  });
}

export async function reconcileMerchantBatch(tenantId: string, batchId: string): Promise<ReconciliationResult> {
  return request<ReconciliationResult>(`/api/tenants/${encodeURIComponent(tenantId)}/evidence/reconcile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ batchId }),
    tenantId,
  });
}

export async function loadAgentAuditRun(tenantId: string, runId: string): Promise<AgentAuditRun> {
  return request<AgentAuditRun>(`/api/tenants/${encodeURIComponent(tenantId)}/agent-runs/${encodeURIComponent(runId)}`, { tenantId });
}

export { DEMO_BATCH, TENANT_ID };
