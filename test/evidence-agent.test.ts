import assert from "node:assert/strict";
import test from "node:test";
import { ExternalAgentApi } from "../src/external-agent-api.js";
import { canonicalJson, EvidenceGateway, signEnvelopeWithHmac, type EvidenceEnvelope } from "../src/evidence.js";
import { sha256Hex } from "../src/hash.js";
import { planPolls, selectRandomAudits } from "../src/audit.js";

const SECRET = "device-secret-demo";
const BATCH = "FG-PA-261006-01";

async function makeEnvelope(
  eventId: string,
  sequence: number,
  payload: Record<string, unknown>,
  previousEventHash?: string,
): Promise<EvidenceEnvelope> {
  const envelope: EvidenceEnvelope = {
    envelopeVersion: "evidence-envelope-v1",
    eventId,
    eventType: eventId.includes("lab") ? "lab_report" : "temperature_reading",
    subjectRefs: [{ type: "batch", id: BATCH }, { type: "device", id: "device-07" }],
    issuer: { type: "device", id: "device-07" },
    producedByAgent: "edge-gateway-demo",
    observedAt: "2026-10-07T04:20:00Z",
    receivedAt: "2026-10-07T04:20:05Z",
    sequence,
    previousEventHash,
    payload,
    payloadHash: await sha256Hex(canonicalJson(payload)),
    schemaHash: "schema-fish-oil-cold-chain-v1",
    methodId: "temperature-v1",
    unitSystem: "SI",
    attestationLevel: "device-signed",
    keyId: "device-key-07",
  };
  envelope.signature = await signEnvelopeWithHmac(envelope, SECRET);
  return envelope;
}

test("evidence gateway verifies signed events and rejects payload tampering", async () => {
  const gateway = new EvidenceGateway();
  gateway.registerKey({
    issuerId: "device-07",
    keyId: "device-key-07",
    attestationLevel: "device-signed",
    secret: SECRET,
  });

  const first = await gateway.ingest(await makeEnvelope("evt-001", 1, { temperatureC: 4.2 }));
  assert.equal(first.validation.status, "accepted");

  const tampered = await gateway.ingest({
    ...(await makeEnvelope("evt-002-tampered", 2, { temperatureC: 4.8 }, first.validation.eventHash)),
    payload: { temperatureC: 40.8 },
  });
  assert.equal(tampered.validation.status, "rejected");
  assert.ok(tampered.validation.reasons.includes("payload_hash_mismatch"));

  const second = await gateway.ingest(
    await makeEnvelope("evt-002", 2, { temperatureC: 4.8 }, first.validation.eventHash),
  );
  assert.equal(second.validation.status, "accepted");

  const replay = await gateway.ingest(
    await makeEnvelope("evt-003", 3, { temperatureC: 4.8 }, second.validation.eventHash),
  );
  assert.equal(replay.validation.status, "rejected");
  assert.ok(replay.validation.reasons.includes("payload_replay_detected"));
});

test("supplier declared evidence is retained for review and raw values are redacted by default", async () => {
  const gateway = new EvidenceGateway();
  const payload = { label: "supplier-declared", epaDhaPercent: 73 };
  const envelope: EvidenceEnvelope = {
    envelopeVersion: "evidence-envelope-v1",
    eventId: "evt-supplier-001",
    eventType: "lab_report",
    subjectRefs: [{ type: "batch", id: BATCH }],
    issuer: { type: "supplier", id: "supplier-01" },
    producedByAgent: "supplier-connector",
    observedAt: "2026-10-07T04:20:00Z",
    receivedAt: "2026-10-07T04:20:05Z",
    payload,
    payloadHash: await sha256Hex(canonicalJson(payload)),
    schemaHash: "schema-fish-oil-lab-v1",
    attestationLevel: "supplier-declared",
  };
  const result = await gateway.ingest(envelope);
  assert.equal(result.validation.status, "review");
  const view = gateway.listForBatch(BATCH);
  assert.equal(view[0].status, "review");
  assert.equal(view[0].payload, undefined);
  assert.ok(view[0].reasons.includes("supplier_declared_requires_independent_confirmation"));

  const replay = await gateway.ingest({ ...envelope, eventId: "evt-supplier-002" });
  assert.equal(replay.validation.status, "rejected");
  assert.ok(replay.validation.reasons.includes("payload_replay_detected"));
});

test("external Agent API returns evidence views and consumer reports", async () => {
  const gateway = new EvidenceGateway();
  gateway.registerKey({
    issuerId: "device-07",
    keyId: "device-key-07",
    attestationLevel: "device-signed",
    secret: SECRET,
  });
  const event = await gateway.ingest(await makeEnvelope("evt-api-001", 1, { temperatureC: 4.2 }));
  assert.equal(event.validation.status, "accepted");

  const api = new ExternalAgentApi(gateway);
  const view = await api.handle({
    method: "GET",
    path: "/v1/batches/FG-PA-261006-01/evidence",
  });
  assert.equal(view.status, 200);
  const evidence = view.body.evidence as Array<Record<string, unknown>>;
  assert.equal(evidence[0].payload, undefined);

  const report = await api.handle({
    method: "POST",
    path: "/v1/batches/FG-PA-261006-01/consumer-report",
    body: {
      requestedChecks: ["temperature_reading", "lab_report"],
      verification: {
        status: "accepted",
        checks: { coldChainWithinLimit: true },
        reasons: [],
      },
    },
  });
  assert.equal(report.status, 200);
  assert.equal(report.body.status, "review");
  assert.deepEqual(report.body.missing, ["lab_report"]);
});

test("polling and risk-weighted random audits are reproducible", async () => {
  const now = new Date("2026-10-07T12:00:00Z");
  const plans = planPolls([
    { targetId: "device-01", kind: "device", intervalMs: 60_000, lastObservedAt: "2026-10-07T11:58:00Z", riskWeight: 1 },
    { targetId: "lab-01", kind: "lab", intervalMs: 60_000, riskWeight: 2 },
  ], now);
  assert.equal(plans[0].due, true);
  assert.equal(plans[1].reason, "never_observed");

  const candidates = [
    { candidateId: "batch-a", batchId: "B-A", riskWeight: 1, strata: "normal" },
    { candidateId: "batch-b", batchId: "B-B", riskWeight: 2, strata: "near-threshold" },
    { candidateId: "batch-c", batchId: "B-C", riskWeight: 1, strata: "normal" },
  ];
  const first = await selectRandomAudits(candidates, 2, "commit-reveal-seed-01");
  const second = await selectRandomAudits(candidates, 2, "commit-reveal-seed-01");
  assert.deepEqual(first.selected, second.selected);
  assert.equal(first.seedCommitment, second.seedCommitment);
  assert.equal(first.selected.length, 2);
});

