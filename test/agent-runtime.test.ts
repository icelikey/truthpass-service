import assert from "node:assert/strict";
import test from "node:test";
import { runAgent, type AgentInvocation } from "../src/agents/runtime.js";
import { fishOilBatch, fishOilEvidence, fishOilProduct } from "../src/data/fixtures.js";
import { MemoryDataRepository } from "../src/data/repository.js";
import { buildJevContext, buildJevRoleView } from "../src/jev/context.js";

async function productionInput() {
  const repository = new MemoryDataRepository();
  repository.createProduct(fishOilProduct);
  repository.createBatch(fishOilBatch);
  for (const item of fishOilEvidence) await repository.addEvidence(item);
  const context = buildJevContext(repository, fishOilBatch.batchId);
  return { schemaVersion: "agent.input.v1", role: "production", view: buildJevRoleView(context, "production") };
}

test("runAgent supplies a role prompt and allowlisted tools, then validates the result", async () => {
  const input = await productionInput();
  let invocation: AgentInvocation | undefined;
  const output = await runAgent("production", input, async (value) => {
    invocation = value;
    return { schemaVersion: "agent.output.v1", role: "production", batchId: fishOilBatch.batchId, findings: [] };
  });

  assert.equal(output.role, "production");
  assert.match(invocation?.systemPrompt ?? "", /不得判断商品是否合格/);
  assert.ok((invocation?.systemPrompt ?? "").includes('"agent.output.v1"'));
  assert.deepEqual(invocation?.allowedTools, ["getBatch", "getEvidenceView", "listEvidenceMetadata"]);
  assert.equal(invocation?.input.role, "production");
});

test("runAgent rejects role-mismatched input before invoking the model", async () => {
  const input = await productionInput();
  let invoked = false;
  await assert.rejects(runAgent("inspection", input, async () => {
    invoked = true;
    return {};
  }));
  assert.equal(invoked, false);
});

test("runAgent rejects model outputs that try to decide or cite unknown evidence", async () => {
  const input = await productionInput();
  await assert.rejects(runAgent("production", input, async () => ({
    schemaVersion: "agent.output.v1",
    role: "production",
    batchId: fishOilBatch.batchId,
    verdict: "accepted",
    findings: [{ code: "claim", summary: "通过", sourceIds: ["made-up"] }],
  })), /未定义字段/);
});
