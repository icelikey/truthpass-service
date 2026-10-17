import type { AgentAuditRun, AuditExport, EvidenceIssue, MediaIntakePreview, MerchantBatchSummary, MerchantSource, MerchantSummary, ReconciliationResult } from "./types";

const TENANT_ID = "demo-tenant";
const DEMO_BATCH = "FO-2026-001";
const MERCHANT_API_ENABLED = import.meta.env.VITE_TRUTHPASS_MERCHANT_API_ENABLED === "true";

const demoIssues: EvidenceIssue[] = [
  { id: "ev-production-001", batchId: DEMO_BATCH, kind: "production", title: "生产记录", status: "passed", issuer: "合作工厂 A", signature: "not_checked", hash: "0x7a31…4c20", detail: "已关联成品批次和生产时间。", nextAction: "保持批次号和生产记录一致。" },
  { id: "ev-inspection-001", batchId: DEMO_BATCH, kind: "inspection", title: "第三方检测", status: "passed", issuer: "实验室 C", signature: "not_checked", hash: "0x4b29…aa18", detail: "报告指标已进入当前政策范围。", nextAction: "配置机构公钥后完成签名核验。" },
  { id: "ev-cold-chain-001", batchId: DEMO_BATCH, kind: "cold_chain", title: "冷链记录", status: "passed", issuer: "冷链服务 D", signature: "not_checked", hash: "0xc8f1…920e", detail: "当前 Demo 记录显示最大中断 2 小时。", nextAction: "接入真实温控记录。" },
  { id: "ev-shipment-001", batchId: DEMO_BATCH, kind: "shipment", title: "出货记录", status: "review", issuer: "物流服务 D", signature: "missing", hash: "0x91e2…b7d4", detail: "出货记录缺少真实机构签名。", nextAction: "补充物流机构公钥和签名材料。" },
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

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

export async function loadMerchantSummary(tenantId = TENANT_ID): Promise<MerchantSummary> {
  if (!MERCHANT_API_ENABLED) return { ...demoSummary, tenantId, source: "demo/synthetic" };
  try {
    const result = await request<MerchantSummary>(`/api/tenants/${encodeURIComponent(tenantId)}/summary`);
    return { ...result, source: "external" };
  } catch {
    return { ...demoSummary, tenantId, source: "demo/synthetic" };
  }
}

export async function validateMerchantBatch(tenantId: string, batchId: string): Promise<MerchantBatchSummary> {
  const fallback = demoSummary.batches.find((batch) => batch.batchId === batchId) ?? demoSummary.batches[0];
  if (!MERCHANT_API_ENABLED) return { ...fallback, source: "demo/synthetic" };
  try {
    const result = await request<{ batchId: string; status: MerchantBatchSummary["status"]; dataMode: MerchantSource; checks: Array<{ code: string; status: string; evidenceIds: string[] }>; reasons: string[] }>(`/api/tenants/${encodeURIComponent(tenantId)}/evidence/validate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ batchId }),
    });
    return { ...fallback, batchId: result.batchId, status: result.status, source: result.dataMode, lastUpdated: new Date().toLocaleString("zh-CN") };
  } catch {
    return { ...fallback, source: "demo/synthetic", lastUpdated: new Date().toLocaleString("zh-CN") };
  }
}

export async function importDemoEvidence(tenantId: string, batchId: string, kind: EvidenceIssue["kind"]): Promise<{ ok: boolean; source: MerchantSource; message: string }> {
  const item = demoIssues.find((issue) => issue.kind === kind) ?? demoIssues[0];
  if (!MERCHANT_API_ENABLED) return { ok: true, source: "demo/synthetic", message: `已在 Demo 模式导入${item.title}，未写入真实企业数据。` };
  try {
    await request(`/api/tenants/${encodeURIComponent(tenantId)}/evidence/import`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        schemaVersion: "evidence.v1",
        brandId: "brand-demo",
        productId: "product-fish-oil",
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
  } catch {
    return { ok: true, source: "demo/synthetic", message: `已在 Demo 模式导入${item.title}，未写入真实企业数据。` };
  }
}

export async function exportMerchantAudit(tenantId: string): Promise<AuditExport> {
  if (!MERCHANT_API_ENABLED) {
    return {
      tenantId,
      exportedAt: new Date().toISOString(),
      evidence: demoIssues.map((issue) => ({ evidenceId: issue.id, batchId: issue.batchId, kind: issue.kind, payloadHash: issue.hash, status: issue.status, payloadRef: null })),
      events: [{ eventId: "demo-audit-001", eventType: "batch_validated", requestId: "demo-request", batchId: DEMO_BATCH, createdAt: new Date().toISOString() }],
    };
  }
  try {
    return await request<AuditExport>(`/api/tenants/${encodeURIComponent(tenantId)}/audit/export`);
  } catch {
    return {
      tenantId,
      exportedAt: new Date().toISOString(),
      evidence: demoIssues.map((issue) => ({ evidenceId: issue.id, batchId: issue.batchId, kind: issue.kind, payloadHash: issue.hash, status: issue.status, payloadRef: null })),
      events: [{ eventId: "demo-audit-001", eventType: "batch_validated", requestId: "demo-request", batchId: DEMO_BATCH, createdAt: new Date().toISOString() }],
    };
  }
}

export async function prepareMediaIntake(
  tenantId: string,
  input: { brandId: string; productId: string; batchId: string; evidenceKind: "production" | "inspection" | "cold_chain" | "shipment"; mediaKind: "photo" | "video" | "pdf" | "voice" | "sensor"; issuerId: string; sourceKind: string; capturedAt: string; contentHash: string; rawObjectRef?: string; dataMode?: MerchantSource },
): Promise<MediaIntakePreview> {
  return request<MediaIntakePreview>(`/api/tenants/${encodeURIComponent(tenantId)}/evidence/intake`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

export async function reconcileMerchantBatch(tenantId: string, batchId: string): Promise<ReconciliationResult> {
  return request<ReconciliationResult>(`/api/tenants/${encodeURIComponent(tenantId)}/evidence/reconcile`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ batchId }),
  });
}

export async function loadAgentAuditRun(tenantId: string, runId: string): Promise<AgentAuditRun> {
  return request<AgentAuditRun>(`/api/tenants/${encodeURIComponent(tenantId)}/agent-runs/${encodeURIComponent(runId)}`);
}

export { DEMO_BATCH, TENANT_ID };
