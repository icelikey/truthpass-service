import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { verifyExecution } from "../src/verifier.js";
import type { ExecutionEvidence, TaskRequest } from "../src/types.js";

type DemoDataset = {
  status: string;
  sourceBasis: Array<{ url: string }>;
  publicReferenceSamples: Array<{ url: string }>;
  verifierFixture: { task: TaskRequest; evidence: ExecutionEvidence };
  verifierCoverage: {
    coveredByCurrentVerifier: string[];
    presentButNotCheckedByCurrentVerifier: string[];
  };
};

const dataset = JSON.parse(
  await readFile(new URL("../examples/fish-oil-real-sourced-production-demo.json", import.meta.url), "utf8"),
) as DemoDataset;

test("real-sourced fish-oil fixture is explicitly simulated and source-backed", () => {
  assert.equal(dataset.status, "simulated_publicly_sourced");
  assert.ok(dataset.sourceBasis.length >= 4);
  assert.ok(dataset.sourceBasis.every((source) => source.url.startsWith("https://")));
  assert.equal(dataset.publicReferenceSamples.length, 1);
  assert.ok(dataset.publicReferenceSamples[0].url.startsWith("https://"));
  assert.ok(dataset.verifierCoverage.presentButNotCheckedByCurrentVerifier.includes("pAnisidineValue"));
});

test("current verifier accepts the sourced fixture within its declared demo scope", async () => {
  const result = await verifyExecution(dataset.verifierFixture.task, dataset.verifierFixture.evidence);
  assert.equal(result.status, "accepted");
  assert.equal(result.score, 100);
});

test("current verifier catches wrong batch and oxidation regressions", async () => {
  const wrongBatch = await verifyExecution(
    dataset.verifierFixture.task,
    { ...dataset.verifierFixture.evidence, reportBatchId: "FG-OTHER-01" },
  );
  assert.equal(wrongBatch.status, "rejected");
  assert.match(wrongBatch.reasons.join(" "), /批次/);

  const oxidationFailure = await verifyExecution(
    dataset.verifierFixture.task,
    { ...dataset.verifierFixture.evidence, peroxideValue: 6.2, totox: 29 },
  );
  assert.equal(oxidationFailure.status, "rejected");
  assert.match(oxidationFailure.reasons.join(" "), /过氧化值/);
  assert.match(oxidationFailure.reasons.join(" "), /TOTOX/);
});



