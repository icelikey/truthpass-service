import { canonicalizeJson } from "./evidence.js";
import { sha256Hex } from "./hash.js";
import type { JevDecision } from "./jev/model.js";
import type { ExecutionEvidence, TaskRequest, VerificationResult } from "./types.js";

export interface VerificationOptions {
  /** JEV is a routing gate; it can never override a failed deterministic check. */
  jevDecision?: Pick<JevDecision, "decision" | "confidence" | "missingEvidenceCodes" | "conflictCodes" | "modelAssisted">;
  verifierVersion?: string;
  /** Explicitly declared evidence scope, used for accepted_with_scope. */
  scope?: string[];
}
function parseUtc(value: string): number | undefined {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

/**
 * Deterministic fish-oil/service acceptance. The function deliberately uses
 * only code-owned values; JEV can request another route but cannot mark a
 * failed threshold as passed.
 */
export async function verifyExecution(
  task: TaskRequest,
  evidence: ExecutionEvidence,
  options: VerificationOptions = {},
): Promise<VerificationResult> {
  const production = parseUtc(evidence.productionTime);
  const report = parseUtc(evidence.reportTime);
  const taskProduction = parseUtc(task.productionTime);
  const checks = {
    taskMatches: evidence.taskId === task.taskId,
    batchMatches: evidence.batchId === task.batchId && evidence.reportBatchId === task.batchId,
    reportAfterProduction:
      production !== undefined && report !== undefined && taskProduction !== undefined ? report >= Math.max(production, taskProduction) : false,
    signatureValid: !task.acceptance.requireSignature || evidence.signatureValid,
    logisticsWithinLimit: evidence.logisticsGapHours <= task.acceptance.maxLogisticsGapHours,
    epaDhaWithinLimit:
      task.acceptance.minEpaDhaPercent === undefined ||
      (evidence.epaDhaPercent !== undefined && evidence.epaDhaPercent >= task.acceptance.minEpaDhaPercent),
    peroxideWithinLimit:
      task.acceptance.maxPeroxideValue === undefined ||
      (evidence.peroxideValue !== undefined && evidence.peroxideValue <= task.acceptance.maxPeroxideValue),
    totoxWithinLimit:
      task.acceptance.maxTotox === undefined ||
      (evidence.totox !== undefined && evidence.totox <= task.acceptance.maxTotox),
    coldChainWithinLimit:
      !task.acceptance.requireColdChain ||
      (evidence.coldChainGapHours !== undefined && evidence.coldChainGapHours <= task.acceptance.maxLogisticsGapHours),
  };

  const passed = Object.values(checks).filter(Boolean).length;
  const score = Math.round((passed / Object.keys(checks).length) * 100);
  const reasons: string[] = [];
  const missingCodes: string[] = [];
  const conflictCodes: string[] = [...(options.jevDecision?.conflictCodes ?? [])];

  if (!checks.taskMatches) {
    reasons.push("服务返回结果没有绑定到当前任务");
    conflictCodes.push("TASK_MISMATCH");
  }
  if (!checks.batchMatches) {
    reasons.push("检测报告批次与请求批次不一致");
    conflictCodes.push("BATCH_MISMATCH");
  }
  if (!checks.reportAfterProduction) {
    reasons.push("报告时间早于生产时间或时间格式无效");
    conflictCodes.push("REPORT_TIME_INVALID");
  }
  if (!checks.signatureValid) {
    reasons.push("结果缺少有效的服务签名");
    conflictCodes.push("INVALID_SIGNATURE");
  }
  if (!checks.logisticsWithinLimit) reasons.push("物流记录存在超出验收标准的中断");

  if (!checks.epaDhaWithinLimit) {
    if (evidence.epaDhaPercent === undefined && task.acceptance.minEpaDhaPercent !== undefined) {
      reasons.push("缺少 EPA+DHA 实测值");
      missingCodes.push("EPA_DHA_MISSING");
    } else reasons.push("EPA+DHA 实测含量低于任务要求");
  }
  if (!checks.peroxideWithinLimit) {
    if (evidence.peroxideValue === undefined && task.acceptance.maxPeroxideValue !== undefined) {
      reasons.push("缺少过氧化值检测值");
      missingCodes.push("PEROXIDE_MISSING");
    } else reasons.push("过氧化值高于任务要求");
  }
  if (!checks.totoxWithinLimit) {
    if (evidence.totox === undefined && task.acceptance.maxTotox !== undefined) {
      reasons.push("缺少 TOTOX 检测值");
      missingCodes.push("TOTOX_MISSING");
    } else reasons.push("TOTOX 高于任务要求");
  }
  if (!checks.coldChainWithinLimit) {
    if (evidence.coldChainGapHours === undefined && task.acceptance.requireColdChain) {
      reasons.push("缺少冷链温度证据");
      missingCodes.push("COLD_CHAIN_MISSING");
    } else reasons.push("冷链记录存在超温中断");
  }

  const requiredEvidence = task.acceptance.requiredEvidence ?? [];
  const payload = evidence.payload as Record<string, unknown>;
  for (const field of requiredEvidence) {
    const present = payload[field] !== undefined || (evidence as unknown as Record<string, unknown>)[field] !== undefined;
    if (!present) missingCodes.push(`${field.toUpperCase()}_MISSING`);
  }
  const uniqueMissingCodes = [...new Set([...missingCodes, ...(options.jevDecision?.missingEvidenceCodes ?? [])])];
  const uniqueConflictCodes = [...new Set(conflictCodes)];

  const hardFailure =
    !checks.taskMatches ||
    !checks.batchMatches ||
    !checks.reportAfterProduction ||
    !checks.signatureValid ||
    !checks.logisticsWithinLimit ||
    (evidence.epaDhaPercent !== undefined && !checks.epaDhaWithinLimit) ||
    (evidence.peroxideValue !== undefined && !checks.peroxideWithinLimit) ||
    (evidence.totox !== undefined && !checks.totoxWithinLimit) ||
    (evidence.coldChainGapHours !== undefined && !checks.coldChainWithinLimit);
  const missingOnly = !hardFailure && uniqueMissingCodes.length > 0;
  let status: VerificationResult["status"] = hardFailure ? "rejected" : missingOnly ? "review" : "accepted";

  const jevDecision = options.jevDecision?.decision;
  if (!hardFailure && jevDecision && jevDecision !== "route_to_rule_verifier") {
    status = jevDecision === "reject_evidence" ? "rejected" : "review";
    reasons.push(`JEV 路由为 ${jevDecision}，未进入最终通过`);
  }
  if (!hardFailure && options.jevDecision && options.jevDecision.confidence < 0.85) {
    status = "review";
    uniqueConflictCodes.push("JEV_LOW_CONFIDENCE");
    reasons.push("JEV 置信度低于验收门槛，需要复检");
  }
  if (!hardFailure && status === "accepted" && (options.scope ?? task.acceptance.declaredScope)?.length) {
    // A declared scope is explicit evidence coverage, not a claim about fields outside it.
    status = "accepted_with_scope";
  }

  const verifierVersion = options.verifierVersion ?? "deterministic-verifier-v1";
  const resultMaterial = {
    task,
    evidence,
    checks,
    score,
    status,
    missingCodes: uniqueMissingCodes,
    conflictCodes: uniqueConflictCodes,
    verifierVersion,
  };
  const evidenceHash = await sha256Hex(canonicalizeJson(resultMaterial));
  return {
    status,
    score,
    checks,
    reasons,
    evidenceHash,
    policyId: task.acceptance.policyId,
    policyVersion: task.acceptance.policyVersion,
    scope: options.scope ?? task.acceptance.declaredScope,
    missingCodes: uniqueMissingCodes,
    conflictCodes: uniqueConflictCodes,
    verifierVersion,
    modelAssisted: options.jevDecision?.modelAssisted ?? false,
  };
}
