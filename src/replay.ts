import { generateKeyPairSync } from "node:crypto";
import { ConsumerParticipationRegistry } from "./consumer.js";
import { anchorPlan, evaluateBatch } from "./cli.js";
import {
  appendEvidenceToLedger,
  computeEnvelopeHash,
  computeEvidenceRoot,
  createEvidenceEnvelope,
  verifyEvidenceEnvelope,
  type EvidenceEnvelope,
  type EvidenceLedgerState,
} from "./evidence.js";
import { LocalLedger, type LocalLedgerEvent } from "./local-ledger.js";
import { sha256Hex } from "./hash.js";
import type { VerificationResult } from "./types.js";
import { buildJevState, DeterministicDecisionGate } from "./jev/context.js";
import type { JevDecision } from "./jev/model.js";

export type ReplayStatus = "anchor_pending" | "anchored" | "failed";

export interface ReplayResult {
  schemaVersion: "truthpass.cli.replay.v1";
  command: "replay";
  dataClass: "demo/synthetic";
  batchId: string;
  status: ReplayStatus;
  verificationResult: VerificationResult;
  jev: JevDecision;
  evidence: {
    valid: boolean;
    eventCount: number;
    evidenceRoot: string;
    envelopeHashes: string[];
    errors: string[];
  };
  anchor: {
    status: ReplayStatus;
    requestId: string;
    evidenceRoot: string;
    network: string;
    txHash: string | null;
    submitted: false;
  };
  stages: {
    verification: VerificationResult["status"];
    evidenceAnchor: ReplayStatus;
    purchase: "created" | "failed";
    contribution: "created" | "failed";
    dispute: "raised" | "failed";
    supersede: "recorded" | "failed";
  };
  consumer: {
    consentHash: string;
    purchaseId: string;
    feedbackId: string;
    contributionPoints: number;
  };
  dispute: { disputeId: string; reason: string };
  supersede: { replacementId: string; replaces: string };
  ledger: {
    valid: boolean;
    eventCount: number;
    ledgerRoot: string;
    errors: string[];
    events: LocalLedgerEvent[];
  };
  warnings: string[];
}

function buildFishOilEvidence(): {
  envelopes: EvidenceEnvelope[];
  root: string;
  valid: boolean;
  errors: string[];
} {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const keyRegistry = [{ issuerId: "lab-c", keyId: "lab-key-2026-01", publicKey }];
  const schema = {
    id: "fish-oil-batch-v1",
    fields: ["batchId", "epaDhaPercent", "peroxideValue", "totox", "coldChainGapHours"],
  };
  const first = createEvidenceEnvelope({
    eventId: "evt-fo-2026-001-lab",
    eventType: "lab_report",
    subjectRefs: [{ type: "batch", id: "FO-2026-001" }, { type: "sample", id: "S-2026-001-03" }],
    issuer: { type: "lab", id: "lab-c" },
    producedByAgent: "lab-agent-c",
    observedAt: "2026-10-06T10:20:00Z",
    receivedAt: "2026-10-06T10:21:00Z",
    sequence: 0,
    previousEventHash: null,
    nonce: "nonce-fo-001-lab",
    schema,
    attestationLevel: "lab-signed",
    keyId: "lab-key-2026-01",
    status: "valid",
    payload: { batchId: "FO-2026-001", epaDhaPercent: 78, peroxideValue: 2.1, totox: 11 },
    privateKey,
  });
  const second = createEvidenceEnvelope({
    eventId: "evt-fo-2026-001-cold-chain",
    eventType: "cold_chain_reading",
    subjectRefs: [{ type: "batch", id: "FO-2026-001" }],
    issuer: { type: "lab", id: "lab-c" },
    producedByAgent: "lab-agent-c",
    observedAt: "2026-10-06T10:25:00Z",
    receivedAt: "2026-10-06T10:26:00Z",
    sequence: 1,
    previousEventHash: computeEnvelopeHash(first),
    nonce: "nonce-fo-001-cold-chain",
    schema,
    attestationLevel: "lab-signed",
    keyId: "lab-key-2026-01",
    status: "valid",
    payload: { batchId: "FO-2026-001", coldChainGapHours: 2 },
    privateKey,
  });
  const envelopes = [first, second];
  const state: EvidenceLedgerState = {};
  const errors: string[] = [];
  for (const envelope of envelopes) {
    const payload = envelope.eventType === "lab_report"
      ? { batchId: "FO-2026-001", epaDhaPercent: 78, peroxideValue: 2.1, totox: 11 }
      : { batchId: "FO-2026-001", coldChainGapHours: 2 };
    const validation = verifyEvidenceEnvelope(envelope, {
      keyRegistry,
      expectedBatchId: "FO-2026-001",
      payload,
      now: "2026-10-06T12:00:00Z",
      ledger: state,
    });
    if (!validation.valid) errors.push(...validation.errors.map((error) => `${envelope.eventId}: ${error}`));
    appendEvidenceToLedger(state, envelope, validation);
  }
  return {
    envelopes,
    root: computeEvidenceRoot(envelopes),
    valid: errors.length === 0,
    errors,
  };
}

