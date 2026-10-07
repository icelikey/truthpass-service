import assert from "node:assert/strict";
import test from "node:test";
import { renderConsumerFacts, runAgentCollaboration } from "../src/agents/collaboration.js";
import type { AgentInvocation } from "../src/agents/runtime.js";
import { fishOilBatch, fishOilEvidence, fishOilProduct } from "../src/data/fixtures.js";
import { MemoryDataRepository } from "../src/data/repository.js";
import { buildJevContext, buildJevRoleView } from "../src/jev/context.js";
import { getPolicySnapshot } from "../src/rules/policy.js";

async function setup() {
  const repository = new MemoryDataRepository();
  repository.createProduct(fishOilProduct);
  repository.createBatch(fishOilBatch);
  for (const evidence of fishOilEvidence) await repository.addEvidence(evidence);
  const context = buildJevContext(repository, fishOilBatch.batchId);
  return {
    production: { schemaVersion: "agent.input.v1", role: "production", view: buildJevRoleView(context, "production") },
    inspection: { schemaVersion: "agent.input.v1", role: "inspection", view: buildJevRoleView(context, "inspection"), policy: getPolicySnapshot("fish-oil-quality", "v1") },
    card: {
      batchId: fishOilBatch.batchId,
      decision: "not_assessed" as const,
      headline: "当前没有代码验收结论。",
      facts: ["已登记生产和检测记录"],
      uncertainties: ["签名尚未核验"],
      nextActions: ["核验签名"],
      evidenceIds: ["ev-production-001", "ev-inspection-001"],
      dataMode: "demo/synthetic" as const,
    },
  };
}

test("consumer agent receives only validated analyses and the consumer evidence card", async () => {
  const input = await setup();
  let consumerInvocation: AgentInvocation | undefined;
  const result = await runAgentCollaboration(input.production, input.inspection, "这批鱼油怎么样？", input.card, async (invocation) => {
    if (invocation.role === "production") return { schemaVersion: "agent.output.v1", role: invocation.role, batchId: fishOilBatch.batchId, findings: [{ code: "production_record_found", summary: "登记了生产记录。", sourceIds: ["ev-production-001"] }] };
    if (invocation.role === "inspection") return { schemaVersion: "agent.output.v1", role: invocation.role, batchId: fishOilBatch.batchId, findings: [{ code: "signature_review_needed", summary: "签名仍需核验。", sourceIds: ["ev-inspection-001"] }] };
    consumerInvocation = invocation;
    return { schemaVersion: "agent.output.v1", role: invocation.role, batchId: fishOilBatch.batchId, selectedFactIds: ["F0"] };
  });

  assert.deepEqual(result.consumer.selectedFactIds, ["F0"]);
  assert.deepEqual(renderConsumerFacts(input.card, result.consumer.selectedFactIds), ["已登记生产和检测记录"]);
  assert.equal(consumerInvocation?.role, "consumer");
  assert.deepEqual(consumerInvocation?.allowedTools, []);
  const consumerInput = consumerInvocation?.input as { question: string; evidenceCard: unknown; analyses: { production: unknown; inspection: unknown }; view?: unknown };
  assert.equal(consumerInput.question, "这批鱼油怎么样？");
  assert.ok(consumerInput.analyses.production && consumerInput.analyses.inspection);
  assert.equal(consumerInput.view, undefined);
});

test("consumer selection cannot create an unsupported fact", async () => {
  const input = await setup();
  await assert.rejects(runAgentCollaboration(input.production, input.inspection, "请判断是否批次冲突", input.card, async (invocation) => {
    if (invocation.role === "production") return { schemaVersion: "agent.output.v1", role: invocation.role, batchId: fishOilBatch.batchId, findings: [] };
    if (invocation.role === "inspection") return { schemaVersion: "agent.output.v1", role: invocation.role, batchId: fishOilBatch.batchId, findings: [] };
    return { schemaVersion: "agent.output.v1", role: invocation.role, batchId: fishOilBatch.batchId, selectedFactIds: ["F9"] };
  }), /只能选择证据卡/);
});

test("collaboration reports phase transitions as each agent settles", async () => {
  const input = await setup();
  const phases: string[] = [];
  await runAgentCollaboration(input.production, input.inspection, "这批鱼油怎么样？", input.card, async (invocation) => {
    if (invocation.role === "production") return { schemaVersion: "agent.output.v1", role: invocation.role, batchId: fishOilBatch.batchId, findings: [] };
    if (invocation.role === "inspection") return { schemaVersion: "agent.output.v1", role: invocation.role, batchId: fishOilBatch.batchId, findings: [] };
    return { schemaVersion: "agent.output.v1", role: invocation.role, batchId: fishOilBatch.batchId, selectedFactIds: ["F0"] };
  }, (phase) => phases.push(phase.stage));
  assert.deepEqual(phases, ["production_done", "inspection_done", "consumer_started", "consumer_done"]);
});

test("collaboration rejects cross-batch inputs before invoking any agent", async () => {
  const input = await setup();
  const otherBatch = structuredClone(input.inspection) as typeof input.inspection;
  otherBatch.view.context.batch.batchId = "FO-OTHER";
  for (const evidence of otherBatch.view.context.evidence) evidence.batchId = "FO-OTHER";
  let invoked = false;
  await assert.rejects(runAgentCollaboration(input.production, otherBatch, "请查这个批次", input.card, async () => {
    invoked = true;
    return {};
  }), /必须属于同一批次/);
  assert.equal(invoked, false);
});
