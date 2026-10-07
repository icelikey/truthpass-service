import { sha256Canonical, canonicalizeJson } from "../evidence.js";
import type { ExecutionEvidence, TaskRequest } from "../types.js";
import {
  JEV_SCHEMA_VERSION,
  type DecisionGate,
  type JevDecision,
  type JevEvidenceRef,
  type JevGateOptions,
  type JevProvider,
  type JevState,
  type JevStateSummary,
  parseJevDecision,
} from "./model.js";

function isExecutionEvidence(value: unknown): value is ExecutionEvidence {
  return !!value && typeof value === "object" && "taskId" in value && "batchId" in value && "payload" in value;
}

function asEvidenceList(value: ExecutionEvidence | ExecutionEvidence[] | Array<Record<string, unknown>>): Array<ExecutionEvidence | Record<string, unknown>> {
  return Array.isArray(value) ? value : [value];
}

function evidenceRef(value: ExecutionEvidence | Record<string, unknown>, index: number): JevEvidenceRef {
  const eventId = String((value as Record<string, unknown>).eventId ?? (value as ExecutionEvidence).serviceId ?? `evidence-${index + 1}`);
  const kind = String((value as Record<string, unknown>).eventType ?? (value as ExecutionEvidence).serviceId ?? "execution-evidence");
  const payloadHash = String((value as Record<string, unknown>).payloadHash ?? sha256Canonical((value as ExecutionEvidence).payload ?? value));
  return { eventId, kind, payloadHash };
}

/** Build the JEV input from code-owned fields; no model gets to author stateSummary. */
export function buildJevState(
  task: TaskRequest,
  evidence: ExecutionEvidence | ExecutionEvidence[] | Array<Record<string, unknown>>,
  options: { policyId?: string; requestedChecks?: string[]; createdAt?: string } = {},
): JevState {
  const entries = asEvidenceList(evidence);
  const first = entries[0];
  const execution = entries.find(isExecutionEvidence);
  const stateSummary: JevStateSummary = {
    reportBatchMatches: entries.every((item) => {
      const candidate = item as Partial<ExecutionEvidence>;
      return candidate.batchId === task.batchId && (candidate.reportBatchId === undefined || candidate.reportBatchId === task.batchId);
    }),
    epaDhaPresent: execution?.epaDhaPercent !== undefined,
    peroxidePresent: execution?.peroxideValue !== undefined,
    totoxPresent: execution?.totox !== undefined,
    coldChainPresent: execution?.coldChainGapHours !== undefined,
    heavyMetalsPresent: entries.some((item) => "heavyMetals" in item || "heavyMetalsPresent" in item),
    serviceOnline: true,
    signatureValid: entries.every((item) => (item as Partial<ExecutionEvidence>).signatureValid !== false),
    conflictCodes: [],
  };
  const refs = entries.map(evidenceRef);
  const requestedChecks = options.requestedChecks ?? [
    task.acceptance.minEpaDhaPercent === undefined ? undefined : "epa_dha",
    task.acceptance.maxPeroxideValue === undefined ? undefined : "oxidation",
    task.acceptance.maxTotox === undefined ? undefined : "totox",
    task.acceptance.requireColdChain ? "cold_chain" : undefined,
  ].filter((item): item is string => Boolean(item));
  const bare = {
    taskId: task.taskId,
    batchId: task.batchId,
    policyId: options.policyId ?? task.acceptance.policyId ?? "truthpass-default-v1",
    requestedChecks,
    evidenceRefs: refs,
    stateSummary,
    schemaVersion: JEV_SCHEMA_VERSION,
  };
  return {
    ...bare,
    inputHash: sha256Canonical(bare),
    createdAt: options.createdAt,
  };
}

function codesForState(input: JevState): { missing: string[]; conflicts: string[]; hardReject: boolean } {
  const missing: string[] = [];
  const conflicts = [...(input.stateSummary.conflictCodes ?? [])];
  const summary = input.stateSummary;
  if (!summary.reportBatchMatches) conflicts.push("BATCH_MISMATCH");
  if (!summary.signatureValid) conflicts.push("INVALID_SIGNATURE");
  if (summary.serviceOnline === false) conflicts.push("SERVICE_OFFLINE");
  for (const check of input.requestedChecks) {
    if (check === "epa_dha" && !summary.epaDhaPresent) missing.push("EPA_DHA_MISSING");
    if (check === "oxidation" && !summary.peroxidePresent) missing.push("PEROXIDE_MISSING");
    if (check === "totox" && !summary.totoxPresent) missing.push("TOTOX_MISSING");
    if (check === "cold_chain" && !summary.coldChainPresent) missing.push("COLD_CHAIN_MISSING");
    if (check === "heavy_metals" && !summary.heavyMetalsPresent) missing.push("HEAVY_METALS_NOT_COVERED");
  }
  return { missing, conflicts: [...new Set(conflicts)], hardReject: conflicts.includes("BATCH_MISMATCH") || conflicts.includes("INVALID_SIGNATURE") };
}

function expiration(now: Date, ttlMs: number): string {
  return new Date(now.getTime() + ttlMs).toISOString();
}

function outputHash(decision: Omit<JevDecision, "outputHash">): string {
  return sha256Canonical(decision);
}

