import assert from "node:assert/strict";
import test from "node:test";
import { assessProductBatch, verifyServiceExecution } from "../src/verifier.js";
import type { ExecutionEvidence, TaskRequest } from "../src/types.js";

const task: TaskRequest = {
  taskId: "task-1",
  serviceKind: "lab",
  capability: "batch-quality-check",
  batchId: "B-1",
  productionTime: "2026-10-06T08:00:00Z",
  acceptance: { requireSignature: true, policyId: "fish-oil-quality", policyVersion: "v1" },
};

const evidence: ExecutionEvidence = {
  serviceId: "lab-c",
  taskId: "task-1",
  batchId: "B-1",
  reportBatchId: "B-1",
  productionTime: "2026-10-06T08:00:00Z",
  reportTime: "2026-10-06T10:00:00Z",
  logisticsGapHours: 2,
  signatureValid: true,
  epaDhaPercent: 78,
  peroxideValue: 2.1,
  totox: 11,
  coldChainGapHours: 2,
  payload: { result: "pass" },
};

test("accepts matching service delivery without judging product quality", async () => {
  const result = await verifyServiceExecution(task, evidence);
  assert.equal(result.status, "accepted");
  assert.equal(result.score, 100);
  assert.equal(result.reasons.length, 0);
  const product = await assessProductBatch(task, evidence);
  assert.equal(product.status, "accepted");
  assert.equal(product.policyVersion, "v1");
});

test("rejects evidence for another batch", async () => {
  const result = await verifyServiceExecution(task, { ...evidence, reportBatchId: "B-2" });
  assert.equal(result.status, "rejected");
  assert.match(result.reasons.join(" "), /批次/);
});

test("fails closed when task disables a required service signature", async () => {
  const result = await verifyServiceExecution(
    { ...task, acceptance: { ...task.acceptance, requireSignature: false } },
    { ...evidence, signatureValid: false },
  );

  assert.equal(result.status, "rejected");
  assert.equal(result.checks.signatureValid, false);
});

test("rejects fish-oil product evidence below quality thresholds", async () => {
  const result = await assessProductBatch(
    task,
    { ...evidence, epaDhaPercent: 61, peroxideValue: 7.2, totox: 26, coldChainGapHours: 11 },
  );
  assert.equal(result.status, "rejected");
  assert.match(result.reasons.join(" "), /EPA\+DHA/);
  assert.match(result.reasons.join(" "), /过氧化值/);
  assert.match(result.reasons.join(" "), /TOTOX/);
  assert.match(result.reasons.join(" "), /冷链/);
});

test("rejects an unknown policy instead of using caller-provided thresholds", async () => {
  await assert.rejects(
    () => assessProductBatch({ ...task, acceptance: { ...task.acceptance, policyId: "caller-made-policy" } }, evidence),
    /未知或未批准的 policy/,
  );
});

