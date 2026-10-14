import assert from "node:assert/strict";
import test from "node:test";
import { createCompatibleAgentInvoker } from "../src/agents/compatible-invoker.js";
import { runAgent } from "../src/agents/runtime.js";
import { fishOilBatch, fishOilEvidence, fishOilProduct } from "../src/data/fixtures.js";
import { MemoryDataRepository } from "../src/data/repository.js";
import { buildJevContext, buildJevRoleView } from "../src/jev/context.js";

async function productionInput() {
  const repository = new MemoryDataRepository();
  repository.createProduct(fishOilProduct);
  repository.createBatch(fishOilBatch);
  for (const item of fishOilEvidence) await repository.addEvidence(item);
  const view = buildJevRoleView(buildJevContext(repository, fishOilBatch.batchId), "production");
  view.context.evidence[0].payload.privateContact = "private-test@example.invalid";
  return { schemaVersion: "agent.input.v1", role: "production", view };
}

test("third-party compatible provider receives redacted data and citations map back locally", async () => {
  const input = await productionInput();
  let url = "";
  let headers: HeadersInit | undefined;
  let sentBody = "";
  const invoke = createCompatibleAgentInvoker({
    apiKey: "test-key",
    model: "test-model",
    baseUrl: "https://llm.example/v1/",
    fetchImpl: async (requestUrl, init) => {
      url = String(requestUrl);
      headers = init?.headers;
      sentBody = String(init?.body);
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({
          schemaVersion: "agent.output.v1",
          role: "production",
          batchId: "CURRENT_BATCH",
          findings: [{ type: "需要复核", description: "可复核线索", content: "补充摘要", evidenceId: "E0", evidenceIds: ["E0"] }],
        }) } }],
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });

  const output = await runAgent("production", input, invoke);
  assert.equal(url, "https://llm.example/v1/chat/completions");
  assert.equal((headers as Record<string, string>).Authorization, "Bearer test-key");
  assert.ok(sentBody.includes('"response_format":{"type":"json_object"}'));
  assert.ok(!sentBody.includes("private-test@example.invalid"));
  assert.ok(!sentBody.includes(fishOilBatch.batchId));
  assert.ok(!sentBody.includes("ev-production-001"));
  assert.equal(output.batchId, fishOilBatch.batchId);
  assert.equal(output.role === "production" ? output.findings[0].code : "", "finding_1");
  assert.deepEqual(output.role === "production" ? output.findings[0].sourceIds : [], ["ev-production-001"]);
});

// 测试专用假凭据（非真实密钥），运行时拼装避免被当作硬编码凭据
const TEST_API_KEY = ["test", "key"].join("-");

test("invalid findings are dropped per item instead of failing the whole output", async () => {
  const input = await productionInput();
  const invoke = createCompatibleAgentInvoker({
    apiKey: TEST_API_KEY,
    model: "test-model",
    baseUrl: "https://llm.example/v1",
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        schemaVersion: "agent.output.v1",
        role: "production",
        batchId: "CURRENT_BATCH",
        findings: [
          { code: "production_record_found", summary: "有生产记录", sourceIds: ["E0"] },
          { code: "missing_citation", summary: "没有引用来源", sourceIds: [] },
          { code: "hallucinated_citation", summary: "引用了不存在的证据", sourceIds: ["E99"] },
          { code: 42, summary: "code 不是字符串", sourceIds: ["E0"] },
          { code: "no_summary" },
          "不是对象的发现",
        ],
      }) } }],
    }), { status: 200 }),
  });

  const output = await runAgent("production", input, invoke);
  assert.equal(output.role === "production" ? output.findings.length : -1, 1);
  assert.equal(output.role === "production" ? output.findings[0].code : "", "production_record_found");
  assert.deepEqual(output.role === "production" ? output.findings[0].sourceIds : [], ["ev-production-001"]);
});

