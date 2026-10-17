import { sha256Canonical } from "../evidence.js";
import type { EvidenceKind, SourceKind } from "../data/model.js";

export type MediaKind = "photo" | "video" | "pdf" | "voice" | "sensor";
export type MediaIntakeInput = {
  tenantId: string;
  brandId: string;
  productId: string;
  batchId: string;
  sampleId?: string;
  evidenceId?: string;
  evidenceKind: Extract<EvidenceKind, "production" | "inspection" | "cold_chain" | "shipment">;
  mediaKind: MediaKind;
  issuerId: string;
  sourceKind: SourceKind;
  capturedAt: string;
  contentHash: string;
  rawObjectRef?: string;
  dataMode?: "demo/synthetic" | "external";
  note?: string;
};

export type PreparedMediaEvidence = {
  schemaVersion: "evidence.v1";
  tenantId: string;
  brandId: string;
  productId: string;
  batchId: string;
  sampleId?: string;
  evidenceId: string;
  kind: MediaIntakeInput["evidenceKind"];
  issuerId: string;
  sourceKind: SourceKind;
  occurredAt: string;
  payload: {
    schemaVersion: "truthpass.media-evidence.v1";
    mediaKind: MediaKind;
    contentHash: string;
    rawObjectRef?: string;
    note?: string;
  };
  dataMode: "demo/synthetic" | "external";
  rawObjectRef?: string;
  status: "awaiting_confirmation";
};

const nonEmpty = (value: unknown, label: string): string => {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} 不能为空`);
  return value.trim();
};

const mediaKinds = new Set<MediaKind>(["photo", "video", "pdf", "voice", "sensor"]);
const evidenceKinds = new Set<MediaIntakeInput["evidenceKind"]>(["production", "inspection", "cold_chain", "shipment"]);
const sourceKinds = new Set<SourceKind>(["manufacturer", "third_party", "platform_device", "consumer"]);

export function prepareMediaEvidence(input: MediaIntakeInput): PreparedMediaEvidence {
  const tenantId = nonEmpty(input.tenantId, "tenantId");
  const brandId = nonEmpty(input.brandId, "brandId");
  const productId = nonEmpty(input.productId, "productId");
  const batchId = nonEmpty(input.batchId, "batchId");
  const issuerId = nonEmpty(input.issuerId, "issuerId");
  const capturedAt = nonEmpty(input.capturedAt, "capturedAt");
  const contentHash = nonEmpty(input.contentHash, "contentHash").toLowerCase();
  if (!/^0x[0-9a-f]{64}$/.test(contentHash)) throw new Error("contentHash 必须是 32 字节 SHA-256 哈希");
  if (!mediaKinds.has(input.mediaKind)) throw new Error("mediaKind 不受支持");
  if (!evidenceKinds.has(input.evidenceKind)) throw new Error("evidenceKind 不受支持");
  if (!sourceKinds.has(input.sourceKind)) throw new Error("sourceKind 不受支持");
  const evidenceId = input.evidenceId?.trim() || `media-${sha256Canonical([tenantId, batchId, input.mediaKind, contentHash]).slice(2, 26)}`;
  const payload = {
    schemaVersion: "truthpass.media-evidence.v1" as const,
    mediaKind: input.mediaKind,
    contentHash,
    ...(input.rawObjectRef ? { rawObjectRef: input.rawObjectRef.trim() } : {}),
    ...(input.note?.trim() ? { note: input.note.trim().slice(0, 500) } : {}),
  };
  return {
    schemaVersion: "evidence.v1",
    tenantId,
    brandId,
    productId,
    batchId,
    ...(input.sampleId?.trim() ? { sampleId: input.sampleId.trim() } : {}),
    evidenceId,
    kind: input.evidenceKind,
    issuerId,
    sourceKind: input.sourceKind,
    occurredAt: new Date(capturedAt).toISOString(),
    payload,
    dataMode: input.dataMode === "external" ? "external" : "demo/synthetic",
    ...(input.rawObjectRef ? { rawObjectRef: input.rawObjectRef.trim() } : {}),
    status: "awaiting_confirmation",
  };
}
