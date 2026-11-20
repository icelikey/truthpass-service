import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { evidenceSigningPayload } from "../src/security/evidence-signatures.js";
import { EnterprisePilotStore, type EnterpriseEvidenceEnvelope } from "../src/enterprise/pilot-store.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

function productionPayload() {
  return {
    schemaVersion: "production.event.v1",
    stage: "encapsulation",
    sequence: 1,
    startedAt: "2026-11-01T08:00:00.000Z",
    endedAt: "2026-11-01T08:30:00.000Z",
    inputs: [],
    outputs: [{ lotId: "OUTPUT-REAL-001", quantity: 100, unit: "kg" }],
    observations: [],
    deviations: [],
    sourceEvidenceIds: [],
  };
}

function evidence(kind: EnterpriseEvidenceEnvelope["kind"], evidenceId: string, signed = true): EnterpriseEvidenceEnvelope {
  const base = {
    schemaVersion: "evidence.v1" as const,
    tenantId: "tenant-real",
    brandId: "brand-real",
    productId: "fish-oil",
    batchId: "FO-REAL-001",
    ...(kind === "inspection" ? { sampleId: "SAMPLE-REAL-001" } : {}),
    evidenceId,
    kind,
    issuerId: kind === "inspection" ? "lab-real" : "issuer-real",
    sourceKind: kind === "inspection" ? "third_party" as const : kind === "cold_chain" ? "platform_device" as const : "manufacturer" as const,
    occurredAt: "2026-11-01T08:00:00.000Z",
    payload: kind === "production"
      ? productionPayload()
      : kind === "shipment"
        ? { batchId: "FO-REAL-001", source: "external", quantity: 100 }
        : { batchId: "FO-REAL-001", source: "external" },
    dataMode: "external" as const,
  };
  if (!signed) return base;
  const claims = { keyId: "issuer-real-key-1", nonce: "a".repeat(32), expiresAt: "2027-12-31T23:59:59.000Z" };
  const signature = sign(null, Buffer.from(evidenceSigningPayload(base, claims)), privateKey).toString("base64");
  return { ...base, attestation: { algorithm: "Ed25519", ...claims, signature } };
}

test("publishes only a fully signed external batch and is idempotent", async () => {
  const beforeBackend = process.env.DATA_BACKEND;
  const beforeDatabase = process.env.DATABASE_URL;
  process.env.DATA_BACKEND = "memory";
  delete process.env.DATABASE_URL;
  try {
    const store = new EnterprisePilotStore({ resolveTrustedKey: (issuerId, keyId) => issuerId !== "" && keyId === "issuer-real-key-1" ? publicKeyPem : undefined });
    for (const [index, kind] of (["production", "inspection", "cold_chain", "shipment"] as const).entries()) {
      await store.importEvidence(evidence(kind, `EV-REAL-${index}`), `import-${index}`);
    }
    const published = await store.publishBatch("tenant-real", "FO-REAL-001", "publish-001");
    assert.equal(published.idempotent, false);
    assert.equal(published.publication.status, "published");
    assert.equal(published.publication.dataMode, "external");
    const replay = await store.publishBatch("tenant-real", "FO-REAL-001", "publish-002");
    assert.equal(replay.idempotent, true);
    assert.equal(replay.publication.publicationId, published.publication.publicationId);
  } finally {
    if (beforeBackend === undefined) delete process.env.DATA_BACKEND; else process.env.DATA_BACKEND = beforeBackend;
    if (beforeDatabase === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = beforeDatabase;
  }
});

test("publication blocks a shipment quantity conflict", async () => {
  const beforeBackend = process.env.DATA_BACKEND;
  const beforeDatabase = process.env.DATABASE_URL;
  process.env.DATA_BACKEND = "memory";
  delete process.env.DATABASE_URL;
  try {
    const store = new EnterprisePilotStore({ resolveTrustedKey: (issuerId, keyId) => issuerId !== "" && keyId === "issuer-real-key-1" ? publicKeyPem : undefined });
    for (const [index, kind] of (["production", "inspection", "cold_chain"] as const).entries()) {
      await store.importEvidence(evidence(kind, `EV-CONFLICT-${index}`), `import-conflict-${index}`);
    }
    await store.importEvidence(
      { ...evidence("shipment", "EV-CONFLICT-3"), payload: { batchId: "FO-REAL-001", source: "external", quantity: 101 } },
      "import-conflict-3",
    );
    await assert.rejects(
      store.publishBatch("tenant-real", "FO-REAL-001", "publish-conflict"),
      /PUBLISH_(GATE|RECONCILIATION)_BLOCKED/,
    );
  } finally {
    if (beforeBackend === undefined) delete process.env.DATA_BACKEND; else process.env.DATA_BACKEND = beforeBackend;
    if (beforeDatabase === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = beforeDatabase;
  }
});


test("rejects demo-marked payloads when imported as external", async () => {
  const beforeBackend = process.env.DATA_BACKEND;
  const beforeDatabase = process.env.DATABASE_URL;
  process.env.DATA_BACKEND = "memory";
  delete process.env.DATABASE_URL;
  try {
    const store = new EnterprisePilotStore();
    await assert.rejects(
      store.importEvidence({ ...evidence("shipment", "EV-DEMO-001", false), payload: { batchId: "FO-REAL-001", demo: true } }, "import-demo"),
      /EXTERNAL_DEMO_MARKER_REJECTED/,
    );
  } finally {
    if (beforeBackend === undefined) delete process.env.DATA_BACKEND; else process.env.DATA_BACKEND = beforeBackend;
    if (beforeDatabase === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = beforeDatabase;
  }
});


test("publication requires every external signature to resolve through the trusted key registry", async () => {
  const beforeBackend = process.env.DATA_BACKEND;
  const beforeDatabase = process.env.DATABASE_URL;
  process.env.DATA_BACKEND = "memory";
  delete process.env.DATABASE_URL;
  try {
    const store = new EnterprisePilotStore();
    for (const [index, kind] of (["production", "inspection", "cold_chain", "shipment"] as const).entries()) {
      await store.importEvidence(evidence(kind, `EV-UNVERIFIED-${index}`), `import-unverified-${index}`);
    }
    await assert.rejects(
      store.publishBatch("tenant-real", "FO-REAL-001", "publish-unverified"),
      /PUBLISH_GATE_BLOCKED/,
    );
  } finally {
    if (beforeBackend === undefined) delete process.env.DATA_BACKEND; else process.env.DATA_BACKEND = beforeBackend;
    if (beforeDatabase === undefined) delete process.env.DATABASE_URL; else process.env.DATABASE_URL = beforeDatabase;
  }
});

