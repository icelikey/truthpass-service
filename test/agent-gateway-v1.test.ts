import test from "node:test";
import assert from "node:assert/strict";
import { createDeterministicAgentInvoker } from "../src/agents/compatible-invoker.js";
import { runAgent } from "../src/agents/runtime.js";

test("deterministic Agent invoker only selects registered consumer facts", async () => {
  const invoke = createDeterministicAgentInvoker();
  const input = {
    schemaVersion: "agent.input.v1" as const,
    role: "consumer" as const,
    batchId: "FO-2026-001",
    question: "证据怎么样？",
    evidenceCard: {
      batchId: "FO-2026-001",
      decision: "accepted" as const,
      headline: "规则通过",
      facts: ["检测报告已登记", "冷链记录已登记"],
      uncertainties: [],
      nextActions: [],
      evidenceIds: ["ev-inspection-001"],
      dataMode: "demo/synthetic" as const,
    },
    analyses: {
      production: { schemaVersion: "agent.output.v1" as const, role: "production" as const, batchId: "FO-2026-001", findings: [] },
      inspection: { schemaVersion: "agent.output.v1" as const, role: "inspection" as const, batchId: "FO-2026-001", findings: [] },
    },
  };
  const output = await runAgent("consumer", input, invoke);
  assert.deepEqual(output.selectedFactIds, ["F0", "F1"]);
});

test("deterministic evidence roles never invent findings", async () => {
  const invoke = createDeterministicAgentInvoker();
  const input = {
    schemaVersion: "agent.input.v1" as const,
    role: "production" as const,
    view: {
      schemaVersion: "jev.view.v1" as const,
      role: "production" as const,
      allowedEvidenceKinds: ["production" as const],
      context: {
        schemaVersion: "jev.context.v1" as const,
        entity: "fish_oil_batch" as const,
        product: { schemaVersion: "product.v1" as const, productId: "p1", name: "鱼油", category: "fish-oil" as const, supplierId: "s1", claims: [], dataMode: "demo/synthetic" as const },
        batch: { schemaVersion: "batch.v1" as const, batchId: "FO-2026-001", productId: "p1", supplierId: "s1", productionAt: "2026-10-06T08:00:00Z", fillingBatchId: "FILL-1", dataMode: "demo/synthetic" as const },
        claims: [],
        evidence: [],
      },
    },
  };
  const output = await runAgent("production", input, invoke);
  assert.deepEqual(output.findings, []);
});
