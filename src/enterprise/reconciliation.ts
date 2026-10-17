import type { EvidenceKind } from "../data/model.js";
import type { EnterpriseEvidenceRecord } from "./pilot-store.js";

export type ReconciliationStatus = "passed" | "review" | "conflict";
export type ReconciliationCheck = {
  code: "required_kinds" | "batch_binding" | "sample_binding" | "temporal_order" | "duplicate_media" | "quantity_balance";
  status: "passed" | "missing" | "review" | "conflict";
  evidenceIds: string[];
  detail: string;
};

const REQUIRED_KINDS: readonly EvidenceKind[] = ["production", "inspection", "cold_chain", "shipment"];

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function payloadNumber(record: EnterpriseEvidenceRecord, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = asNumber(record.payload[key]);
    if (value !== undefined) return value;
  }
  return undefined;
}

export function reconcileBatch(batchId: string, records: EnterpriseEvidenceRecord[]) {
  const scoped = records.filter((record) => record.batchId === batchId && record.status === "submitted");
  const checks: ReconciliationCheck[] = [];
  const byKind = new Map<EvidenceKind, EnterpriseEvidenceRecord[]>();
  for (const record of scoped) byKind.set(record.kind, [...(byKind.get(record.kind) ?? []), record]);

  const missingKinds = REQUIRED_KINDS.filter((kind) => !(byKind.get(kind)?.length));
  checks.push({
    code: "required_kinds",
    status: missingKinds.length ? "missing" : "passed",
    evidenceIds: scoped.map((record) => record.evidenceId),
    detail: missingKinds.length ? `缺少：${missingKinds.join("、")}` : "生产、检测、冷链和出货均有登记记录。",
  });

  const wrongBatch = records.filter((record) => record.batchId !== batchId && scoped.some((item) => item.evidenceId === record.evidenceId));
  checks.push({
    code: "batch_binding",
    status: wrongBatch.length ? "conflict" : "passed",
    evidenceIds: wrongBatch.map((record) => record.evidenceId),
    detail: wrongBatch.length ? "同一证据编号被绑定到多个批次。" : "已登记证据均绑定当前批次。",
  });

  const inspection = byKind.get("inspection") ?? [];
  const missingSample = inspection.filter((record) => !record.sampleId);
  checks.push({
    code: "sample_binding",
    status: missingSample.length ? "review" : "passed",
    evidenceIds: missingSample.map((record) => record.evidenceId),
    detail: missingSample.length ? "检测记录缺少 sampleId，需要人工核对样品和批次关系。" : "检测记录已绑定样品。",
  });

  const ordered = [...scoped].sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  const productionAt = byKind.get("production")?.map((record) => record.occurredAt).sort()[0];
  const beforeProduction = productionAt ? ordered.filter((record) => record.kind !== "production" && record.occurredAt < productionAt) : [];
  checks.push({
    code: "temporal_order",
    status: beforeProduction.length ? "conflict" : "passed",
    evidenceIds: beforeProduction.map((record) => record.evidenceId),
    detail: beforeProduction.length ? "出现早于生产记录的后续环节数据。" : "时间顺序没有发现明显冲突。",
  });

  const mediaHashes = new Map<string, string[]>();
  for (const record of scoped) {
    const mediaHash = record.payload.mediaKind && typeof record.payload.contentHash === "string" ? record.payload.contentHash : undefined;
    if (mediaHash) mediaHashes.set(mediaHash, [...(mediaHashes.get(mediaHash) ?? []), record.evidenceId]);
  }
  const duplicateIds = [...mediaHashes.values()].filter((ids) => ids.length > 1).flat();
  checks.push({
    code: "duplicate_media",
    status: duplicateIds.length ? "review" : "passed",
    evidenceIds: duplicateIds,
    detail: duplicateIds.length ? "发现相同媒体哈希被多个证据记录引用。" : "没有发现重复媒体哈希。",
  });

  const productionQuantity = (byKind.get("production") ?? []).map((record) => payloadNumber(record, ["outputQuantity", "quantity"])).find((value) => value !== undefined);
  const shipmentQuantity = (byKind.get("shipment") ?? []).map((record) => payloadNumber(record, ["shipmentQuantity", "quantity"])).find((value) => value !== undefined);
  const quantityConflict = productionQuantity !== undefined && shipmentQuantity !== undefined && shipmentQuantity > productionQuantity;
  checks.push({
    code: "quantity_balance",
    status: quantityConflict ? "conflict" : productionQuantity === undefined || shipmentQuantity === undefined ? "review" : "passed",
    evidenceIds: [...(byKind.get("production") ?? []), ...(byKind.get("shipment") ?? [])].map((record) => record.evidenceId),
    detail: quantityConflict ? "出货数量高于已登记生产数量。" : productionQuantity === undefined || shipmentQuantity === undefined ? "尚无足够数量字段进行对账。" : "生产和出货数量没有发现超出关系。",
  });

  const status: ReconciliationStatus = checks.some((check) => check.status === "conflict")
    ? "conflict"
    : checks.some((check) => check.status === "missing" || check.status === "review")
      ? "review"
      : "passed";
  return {
    schemaVersion: "truthpass.enterprise.reconciliation.v1" as const,
    batchId,
    status,
    checks,
    reasons: checks.filter((check) => check.status !== "passed").map((check) => check.detail),
    evidenceIds: scoped.map((record) => record.evidenceId),
  };
}
