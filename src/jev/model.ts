import type { EvidenceEnvelope } from "../evidence.js";

export const JEV_SCHEMA_VERSION = "jev-truthpass-state-v1" as const;

export type JevRoute =
  | "route_to_rule_verifier"
  | "request_more_evidence"
  | "route_to_recheck"
  | "reject_evidence";

export type JevNextAction = "run_deterministic_verifier" | "collect_evidence" | "run_recheck" | "stop";

export interface JevEvidenceRef {
  eventId: string;
  kind: string;
  payloadHash: string;
}

export interface JevStateSummary {
  reportBatchMatches: boolean;
  epaDhaPresent: boolean;
  peroxidePresent: boolean;
  totoxPresent: boolean;
  coldChainPresent: boolean;
  heavyMetalsPresent?: boolean;
  serviceOnline?: boolean;
  signatureValid: boolean;
  /** Optional machine-produced conflict signals. */
  conflictCodes?: string[];
  [key: string]: boolean | string[] | undefined;
}

export interface JevState {
  taskId: string;
  batchId: string;
  policyId: string;
  requestedChecks: string[];
  evidenceRefs: JevEvidenceRef[];
  stateSummary: JevStateSummary;
  inputHash: string;
  schemaVersion: typeof JEV_SCHEMA_VERSION;
  createdAt?: string;
}

export interface JevDecision {
  taskId: string;
  decision: JevRoute;
  confidence: number;
  evidenceScope: string;
  missingEvidenceCodes: string[];
  conflictCodes: string[];
  selectedServiceIds: string[];
  nextAction: JevNextAction;
  modelId: string;
  modelVersion: string;
  inputHash: string;
  outputHash: string;
  expiresAt: string;
  schemaVersion?: typeof JEV_SCHEMA_VERSION;
  modelAssisted?: boolean;
}

export interface DecisionGate {
  decide(input: JevState): Promise<JevDecision>;
}

export interface JevProvider {
  decide(input: JevState, signal?: AbortSignal): Promise<unknown>;
}

export interface JevGateOptions {
  provider?: JevProvider;
  modelId?: string;
  modelVersion?: string;
  minConfidence?: number;
  ttlMs?: number;
  timeoutMs?: number;
  now?: () => Date;
}

/** Type guard for the model output boundary. */
export function isJevDecision(value: unknown): value is JevDecision {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<JevDecision>;
  return (
    typeof candidate.taskId === "string" &&
    typeof candidate.decision === "string" &&
    ["route_to_rule_verifier", "request_more_evidence", "route_to_recheck", "reject_evidence"].includes(candidate.decision) &&
    typeof candidate.confidence === "number" &&
    Number.isFinite(candidate.confidence) &&
    candidate.confidence >= 0 &&
    candidate.confidence <= 1 &&
    typeof candidate.evidenceScope === "string" &&
    Array.isArray(candidate.missingEvidenceCodes) &&
    candidate.missingEvidenceCodes.every((item) => typeof item === "string") &&
    Array.isArray(candidate.conflictCodes) &&
    candidate.conflictCodes.every((item) => typeof item === "string") &&
    Array.isArray(candidate.selectedServiceIds) &&
    candidate.selectedServiceIds.every((item) => typeof item === "string") &&
    typeof candidate.nextAction === "string" &&
    ["run_deterministic_verifier", "collect_evidence", "run_recheck", "stop"].includes(candidate.nextAction) &&
    typeof candidate.modelId === "string" &&
    typeof candidate.modelVersion === "string" &&
    typeof candidate.inputHash === "string" &&
    typeof candidate.outputHash === "string" &&
    typeof candidate.expiresAt === "string"
  );
}

/** Narrow a provider response and reject unknown enum values at the boundary. */
export function parseJevDecision(value: unknown): JevDecision | undefined {
  if (!isJevDecision(value)) return undefined;
  return {
    ...value,
    schemaVersion: value.schemaVersion ?? JEV_SCHEMA_VERSION,
    modelAssisted: value.modelAssisted ?? true,
  };
}

export type EnvelopeLike = Pick<EvidenceEnvelope, "eventId" | "payloadHash" | "eventType" | "issuer">;

