import assert from "node:assert/strict";
import test from "node:test";
import { SafeJevDecisionGate } from "../src/jev/context.js";
import { HttpJevProvider, providerFromEnv } from "../src/jev/http-provider.js";
import type { JevState } from "../src/jev/model.js";

const input: JevState = {
  taskId: "task-1",
  batchId: "FO-2026-001",
  policyId: "fish-oil-quality",
  requestedChecks: ["epa_dha", "cold_chain"],
  evidenceRefs: [{ eventId: "evt-1", kind: "lab-c", payloadHash: "0x" + "1".repeat(64) }],
  stateSummary: {
    reportBatchMatches: true,
    epaDhaPresent: true,
    peroxidePresent: true,
    totoxPresent: true,
    coldChainPresent: true,
    signatureValid: true,
  },
  inputHash: "0x" + "2".repeat(64),
  schemaVersion: "jev-truthpass-state-v1",
};

test("DeepSeek-compatible provider is normalized into the safe JEV decision contract", async () => {
  let requestBody: Record<string, unknown> | undefined;
  const provider = new HttpJevProvider({
    kind: "deepseek",
    baseUrl: "https://api.deepseek.com",
    apiKey: "test-only",
    modelId: "deepseek-chat",
    fetch: async (_input, init) => {
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      return new Response(JSON.stringify({
        choices: [{ message: { content: JSON.stringify({ decision: "route_to_rule_verifier", confidence: 0.96, missingEvidenceCodes: [], conflictCodes: [] }) } }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    },
  });
  const decision = await new SafeJevDecisionGate({ provider }).decide(input);
  assert.equal(decision.decision, "route_to_rule_verifier");
  assert.equal(decision.modelAssisted, true);
  assert.equal((requestBody?.response_format as Record<string, unknown>)?.type, "json_object");
});

test("JEV provider maps the public route/confidence response shape", async () => {
  const provider = new HttpJevProvider({
    kind: "jev",
    baseUrl: "https://jev.example",
    apiKey: "test-only",
    modelId: "jev",
    fetch: async () => new Response(JSON.stringify({ route: "billing", confidence: 0.2 }), { status: 200 }),
  });
  const decision = await new SafeJevDecisionGate({ provider }).decide(input);
  assert.equal(decision.decision, "request_more_evidence");
  assert.equal(decision.modelAssisted, true);
  assert.ok(decision.conflictCodes.includes("JEV_LOW_CONFIDENCE") === false);
});

test("live providers require an explicit opt-in flag", () => {
  assert.equal(providerFromEnv({ DEEPSEEK_API_KEY: "test-only" }).enabled, false);
  const config = providerFromEnv({ TRUTHPASS_LIVE_API: "true", DEEPSEEK_API_KEY: "test-only" });
  assert.equal(config.enabled, true);
  assert.equal(config.source, "deepseek");
});
