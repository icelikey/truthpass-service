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

export interface AuditExport {
  tenantId: string;
  exportedAt: string;
  evidence: Array<{ evidenceId: string; batchId: string; kind: string; payloadHash: string; status: string; payloadRef: string | null }>;
  events: Array<{ eventId: string; eventType: string; requestId: string; batchId?: string; evidenceId?: string; createdAt: string }>;
}