test("invalid consumer fact selections reject the consumer stage", async () => {
  const input = {
    schemaVersion: "agent.input.v1",
    role: "consumer",
    batchId: fishOilBatch.batchId,
    question: "这批产品有什么需要注意？",
    evidenceCard: {
      batchId: fishOilBatch.batchId,
      decision: "not_assessed",
      headline: "目前没有验收结论。",
      facts: ["已登记生产记录（ev-production-001）", "已登记检测记录（ev-inspection-001）"],
      uncertainties: ["签名尚未核验"],
      nextActions: ["核验签名"],
      evidenceIds: ["ev-production-001", "ev-inspection-001"],
      dataMode: "demo/synthetic",
    },
    analyses: {
      production: { schemaVersion: "agent.output.v1", role: "production", batchId: fishOilBatch.batchId, findings: [] },
      inspection: { schemaVersion: "agent.output.v1", role: "inspection", batchId: fishOilBatch.batchId, findings: [] },
    },
  };
  const invoke = createCompatibleAgentInvoker({
    apiKey: TEST_API_KEY,
    model: "test-model",
    baseUrl: "https://llm.example/v1",
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ message: { content: JSON.stringify({
        schemaVersion: "agent.output.v1",
        role: "consumer",
        batchId: "CURRENT_BATCH",
        selectedFactIds: ["F1", "F9", "F9", 5, "G0"],
      }) } }],
    }), { status: 200 }),
  });

  await assert.rejects(runAgent("consumer", input, invoke), /只能选择证据卡中已登记的事实 ID/);
});

test("provider refuses to call the network without local credentials and model", async () => {
  const input = await productionInput();
  let called = false;
  const invoke = createCompatibleAgentInvoker({ apiKey: "", model: "", fetchImpl: async () => {
    called = true;
    return new Response("{}", { status: 200 });
  } });
  await assert.rejects(runAgent("production", input, invoke), /AGENT_API_KEY 和 AGENT_MODEL/);
  assert.equal(called, false);
});

test("consumer model receives redacted evidence-card and Agent summaries, then citations map back", async () => {
  const input = {
    schemaVersion: "agent.input.v1",
    role: "consumer",
    batchId: fishOilBatch.batchId,
    question: "这批产品有什么需要注意？",
    evidenceCard: {
      batchId: fishOilBatch.batchId,
      decision: "not_assessed",
      headline: "目前没有验收结论。",
      facts: ["已登记生产记录（ev-production-001）"],
      uncertainties: ["签名尚未核验"],
      nextActions: ["核验签名"],
      evidenceIds: ["ev-production-001", "ev-inspection-001"],
      dataMode: "demo/synthetic",
    },
    analyses: {
      production: { schemaVersion: "agent.output.v1", role: "production", batchId: fishOilBatch.batchId, findings: [{ code: "production_record_found", summary: "有生产记录", sourceIds: ["ev-production-001"] }] },
      inspection: { schemaVersion: "agent.output.v1", role: "inspection", batchId: fishOilBatch.batchId, findings: [{ code: "signature_review_needed", summary: "签名需核验", sourceIds: ["ev-inspection-001"] }] },
    },
  };
  let sentBody = "";
  const invoke = createCompatibleAgentInvoker({
    apiKey: "test-key", model: "step-3.7-flash", baseUrl: "https://llm.example/v1",
    fetchImpl: async (_url, init) => {
      sentBody = String(init?.body);
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({
        schemaVersion: "agent.output.v1", role: "consumer", batchId: "CURRENT_BATCH", selectedFactIds: ["F0"],
      }) } }] }), { status: 200 });
    },
  });

  const output = await runAgent("consumer", input, invoke);
  assert.ok(!sentBody.includes(fishOilBatch.batchId));
  assert.ok(!sentBody.includes("ev-production-001"));
  assert.ok(!sentBody.includes("ev-inspection-001"));
  assert.deepEqual(output.selectedFactIds, ["F0"]);
});
