import assert from "node:assert/strict";
import test from "node:test";
import { buildJevState, DeterministicDecisionGate, SafeJevDecisionGate, replayJevDecision } from "../src/jev/context.js";
import type { ExecutionEvidence, TaskRequest } from "../src/types.js";

const task: TaskRequest = {
  taskId: "task-jev-1",
  serviceKind: "lab",
  capability: "fish-oil-batch-quality-check",
  batchId: "FO-2026-001",
  productionTime: "2026-10-06T08:00:00Z",
  acceptance: {
    requireSignature: true,
    maxLogisticsGapHours: 6,
    minEpaDhaPercent: 70,
    maxPeroxideValue: 5,
    maxTotox: 20,
    requireColdChain: true,
  },
};

const evidence: ExecutionEvidence = {
  serviceId: "lab-c",
  taskId: task.taskId,
  batchId: task.batchId,
  reportBatchId: task.batchId,
  productionTime: task.productionTime,
  reportTime: "2026-10-06T10:00:00Z",
  logisticsGapHours: 2,
  signatureValid: true,
  epaDhaPercent: 78,
  peroxideValue: 2,
  totox: 11,
  coldChainGapHours: 2,
  payload: { source: "fixture" },
};

test("deterministic JEV gate routes complete evidence to rules", async () => {
  const state = buildJevState(task, evidence);
  const decision = await new DeterministicDecisionGate({ now: () => new Date("2026-10-06T11:00:00Z") }).decide(state);
  assert.equal(decision.decision, "route_to_rule_verifier");
  assert.equal(decision.modelAssisted, false);
  assert.equal(replayJevDecision(decision, state, new Date("2026-10-06T11:01:00Z")).valid, true);
});

test("missing evidence requests more evidence", async () => {
  const state = buildJevState(task, { ...evidence, totox: undefined, coldChainGapHours: undefined });
  const decision = await new DeterministicDecisionGate().decide(state);
  assert.equal(decision.decision, "request_more_evidence");
  assert.ok(decision.missingEvidenceCodes.includes("TOTOX_MISSING"));
  assert.ok(decision.missingEvidenceCodes.includes("COLD_CHAIN_MISSING"));
});

test("invalid provider output falls back safely", async () => {
  const state = buildJevState(task, evidence);
  const gate = new SafeJevDecisionGate({ provider: { decide: async () => ({ decision: "accepted", confidence: 1 }) } });
  const decision = await gate.decide(state);
  assert.equal(decision.modelAssisted, false);
  assert.equal(decision.decision, "route_to_rule_verifier");
});

