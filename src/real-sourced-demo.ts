import { readFile } from "node:fs/promises";
import { verifyExecution } from "./verifier.js";
import type { ExecutionEvidence, TaskRequest } from "./types.js";

type DemoDataset = {
  datasetId: string;
  datasetVersion: string;
  status: string;
  sourceBasis: Array<{ sourceId: string; url: string }>;
  verifierFixture: { task: TaskRequest; evidence: ExecutionEvidence };
  demoScenarios: Array<{
    scenarioId: string;
    description: string;
    mutations?: {
      "evidence.reportBatchId"?: string;
      "evidence.peroxideValue"?: number;
      "evidence.totox"?: number;
      "evidence.coldChainGapHours"?: number;
      "task.acceptance.requireColdChain"?: boolean;
    };
    expectedStatus: string;
  }>;
  verifierCoverage: {
    coveredByCurrentVerifier: string[];
    presentButNotCheckedByCurrentVerifier: string[];
    interpretation: string;
  };
};

const dataset = JSON.parse(
  await readFile(new URL("../examples/fish-oil-real-sourced-production-demo.json", import.meta.url), "utf8"),
) as DemoDataset;

const results = [];
for (const scenario of dataset.demoScenarios) {
  const task: TaskRequest = {
    ...dataset.verifierFixture.task,
    acceptance: { ...dataset.verifierFixture.task.acceptance },
  };
  const evidence: ExecutionEvidence = { ...dataset.verifierFixture.evidence };

  const mutations = scenario.mutations ?? {};
  if (mutations["task.acceptance.requireColdChain"] !== undefined) {
    task.acceptance.requireColdChain = mutations["task.acceptance.requireColdChain"];
  }
  if (mutations["evidence.reportBatchId"] !== undefined) {
    evidence.reportBatchId = mutations["evidence.reportBatchId"];
  }
  if (mutations["evidence.peroxideValue"] !== undefined) {
    evidence.peroxideValue = mutations["evidence.peroxideValue"];
  }
  if (mutations["evidence.totox"] !== undefined) {
    evidence.totox = mutations["evidence.totox"];
  }
  if (mutations["evidence.coldChainGapHours"] !== undefined) {
    evidence.coldChainGapHours = mutations["evidence.coldChainGapHours"];
  }

  const verification = await verifyExecution(task, evidence);
  results.push({
    scenarioId: scenario.scenarioId,
    description: scenario.description,
    expectedStatus: scenario.expectedStatus,
    actualStatus: verification.status,
    score: verification.score,
    reasons: verification.reasons,
    evidenceHash: verification.evidenceHash,
  });
}

console.log(JSON.stringify({
  datasetId: dataset.datasetId,
  datasetVersion: dataset.datasetVersion,
  status: dataset.status,
  sources: dataset.sourceBasis,
  results,
  verifierCoverage: dataset.verifierCoverage,
}, null, 2));

