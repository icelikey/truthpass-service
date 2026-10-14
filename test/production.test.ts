import assert from "node:assert/strict";
import test from "node:test";
import { assessProductionBatch, buildProductionPublicSummary } from "../src/production.js";
import { fishOilBatch, fishOilProduct } from "../src/data/fixtures.js";
import { MemoryDataRepository } from "../src/data/repository.js";
import { validateEvidence, validateProductionEvent } from "../src/data/validation.js";

const event = (overrides: Record<string, unknown> = {}) => ({
  schemaVersion: "production.event.v1",
  stage: "raw_material_receipt",
  sequence: 1,
  startedAt: "2026-10-06T08:00:00Z",
  endedAt: "2026-10-06T08:30:00Z",
  inputs: [{ lotId: fishOilBatch.batchId, quantity: 100, unit: "kg" }],
  outputs: [{ lotId: "RAW-2026-001", quantity: 98, unit: "kg" }],
  observations: [{ code: "temperature", value: 4.5, unit: "C" }],
  deviations: [],
  sourceEvidenceIds: [],
  ...overrides,
});

async function repositoryWithBatch(batch = fishOilBatch): Promise<MemoryDataRepository> {
  const repository = new MemoryDataRepository();
  repository.createProduct(fishOilProduct);
  repository.createBatch(batch);
  return repository;
}

test("accepts a valid production.event.v1 evidence payload", async () => {
  assert.equal(validateProductionEvent(event()).ok, true);
  const repository = await repositoryWithBatch();
  const stored = await repository.addEvidence({
    schemaVersion: "evidence.v1",
    evidenceId: "ev-production-event-001",
    batchId: fishOilBatch.batchId,
    kind: "production",
    issuerId: fishOilProduct.supplierId,
    sourceKind: "manufacturer",
    occurredAt: "2026-10-06T08:30:00Z",
    payload: event(),
    dataMode: "demo/synthetic",
  });
  assert.equal(stored.payload.schemaVersion, "production.event.v1");
});

test("rejects invalid production event fields and self-assessment fields", () => {
  for (const invalid of [
    { stage: "unknown" },
    { startedAt: "2026-10-06T09:00:00Z" },
    { observations: [{ code: "temperature", value: Number.NaN, unit: "C" }] },
    { sequence: 0 },
    { verdict: "pass" },
    { score: 100 },
  ]) {
    assert.equal(validateProductionEvent(event(invalid)).ok, false);
  }
  assert.equal(validateProductionEvent({ ...event(), endedAt: "2026-10-06T07:59:59Z" }).ok, false);
  assert.equal(validateProductionEvent({ ...event(), outputs: undefined }).ok, false);
  assert.equal(validateEvidence({
    schemaVersion: "evidence.v1",
    evidenceId: "ev-production-invalid",
    batchId: fishOilBatch.batchId,
    kind: "production",
    issuerId: fishOilProduct.supplierId,
    sourceKind: "manufacturer",
    occurredAt: "2026-10-06T08:30:00Z",
    payload: { ...event(), accepted: true },
    dataMode: "demo/synthetic",
  }).ok, false);
});

test("rejects unknown or cross-batch source evidence references", async () => {
  const repository = await repositoryWithBatch();
  const base = {
    schemaVersion: "evidence.v1" as const,
    batchId: fishOilBatch.batchId,
    kind: "production" as const,
    issuerId: fishOilProduct.supplierId,
    sourceKind: "manufacturer" as const,
    occurredAt: "2026-10-06T08:30:00Z",
    dataMode: "demo/synthetic" as const,
  };
  await assert.rejects(() => repository.addEvidence({ ...base, evidenceId: "ev-unknown-source", payload: event({ sourceEvidenceIds: ["missing"] }) }), /sourceEvidenceId.*不存在/);

  const otherBatch = { ...fishOilBatch, batchId: "FO-2026-002", fillingBatchId: "FILL-2026-002" };
  repository.createBatch(otherBatch);
  await repository.addEvidence({ ...base, evidenceId: "ev-source", payload: event() });
  await assert.rejects(() => repository.addEvidence({ ...base, batchId: otherBatch.batchId, evidenceId: "ev-cross-batch", payload: event({ sourceEvidenceIds: ["ev-source"] }) }), /sourceEvidenceId.*同一批次/);
});

test("deterministic production assessment preserves missing, restricted, and not_covered states", async () => {
  const repository = await repositoryWithBatch();
  await repository.addEvidence({
    schemaVersion: "evidence.v1",
    evidenceId: "ev-production-event-001",
    batchId: fishOilBatch.batchId,
    kind: "production",
    issuerId: fishOilProduct.supplierId,
    sourceKind: "manufacturer",
    occurredAt: "2026-10-06T08:30:00Z",
    payload: event(),
    dataMode: "demo/synthetic",
  });
  await repository.addEvidence({
    schemaVersion: "evidence.v1",
    evidenceId: "ev-production-event-002",
    batchId: fishOilBatch.batchId,
    kind: "production",
    issuerId: fishOilProduct.supplierId,
    sourceKind: "manufacturer",
    occurredAt: "2026-10-06T09:30:00Z",
    payload: event({ stage: "refining", inputs: [{ lotId: "UNRELATED", quantity: 1, unit: "kg" }], outputs: [{ lotId: "UNRELATED-OUT", quantity: 1, unit: "kg" }] }),
    dataMode: "demo/synthetic",
  });
  const missing = await assessProductionBatch(repository, fishOilBatch.batchId);
  assert.equal(missing.status, "incomplete");
  assert.equal(missing.stages.find((stage) => stage.stage === "concentration")?.status, "missing");
  assert.equal(missing.stages.find((stage) => stage.stage === "refining")?.status, "not_covered");
  assert.notEqual(missing.status, "conformant");

  assert.equal(repository.revokeEvidence("ev-production-event-001"), true);
  const restricted = await assessProductionBatch(repository, fishOilBatch.batchId);
  assert.equal(restricted.stages.find((stage) => stage.stage === "raw_material_receipt")?.status, "restricted");
  assert.notEqual(restricted.status, "conformant");
});

test("production assessment policy and final status are server-selected", async () => {
  const repository = await repositoryWithBatch();
  const assessment = await assessProductionBatch(repository, fishOilBatch.batchId);
  assert.equal(assessment.policyId, "fish-oil-production");
  assert.equal(assessment.policyVersion, "v1");
  assert.equal("verdict" in assessment, false);
  assert.equal("score" in assessment, false);
});

test("exposes traceability and user-facing process facts without adding a verdict", async () => {
  assert.equal(validateProductionEvent({ ...event(), traceability: { originRegion: "北太平洋海域" } }).ok, true);
  assert.equal(validateProductionEvent({ ...event(), traceability: { originRegion: "", extra: "secret" } }).ok, false);
  const repository = await repositoryWithBatch();
  await repository.addEvidence({
    schemaVersion: "evidence.v1", evidenceId: "ev-public-fact", batchId: fishOilBatch.batchId,
    kind: "production", issuerId: fishOilProduct.supplierId, sourceKind: "manufacturer",
    occurredAt: event().endedAt, payload: { ...event(), traceability: { originRegion: "北太平洋海域" } }, dataMode: "demo/synthetic",
  });
  const summary = await buildProductionPublicSummary(repository, fishOilBatch.batchId);
  assert.equal(summary.originRegion, "北太平洋海域");
  assert.deepEqual(summary.facts.map((fact) => [fact.label, fact.value]), [["接收温度", "4.5 C"]]);
  assert.equal("verdict" in summary, false);
});
