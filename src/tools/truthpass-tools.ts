import { buildJevContext, buildJevRoleView } from "../jev/context.js";
import type { JevRole, JevRoleView } from "../jev/model.js";
import { getPolicySnapshot } from "../rules/policy.js";
import { assessProductBatch, verifyServiceExecution } from "../verifier.js";
import type {
  BatchRecord,
  EvidenceRecord,
} from "../data/model.js";
import type { MemoryDataRepository } from "../data/repository.js";
import type { ExecutionEvidence, ProductBatchAssessment, ServiceExecutionResult, SignatureVerification, TaskRequest } from "../types.js";
import type { PolicySnapshot } from "../rules/policy.js";
import { attestationReplayKey, verifyEvidenceAttestation, type ReplayGuard, type TrustedIssuerKeyResolver } from "../security/evidence-signatures.js";

export class ToolBoundaryError extends Error {
  constructor(message: string, readonly code: string) {
    super(message);
  }
}

export type AgentToolName =
  | "getBatch"
  | "getEvidenceView"
  | "getPolicy"
  | "verifyServiceExecution"
  | "assessProductBatch"
  | "listEvidenceMetadata";

const sharedTools = ["getBatch", "getEvidenceView", "listEvidenceMetadata"] as const;
const roleToolAllowlist: Record<JevRole, readonly AgentToolName[]> = {
  production: sharedTools,
  inspection: [...sharedTools, "getPolicy", "verifyServiceExecution", "assessProductBatch"],
  consumer_feedback: sharedTools,
};

export function getAgentToolAllowlist(role: JevRole): readonly AgentToolName[] {
  return [...roleToolAllowlist[role]];
}

export class TruthPassTools {
  #repository: MemoryDataRepository;
  #role: JevRole;
  #resolveTrustedKey?: TrustedIssuerKeyResolver;
  #allowSyntheticEvidence: boolean;
  #replayGuard?: ReplayGuard;

  constructor(repository: MemoryDataRepository, role: JevRole, resolveTrustedKey?: TrustedIssuerKeyResolver, allowSyntheticEvidence = false, replayGuard?: ReplayGuard) {
    this.#repository = repository;
    this.#role = role;
    this.#resolveTrustedKey = resolveTrustedKey;
    this.#allowSyntheticEvidence = allowSyntheticEvidence;
    this.#replayGuard = replayGuard;
  }

  getBatch(input: { batchId: string }): BatchRecord {
    this.requireTool("getBatch");
    const batch = this.#repository.getBatch(input.batchId);
    if (!batch) throw new ToolBoundaryError("batch 不存在", "BATCH_NOT_FOUND");
    return structuredClone(batch);
  }

