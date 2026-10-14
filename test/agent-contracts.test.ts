import assert from "node:assert/strict";
import test from "node:test";
import { AgentContractError, parseAgentInput, parseAgentOutput } from "../src/agents/contracts.js";
import { fishOilBatch, fishOilEvidence, fishOilProduct } from "../src/data/fixtures.js";
import { MemoryDataRepository } from "../src/data/repository.js";
import { buildJevContext, buildJevRoleView } from "../src/jev/context.js";
import { getPolicySnapshot } from "../src/rules/policy.js";

async function inputs() {
  const repository = new MemoryDataRepository();
  repository.createProduct(fishOilProduct);
  repository.createBatch(fishOilBatch);
  for (const item of fishOilEvidence) await repository.addEvidence(item);
  const context = buildJevContext(repository, fishOilBatch.batchId);
  const production = { schemaVersion: "agent.output.v1", role: "production", batchId: fishOilBatch.batchId, findings: [{ code: "production_record_found", summary: "找到生产记录", sourceIds: ["ev-production-001"] }] };
  const inspection = { schemaVersion: "agent.output.v1", role: "inspection", batchId: fishOilBatch.batchId, findings: [{ code: "inspection_report_found", summary: "找到检测报告", sourceIds: ["ev-inspection-001"] }] };
  const evidenceCard = { batchId: fishOilBatch.batchId, decision: "not_assessed", headline: "现有资料不足以作出结论。", facts: ["已登记生产记录"], uncertainties: ["签名尚未核验"], nextActions: ["补充验证"], evidenceIds: ["ev-production-001"], dataMode: "demo/synthetic" };
  return {
    production: { schemaVersion: "agent.input.v1", role: "production", view: buildJevRoleView(context, "production") },
    inspection: { schemaVersion: "agent.input.v1", role: "inspection", view: buildJevRoleView(context, "inspection"), policy: getPolicySnapshot("fish-oil-quality", "v1") },
    consumer: { schemaVersion: "agent.input.v1", role: "consumer", batchId: fishOilBatch.batchId, question: "这批产品怎么样？", evidenceCard, analyses: { production, inspection } },
  };
}

const productionOutput = { schemaVersion: "agent.output.v1", role: "production", batchId: fishOilBatch.batchId, findings: [{ code: "production_record_found", summary: "找到该批次的生产记录", sourceIds: ["ev-production-001"] }] };
const inspectionOutput = { schemaVersion: "agent.output.v1", role: "inspection", batchId: fishOilBatch.batchId, findings: [{ code: "report_batch_linked", summary: "报告指向当前批次", sourceIds: ["ev-inspection-001"] }] };
const consumerOutput = { schemaVersion: "agent.output.v1", role: "consumer", batchId: fishOilBatch.batchId, selectedFactIds: ["F0"] };

test("accepts production, inspection, and consumer-agent contracts", async () => {
  const data = await inputs();
  assert.equal(parseAgentInput("production", data.production).role, "production");
  assert.equal(parseAgentInput("inspection", data.inspection).role, "inspection");
  assert.equal(parseAgentInput("consumer", data.consumer).role, "consumer");
  assert.equal(parseAgentOutput("production", data.production, productionOutput).role, "production");
  assert.equal(parseAgentOutput("inspection", data.inspection, inspectionOutput).role, "inspection");
  assert.equal(parseAgentOutput("consumer", data.consumer, consumerOutput).role, "consumer");
});

test("rejects cross-role views and findings that cite unknown evidence IDs", async () => {
  const data = await inputs();
  assert.throws(() => parseAgentInput("production", data.inspection), AgentContractError);
  assert.throws(() => parseAgentOutput("production", data.production, { ...productionOutput, findings: [{ ...productionOutput.findings[0], sourceIds: ["invented-evidence"] }] }), /不存在的证据/);
});

test("rejects model-generated scores and verdict fields", async () => {
  const data = await inputs();
  assert.throws(() => parseAgentOutput("inspection", data.inspection, { ...inspectionOutput, score: 100, verdict: "trusted" }), /未定义字段/);
});

test("requires every agent finding to cite at least one input source", async () => {
  const data = await inputs();
  assert.throws(
    () => parseAgentOutput("inspection", data.inspection, { ...inspectionOutput, findings: [{ ...inspectionOutput.findings[0], sourceIds: [] }] }),
    /至少一个来源 ID/,
  );
});

test("rejects altered policy snapshots and prevents the consumer role from receiving raw evidence", async () => {
  const data = await inputs();
  const altered = { ...data.inspection, policy: { ...data.inspection.policy, thresholds: { ...data.inspection.policy.thresholds, minEpaDhaPercent: 1 } } };
  assert.throws(() => parseAgentInput("inspection", altered), /不一致/);
  assert.throws(() => parseAgentInput("consumer", { ...data.consumer, view: data.production.view }), /未定义字段/);
  assert.throws(() => parseAgentOutput("consumer", data.consumer, { ...consumerOutput, verdict: "accepted" }), /未定义字段/);
  assert.throws(() => parseAgentOutput("consumer", data.consumer, { ...consumerOutput, selectedFactIds: ["F9"] }), /只能选择/);
});
