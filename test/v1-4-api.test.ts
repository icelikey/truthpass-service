import assert from "node:assert/strict";
import test from "node:test";
import { createApiServer } from "../api-server.js";

async function withServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = createApiServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("v1.4 public APIs expose CFI manifest, standard, and honey policy", async () => {
  await withServer(async (baseUrl) => {
    const manifestResponse = await fetch(`${baseUrl}/api/cfi/manifest`);
    const manifest = await manifestResponse.json() as Record<string, any>;
    assert.equal(manifestResponse.status, 200);
    assert.equal(manifest.schemaVersion, "truthpass.cfi.manifest.v1");
    assert.equal(manifest.policies.length, 2);
    assert.match(manifest.endpoints.feedback, /\/api\/consumer\/feedback$/);

    const standardResponse = await fetch(`${baseUrl}/api/standards`);
    const standard = await standardResponse.json() as Record<string, any>;
    assert.equal(standardResponse.status, 200);
    assert.equal(standard.schemaVersion, "truthpass.public-standard.v1");
    assert.ok(Array.isArray(standard.principles));

    const policyResponse = await fetch(`${baseUrl}/api/standards/policies/honey-quality/v1`);
    const policy = await policyResponse.json() as Record<string, any>;
    assert.equal(policyResponse.status, 200);
    assert.equal(policy.productCategory, "honey");
    assert.match(policy.policyHash, /^0x[0-9a-f]{64}$/);
  });
});

test("integrated API exposes a grounded CLI explanation endpoint", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/cli/explain?batchId=FO-2026-001`);
    const body = await response.json() as Record<string, any>;
    assert.equal(response.status, 200);
    assert.equal(body.schemaVersion, "truthpass.cli.explain.v1");
    assert.equal(body.batchId, "FO-2026-001");
    assert.match(body.explanation, /demo\/synthetic|anchor_pending/);
  });
});

test("integrated wallet preparation binds consumer actions to the public gateway and escrow", async () => {
  await withServer(async (baseUrl) => {
    const wallet = "0x3333333333333333333333333333333333333333";
    const purchaseResponse = await fetch(`${baseUrl}/api/wallet/prepare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "purchase", wallet, batchId: "FO-2026-001" }),
    });
    const purchase = await purchaseResponse.json() as Record<string, any>;
    assert.equal(purchaseResponse.status, 200);
    assert.equal(purchase.contractAddress, "0x5192484B107E51EADFda4DBF4c9fFa41C03453F1");
    assert.equal(purchase.txRequest.chainId, 677);
    assert.equal(purchase.txRequest.value, "0x0");
    assert.equal(purchase.signer, wallet);

    const contributionWithoutPurchase = await fetch(`${baseUrl}/api/wallet/prepare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "contribution", wallet, batchId: "FO-2026-001" }),
    });
    assert.equal(contributionWithoutPurchase.status, 400);

    const disputeResponse = await fetch(`${baseUrl}/api/wallet/prepare`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "dispute", wallet, batchId: "FO-2026-001" }),
    });
    const dispute = await disputeResponse.json() as Record<string, any>;
    assert.equal(disputeResponse.status, 200);
    assert.equal(dispute.contractAddress, "0x722a4291C64B5BD3ED374AD457Ba6326681C2933");
    assert.notEqual(dispute.txRequest.value, "0x0");
    assert.equal(dispute.signer, wallet);
  });
});

test("v1.4 anonymous credential and feedback APIs keep the nonce out of responses", async () => {
  await withServer(async (baseUrl) => {
    const nonce = "api-test-long-random-nonce-001";
    const credentialResponse = await fetch(`${baseUrl}/api/consumer/credentials`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ nonce, scopes: ["feedback"], issuedAt: "2026-10-15T01:00:00.000Z" }),
    });
    const credential = await credentialResponse.json() as Record<string, any>;
    assert.equal(credentialResponse.status, 201);
    assert.equal(JSON.stringify(credential).includes(nonce), false);

    const feedbackResponse = await fetch(`${baseUrl}/api/consumer/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ credentialId: credential.credentialId, batchId: "FO-2026-001", rating: 5, evidenceRefs: ["0x" + "b".repeat(64)] }),
    });
    const feedback = await feedbackResponse.json() as Record<string, any>;
    assert.equal(feedbackResponse.status, 201);
    assert.equal(feedback.privacy.rawComment, "not_collected");
    assert.match(feedback.feedbackId, /^0x[0-9a-f]{64}$/);
  });
});


