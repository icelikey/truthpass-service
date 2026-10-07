import assert from "node:assert/strict";
import test from "node:test";
import { runCli } from "../src/cli.js";
import { LocalLedger } from "../src/local-ledger.js";
import { replayFishOilFlow } from "../src/replay.js";

test("local replay carries the canonical VerificationResult through all stages", async () => {
  const result = await replayFishOilFlow("FO-2026-001");
  assert.equal(result.status, "anchor_pending");
  assert.equal(result.verificationResult.status, "accepted");
  assert.equal(result.stages.verification, result.verificationResult.status);
  assert.equal(result.stages.evidenceAnchor, "anchor_pending");
  assert.equal(result.stages.purchase, "created");
  assert.equal(result.stages.contribution, "created");
  assert.equal(result.stages.dispute, "raised");
  assert.equal(result.stages.supersede, "recorded");
  assert.equal(result.anchor.submitted, false);
  assert.equal(result.anchor.txHash, null);
  assert.equal(result.ledger.valid, true);
  assert.equal(result.ledger.eventCount, 6);
  assert.equal(result.ledger.events[0].type, "verification_evaluated");
  assert.equal(result.ledger.events.at(-1)?.type, "evidence_superseded");
});

test("replay CLI is machine-readable and does not submit a transaction", async () => {
  const result = await runCli(["replay", "--batch", "FO-2026-001", "--json"]);
  assert.equal(result.exitCode, 0);
  const value = result.value as Record<string, any>;
  assert.equal(value.status, "anchor_pending");
  assert.equal(value.anchor.submitted, false);
  assert.equal(value.anchor.txHash, null);
  assert.match(value.schemaVersion, /^truthpass\.cli\.replay\.v1$/);
  assert.equal(JSON.stringify(value).includes("apikey_"), false);
});

test("local ledger exposes a verified append-only root and defensive event copies", async () => {
  const ledger = new LocalLedger();
  await ledger.append({ type: "verification_evaluated", requestId: "0x1", data: { ok: true } });
  await ledger.append({ type: "evidence_anchor_planned", requestId: "0x1", data: { pending: true } });
  const original = await ledger.verify();
  assert.equal(original.valid, true);
  const entries = ledger.list();
  entries[0].data.ok = false;
  // list() returns a defensive copy, so an external caller cannot mutate the
  // ledger itself; this assertion documents the copy boundary.
  assert.equal((await ledger.verify()).valid, true);
});
