import { createHash } from "node:crypto";
import { buildJevContext } from "../jev/context.js";
import { assessProductBatch } from "../verifier.js";
import type { MemoryDataRepository } from "../data/repository.js";
import type { ExecutionEvidence, TaskRequest } from "../types.js";
import { CLI_SCHEMA_VERSION, type CliVerificationResult } from "./cli-contract.js";

export async function runCliVerify(repository: MemoryDataRepository, task: TaskRequest, policy: { id: string; version: string }): Promise<CliVerificationResult> {
  const context = buildJevContext(repository, task.batchId);
  const evidence = repository.listEvidence(task.batchId);
  const execution = evidence.find((item) => item.kind === "inspection");
  const evidenceRoot = "0x" + createHash("sha256").update(evidence.map((item) => item.payloadHash).join("|")).digest("hex");
  if (!execution) {
    return {
      schemaVersion: CLI_SCHEMA_VERSION, dataClass: context.batch.dataMode, command: "verify", batchId: task.batchId,
      status: "missing_evidence", policy, evidence: evidence.map(toReference), evidenceRoot,
      anchor: { status: "not_requested", submitted: false }, reasons: ["当前批次没有检测证据"],
    };
  }
  const payload = execution.payload;
  const executionEvidence: ExecutionEvidence = {
    serviceId: execution.issuerId,
    taskId: task.taskId,
    batchId: execution.batchId,
    reportBatchId: typeof payload.reportBatchId === "string" ? payload.reportBatchId : execution.batchId,
    productionTime: context.batch.productionAt,
    reportTime: execution.occurredAt,
    logisticsGapHours: typeof payload.logisticsGapHours === "number" ? payload.logisticsGapHours : 0,
    signatureValid: payload.signatureValid === true,
    epaDhaPercent: numberValue(payload.epaDhaPercent),
    peroxideValue: numberValue(payload.peroxideValue),
    totox: numberValue(payload.totox),
    coldChainGapHours: numberValue(payload.coldChainGapHours) ?? coldChainGapFromRepository(evidence),
    payload,
  };
  const assessment = await assessProductBatch(task, executionEvidence);
  return {
    schemaVersion: CLI_SCHEMA_VERSION, dataClass: context.batch.dataMode, command: "verify", batchId: task.batchId,
    status: assessment.status === "accepted" ? "accepted" : "rejected", policy, assessment,
    evidence: evidence.map(toReference), evidenceRoot, anchor: { status: "not_requested", submitted: false }, reasons: assessment.reasons,
  };
}

function toReference(item: { evidenceId: string; kind: string; sourceKind: string; status: string; dataMode: "demo/synthetic" | "external" }) {
  return { evidenceId: item.evidenceId, kind: item.kind, sourceKind: item.sourceKind, status: item.status, dataMode: item.dataMode };
}

function numberValue(value: unknown): number | undefined { return typeof value === "number" && Number.isFinite(value) ? value : undefined; }

function coldChainGapFromRepository(evidence: Array<{ kind: string; payload: Record<string, unknown> }>): number | undefined {
  const record = evidence.find((item) => item.kind === "cold_chain");
  return record ? numberValue(record.payload.maxGapHours) : undefined;
}
