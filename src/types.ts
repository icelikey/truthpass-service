export type ServiceKind = "supplier" | "lab" | "logistics" | "after-sales";
export type ProbeStatus = "healthy" | "degraded" | "offline";
/**
 * Verification is intentionally scoped.  `accepted` means every check in the
 * declared policy passed; `accepted_with_scope` means that the declared scope
 * passed while other fields were not covered; `review` is a safe failure
 * state for missing/ambiguous evidence; `rejected` is a deterministic hard
 * failure. `partial` is retained as a read-only compatibility value for old
 * consumers and is no longer emitted by the verifier.
 */
export type VerificationStatus = "accepted" | "accepted_with_scope" | "review" | "rejected" | "partial";

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

export interface TaskRequest {
  taskId: string;
  serviceKind: ServiceKind;
  capability: string;
  batchId: string;
  productionTime: string;
  acceptance: {
    requireSignature: boolean;
    maxLogisticsGapHours: number;
    minEpaDhaPercent?: number;
    maxPeroxideValue?: number;
    maxTotox?: number;
    requireColdChain?: boolean;
    /** Optional policy metadata used by the replayable verifier. */
    policyId?: string;
    policyVersion?: string;
    /** Fields that must be present before a result can be accepted. */
    requiredEvidence?: string[];
    /** A human-readable declared scope for accepted_with_scope results. */
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
  signatureValid: boolean;
  /** Fish-oil metrics are optional so the generic service layer remains reusable. */
  epaDhaPercent?: number;
  peroxideValue?: number;
  totox?: number;
  coldChainGapHours?: number;
  payload: Record<string, unknown>;
}

export interface VerificationResult {
  status: VerificationStatus;
  score: number;
  checks: Record<string, boolean>;
  reasons: string[];
  evidenceHash: string;
  /** The policy/version and scope are part of the result contract. */
  policyId?: string;
  policyVersion?: string;
  scope?: string[];
  missingCodes?: string[];
  conflictCodes?: string[];
  verifierVersion?: string;
  /** True only when a structured model gate participated before rules. */
  modelAssisted?: boolean;
}

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
