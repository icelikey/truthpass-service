import assert from "node:assert/strict";
import test from "node:test";
import { runCli } from "../src/cli.js";

test("CLI doctor returns safe fixture and chain status without secrets", async () => {
  const result = await runCli(["doctor", "--json"]);
  assert.equal(result.exitCode, 0);
  assert.equal(typeof result.value, "object");
  const value = result.value as Record<string, any>;
  assert.equal(value.fixtureMode, "demo/synthetic");
  assert.equal(value.chain.submissionEnabled, false);
  assert.equal(JSON.stringify(value).includes("apikey_"), false);
});

test("CLI verify reuses the service ranking and selects lab-c", async () => {
  const result = await runCli(["verify", "--batch", "FO-2026-001", "--json"]);
  assert.equal(result.exitCode, 0);
  const value = result.value as Record<string, any>;
  assert.equal(value.status, "accepted");
  assert.equal(value.selectedServiceId, "lab-c");
  assert.equal(value.ranking.length, 3);
  assert.equal(value.ranking.find((item: any) => item.serviceId === "lab-a").eligible, false);
});

test("CLI anchor is dry-run only and produces an idempotent plan", async () => {
  const first = await runCli(["anchor", "--batch", "FO-2026-001", "--dry-run", "--json"]);
  const second = await runCli(["anchor", "--batch", "FO-2026-001", "--dry-run", "--json"]);
  assert.equal(first.exitCode, 0);
  assert.deepEqual(first.value, second.value);
  assert.equal((first.value as Record<string, any>).status, "prepared_offline_not_submitted");
  const refused = await runCli(["anchor", "--batch", "FO-2026-001"]);
  assert.equal(refused.exitCode, 60);
});

test("CLI rejects unsupported batch IDs with machine-readable error", async () => {
  const result = await runCli(["verify", "--batch", "FO-UNKNOWN", "--json"]);
  assert.equal(result.exitCode, 40);
  assert.equal((result.value as Record<string, any>).code, "BATCH_NOT_FOUND");
});