function makeDecision(input: JevState, options: { now: Date; modelId: string; modelVersion: string; modelAssisted: boolean; ttlMs: number }): JevDecision {
  const { missing, conflicts, hardReject } = codesForState(input);
  const decision = hardReject
    ? "reject_evidence"
    : conflicts.length > 0
      ? "route_to_recheck"
      : missing.length > 0
        ? "request_more_evidence"
        : "route_to_rule_verifier";
  const nextAction = decision === "route_to_rule_verifier" ? "run_deterministic_verifier" : decision === "request_more_evidence" ? "collect_evidence" : decision === "route_to_recheck" ? "run_recheck" : "stop";
  const confidence = hardReject || conflicts.length > 0 ? 1 : missing.length > 0 ? 0.9 : 1;
  const unsigned: Omit<JevDecision, "outputHash"> = {
    taskId: input.taskId,
    decision,
    confidence,
    evidenceScope: input.requestedChecks.join(",") || "batch_identity",
    missingEvidenceCodes: missing,
    conflictCodes: conflicts,
    selectedServiceIds: input.evidenceRefs.map((item) => item.kind),
    nextAction,
    modelId: options.modelId,
    modelVersion: options.modelVersion,
    inputHash: input.inputHash,
    expiresAt: expiration(options.now, options.ttlMs),
    schemaVersion: JEV_SCHEMA_VERSION,
    modelAssisted: options.modelAssisted,
  };
  return { ...unsigned, outputHash: outputHash(unsigned) };
}

/** Deterministic fallback: safe even when JEV is unreachable. */
export class DeterministicDecisionGate implements DecisionGate {
  private readonly now: () => Date;
  private readonly ttlMs: number;

  constructor(options: { now?: () => Date; ttlMs?: number } = {}) {
    this.now = options.now ?? (() => new Date());
    this.ttlMs = options.ttlMs ?? 15 * 60_000;
  }

  async decide(input: JevState): Promise<JevDecision> {
    return makeDecision(input, { now: this.now(), ttlMs: this.ttlMs, modelId: "deterministic-fallback", modelVersion: "rules-v1", modelAssisted: false });
  }
}

function hasExpired(decision: JevDecision, now: Date): boolean {
  const expiry = Date.parse(decision.expiresAt);
  return !Number.isFinite(expiry) || expiry < now.getTime();
}

/**
 * Provider wrapper that validates output, hashes, expiry and confidence. Any
 * provider failure returns the deterministic decision gate; it never upgrades
 * a missing or conflicting proof to an accepted result.
 */
export class SafeJevDecisionGate implements DecisionGate {
  private readonly fallback: DeterministicDecisionGate;
  private readonly provider?: JevProvider;
  private readonly options: Required<Pick<JevGateOptions, "modelId" | "modelVersion" | "minConfidence" | "ttlMs" | "timeoutMs">> & Pick<JevGateOptions, "now">;

  constructor(options: JevGateOptions = {}) {
    this.provider = options.provider;
    this.options = {
      modelId: options.modelId ?? "jev",
      modelVersion: options.modelVersion ?? "adapter-unknown",
      minConfidence: options.minConfidence ?? 0.85,
      ttlMs: options.ttlMs ?? 15 * 60_000,
      timeoutMs: options.timeoutMs ?? 3_000,
      now: options.now,
    };
    this.fallback = new DeterministicDecisionGate({ now: options.now, ttlMs: this.options.ttlMs });
  }

  async decide(input: JevState): Promise<JevDecision> {
    if (!this.provider) return this.fallback.decide(input);
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        this.provider.decide(input, controller.signal),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new Error("JEV adapter timeout"));
          }, this.options.timeoutMs);
        }),
      ]);
      const decision = parseJevDecision(result);
      const now = this.options.now?.() ?? new Date();
      if (!decision || decision.taskId !== input.taskId || decision.inputHash !== input.inputHash || hasExpired(decision, now)) {
        return this.fallback.decide(input);
      }
      const unsigned = { ...decision } as Partial<JevDecision>;
      delete unsigned.outputHash;
      if (decision.outputHash !== outputHash(unsigned as Omit<JevDecision, "outputHash">)) return this.fallback.decide(input);
      if (decision.confidence < this.options.minConfidence && decision.decision === "route_to_rule_verifier") {
        const downgraded: Omit<JevDecision, "outputHash"> = {
          ...decision,
          decision: "route_to_recheck",
          conflictCodes: [...new Set([...decision.conflictCodes, "JEV_LOW_CONFIDENCE"])],
          nextAction: "run_recheck",
          modelAssisted: true,
        };
        return { ...downgraded, outputHash: outputHash(downgraded) };
      }
      return { ...decision, schemaVersion: JEV_SCHEMA_VERSION, modelAssisted: true };
    } catch {
      return this.fallback.decide(input);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}

/** Alias used by older integrations. */
export const JEVDecisionGate = SafeJevDecisionGate;

export function replayJevDecision(decision: JevDecision, input: JevState, now = new Date()): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (decision.taskId !== input.taskId) errors.push("taskId 不一致");
  if (decision.inputHash !== input.inputHash) errors.push("inputHash 不一致");
  if (hasExpired(decision, now)) errors.push("JEV 输出已过期");
  const unsigned = { ...decision } as Partial<JevDecision>;
  delete unsigned.outputHash;
  if (decision.outputHash !== outputHash(unsigned as Omit<JevDecision, "outputHash">)) errors.push("outputHash 不一致");
  return { valid: errors.length === 0, errors };
}

