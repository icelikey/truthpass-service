import assert from "node:assert/strict";
import test from "node:test";
import { FISH_OIL_POLICY_V1, getPolicySnapshot } from "../src/rules/policy.js";

test("approved policy snapshots cannot be changed by callers", () => {
  const snapshot = getPolicySnapshot("fish-oil-quality", "v1");
  snapshot.thresholds.minEpaDhaPercent = 1;
  snapshot.requiredEvidence.pop();

  assert.equal(getPolicySnapshot("fish-oil-quality", "v1").thresholds.minEpaDhaPercent, 70);
  assert.deepEqual(getPolicySnapshot("fish-oil-quality", "v1").requiredEvidence, ["inspection", "cold_chain"]);
  assert.throws(() => { FISH_OIL_POLICY_V1.thresholds.minEpaDhaPercent = 1; }, TypeError);
});
