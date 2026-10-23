import { canonicalizeJson } from "./evidence.js";
import { sha256Hex } from "./hash.js";
import { getPolicySnapshot } from "./rules/policy.js";
import type { JevDecision } from "./jev/model.js";
import type { ExecutionEvidence, ProductBatchAssessment, ServiceExecutionResult, SignatureVerification, TaskRequest, VerificationResult } from "./types.js";

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

function formatParameterRange(
  label: string,
  observed: number | undefined,
  unit: string,
  operator: ">=" | "<=",
  target: number,
): string {
  if (observed === undefined) return `${label}：未登记实测值；当前规则范围 ${operator}${target}${unit}`;
  const difference = operator === ">=" ? target - observed : observed - target;
  if (difference <= 0) return `${label}：实测 ${observed}${unit}；当前规则范围 ${operator}${target}${unit}，差值 ${Math.abs(difference)}${unit}`;
  return `${label}：实测 ${observed}${unit}；当前规则范围 ${operator}${target}${unit}，超出范围 ${difference}${unit}`;
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
    signatureValid: !task.acceptance.requireSignature || evidence.signatureValid === true,
    logisticsWithinLimit: evidence.logisticsGapHours <= (task.acceptance.maxLogisticsGapHours ?? Number.POSITIVE_INFINITY),
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
      (evidence.coldChainGapHours !== undefined && evidence.coldChainGapHours <= (task.acceptance.maxLogisticsGapHours ?? Number.POSITIVE_INFINITY)),
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
  if (!checks.logisticsWithinLimit) {
    const limit = task.acceptance.maxLogisticsGapHours;
    reasons.push(limit === undefined
      ? `物流记录：实测中断 ${evidence.logisticsGapHours} 小时；当前任务未声明范围`
      : `物流记录：实测中断 ${evidence.logisticsGapHours} 小时；当前规则范围 ≤${limit} 小时，超出范围 ${Math.max(0, evidence.logisticsGapHours - limit)} 小时`);
  }

  if (!checks.epaDhaWithinLimit) {
    if (evidence.epaDhaPercent === undefined && task.acceptance.minEpaDhaPercent !== undefined) {
      reasons.push("缺少 EPA+DHA 实测值");
      missingCodes.push("EPA_DHA_MISSING");
    } else if (task.acceptance.minEpaDhaPercent !== undefined) reasons.push(formatParameterRange("EPA+DHA", evidence.epaDhaPercent, "%", ">=", task.acceptance.minEpaDhaPercent));
  }
  if (!checks.peroxideWithinLimit) {
    if (evidence.peroxideValue === undefined && task.acceptance.maxPeroxideValue !== undefined) {
      reasons.push("缺少过氧化值检测值");
      missingCodes.push("PEROXIDE_MISSING");
    } else if (task.acceptance.maxPeroxideValue !== undefined) reasons.push(formatParameterRange("过氧化值", evidence.peroxideValue, " meq/kg", "<=", task.acceptance.maxPeroxideValue));
  }
  if (!checks.totoxWithinLimit) {
    if (evidence.totox === undefined && task.acceptance.maxTotox !== undefined) {
      reasons.push("缺少 TOTOX 检测值");
      missingCodes.push("TOTOX_MISSING");
    } else if (task.acceptance.maxTotox !== undefined) reasons.push(formatParameterRange("TOTOX", evidence.totox, "", "<=", task.acceptance.maxTotox));
  }
  if (!checks.coldChainWithinLimit) {
    if (evidence.coldChainGapHours === undefined && task.acceptance.requireColdChain) {
      reasons.push("缺少冷链温度证据");
      missingCodes.push("COLD_CHAIN_MISSING");
    } else if (task.acceptance.maxLogisticsGapHours !== undefined) reasons.push(formatParameterRange("冷链异常时长", evidence.coldChainGapHours, " 小时", "<=", task.acceptance.maxLogisticsGapHours));
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

/** New naming used by the teammate's service layer; it shares the same rule boundary. */
export async function verifyServiceExecution(
  task: TaskRequest,
  evidence: ExecutionEvidence,
  signatureVerification: SignatureVerification = evidence.signatureValid ? "demo" : "invalid",
): Promise<ServiceExecutionResult> {
  const result = await verifyExecution(task, {
    ...evidence,
    signatureValid: signatureVerification === "verified" || signatureVerification === "demo",
  }, {});
  return {
    ...result,
    status: result.status,
    score: result.score,
    checks: result.checks,
    reasons: result.reasons,
    evidenceHash: result.evidenceHash,
  };
}

/** Product-level deterministic assessment used by the CLI and Agent adapters. */
export async function assessProductBatch(
  task: TaskRequest,
  evidence: ExecutionEvidence,
): Promise<ProductBatchAssessment> {
  const policy = getPolicySnapshot(task.acceptance.policyId ?? "fish-oil-quality", task.acceptance.policyVersion ?? "v1");
  const checks = {
    logisticsWithinLimit: evidence.logisticsGapHours <= policy.thresholds.maxLogisticsGapHours,
    epaDhaWithinLimit: evidence.epaDhaPercent !== undefined && evidence.epaDhaPercent >= policy.thresholds.minEpaDhaPercent,
    peroxideWithinLimit: evidence.peroxideValue !== undefined && evidence.peroxideValue <= policy.thresholds.maxPeroxideValue,
    totoxWithinLimit: evidence.totox !== undefined && evidence.totox <= policy.thresholds.maxTotox,
    coldChainWithinLimit: evidence.coldChainGapHours !== undefined && evidence.coldChainGapHours <= policy.thresholds.maxLogisticsGapHours,
  };
  const parameterDetails = [
    {
      key: "epa_dha",
      label: "EPA+DHA",
      observed: evidence.epaDhaPercent,
      unit: "%",
      operator: ">=" as const,
      target: policy.thresholds.minEpaDhaPercent,
      status: evidence.epaDhaPercent === undefined ? "missing" as const : checks.epaDhaWithinLimit ? "within_range" as const : "outside_range" as const,
      difference: evidence.epaDhaPercent === undefined ? undefined : evidence.epaDhaPercent - policy.thresholds.minEpaDhaPercent,
    },
    {
      key: "peroxide",
      label: "过氧化值",
      observed: evidence.peroxideValue,
      unit: " meq/kg",
      operator: "<=" as const,
      target: policy.thresholds.maxPeroxideValue,
      status: evidence.peroxideValue === undefined ? "missing" as const : checks.peroxideWithinLimit ? "within_range" as const : "outside_range" as const,
      difference: evidence.peroxideValue === undefined ? undefined : policy.thresholds.maxPeroxideValue - evidence.peroxideValue,
    },
    {
      key: "totox",
      label: "TOTOX",
      observed: evidence.totox,
      unit: "",
      operator: "<=" as const,
      target: policy.thresholds.maxTotox,
      status: evidence.totox === undefined ? "missing" as const : checks.totoxWithinLimit ? "within_range" as const : "outside_range" as const,
      difference: evidence.totox === undefined ? undefined : policy.thresholds.maxTotox - evidence.totox,
    },
    {
      key: "cold_chain_gap",
      label: "冷链异常时长",
      observed: evidence.coldChainGapHours,
      unit: " 小时",
      operator: "<=" as const,
      target: policy.thresholds.maxLogisticsGapHours,
      status: evidence.coldChainGapHours === undefined ? "missing" as const : checks.coldChainWithinLimit ? "within_range" as const : "outside_range" as const,
      difference: evidence.coldChainGapHours === undefined ? undefined : policy.thresholds.maxLogisticsGapHours - evidence.coldChainGapHours,
    },
  ];
  const score = Math.round((Object.values(checks).filter(Boolean).length / Object.keys(checks).length) * 100);
  const reasons: string[] = [];
  if (!checks.logisticsWithinLimit) reasons.push(`物流记录：实测中断 ${evidence.logisticsGapHours} 小时；当前规则范围 ≤${policy.thresholds.maxLogisticsGapHours} 小时，超出范围 ${Math.max(0, evidence.logisticsGapHours - policy.thresholds.maxLogisticsGapHours)} 小时`);
  if (!checks.epaDhaWithinLimit) {
    if (evidence.epaDhaPercent === undefined) reasons.push(formatParameterRange("EPA+DHA", undefined, "%", ">=", policy.thresholds.minEpaDhaPercent));
    else reasons.push(formatParameterRange("EPA+DHA", evidence.epaDhaPercent, "%", ">=", policy.thresholds.minEpaDhaPercent));
  }
  if (!checks.peroxideWithinLimit) {
    if (evidence.peroxideValue === undefined) reasons.push(formatParameterRange("过氧化值", undefined, " meq/kg", "<=", policy.thresholds.maxPeroxideValue));
    else reasons.push(formatParameterRange("过氧化值", evidence.peroxideValue, " meq/kg", "<=", policy.thresholds.maxPeroxideValue));
  }
  if (!checks.totoxWithinLimit) {
    if (evidence.totox === undefined) reasons.push(formatParameterRange("TOTOX", undefined, "", "<=", policy.thresholds.maxTotox));
    else reasons.push(formatParameterRange("TOTOX", evidence.totox, "", "<=", policy.thresholds.maxTotox));
  }
  if (!checks.coldChainWithinLimit) {
    if (evidence.coldChainGapHours === undefined) reasons.push(formatParameterRange("冷链异常时长", undefined, " 小时", "<=", policy.thresholds.maxLogisticsGapHours));
    else reasons.push(formatParameterRange("冷链异常时长", evidence.coldChainGapHours, " 小时", "<=", policy.thresholds.maxLogisticsGapHours));
  }
  const result = { status: Object.values(checks).every(Boolean) ? "accepted" as const : "rejected" as const, policyId: policy.policyId, policyVersion: policy.version, score, checks, reasons, parameterDetails };
  return { ...result, evidenceHash: await sha256Hex(canonicalizeJson({ kind: "product-assessment", policy, task, evidence, result })) };
}
