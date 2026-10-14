import assert from "node:assert/strict";
import test from "node:test";
import { answerWithKnowledge, deterministicAnswer } from "../src/knowledge/qa.js";
import type { KnowledgeChunk } from "../src/knowledge/wiki.js";

const CHUNKS: KnowledgeChunk[] = [
  { id: 1, sourceTable: "standards", sourceId: "4", title: "GOED 氧化限值", chunkText: "GOED 规定过氧化值上限为 5 meq/kg，TOTOX 上限为 26。", metadata: {}, concepts: ["oxidation"], keywords: ["过氧化值", "TOTOX"] },
  { id: 2, sourceTable: "standards", sourceId: "9", title: "含量下限", chunkText: "备案原料鱼油 EPA+DHA 合计不低于 25 g/100g。", metadata: {}, concepts: ["potency"], keywords: ["含量"] },
];

function fetchReturning(content: unknown) {
  return async () => new Response(JSON.stringify({ choices: [{ message: { content: typeof content === "string" ? content : JSON.stringify(content) } }] }), { status: 200, headers: { "Content-Type": "application/json" } });
}

test("knowledge qa answers grounded in chunks with citations", async () => {
  const answer = await answerWithKnowledge("过氧化值标准是多少？", CHUNKS, {
    apiKey: "test", model: "m", fetchImpl: fetchReturning({ answer: "根据【K1】，GOED 规定过氧化值上限为 5 meq/kg。", refs: [1] }),
  });
  assert.equal(answer.grounded, true);
  assert.ok(answer.text.includes("5 meq/kg"));
  assert.deepEqual(answer.citations.map((c) => c.ref), ["K1"]);
  assert.equal(answer.citations[0].source, "standards#4");
});

test("numeric guard rejects fabricated numbers and falls back to deterministic excerpts", async () => {
  const answer = await answerWithKnowledge("过氧化值标准是多少？", CHUNKS, {
    apiKey: "test", model: "m", fetchImpl: fetchReturning({ answer: "根据【K1】，过氧化值上限为 12 meq/kg。", refs: [1] }),
  });
  assert.equal(answer.grounded, false);
  assert.ok(answer.text.includes("已按摘录回退"));
  // 确定性回退仍要携带引用
  assert.ok(answer.citations.length > 0);
});

test("invalid citations default to the first chunks without failing", async () => {
  const answer = await answerWithKnowledge("标准是多少？", CHUNKS, {
    apiKey: "test", model: "m", fetchImpl: fetchReturning({ answer: "依据登记标准，过氧化值上限为 5 meq/kg。", refs: [99] }),
  });
  assert.equal(answer.grounded, true);
  assert.ok(answer.citations.every((c) => Number(c.ref.slice(1)) <= CHUNKS.length));
});

test("model failure and missing credentials fall back deterministically", async () => {
  const offline = await answerWithKnowledge("标准是多少？", CHUNKS, { apiKey: "", model: "" });
  assert.equal(offline.grounded, false);

  const http = await answerWithKnowledge("标准是多少？", CHUNKS, {
    apiKey: "test", model: "m",
    fetchImpl: async () => new Response("upstream", { status: 503 }),
  });
  assert.equal(http.grounded, false);
  assert.ok(http.text.includes("HTTP 503"));
});

test("empty knowledge base answers without invoking the model", async () => {
  const answer = await answerWithKnowledge("标准是多少？", [], {
    apiKey: "test", model: "m",
    fetchImpl: async () => { throw new Error("must not fetch"); },
  });
  assert.equal(answer.grounded, false);
  assert.ok(answer.text.includes("没有登记任何知识块"));
});

test("deterministic fallback lists excerpts with K markers", () => {
  const result = deterministicAnswer(CHUNKS, "服务暂不可用。");
  assert.match(result.text, /【K1】GOED 氧化限值（来源: standards#4）/);
  assert.equal(result.citations.length, CHUNKS.length);
  assert.equal(result.grounded, false);
});
