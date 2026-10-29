export type MerchantSource = "external" | "demo/synthetic";
export type EvidenceReviewStatus = "passed" | "review" | "missing" | "revoked";

export interface EvidenceIssue {
  id: string;
  batchId: string;
  kind: "production" | "inspection" | "cold_chain" | "shipment";
  title: string;
  status: EvidenceReviewStatus;
  issuer: string;
  signature: "verified" | "not_checked" | "invalid" | "missing";
  hash: string;
  detail: string;
  nextAction: string;
}

export interface MerchantBatchSummary {
  batchId: string;
  productName: string;
  policy: string;
  status: "accepted_with_scope" | "review" | "rejected";
  completeness: number;
  source: MerchantSource;
  lastUpdated: string;
  issues: EvidenceIssue[];
}

export interface MerchantSummary {
  tenantId: string;
  brandName: string;
  productCount: number;
  batchCount: number;
  reviewCount: number;
  revokedCount: number;
  feedbackCount: number;
  source: MerchantSource;
  batches: MerchantBatchSummary[];
}

export interface MediaPresignResponse {
  schemaVersion: "truthpass.media.presign.v1";
  tenantId: string;
  uploadId: string;
  method: "PUT";
  uploadUrl: string;
  headers: Record<string, string | undefined>;
  rawObjectRef: string;
  expiresAt: string;
  dataMode: MerchantSource;
  storageMode: "object_storage" | "presign_preview";
  nextAction: string;
  requestId: string;
  traceId: string;
}

export interface MediaRecognitionDraft {
  status: "provider_unconfigured" | "needs_confirmation" | "ready_for_review";
  provider: string;
  kind: "ocr" | "asr" | "none";
  fields: Array<{ name: string; value: string | null; confidence: number | null }>;
  note: string;
}

export interface MediaIntakePreview {
  schemaVersion: "truthpass.enterprise.media-intake.v1";
  tenantId: string;
  requestId: string;
  traceId: string;
  status: "awaiting_confirmation";
  nextAction: string;
  recognition?: MediaRecognitionDraft;
  evidence: {
    evidenceId: string;
    batchId: string;
    sampleId?: string;
    kind: "production" | "inspection" | "cold_chain" | "shipment";
    issuerId: string;
    sourceKind: string;
    occurredAt: string;
    dataMode: MerchantSource;
    payload: { mediaKind: string; contentHash: string; rawObjectRef?: string };
  };
}

export interface ReconciliationResult {
  schemaVersion: "truthpass.enterprise.reconciliation.v1";
  tenantId: string;
  batchId: string;
  status: "passed" | "review" | "conflict";
  reasons: string[];
  checks: Array<{ code: string; status: string; evidenceIds: string[]; detail: string }>;
  evidenceIds: string[];
}

export interface AgentAuditRun {
  schemaVersion: "truthpass.agent.audit-read.v1";
  tenantId: string;
  runId: string;
  traceId: string;
  run: {
    batchId: string;
    question: string;
    dataMode: MerchantSource;
    createdAt: string;
    records: Array<{ role: string; inputEvidenceIds: string[]; citedEvidenceIds?: string[]; selectedFactIds?: string[]; outputStatus: string; writeBoundary: string }>;
    finalDecisionSource: string;
  };
}

export interface AuditExport {
  tenantId: string;
  exportedAt: string;
  evidence: Array<{ evidenceId: string; batchId: string; kind: string; payloadHash: string; status: string; payloadRef: string | null }>;
  events: Array<{ eventId: string; eventType: string; requestId: string; batchId?: string; evidenceId?: string; createdAt: string }>;
}
