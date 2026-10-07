import assert from "node:assert/strict";
import test from "node:test";
import { runCliVerify } from "../src/integrations/cli-verifier.js";
import { fishOilBatch, fishOilEvidence, fishOilProduct } from "../src/data/fixtures.js";
import { MemoryDataRepository } from "../src/data/repository.js";

const task = {
  taskId: "task-fish-oil-2026-001",
  serviceKind: "lab" as const,
  capability: "fish-oil-batch-quality-check",
  batchId: fishOilBatch.batchId,
  productionTime: fishOilBatch.productionAt,
  acceptance: { requireSignature: true, policyId: "fish-oil-quality", policyVersion: "v1" },
};

async function repositoryWithEvidence() {
  const repository = new MemoryDataRepository();
  repository.createProduct(fishOilProduct);
  repository.createBatch(fishOilBatch);
  for (const evidence of fishOilEvidence) await repository.addEvidence(evidence);
  await repository.addEvidence({
    schemaVersion: "evidence.v1", evidenceId: "ev-cli-inspection-001", batchId: fishOilBatch.batchId,
    kind: "inspection", issuerId: "lab-c", sourceKind: "third_party", occurredAt: "2026-10-06T10:20:00Z",
    dataMode: "demo/synthetic", payload: { reportBatchId: fishOilBatch.batchId, logisticsGapHours: 2, signatureValid: true, epaDhaPercent: 78, peroxideValue: 2.1, totox: 11, coldChainGapHours: 2 },
  });
  return repository;
}

test("CLI verify returns shared deterministic assessment and dry-run anchor state", async () => {
  const result = await runCliVerify(await repositoryWithEvidence(), task, { id: "fish-oil-quality", version: "v1" });
  assert.equal(result.schemaVersion, "truthpass.cli.result.v1");
  assert.equal(result.status, "accepted");
  assert.equal(result.assessment?.status, "accepted");
  assert.equal(result.anchor.submitted, false);
  assert.equal(result.anchor.status, "anchor_pending");
  assert.ok(result.evidenceRoot.startsWith("0x"));
  assert.ok(result.evidence.some((item) => item.evidenceId === "ev-cli-inspection-001"));
});

test("CLI verify fails closed to missing evidence without producing an anchor", async () => {
  const repository = new MemoryDataRepository();
  repository.createProduct(fishOilProduct);
  repository.createBatch(fishOilBatch);
  const result = await runCliVerify(repository, task, { id: "fish-oil-quality", version: "v1" });
  assert.equal(result.status, "missing_evidence");
  assert.equal(result.anchor.submitted, false);
  assert.ok(result.reasons.length > 0);
});
