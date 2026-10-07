import assert from "node:assert/strict";
import test from "node:test";
import { runCliInspect } from "../src/integrations/cli-verifier.js";
import { fishOilBatch, fishOilEvidence, fishOilProduct } from "../src/data/fixtures.js";
import { MemoryDataRepository } from "../src/data/repository.js";

test("CLI inspect returns one auditable stage list without broadcasting a transaction", async () => {
  const repository = new MemoryDataRepository();
  repository.createProduct(fishOilProduct);
  repository.createBatch(fishOilBatch);
  for (const item of fishOilEvidence) await repository.addEvidence(item);
  const result = await runCliInspect(repository, {
    taskId: "task-fish-oil-2026-001", serviceKind: "lab", capability: "fish-oil-batch-quality-check",
    batchId: fishOilBatch.batchId, productionTime: fishOilBatch.productionAt,
    acceptance: { requireSignature: true, policyId: "fish-oil-quality", policyVersion: "v1" },
  }, { id: "fish-oil-quality", version: "v1" });
  assert.equal(result.command, "inspect");
  assert.equal(result.stages.at(-1)?.detail, "dry-run：未广播交易");
  assert.equal(result.verification.anchor.submitted, false);
});
