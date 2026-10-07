import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import {
  appendEvidenceToLedger,
  computeEvidenceRoot,
  createEvidenceEnvelope,
  verifyEvidenceEnvelope,
  type EvidenceEnvelope,
} from "../src/evidence.js";

function makePair() {
  return generateKeyPairSync("ed25519");
}

function makeEnvelope(privateKey: ReturnType<typeof makePair>["privateKey"], sequence = 0, previousEventHash: string | null = null): EvidenceEnvelope {
  return createEvidenceEnvelope({
    eventId: `evt-${sequence}`,
    eventType: "lab_report",
    subjectRefs: [{ type: "batch", id: "FO-2026-001" }],
    issuer: { type: "lab", id: "lab-c" },
    producedByAgent: "lab-adapter",
    observedAt: `2026-10-06T10:0${sequence}:00Z`,
    sequence,
    previousEventHash,
    nonce: `nonce-${sequence}`,
    attestationLevel: "lab-signed",
    keyId: "key-lab-c-1",
    status: "valid",
    payload: { epaDhaPercent: 78, sequence },
    schema: { name: "fish-oil-lab-report", version: 1 },
    privateKey,
  });
}

test("normalizes, hashes and verifies a signed envelope", () => {
  const pair = makePair();
  const envelope = makeEnvelope(pair.privateKey);
  const result = verifyEvidenceEnvelope(envelope, {
    publicKey: pair.publicKey,
    payload: { sequence: 0, epaDhaPercent: 78 },
    expectedBatchId: "FO-2026-001",
    expectedIssuerId: "lab-c",
    now: "2026-10-06T12:00:00Z",
  });
  assert.equal(result.valid, true);
  assert.equal(result.errors.length, 0);
});

test("rejects tampered payload and replayed sequence", () => {
  const pair = makePair();
  const first = makeEnvelope(pair.privateKey);
  const tampered = { ...first, payloadHash: `0x${"00".repeat(32)}` };
  assert.equal(verifyEvidenceEnvelope(tampered, { publicKey: pair.publicKey }).valid, false);

  const state = {};
  assert.equal(appendEvidenceToLedger(state, first).valid, true);
  assert.equal(appendEvidenceToLedger(state, first).valid, false);
});

test("evidence root is independent of insertion order", () => {
  const pair = makePair();
  const a = makeEnvelope(pair.privateKey, 0);
  const b = makeEnvelope(pair.privateKey, 1, "0x" + "11".repeat(32));
  assert.equal(computeEvidenceRoot([a, b]), computeEvidenceRoot([b, a]));
});
