import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ConsumerParticipationRegistry } from "../src/consumer.js";
import { verifyExecution } from "../src/verifier.js";

const dataset = JSON.parse(
  await readFile(new URL("../examples/fish-oil-order-to-delivery-demo.json", import.meta.url), "utf8"),
) as any;

test("fish-oil order-to-delivery fixture preserves every batch relation", async () => {
  const flow = dataset.commerceFlow;
  const { task, evidence } = dataset.productionAndEvidence.verifierFixture;
  const verification = await verifyExecution(task, evidence);

  assert.equal(verification.status, "accepted");
  assert.equal(flow.catalogListing.batchId, task.batchId);
  assert.equal(flow.catalogListing.qualityGate.requiredVerificationStatus, verification.status);
  assert.equal(flow.order.batchId, task.batchId);
  assert.equal(flow.order.unitPrice * flow.order.quantity, flow.order.totalAmount);
  assert.equal(flow.payment.amount, flow.order.totalAmount);
  assert.equal(flow.payment.currency, flow.order.currency);
  assert.equal(flow.fulfillment.batchId, task.batchId);
  assert.equal(flow.fulfillment.orderId, flow.order.orderId);
  assert.equal(flow.payment.orderId, flow.order.orderId);
  assert.equal(flow.shipment.orderId, flow.order.orderId);
  assert.equal(flow.shipment.batchId, flow.order.batchId);
  assert.equal(flow.shipment.deliveryStatus, "delivered");
  assert.equal(flow.shipment.sealIntactAtDelivery, true);
  assert.equal(flow.fulfillment.inventoryBefore - flow.fulfillment.inventoryAfter, flow.order.quantity);
});

test("consumer purchase and feedback close the simulated order loop", async () => {
  const flow = dataset.commerceFlow;
  const registry = new ConsumerParticipationRegistry();

  const consent = await registry.grantConsent({
    consumerId: flow.customer.consumerId,
    batchId: flow.order.batchId,
    scopes: flow.customer.consent.scopes,
    grantedAt: flow.customer.consent.grantedAt,
  });
  const purchase = await registry.recordPurchase({
    consumerId: flow.order.consumerId,
    batchId: flow.order.batchId,
    purchaseProofHash: flow.order.purchaseProofHashInput,
    createdAt: flow.consumerAcceptance.purchaseCreatedAt,
  });
  const feedback = await registry.recordFeedback({
    purchaseId: purchase.purchaseId,
    rating: flow.consumerAcceptance.rating,
    categories: flow.consumerAcceptance.categories,
    evidence: flow.consumerAcceptance.evidence,
    createdAt: flow.consumerAcceptance.feedbackSubmittedAt,
  });

  assert.ok(consent.consentHash);
  assert.equal(purchase.batchId, flow.order.batchId);
  assert.equal(feedback.purchaseId, purchase.purchaseId);
  assert.equal(feedback.consumerId, flow.customer.consumerId);
  assert.equal(dataset.anchorPlan.status, "prepared_offline_not_submitted");
});


