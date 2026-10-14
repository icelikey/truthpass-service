import assert from "node:assert/strict";
import test from "node:test";
import { numericGuard, explainRejection } from "../src/knowledge/explain.js";
import { buildWikiAppendix, selectRelevantChunks } from "../src/knowledge/wiki.js";
import type { KnowledgeChunk } from "../src/knowledge/wiki.js";

function chunk(id: number, concepts: string[], title: string, chunkText?: string, keywords?: string[]): KnowledgeChunk {
  return {
    id,
    sourceTable: "standard_limits",
    sourceId: String(id),
    title,
    chunkText: chunkText ?? "限值 5，TOTOX 上限 26，标准条目 " + id,
    metadata: {},
    concepts,
    keywords: keywords ?? [],
  };
}

// ---------- numericGuard：三轮热修的回归钉子 ----------

test("守卫放行允许来源中的数字", () => {
  const violations = numericGuard("实测过氧化值 7.2 超过限值 5", ["过氧化值实测 7.2，限值 5"]);
  assert.deepEqual(violations, []);
});

test("守卫拦截证据之外的新数字并给出上下文", () => {
  const violations = numericGuard("实测过氧化值 7.2，且 TOTOX 高达 31", ["过氧化值实测 7.2"]);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].number, "31");
  assert.ok(violations[0].context.includes("TOTOX"));
});

test("守卫不把引用标记【K编号】当数据数字", () => {
  const violations = numericGuard("见【K2】与【K10】的说明", []);
  assert.deepEqual(violations, []);
});

test("守卫不把行首列表编号当数据数字", () => {
  const violations = numericGuard("1. 批次不一致\n2. 签名无效\n10. 补充说明", []);
  assert.deepEqual(violations, []);
});

test("守卫不把来源指针 standard_limits#4 当数据数字", () => {
  const violations = numericGuard("依据见 standard_limits#5,6 与 standard_limits#4", []);
  assert.deepEqual(violations, []);
});

test("守卫对纯文本中的孤立数字仍然拦截", () => {
  const violations = numericGuard("该批次共有 4 项检查未通过", []);
  assert.equal(violations.length, 1);
  assert.equal(violations[0].number, "4");
});

// ---------- explainRejection：L1 映射 + 拒绝/通过两分支 ----------

const KNOWLEDGE = [
  chunk(1, ["oxidation"], "GOED 三限值"),
  chunk(2, ["oxidation"], "IFOS 更严线"),
  chunk(3, ["potency"], "原料目录下限"),
  chunk(4, ["potency", "policy"], "2025 上限 70%"),
  chunk(5, ["regulation"], "2012 内容物欺诈"),
  chunk(6, ["vitamin"], "药典维生素AD"),
  chunk(7, ["policy"], "真验 v1 政策对照"),
];

test("拒绝场景：按检查项概念映射取证，模板含事实与引用", async () => {
  const explanation = await explainRejection(
    {
      checks: { signatureValid: false, batchMatches: false, epaDhaWithinLimit: false },
      reasons: ["检测报告批次与请求批次不一致", "结果缺少有效的服务签名", "EPA+DHA 未达到 70% 或缺少检测值"],
      evidence: { epaDhaPercent: 61, reportBatchId: "FO-2026-000", signatureValid: false },
    },
    KNOWLEDGE,
  );
  assert.equal(explanation.mode, "deterministic");
  assert.ok(explanation.text.includes("EPA+DHA 未达到 70%"));
  assert.ok(explanation.text.includes("61%"));
  assert.ok(explanation.text.includes("【K1】"));
  // signatureValid→policy、batchMatches→regulation、epaDha→potency：
  // 命中块 = 3(potency) + 4(potency+policy) + 5(regulation) + 7(policy) = 4；oxidation/vitamin 不相关
  assert.equal(explanation.citations.length, 4);
  assert.ok(explanation.citations.every((c) => !c.title.includes("药典")));
});

test("通过场景：只引用政策对照块", async () => {
  const explanation = await explainRejection(
    {
      checks: { signatureValid: true, batchMatches: true, epaDhaWithinLimit: true },
      reasons: [],
    },
    KNOWLEDGE,
  );
  assert.ok(explanation.text.includes("全部确定性验收项通过"));
  assert.equal(explanation.citations.length, 2); // 仅 policy 概念：4 与 7
  assert.ok(explanation.citations.every((c) => c.title !== "GOED 三限值"));
});

test("引用数量上限为 6", async () => {
  const many = Array.from({ length: 8 }, (_, i) => chunk(i + 1, ["oxidation"], "氧化块 " + (i + 1)));
  const explanation = await explainRejection(
    { checks: { peroxideWithinLimit: false }, reasons: ["过氧化值未达到 ≤5 或缺少检测值"] },
    many,
  );
  assert.equal(explanation.citations.length, 6);
});

// ---------- buildWikiAppendix ----------

test("wiki 附录带 K 编号与来源回链", () => {
  const appendix = buildWikiAppendix([KNOWLEDGE[0], KNOWLEDGE[2]]);
  assert.ok(appendix.includes("【K1】GOED 三限值（来源: standard_limits#1）"));
  assert.ok(appendix.includes("【K2】原料目录下限（来源: standard_limits#3）"));
});

// ---------- selectRelevantChunks：检索过滤不劣于整库注入 ----------

test("selectRelevantChunks 命中关键词时只注入命中块（不补足，守卫更严）", () => {
  const many = Array.from({ length: 12 }, (_, i) => chunk(i + 1, ["evidence"], "无关块 " + (i + 1)));
  many[3] = chunk(4, ["potency"], "含量块", undefined, ["过氧化值", "标准"]);
  const picked = selectRelevantChunks(many, "过氧化值标准是多少", 8);
  assert.deepEqual(picked.map((c) => c.id), [4]);
});

test("selectRelevantChunks 多个命中按分数排序并截断 limit", () => {
  const many = Array.from({ length: 12 }, (_, i) => chunk(i + 1, ["vitamin"], "无关块 " + (i + 1)));
  many[0] = chunk(1, ["potency"], "块1", undefined, ["氧化"]); // 关键词 +3
  many[5] = chunk(6, ["oxidation"], "块6", undefined, ["氧化"]); // 关键词 +3，index 靠后
  const picked = selectRelevantChunks(many, "氧化", 2);
  assert.deepEqual(picked.map((c) => c.id), [1, 6]);
});

test("selectRelevantChunks 零命中回退前 8 块", () => {
  const many = Array.from({ length: 12 }, (_, i) => chunk(i + 1, ["evidence"], "无关块 " + (i + 1)));
  const picked = selectRelevantChunks(many, "今天天气怎么样", 8);
  assert.deepEqual(picked.map((c) => c.id), [1, 2, 3, 4, 5, 6, 7, 8]);
});

test("selectRelevantChunks 不超过 limit 时整库原样返回", () => {
  const few = Array.from({ length: 6 }, (_, i) => chunk(i + 1, ["evidence"], "块 " + (i + 1)));
  assert.deepEqual(selectRelevantChunks(few, "随便问", 8), few);
});
