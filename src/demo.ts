import { ServiceRegistry } from "./registry.js";
import { ConsumerParticipationRegistry } from "./consumer.js";
import { runVerificationWorkflow } from "./orchestrator.js";
import { closePersistence, persistenceEnabled, persistDemoRun, recordEvidence } from "./data/persistence.js";
import { explainRejection } from "./knowledge/explain.js";
import { loadKnowledgeChunks } from "./knowledge/wiki.js";
import type { ExecutionEvidence, ServiceAdapter, ServiceCard, TaskRequest } from "./types.js";

// 组合根旁路记录各服务返回的原始证据，供持久化 Sink 写入 execution_evidence
const evidenceLog = new Map<string, ExecutionEvidence>();

const task: TaskRequest = {
  taskId: "task-fish-oil-2026-001",
  serviceKind: "lab",
  capability: "fish-oil-batch-quality-check",
  batchId: "FO-2026-001",
  productionTime: "2026-10-06T08:00:00Z",
  acceptance: {
    requireSignature: true,
    policyId: "fish-oil-quality",
    policyVersion: "v1",
  },
};

function adapterFor(card: ServiceCard, mode: "valid" | "wrong-batch" | "offline"): ServiceAdapter {
  return {
    async probe(request) {
      if (mode === "offline") {
        return {
          serviceId: card.id,
          status: "offline",
          latencyMs: 0,
          capabilityMatch: false,
          schemaValid: false,
          checkedAt: new Date().toISOString(),
          reason: "连接超时",
        };
      }
      return {
        serviceId: card.id,
        status: mode === "valid" ? "healthy" : "degraded",
        latencyMs: mode === "valid" ? 420 : 980,
        capabilityMatch: true,
        schemaValid: true,
        checkedAt: new Date().toISOString(),
      };
    },
    async execute(request) {
      return {
        serviceId: card.id,
        taskId: request.taskId,
        batchId: request.batchId,
        reportBatchId: mode === "wrong-batch" ? "FO-2026-000" : request.batchId,
        productionTime: request.productionTime,
        reportTime: "2026-10-06T10:20:00Z",
        logisticsGapHours: mode === "valid" ? 2 : 4,
        signatureValid: mode === "valid",
        epaDhaPercent: mode === "valid" ? 78 : 61,
        peroxideValue: mode === "valid" ? 2.1 : 7.2,
        totox: mode === "valid" ? 11 : 26,
        coldChainGapHours: mode === "valid" ? 2 : 11,
        payload: {
          product: "高浓度鱼油软胶囊",
          labelEpaDhaPercent: 80,
          rawMaterialOrigin: "demo/synthetic",
          evidenceMode: "demo/synthetic",
        },
      };
    },
  };
}

const services: Array<[ServiceCard, "valid" | "wrong-batch" | "offline"]> = [
  [
    {
      id: "lab-a",
      name: "山野检测服务",
      kind: "lab",
      endpoint: "https://example.test/lab-a",
      capabilities: ["fish-oil-batch-quality-check"],
      signer: "0x1111...aaaa",
      historicalScore: 92,
      feedbackCount: 14,
    },
    "wrong-batch",
  ],
  [
    {
      id: "lab-b",
      name: "快速检测服务",
      kind: "lab",
      endpoint: "https://example.test/lab-b",
      capabilities: ["fish-oil-batch-quality-check"],
      signer: "0x2222...bbbb",
      historicalScore: 96,
      feedbackCount: 9,
    },
    "offline",
  ],
  [
    {
      id: "lab-c",
      name: "可信实验室",
      kind: "lab",
      endpoint: "https://example.test/lab-c",
      capabilities: ["fish-oil-batch-quality-check"],
      signer: "0x3333...cccc",
      historicalScore: 88,
      feedbackCount: 21,
    },
    "valid",
  ],
];

const registry = new ServiceRegistry();
for (const [card, mode] of services) registry.register(card, recordEvidence(card.id, evidenceLog, adapterFor(card, mode)), "demo/synthetic");