  getEvidenceView(input: { batchId: string }): JevRoleView {
    this.requireTool("getEvidenceView");
    try {
      return structuredClone(buildJevRoleView(buildJevContext(this.#repository, input.batchId), this.#role));
    } catch (error) {
      throw new ToolBoundaryError(String(error instanceof Error ? error.message : error), "EVIDENCE_VIEW_FAILED");
    }
  }

  getPolicy(input: { policyId: string; policyVersion: string }): PolicySnapshot {
    this.requireTool("getPolicy");
    try {
      return structuredClone(getPolicySnapshot(input.policyId, input.policyVersion));
    } catch (error) {
      throw new ToolBoundaryError(String(error instanceof Error ? error.message : error), "POLICY_NOT_FOUND");
    }
  }

  async verifyServiceExecution(input: { task: TaskRequest; evidenceId: string }): Promise<ServiceExecutionResult> {
    this.requireTool("verifyServiceExecution");
    const loaded = await this.loadExecutionEvidence(input.task, input.evidenceId);
    return structuredClone(await verifyServiceExecution(input.task, loaded.evidence, loaded.signatureVerification));
  }

  async assessProductBatch(input: { task: TaskRequest; evidenceId: string }): Promise<ProductBatchAssessment> {
    this.requireTool("assessProductBatch");
    const loaded = await this.loadExecutionEvidence(input.task, input.evidenceId);
    return structuredClone(await assessProductBatch(input.task, loaded.evidence));
  }

  listEvidenceMetadata(batchId: string): Array<Pick<EvidenceRecord, "evidenceId" | "batchId" | "kind" | "issuerId" | "payloadHash" | "status">> {
    this.requireTool("listEvidenceMetadata");
    if (!this.#repository.getBatch(batchId)) throw new ToolBoundaryError("batch 不存在", "BATCH_NOT_FOUND");
    return structuredClone(this.#repository.listEvidence(batchId).map(({ evidenceId, batchId: id, kind, issuerId, payloadHash, status }) => ({ evidenceId, batchId: id, kind, issuerId, payloadHash, status })));
  }

  private requireTool(tool: AgentToolName): void {
    if (!roleToolAllowlist[this.#role].includes(tool)) {
      throw new ToolBoundaryError("当前角色无权调用工具 " + tool, "TOOL_FORBIDDEN");
    }
  }

  private async loadExecutionEvidence(task: TaskRequest, evidenceId: string): Promise<{ evidence: ExecutionEvidence; signatureVerification: SignatureVerification }> {
    if (task.acceptance.requireSignature !== true) {
      throw new ToolBoundaryError("鱼油任务必须要求服务签名验证", "TASK_POLICY_INVALID");
    }
    try {
      getPolicySnapshot(task.acceptance.policyId ?? "fish-oil-quality", task.acceptance.policyVersion ?? "v1");
    } catch {
      throw new ToolBoundaryError("任务引用了未知或未批准的 Policy", "TASK_POLICY_INVALID");
    }

    const record = this.#repository.getEvidence(evidenceId);
    if (!record) throw new ToolBoundaryError("已登记证据不存在", "EVIDENCE_NOT_FOUND");
    if (record.status === "revoked") throw new ToolBoundaryError("证据已撤销", "EVIDENCE_REVOKED");
    if (record.kind !== "inspection") throw new ToolBoundaryError("验收工具只接受 inspection 证据", "EVIDENCE_KIND_INVALID");
    let signatureVerification: SignatureVerification = this.#allowSyntheticEvidence && record.dataMode === "demo/synthetic"
      ? payloadSignatureFlag(record.payload) ? "demo" : "invalid"
      : "invalid";
    if (signatureVerification === "invalid" && record.dataMode === "external" && this.#resolveTrustedKey && this.#replayGuard && record.attestation && verifyEvidenceAttestation(record, this.#resolveTrustedKey)) {
      try {
        signatureVerification = await this.#replayGuard.reserve(attestationReplayKey(`evidence:${record.issuerId}`, record.attestation)) ? "verified" : "invalid";
      } catch {
        signatureVerification = "invalid";
      }
    }
    if (signatureVerification === "invalid") throw new ToolBoundaryError("证据签名缺失、无效或签发方密钥不受信任", "EVIDENCE_SIGNATURE_INVALID");
    if (record.batchId !== task.batchId) throw new ToolBoundaryError("证据不属于任务批次", "BATCH_MISMATCH");

    const batch = this.#repository.getBatch(record.batchId);
    if (!batch) throw new ToolBoundaryError("证据关联的 batch 不存在", "BATCH_NOT_FOUND");
    const payload = record.payload;
    for (const key of ["taskId", "reportBatchId"] as const) {
      if (typeof payload[key] !== "string" || payload[key] === "") {
        throw new ToolBoundaryError("inspection payload 缺少合法 " + key, "EVIDENCE_PAYLOAD_INVALID");
      }
    }
    if (!isFiniteNumber(payload.logisticsGapHours)) {
      throw new ToolBoundaryError("inspection payload 缺少合法履约字段", "EVIDENCE_PAYLOAD_INVALID");
    }
    for (const key of ["epaDhaPercent", "peroxideValue", "totox", "coldChainGapHours"] as const) {
      if (payload[key] !== undefined && !isFiniteNumber(payload[key])) {
        throw new ToolBoundaryError("inspection payload 的 " + key + " 必须为数字", "EVIDENCE_PAYLOAD_INVALID");
      }
    }

    return { signatureVerification, evidence: {
      serviceId: record.issuerId,
      taskId: payload.taskId as string,
      batchId: record.batchId,
      reportBatchId: payload.reportBatchId as string,
      productionTime: batch.productionAt,
      reportTime: record.occurredAt,
      logisticsGapHours: payload.logisticsGapHours,
      signatureValid: signatureVerification === "demo" ? true : undefined,
      epaDhaPercent: payload.epaDhaPercent as number | undefined,
      peroxideValue: payload.peroxideValue as number | undefined,
      totox: payload.totox as number | undefined,
      coldChainGapHours: payload.coldChainGapHours as number | undefined,
      payload,
    } };
  }
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function payloadSignatureFlag(payload: Record<string, unknown>): boolean {
  return payload.signatureValid === true;
}
