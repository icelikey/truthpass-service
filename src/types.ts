import type { DataMode, EvidenceAttestation } from "./data/model.js";

export type ServiceKind = "supplier" | "lab" | "logistics" | "after-sales";
export type ProbeStatus = "healthy" | "degraded" | "offline";
export type ServiceExecutionStatus = "accepted" | "accepted_with_scope" | "review" | "rejected" | "partial";
export type ProductAssessmentStatus = "accepted" | "rejected" | "not_evaluated";

export interface ServiceCard {
  id: string;
  name: string;
  kind: ServiceKind;
  endpoint: string;
  capabilities: string[];
  signer: string;
  historicalScore: number;
  feedbackCount: number;
}

export type EvidenceMode = DataMode;
export type SignatureVerification = "verified" | "demo" | "invalid";

export interface TaskRequest {
  taskId: string;
  serviceKind: ServiceKind;
  capability: string;
  batchId: string;
  productionTime: string;
  acceptance: {
    requireSignature: boolean;
    /** Legacy threshold fields remain optional during the v1.2 schema merge. */
    maxLogisticsGapHours?: number;
    minEpaDhaPercent?: number;
    maxPeroxideValue?: number;
    maxTotox?: number;
    requireColdChain?: boolean;
    policyId?: string;
    policyVersion?: string;
    requiredEvidence?: string[];
    declaredScope?: string[];
  };
}

export interface ProbeResult {
  serviceId: string;
  status: ProbeStatus;
  latencyMs: number;
  capabilityMatch: boolean;
  schemaValid: boolean;
  checkedAt: string;
  reason?: string;
}

export interface ExecutionEvidence {
  serviceId: string;
  taskId: string;
  batchId: string;
  reportBatchId: string;
  productionTime: string;
  reportTime: string;
  logisticsGapHours: number;
  /** Demo-only claim. External evidence must use attestation and a trusted issuer key. */
  signatureValid?: boolean;
  attestation?: EvidenceAttestation;
  /** Fish-oil metrics are optional so the generic service layer remains reusable. */
  epaDhaPercent?: number;
  peroxideValue?: number;
  totox?: number;
  coldChainGapHours?: number;
  payload: Record<string, unknown>;
}

export interface ServiceExecutionResult {
  status: ServiceExecutionStatus;
  score: number;
  checks: Record<string, boolean>;
  reasons: string[];
  evidenceHash: string;
  policyId?: string;
  policyVersion?: string;
  verifierVersion?: string;
  missingCodes?: string[];
  conflictCodes?: string[];
  modelAssisted?: boolean;
}

export interface ProductBatchAssessment {
  status: ProductAssessmentStatus;
  policyId: string;
  policyVersion: string;
  score: number;
  checks: Record<string, boolean>;
  reasons: string[];
  evidenceHash: string;
}

/** Compatibility name used by the CLI/replay protocol. */
export type VerificationResult = ServiceExecutionResult & {
  policyId?: string;
  policyVersion?: string;
  scope?: string[];
  missingCodes?: string[];
  conflictCodes?: string[];
  verifierVersion?: string;
  modelAssisted?: boolean;
};

export interface FeedbackRecord {
  feedbackId: string;
  serviceId: string;
  taskId: string;
  accepted: boolean;
  score: number;
  evidenceHash: string;
  createdAt: string;
  revoked: boolean;
}

export interface ServiceAdapter {
  probe(task: TaskRequest): Promise<ProbeResult>;
  execute(task: TaskRequest): Promise<ExecutionEvidence>;
}
