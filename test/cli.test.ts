import assert from "node:assert/strict";
import { unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
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
  assert.equal((first.value as Record<string, any>).anchorStatus, "anchor_pending");
  const refused = await runCli(["anchor", "--batch", "FO-2026-001"]);
  assert.equal(refused.exitCode, 60);
});

test("CLI rejects unsupported batch IDs with machine-readable error", async () => {
  const result = await runCli(["verify", "--batch", "FO-UNKNOWN", "--json"]);
  assert.equal(result.exitCode, 40);
  assert.equal((result.value as Record<string, any>).code, "BATCH_NOT_FOUND");
});


test("CLI inspect returns consumer-agent product, JEV, and mainnet receipt data", async () => {
  const result = await runCli(["inspect", "--batch", "FO-2026-001", "--json"]);
  assert.equal(result.exitCode, 0);
  const value = result.value as Record<string, any>;
  assert.equal(value.schemaVersion, "truthpass.cli.inspection.v1");
  assert.equal(value.command, "inspect");
  assert.match(value.policyHash, /^0x[0-9a-f]{64}$/);
  assert.equal(value.status, "accepted");
  assert.equal(value.product.name, "高浓度鱼油软胶囊");
  assert.equal(value.batch.id, "FO-2026-001");
  assert.equal(value.quality.epaDhaPercent, 78);
  assert.equal(value.evidence.serviceId, "lab-c");
  assert.equal(value.jev.route, "route_to_rule_verifier");
  assert.equal(value.verification.verifierVersion, "deterministic-verifier-v1");
  assert.equal(value.chain.network, "bot-mainnet");
  assert.equal(value.chain.chainId, 677);
  assert.equal(value.chain.lifecycle, "anchored");
  assert.equal(value.chain.anchored, true);
  assert.match(value.chain.receipts.evidence.txHash, /^0x[0-9a-f]+$/);
  assert.match(value.chain.receipts.verification.explorerUrl, /scan\.botchain\.ai\/tx\//);
  assert.equal(value.publicDataBoundary.rawReports, "off_chain");
  assert.equal(value.publicDataBoundary.notes.length, 3);
  assert.equal(JSON.stringify(value).includes("apikey_"), false);
});

test("CLI inspect reports unavailable chain manifest without claiming anchored", async () => {
  const previous = process.env.TRUTHPASS_MAINNET_REPLAY_MANIFEST;
  const manifestPath = resolve(process.cwd(), ".test-mainnet-replay-invalid.json");
  writeFileSync(manifestPath, JSON.stringify({
    schemaVersion: "truthpass.mainnet.replay.v2",
    status: "mainnet_receipts_verified",
    lifecycle: "pending",
    batchId: "FO-2026-001",
  }));
  process.env.TRUTHPASS_MAINNET_REPLAY_MANIFEST = manifestPath;
  try {
    const result = await runCli(["inspect", "--batch", "FO-2026-001", "--json"]);
    assert.equal(result.exitCode, 0);
    const value = result.value as Record<string, any>;
    assert.equal(value.chain.lifecycle, "unavailable");
    assert.equal(value.chain.anchored, false);
    assert.equal(value.chain.availabilityReason, "manifest_lifecycle_not_anchored");
  } finally {
    unlinkSync(manifestPath);
    if (previous === undefined) delete process.env.TRUTHPASS_MAINNET_REPLAY_MANIFEST;
    else process.env.TRUTHPASS_MAINNET_REPLAY_MANIFEST = previous;
  }
});
