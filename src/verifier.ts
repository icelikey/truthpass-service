import { sha256Hex } from "./hash.js";
import { getPolicySnapshot } from "./rules/policy.js";
import type {
  ExecutionEvidence,
  ProductBatchAssessment,
  ServiceExecutionResult,
  TaskRequest,
} from "./types.js";

export async function verifyServiceExecution(
  task: TaskRequest,
  evidence: ExecutionEvidence,
): Promise<ServiceExecutionResult> {
  const checks = {
    taskMatches: evidence.taskId === task.taskId,
    batchMatches: evidence.batchId === task.batchId && evidence.reportBatchId === task.batchId,
    reportAfterProduction: evidence.reportTime >= task.productionTime,
    signatureValid: task.acceptance.requireSignature === true && evidence.signatureValid === true,
  };

  const passed = Object.values(checks).filter(Boolean).length;
  const score = Math.round((passed / Object.keys(checks).length) * 100);
  const reasons: string[] = [];

  if (!checks.taskMatches) reasons.push("服务返回结果没有绑定到当前任务");
  if (!checks.batchMatches) reasons.push("检测报告批次与请求批次不一致");
  if (!checks.reportAfterProduction) reasons.push("报告时间早于生产时间");
  if (!checks.signatureValid) reasons.push("结果缺少有效的服务签名");
  const status = score === 100 ? "accepted" : "rejected";
  const evidenceHash = await sha256Hex(JSON.stringify({ kind: "service-execution", task, evidence, checks, score }));

  return { status, score, checks, reasons, evidenceHash };
}

export async function assessProductBatch(
  task: TaskRequest,
  evidence: ExecutionEvidence,
): Promise<ProductBatchAssessment> {
  const policy = getPolicySnapshot(task.acceptance.policyId, task.acceptance.policyVersion);
  const checks = {
    logisticsWithinLimit: evidence.logisticsGapHours <= policy.thresholds.maxLogisticsGapHours,
    epaDhaWithinLimit: evidence.epaDhaPercent !== undefined && evidence.epaDhaPercent >= policy.thresholds.minEpaDhaPercent,
    peroxideWithinLimit: evidence.peroxideValue !== undefined && evidence.peroxideValue <= policy.thresholds.maxPeroxideValue,
    totoxWithinLimit: evidence.totox !== undefined && evidence.totox <= policy.thresholds.maxTotox,
    coldChainWithinLimit: evidence.coldChainGapHours !== undefined && evidence.coldChainGapHours <= policy.thresholds.maxLogisticsGapHours,
  };

  const passed = Object.values(checks).filter(Boolean).length;
  const score = Math.round((passed / Object.keys(checks).length) * 100);
  const reasons: string[] = [];
  if (!checks.logisticsWithinLimit) reasons.push("物流记录存在超出验收标准的中断");
  if (!checks.epaDhaWithinLimit) reasons.push(`EPA+DHA 未达到 ${policy.thresholds.minEpaDhaPercent}% 或缺少检测值`);
  if (!checks.peroxideWithinLimit) reasons.push(`过氧化值未达到 ≤${policy.thresholds.maxPeroxideValue} 或缺少检测值`);
  if (!checks.totoxWithinLimit) reasons.push(`TOTOX 未达到 ≤${policy.thresholds.maxTotox} 或缺少检测值`);
  if (!checks.coldChainWithinLimit) reasons.push("冷链记录存在超温中断或缺少温度证据");

  const result = {
    status: Object.values(checks).every(Boolean) ? "accepted" as const : "rejected" as const,
    policyId: policy.policyId,
    policyVersion: policy.version,
    score,
    checks,
    reasons,
  };
  return { ...result, evidenceHash: await sha256Hex(JSON.stringify({ kind: "product-assessment", policy, task, evidence, result })) };
}