/**
 * Run the complete local business flow without sending an RPC transaction.
 * The same VerificationResult returned by `verify` is carried into every
 * later stage.  The local ledger is an append-only audit fixture; its root is
 * not a chain transaction hash and the final status therefore remains
 * `anchor_pending` until a deployed contract receipt is supplied.
 */
export async function replayFishOilFlow(batchId: string, network: "testnet" | "mainnet" = "testnet"): Promise<ReplayResult> {
  const verificationEnvelope = await evaluateBatch(batchId);
  const verification = verificationEnvelope.verificationResult as VerificationResult | null;
  if (!verification) {
    throw new Error("verify did not return the canonical VerificationResult");
  }
  const evidence = buildFishOilEvidence();
  if (!evidence.valid) throw new Error(`证据回放失败：${evidence.errors.join("；")}`);
  const jevTask = {
    taskId: "task-fish-oil-2026-001",
    serviceKind: "lab" as const,
    capability: "fish-oil-batch-quality-check",
    batchId,
    productionTime: "2026-10-06T08:00:00Z",
    acceptance: {
      requireSignature: true,
      maxLogisticsGapHours: 6,
      minEpaDhaPercent: 70,
      maxPeroxideValue: 5,
      maxTotox: 20,
      requireColdChain: true,
    },
  };
  const jevState = buildJevState(jevTask, {
    serviceId: "lab-c",
    taskId: jevTask.taskId,
    batchId,
    reportBatchId: batchId,
    productionTime: jevTask.productionTime,
    reportTime: "2026-10-06T10:20:00Z",
    logisticsGapHours: 2,
    signatureValid: true,
    epaDhaPercent: 78,
    peroxideValue: 2.1,
    totox: 11,
    coldChainGapHours: 2,
    payload: { source: "demo/synthetic" },
  });
  const jev = await new DeterministicDecisionGate({ now: () => new Date("2026-10-06T12:00:00Z") }).decide(jevState);
  const anchor = await anchorPlan(batchId, network);
  anchor.evidenceRoot = evidence.root;
  const requestId = String(anchor.requestId);
  const evidenceRoot = String(anchor.evidenceRoot);
  const ledger = new LocalLedger();
  const timestamp = "2026-10-06T12:00:00.000Z";

  await ledger.append({
    type: "verification_evaluated",
    requestId,
    createdAt: timestamp,
    data: {
      batchId,
      status: verification.status,
      score: verification.score,
      evidenceHash: verification.evidenceHash,
      checks: verification.checks,
      jevDecision: jev.decision,
      jevInputHash: jev.inputHash,
      jevOutputHash: jev.outputHash,
    },
  });
  await ledger.append({
    type: "evidence_anchor_planned",
    requestId,
    createdAt: timestamp,
    data: {
      evidenceRoot,
      network: anchor.network,
      anchorStatus: "anchor_pending",
      submitted: false,
    },
  });

  const consumers = new ConsumerParticipationRegistry();
  const consumerId = "consumer-demo-001";
  const consent = await consumers.grantConsent({
    consumerId,
    batchId,
    scopes: ["purchase", "packaging", "storage", "quality-feedback"],
    grantedAt: timestamp,
  });
  const purchaseProofHash = await sha256Hex(`truthpass:purchase:${batchId}:${consumerId}`);
  const purchase = await consumers.recordPurchase({
    consumerId,
    batchId,
    purchaseProofHash,
    createdAt: timestamp,
  });
  await ledger.append({
    type: "purchase_recorded",
    requestId,
    createdAt: timestamp,
    data: {
      batchId,
      purchaseId: purchase.purchaseId,
      purchaseProofHash,
      consumerCommitment: await sha256Hex(consumerId),
    },
  });

  const feedback = await consumers.recordFeedback({
    purchaseId: purchase.purchaseId,
    rating: 5,
    categories: ["packaging", "storage", "quality"],
    evidence: {
      source: "demo/synthetic",
      deliverySealIntact: true,
      storageTemperatureWithinPolicy: true,
    },
    createdAt: timestamp,
  });
  await ledger.append({
    type: "contribution_recorded",
    requestId,
    createdAt: timestamp,
    data: {
      batchId,
      purchaseId: purchase.purchaseId,
      feedbackId: feedback.feedbackId,
      evidenceHash: feedback.evidenceHash,
      contributionPoints: feedback.contributionPoints,
    },
  });

  const disputeReason = "演示：请求对交付后的批次进行复核";
  const disputeId = await sha256Hex(`truthpass:dispute:${requestId}:${purchase.purchaseId}`);
  await ledger.append({
    type: "dispute_raised",
    requestId,
    createdAt: timestamp,
    data: { disputeId, purchaseId: purchase.purchaseId, reason: disputeReason },
  });
  const replacementId = await sha256Hex(`truthpass:replacement:${requestId}:${disputeId}`);
  await ledger.append({
    type: "evidence_superseded",
    requestId,
    createdAt: timestamp,
    data: {
      replacementId,
      replaces: evidenceRoot,
      reason: "复核事件保留原记录并追加替代承诺",
    },
  });

  const ledgerVerification = await ledger.verify();
  const status: ReplayStatus = ledgerVerification.valid ? "anchor_pending" : "failed";
  return {
    schemaVersion: "truthpass.cli.replay.v1",
    command: "replay",
    dataClass: "demo/synthetic",
    batchId,
    status,
    verificationResult: verification,
    jev,
    evidence: {
      valid: evidence.valid,
      eventCount: evidence.envelopes.length,
      evidenceRoot: evidence.root,
      envelopeHashes: evidence.envelopes.map(computeEnvelopeHash),
      errors: evidence.errors,
    },
    anchor: {
      status,
      requestId,
      evidenceRoot,
      network: String(anchor.network),
      txHash: null,
      submitted: false,
    },
    stages: {
      verification: verification.status,
      evidenceAnchor: status,
      purchase: "created",
      contribution: "created",
      dispute: "raised",
      supersede: "recorded",
    },
    consumer: {
      consentHash: consent.consentHash,
      purchaseId: purchase.purchaseId,
      feedbackId: feedback.feedbackId,
      contributionPoints: feedback.contributionPoints,
    },
    dispute: { disputeId, reason: disputeReason },
    supersede: { replacementId, replaces: evidenceRoot },
    ledger: {
      ...ledgerVerification,
      events: ledger.list(),
    },
    warnings: [
      "本回放使用 demo/synthetic 数据。",
      "anchor_pending 表示仅生成锚定计划，未提交真实交易。",
      "本地 ledgerRoot 不是区块哈希；必须收到真实 receipt 和事件后才能显示 anchored。",
    ],
  };
}
