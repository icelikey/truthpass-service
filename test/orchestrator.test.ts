import assert from "node:assert/strict";
import test from "node:test";
import { runVerificationWorkflow } from "../src/orchestrator.js";
import { ServiceRegistry } from "../src/registry.js";
import type { ServiceAdapter, ServiceCard, TaskRequest } from "../src/types.js";

const task: TaskRequest = {
  taskId: "workflow-task",
  serviceKind: "lab",
  capability: "fish-oil-batch-quality-check",
  batchId: "FO-WORKFLOW",
  productionTime: "2026-10-06T08:00:00Z",
  acceptance: { requireSignature: true, policyId: "fish-oil-quality", policyVersion: "v1" },
};

function register(registry: ServiceRegistry, id: string, reportBatchId: string): void {
  const card: ServiceCard = {
    id, name: id, kind: "lab", endpoint: `https://example.test/${id}`,
    capabilities: ["fish-oil-batch-quality-check"], signer: `signer-${id}`,
    historicalScore: 90, feedbackCount: 1,
  };
  const adapter: ServiceAdapter = {
    async probe() {
      return { serviceId: id, status: "healthy", latencyMs: 1, capabilityMatch: true, schemaValid: true, checkedAt: "2026-10-06T08:00:00Z" };
    },
    async execute(request) {
      return { serviceId: id, taskId: request.taskId, batchId: request.batchId, reportBatchId, productionTime: request.productionTime, reportTime: "2026-10-06T09:00:00Z", logisticsGapHours: 1, signatureValid: true, epaDhaPercent: 78, peroxideValue: 2, totox: 10, coldChainGapHours: 1, payload: { evidenceMode: "demo/synthetic" } };
    },
  };
  registry.register(card, adapter, "demo/synthetic");
}

test("runs role-based workflow and records only an eligible service", async () => {
  const registry = new ServiceRegistry();
  register(registry, "wrong", "FO-OTHER");
  register(registry, "valid", task.batchId);

  const result = await runVerificationWorkflow(task, registry, "2026-10-06T12:00:00Z");

  assert.equal(result.status, "completed");
  assert.equal(result.selectedServiceId, "valid");
  assert.deepEqual(result.trace.map((item) => item.node), ["task_adapter", "discovery_probe", "router", "reputation"]);
  assert.equal(result.feedback?.serviceId, "valid");
});
