import assert from "node:assert/strict";
import test from "node:test";
import { ConsumerParticipationRegistry } from "../src/consumer.js";

test("requires consent and a purchase before recording consumer feedback", async () => {
  const registry = new ConsumerParticipationRegistry();
  await assert.rejects(
    () => registry.recordPurchase({ consumerId: "c-1", batchId: "FO-1", purchaseProofHash: "p", createdAt: "2026-10-06T12:00:00Z" }),
    /尚未授权/,
  );
  await registry.grantConsent({ consumerId: "c-1", batchId: "FO-1", scopes: ["quality-feedback"], grantedAt: "2026-10-06T12:00:00Z" });
  const purchase = await registry.recordPurchase({ consumerId: "c-1", batchId: "FO-1", purchaseProofHash: "p", createdAt: "2026-10-06T12:00:00Z" });
  const feedback = await registry.recordFeedback({ purchaseId: purchase.purchaseId, rating: 4, categories: ["包装完好"], evidence: { source: "demo/synthetic" }, createdAt: "2026-10-06T12:10:00Z" });
  assert.equal(feedback.batchId, "FO-1");
  await assert.rejects(
    () => registry.recordFeedback({ purchaseId: purchase.purchaseId, rating: 5, categories: ["重复"], evidence: { source: "demo/synthetic" } }),
    /只能提交一次/,
  );
});
