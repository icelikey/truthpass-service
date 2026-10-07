import { readFile } from "node:fs/promises";
import { ConsumerParticipationRegistry } from "./consumer.js";
import { sha256Hex } from "./hash.js";
import { ServiceRegistry } from "./registry.js";
import { verifyExecution } from "./verifier.js";
import type { ExecutionEvidence, TaskRequest } from "./types.js";

type E2EDataset = {
  productionAndEvidence: {
    verifierFixture: { task: TaskRequest; evidence: ExecutionEvidence };
  };
  commerceFlow: {
    customer: {
      consumerId: string;
      consent: {
        scopes: Array<"purchase" | "packaging" | "odor" | "storage" | "quality-feedback">;
        grantedAt: string;
        consentVersion: string;
      };
    };
    catalogListing: {
      listingId: string;
      batchId: string;
      availableQuantity: number;
      unitPrice: number;
      currency: string;
      qualityGate: { requiredVerificationStatus: string };
      listingStatus: string;
    };
    order: {
      orderId: string;
      consumerId: string;
      listingId: string;
      batchId: string;
      quantity: number;
      unitPrice: number;
      totalAmount: number;
      currency: string;
      status: string;
      purchaseProofHashInput: string;
    };
    payment: { paymentId: string; orderId: string; status: string; amount: number; currency: string };
    fulfillment: {
      orderId: string;
      batchId: string;
      pickedQuantity: number;
      inventoryBefore: number;
      inventoryAfter: number;
      labelBatchMatch: boolean;
    };
    shipment: {
      orderId: string;
      batchId: string;
      deliveryStatus: string;
      sealIntactAtDelivery: boolean;
      temperatureGapHours: number;
    };
    consumerAcceptance: {
      purchaseProofHashInput: string;
      purchaseCreatedAt: string;
      feedbackSubmittedAt: string;
      rating: number;
      categories: string[];
      evidence: Record<string, unknown>;
    };
    expectedClosure: Record<string, string>;
  };
  anchorPlan: { network: string; status: string; records: string[] };
};

const dataset = JSON.parse(
  await readFile(new URL("../examples/fish-oil-order-to-delivery-demo.json", import.meta.url), "utf8"),
) as E2EDataset;

const { task, evidence } = dataset.productionAndEvidence.verifierFixture;
const flow = dataset.commerceFlow;
const qualityVerification = await verifyExecution(task, evidence);

if (qualityVerification.status !== "accepted") {
  throw new Error("quality gate failed: " + qualityVerification.reasons.join("; "));
}
if (flow.catalogListing.batchId !== task.batchId || flow.order.batchId !== task.batchId) {
  throw new Error("catalog/order batch does not match verified batch");
}
if (flow.order.consumerId !== flow.customer.consumerId) {
  throw new Error("order consumer does not match consent consumer");
}
if (flow.order.listingId !== flow.catalogListing.listingId) {
  throw new Error("order listing does not match catalog listing");
}
if (flow.catalogListing.qualityGate.requiredVerificationStatus !== qualityVerification.status) {
  throw new Error("catalog quality gate does not match verifier result");
}
if (
  flow.order.quantity > flow.catalogListing.availableQuantity ||
  flow.order.unitPrice * flow.order.quantity !== flow.order.totalAmount
) {
  throw new Error("order quantity or total amount is invalid");
}
if (
  flow.payment.orderId !== flow.order.orderId ||
  flow.payment.status !== "captured" ||
  flow.payment.amount !== flow.order.totalAmount ||
  flow.payment.currency !== flow.order.currency
) {
  throw new Error("payment is not captured for this order");
}
if (
  flow.fulfillment.orderId !== flow.order.orderId ||
  flow.fulfillment.batchId !== flow.order.batchId ||
  flow.fulfillment.pickedQuantity !== flow.order.quantity ||
  flow.fulfillment.inventoryBefore - flow.fulfillment.inventoryAfter !== flow.order.quantity ||
  !flow.fulfillment.labelBatchMatch
) {
  throw new Error("fulfillment relation or inventory decrement is invalid");
}
if (
  flow.shipment.orderId !== flow.order.orderId ||
  flow.shipment.batchId !== flow.order.batchId ||
  flow.shipment.deliveryStatus !== "delivered" ||
  !flow.shipment.sealIntactAtDelivery ||
  flow.shipment.temperatureGapHours > task.acceptance.maxLogisticsGapHours
) {
  throw new Error("shipment does not satisfy delivery closure checks");
}
if (
  flow.consumerAcceptance.purchaseProofHashInput !== flow.order.purchaseProofHashInput ||
  flow.consumerAcceptance.rating < 1 ||
  flow.consumerAcceptance.rating > 5
) {
  throw new Error("consumer acceptance is not bound to this order");
}

