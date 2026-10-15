import assert from "node:assert/strict";
import test from "node:test";
import { EnterprisePilotStore, type EnterpriseEvidenceEnvelope } from "../src/enterprise/pilot-store.js";

function evidence(tenantId: string, kind: EnterpriseEvidenceEnvelope["kind"], evidenceId: string): EnterpriseEvidenceEnvelope {
  return {
    schemaVersion: "evidence.v1",
    tenantId,
    brandId: "brand-demo",
    productId: "product-fish-oil",
    batchId: "BATCH-001",
    sampleId: kind === "inspection" ? "SAMPLE-001" : undefined,
    evidenceId,
    kind,
    issuerId: kind === "inspection" ? "lab-demo" : "factory-demo",
    sourceKind: kind === "inspection" ? "third_party" : "manufacturer",
    occurredAt: "2026-10-15T08:00:00.000Z",
    payload: kind === "production"
      ? {
          schemaVersion: "production.event.v1",
          stage: "encapsulation",
          sequence: 1,
          startedAt: "2026-10-15T08:00:00.000Z",
          endedAt: "2026-10-15T08:30:00.000Z",
          inputs: [],
          outputs: [],
          observations: [],
          deviations: [],
          sourceEvidenceIds: [],
          legacyPayload: undefined,
          traceability: undefined,
        }
      : { kind, batchId: "BATCH-001" },
    dataMode: "external",
  };
}

test("enterprise pilot store isolates tenants and keeps imports idempotent", async () => {
  const beforeBackend = process.env.DATA_BACKEND;
  const beforeDatabase = process.env.DATABASE_URL;
  process.env.DATA_BACKEND = "memory";
  delete process.env.DATABASE_URL;
  try {
    const store = new EnterprisePilotStore();
    const first = await store.importEvidence(evidence("tenant-a", "production", "EV-001"), "req-001");
    const replay = await store.importEvidence(evidence("tenant-a", "production", "EV-001"), "req-002");
    assert.equal(first.idempotent, false);
    assert.equal(replay.idempotent, true);
    assert.equal((await store.listEvidence("tenant-b", "BATCH-001")).length, 0);
    assert.equal((await store.listEvidence("tenant-a", "BATCH-001")).length, 1);
    await assert.rejects(
      store.importEvidence({ ...evidence("tenant-a", "shipment", "EV-001"), payload: { changed: true } }, "req-003"),
      /EVIDENCE_ID_CONFLICT/,
    );
  } finally {
    if (beforeBackend === undefined) delete process.env.DATA_BACKEND; else process.env.DATA_BACKEND = beforeBackend;
    if (beforeDatabase === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = beforeDatabase;
  }
});

test("enterprise pilot verification fails closed for missing signatures and revoked evidence", async () => {
  const beforeBackend = process.env.DATA_BACKEND;
  const beforeDatabase = process.env.DATABASE_URL;
  process.env.DATA_BACKEND = "memory";
  delete process.env.DATABASE_URL;
  try {
    const store = new EnterprisePilotStore();
    for (const [index, kind] of (["production", "inspection", "cold_chain", "shipment"] as const).entries()) {
      await store.importEvidence(evidence("tenant-a", kind, `EV-${index}`), `req-${index}`);
    }
    const review = await store.validateBatch("tenant-a", "BATCH-001", "validate-001");
    assert.equal(review.status, "review");
    assert.equal(review.verifierVersion, "enterprise-evidence-gate-v1");
    assert.equal(review.dataMode, "external");

    assert.equal(await store.revoke("tenant-a", "EV-0", "revoke-001"), true);
    const rejected = await store.validateBatch("tenant-a", "BATCH-001", "validate-002");
    assert.equal(rejected.status, "rejected");
    const exported = await store.exportAudit("tenant-a");
    assert.ok(exported.events.some((event) => event.eventType === "evidence_revoked"));
    assert.equal("payload" in exported.evidence[0]!, false);
  } finally {
    if (beforeBackend === undefined) delete process.env.DATA_BACKEND; else process.env.DATA_BACKEND = beforeBackend;
    if (beforeDatabase === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = beforeDatabase;
  }
});