test("Agent manifest and collaboration expose explicit runtime mode", async () => {
  await withServer(async (baseUrl) => {
    const manifestResponse = await fetch(baseUrl + "/api/agent/manifest");
    const manifest = await manifestResponse.json() as Record<string, any>;
    assert.equal(manifestResponse.status, 200);
    assert.equal(manifest.agentMode, "deterministic_fallback");
    assert.equal(manifest.authMode, "unconfigured_demo");
    assert.match(manifest.endpoints.collaboration, /\/api\/agent\/v1\/collaborate$/);
    assert.match(manifest.endpoints.registration, /\/api\/agent\/register$/);

    const collaborationResponse = await fetch(baseUrl + "/api/agent/v1/collaborate", {
      method: "POST",
      headers: { "content-type": "application/json", "x-truthpass-request-id": "test-request-001" },
      body: JSON.stringify({ batchId: "FO-2026-001", question: "请解释证据状态。", tenantId: "demo" }),
    });
    const collaboration = await collaborationResponse.json() as Record<string, any>;
    assert.equal(collaborationResponse.status, 200);
    assert.equal(collaboration.schemaVersion, "truthpass.agent.collaboration.v1");
    assert.equal(collaboration.agentMode, "deterministic_fallback");
    assert.equal(collaboration.dataMode, "demo/synthetic");
    assert.equal(collaboration.traceId, "test-request-001");
    assert.ok(Array.isArray(collaboration.selectedFacts));
  });
});


test("customer service exposes status and SSE runtime metadata", async () => {
  await withServer(async (baseUrl) => {
    const statusResponse = await fetch(baseUrl + "/api/agent/status");
    const status = await statusResponse.json() as Record<string, any>;
    assert.equal(statusResponse.status, 200);
    assert.equal(status.schemaVersion, "truthpass.agent.status.v1");
    assert.equal(status.status, "degraded");
    assert.equal(status.agentMode, "deterministic_fallback");
    assert.equal(status.fallbackAvailable, true);

    const chatResponse = await fetch(baseUrl + "/api/agent/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-truthpass-request-id": "chat-test-001" },
      body: JSON.stringify({ messages: [{ role: "user", content: "你好" }] }),
    });
    const stream = await chatResponse.text();
    assert.equal(chatResponse.status, 200);
    assert.match(stream, /"kind":"meta"/);
    assert.match(stream, /"serviceStatus":"deterministic_fallback"/);
    assert.match(stream, /"traceId":"chat-test-001"/);
    assert.match(stream, /"provider":"deterministic"/);
    assert.match(stream, /"model":"deterministic-fallback"/);
    assert.match(stream, /"modelAssisted":false/);
    assert.match(stream, /"evidenceIds":\[\]/);
    assert.match(stream, /"pipeline":\["verifier","jev","deepseek"\]/);
    assert.match(stream, /"kind":"done"/);
  });
});

test("JEV detection separates replay history from current receipt state", async () => {
  await withServer(async (baseUrl) => {
    const replayResponse = await fetch(`${baseUrl}/api/jev/detection?batchId=FO-2026-001`);
    const replay = await replayResponse.json() as Record<string, any>;
    assert.equal(replayResponse.status, 200);
    assert.equal(replay.status, "replay_verified");
    assert.equal(replay.chainStatus, "replay_verified");
    assert.equal(replay.txHash, undefined);
    assert.equal(replay.explorerUrl, undefined);

    const pendingResponse = await fetch(`${baseUrl}/api/jev/detection?batchId=FO-2026-002`);
    const pending = await pendingResponse.json() as Record<string, any>;
    assert.equal(pendingResponse.status, 200);
    assert.equal(pending.status, "anchor_pending");
    assert.equal(pending.txHash, undefined);
  });
});


test("customer service rate limits repeated session requests", async () => {
  await withServer(async (baseUrl) => {
    let lastStatus = 200;
    for (let index = 0; index < 31; index += 1) {
      const response = await fetch(baseUrl + "/api/agent/chat", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "198.51.100.33",
          "x-truthpass-session": "rate-test-session",
        },
        body: JSON.stringify({ messages: [{ role: "user", content: "你好" }] }),
      });
      lastStatus = response.status;
      if (lastStatus === 429) break;
      await response.text();
    }
    assert.equal(lastStatus, 429);
  });
});