const consumers = new ConsumerParticipationRegistry();
const consent = await consumers.grantConsent({
  consumerId: flow.customer.consumerId,
  batchId: flow.order.batchId,
  scopes: flow.customer.consent.scopes,
  grantedAt: flow.customer.consent.grantedAt,
});
const purchase = await consumers.recordPurchase({
  consumerId: flow.order.consumerId,
  batchId: flow.order.batchId,
  purchaseProofHash: flow.order.purchaseProofHashInput,
  createdAt: flow.consumerAcceptance.purchaseCreatedAt,
});
const consumerFeedback = await consumers.recordFeedback({
  purchaseId: purchase.purchaseId,
  rating: flow.consumerAcceptance.rating,
  categories: flow.consumerAcceptance.categories,
  evidence: flow.consumerAcceptance.evidence,
  createdAt: flow.consumerAcceptance.feedbackSubmittedAt,
});

const reputationRegistry = new ServiceRegistry();
const serviceFeedback = await reputationRegistry.recordFeedback(
  evidence.serviceId,
  task,
  qualityVerification,
  flow.consumerAcceptance.feedbackSubmittedAt,
);

const anchorInputs = {
  batchId: flow.order.batchId,
  verificationEvidenceHash: qualityVerification.evidenceHash,
  orderId: flow.order.orderId,
  paymentId: flow.payment.paymentId,
  purchaseId: purchase.purchaseId,
  consumerFeedbackId: consumerFeedback.feedbackId,
  serviceFeedbackId: serviceFeedback.feedbackId,
};
const anchorBundleHash = await sha256Hex(JSON.stringify(anchorInputs));

console.log(JSON.stringify({
  dataset: "truthpass-fish-oil-order-to-delivery-demo-v1",
  simulated: true,
  stages: {
    qualityVerification: qualityVerification.status,
    catalogListing: flow.catalogListing.listingStatus,
    order: flow.order.status,
    payment: flow.payment.status,
    fulfillment: "packed",
    shipment: flow.shipment.deliveryStatus,
    purchaseBinding: "created",
    consumerFeedback: "created",
    reputationFeedback: "created",
    chainAnchorBundle: dataset.anchorPlan.status,
  },
  qualityVerification: {
    score: qualityVerification.score,
    evidenceHash: qualityVerification.evidenceHash,
    reasons: qualityVerification.reasons,
  },
  order: {
    orderId: flow.order.orderId,
    quantity: flow.order.quantity,
    totalAmount: flow.order.totalAmount,
    currency: flow.order.currency,
  },
  consumer: {
    consumerId: flow.customer.consumerId,
    consentHash: consent.consentHash,
    purchaseId: purchase.purchaseId,
    feedbackId: consumerFeedback.feedbackId,
  },
  reputation: serviceFeedback,
  anchorBundle: {
    network: dataset.anchorPlan.network,
    status: dataset.anchorPlan.status,
    hash: anchorBundleHash,
    records: dataset.anchorPlan.records,
  },
}, null, 2));



