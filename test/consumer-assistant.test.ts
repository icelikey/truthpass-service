import assert from "node:assert/strict";
import test from "node:test";
import { answerConsumerQuestion, type ConsumerEvidenceSnapshot } from "../src/agents/consumer-assistant.js";

const snapshot: ConsumerEvidenceSnapshot = {
  batchId: "FO-TEST-001",
  dataMode: "external",
  decision: "not_assessed",
  decisionReasons: [],
  evidence: [
    { evidenceId: "lab-001", kind: "inspection", issuerId: "lab-1", sourceKind: "third_party", status: "submitted", dataMode: "external", signature: "not_checked" },
    { evidenceId: "factory-001", kind: "production", issuerId: "factory-1", sourceKind: "manufacturer", status: "submitted", dataMode: "external", signature: "missing" },
  ],
};

test("explains missing evidence as unknown, not product failure", () => {
  const answer = answerConsumerQuestion("这批还缺什么证据？", snapshot);
  assert.match(answer.headline, /未覆盖/);
  assert.ok(answer.uncertainties.some((item) => item.includes("不等同于该项已经不合格")));
  assert.ok(answer.nextActions.some((item) => item.includes("温控/运输记录")));
});

test("distinguishes an unverified signature from a verified one", () => {
  const answer = answerConsumerQuestion("检测报告的签名能核验吗？", snapshot);
  assert.match(answer.headline, /尚未经过系统核验/);
  assert.ok(answer.uncertainties.some((item) => item.includes("不能确认签发者身份")));
  assert.ok(answer.nextActions.some((item) => item.includes("公钥信息")));
});

test("does not claim a verdict when deterministic assessment was not supplied", () => {
  const answer = answerConsumerQuestion("这批能放心买吗？", snapshot);
  assert.equal(answer.decision, "not_assessed");
  assert.match(answer.headline, /不足以给出/);
});

test("reports explicitly invalid signatures without changing the decision", () => {
  const answer = answerConsumerQuestion("签名是否有效？", {
    ...snapshot,
    evidence: snapshot.evidence.map((item) => item.kind === "inspection" ? { ...item, signature: "invalid" } : item),
  });
  assert.match(answer.headline, /核验失败/);
  assert.equal(answer.decision, "not_assessed");
});

test("labels synthetic data as demo and never treats it as real-batch proof", () => {
  const answer = answerConsumerQuestion("这批可信么？", { ...snapshot, dataMode: "demo/synthetic" });
  assert.ok(answer.uncertainties.some((item) => item.includes("不能证明真实商品")));
});

test("explains who submitted evidence without equating source identity with truth", () => {
  const answer = answerConsumerQuestion("这些证据来自谁？", snapshot);
  assert.ok(answer.headline.includes("厂商") && answer.headline.includes("第三方机构"));
  assert.match(answer.headline, /不等于记录内容已经独立验证/);
});

test("consumer facts are readable without leaking internal evidence IDs", () => {
  const answer = answerConsumerQuestion("这批目前能确认什么？", snapshot);
  assert.ok(answer.facts.some((fact) => fact.includes("第三方检测来自第三方机构")));
  assert.ok(answer.facts.some((fact) => fact.includes("生产记录由生产方提交")));
  assert.ok(answer.facts.every((fact) => !fact.includes("lab-001") && !fact.includes("factory-001")));
});
