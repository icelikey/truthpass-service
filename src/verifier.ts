import { sha256Hex } from "./hash.js";
import type { ExecutionEvidence, TaskRequest, VerificationResult } from "./types.js";

export async function verifyExecution(
  task: TaskRequest,
  evidence: ExecutionEvidence,
): Promise<VerificationResult> {
  const checks = {
    taskMatches: evidence.taskId === task.taskId,
    batchMatches: evidence.batchId === task.batchId && evidence.reportBatchId === task.batchId,
    reportAfterProduction: evidence.reportTime >= task.productionTime,
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
      (evidence.coldChainGapHours !== undefined &&
        evidence.coldChainGapHours <= task.acceptance.maxLogisticsGapHours),
  };

  const passed = Object.values(checks).filter(Boolean).length;
  const score = Math.round((passed / Object.keys(checks).length) * 100);
  const reasons: string[] = [];

  if (!checks.taskMatches) reasons.push("服务返回结果没有绑定到当前任务");
  if (!checks.batchMatches) reasons.push("检测报告批次与请求批次不一致");
  if (!checks.reportAfterProduction) reasons.push("报告时间早于生产时间");
  if (!checks.signatureValid) reasons.push("结果缺少有效的服务签名");
  if (!checks.logisticsWithinLimit) reasons.push("物流记录存在超出验收标准的中断");
  if (!checks.epaDhaWithinLimit) reasons.push("EPA+DHA 实测含量低于任务要求");
  if (!checks.peroxideWithinLimit) reasons.push("过氧化值高于任务要求或缺少检测值");
  if (!checks.totoxWithinLimit) reasons.push("TOTOX 高于任务要求或缺少检测值");
  if (!checks.coldChainWithinLimit) reasons.push("冷链记录存在超温中断或缺少温度证据");

  const criticalFailure =
    !checks.taskMatches ||
    !checks.batchMatches ||
    !checks.signatureValid ||
    !checks.epaDhaWithinLimit ||
    !checks.peroxideWithinLimit ||
    !checks.totoxWithinLimit ||
    !checks.coldChainWithinLimit;
  const status = criticalFailure ? "rejected" : score === 100 ? "accepted" : score >= 60 ? "partial" : "rejected";
  const evidenceHash = await sha256Hex(JSON.stringify({ task, evidence, checks, score }));

  return { status, score, checks, reasons, evidenceHash };
}