const workflow = await runVerificationWorkflow(task, registry, "2026-10-06T12:00:00Z");
if (workflow.status !== "completed" || !workflow.selectedServiceId || !workflow.feedback) {
  throw new Error("没有符合服务履约条件的服务");
}
const ranked = workflow.ranking;
const winner = ranked.find((item) => item.service.id === workflow.selectedServiceId);
const feedback = workflow.feedback;
if (!winner) throw new Error("工作流选择的服务不在排名结果中");

const consumers = new ConsumerParticipationRegistry();
const consent = await consumers.grantConsent({
  consumerId: "consumer-demo-001",
  batchId: task.batchId,
  scopes: ["purchase", "packaging", "odor", "storage", "quality-feedback"],
  grantedAt: "2026-10-06T12:00:00Z",
});
const purchase = await consumers.recordPurchase({
  consumerId: "consumer-demo-001",
  batchId: task.batchId,
  purchaseProofHash: "demo-purchase-proof-001",
  createdAt: "2026-10-06T12:05:00Z",
});
const consumerFeedback = await consumers.recordFeedback({
  purchaseId: purchase.purchaseId,
  rating: 5,
  categories: ["包装完好", "无明显腥味", "批次可查"],
  evidence: { source: "demo/synthetic", note: "消费者 Agent 授权后的体验反馈" },
  createdAt: "2026-10-06T12:20:00Z",
});

let rejectionExplanations: unknown = undefined;
if (persistenceEnabled()) {
  try {
    await persistDemoRun({ task, ranking: ranked, evidenceByServiceId: evidenceLog, feedback, consent, purchase, consumerFeedback });
    console.error("[persistence] 本次演示已落库 Supabase/Postgres");
  } catch (error) {
    console.error("[persistence] 落库失败(不影响演示输出):", error instanceof Error ? error.message : error);
  }
  try {
    const chunks = await loadKnowledgeChunks();
    const rejected = ranked.filter((item) => !item.eligible && (item.execution || item.product));
    const explanations = [];
    for (const item of rejected) {
      const evidence = evidenceLog.get([item.service.id, task.taskId].join(":"));
      explanations.push({
        serviceId: item.service.id,
        ...(await explainRejection(
          {
            checks: { ...(item.execution?.checks ?? {}), ...(item.product?.checks ?? {}) },
            reasons: [...(item.execution?.reasons ?? []), ...(item.product?.reasons ?? [])],
            evidence: evidence
              ? {
                  epaDhaPercent: evidence.epaDhaPercent,
                  peroxideValue: evidence.peroxideValue,
                  totox: evidence.totox,
                  coldChainGapHours: evidence.coldChainGapHours,
                  reportBatchId: evidence.reportBatchId,
                  signatureValid: evidence.signatureValid,
                }
              : undefined,
          },
          chunks,
        )),
      });
    }
    rejectionExplanations = explanations;
    console.error("[knowledge] 拒因解释已生成: " + explanations.length + " 条");
  } catch (error) {
    console.error("[knowledge] 解释生成失败(不影响演示输出):", error instanceof Error ? error.message : error);
  }
  await closePersistence();
}

console.log(JSON.stringify({
  task,
  agentTrace: workflow.trace,
  ranking: ranked.map((item) => ({
    serviceId: item.service.id,
    liveStatus: item.probe.status,
    score: item.score,
    eligible: item.eligible,
    serviceExecution: item.execution?.status ?? "not-executed",
    productAssessment: item.product?.status ?? "not-evaluated",
    reasons: [...(item.execution?.reasons ?? []), ...(item.product?.reasons ?? []), ...(item.probe.reason ? [item.probe.reason] : [])],
  })),
  selectedService: winner.service.id,
  feedback,
  consumerParticipation: { purchase, feedback: consumerFeedback },
  rejectionExplanations,
}, null, 2));
