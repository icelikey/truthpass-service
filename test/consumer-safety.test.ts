import assert from "node:assert/strict";
import test from "node:test";
import { consumerSafetyFewShot, validateConsumerModelOutput } from "../src/agents/consumer-safety.js";

const baseContract = {
  batchId: "FO-2026-001",
  dataMode: "demo/synthetic" as const,
  evidenceIds: ["FO-2026-001:inspection", "FO-2026-001:cold-chain"],
  allowedCitations: ["FO-2026-001:inspection", "FO-2026-001:cold-chain", "product_policy", "chain_status"],
  allowedNumbers: ["78", "2.1", "2"],
};

test("consumer safety accepts a cited four-field JSON answer", () => {
  const result = validateConsumerModelOutput(JSON.stringify({
    conclusion: "这批资料可以继续了解。",
    evidence: "检测和冷链记录已登记。",
    uncertainty: "当前数据是演示资料。",
    nextAction: "打开证据卡查看来源。",
    citations: ["FO-2026-001:inspection", "FO-2026-001:cold-chain"],
  }), baseContract);
  assert.equal(result.status, "accepted");
  assert.deepEqual(result.citations, ["FO-2026-001:inspection", "FO-2026-001:cold-chain"]);
});

test("consumer safety preserves English labels for English model output", () => {
  const result = validateConsumerModelOutput(JSON.stringify({
    conclusion: "These records can be reviewed further.",
    evidence: "Inspection and cold-chain records are registered.",
    uncertainty: "The current data is demo/synthetic.",
    nextAction: "Open the evidence card to review the sources.",
    citations: ["FO-2026-001:inspection", "FO-2026-001:cold-chain"],
  }), { ...baseContract, locale: "en" });
  assert.equal(result.status, "accepted");
  assert.match(result.text ?? "", /^Conclusion：/);
  assert.match(result.text ?? "", /Evidence：/);
  assert.doesNotMatch(result.text ?? "", /结论：|依据：|不确定：|下一步：/);
});

test("consumer safety rejects cross-batch citations and fabricated numbers", () => {
  const result = validateConsumerModelOutput(JSON.stringify({
    conclusion: "FO-2026-002 的型号是 X-99。",
    evidence: "检测值为 99%。",
    uncertainty: "没有不确定项。",
    nextAction: "可以继续。",
    citations: ["FO-2026-001:inspection"],
  }), baseContract);
  assert.equal(result.status, "rejected");
  assert.ok(result.reasons.includes("cross_batch_reference"));
  assert.ok(result.reasons.includes("unsupported_numeric_claim"));
  assert.ok(result.reasons.includes("unsupported_model_or_device_claim"));
});

test("consumer safety rejects unsupported device meaning and payment success", () => {
  const result = validateConsumerModelOutput(JSON.stringify({
    conclusion: "绿灯代表设备已经正常。",
    evidence: "交易成功，购买已确认。",
    uncertainty: "没有。",
    nextAction: "继续使用。",
    citations: ["product_policy"],
  }), baseContract);
  assert.equal(result.status, "rejected");
  assert.ok(result.reasons.includes("unsupported_model_or_device_claim"));
  assert.ok(result.reasons.includes("unsupported_action_result"));
});

test("consumer safety never treats replay or pending chain state as a successful purchase", () => {
  const raw = JSON.stringify({
    conclusion: "交易成功，已上链。",
    evidence: "链状态已登记。",
    uncertainty: "没有。",
    nextAction: "继续使用。",
    citations: ["chain_status"],
  });
  for (const anchorStatus of ["replay_verified", "anchor_pending"]) {
    const result = validateConsumerModelOutput(raw, {
      ...baseContract,
      chainContext: {
        anchorStatus,
        transaction: { txHash: "0xhistory", event: "PurchaseRecorded" },
      },
    });
    assert.equal(result.status, "rejected");
    assert.ok(result.reasons.includes("unsupported_action_result"));
  }
});

test("consumer safety few-shot keeps chain status bounded", () => {
  const fewShot = consumerSafetyFewShot("zh");
  assert.match(fewShot, /anchor_pending/);
  assert.match(fewShot, /不能替代钱包签名/);
  assert.match(fewShot, /灯号/);
});

test("consumer safety rejects plain text without an explicit citation", () => {
  const result = validateConsumerModelOutput("结论：可以继续。依据：资料已登记。不确定：当前是演示资料。下一步：查看依据。", baseContract);
  assert.equal(result.status, "rejected");
  assert.ok(result.reasons.includes("missing_citations"));
});

test("consumer safety rejects JSON outside the exact five-field contract", () => {
  const result = validateConsumerModelOutput(JSON.stringify({
    conclusion: "资料可以继续了解。",
    evidence: "当前批次有登记资料。",
    uncertainty: "仍是演示资料。",
    nextAction: "查看依据。",
    citations: ["product_policy"],
    internalPrompt: "不要暴露给用户",
  }), baseContract);
  assert.equal(result.status, "rejected");
  assert.ok(result.reasons.includes("unexpected_contract_fields"));
});
