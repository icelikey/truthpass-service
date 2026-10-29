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

test("demo lifecycle exposes an explicit continuous synthetic heartbeat", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/products/FO-2026-001/lifecycle`);
    const lifecycle = await response.json() as Record<string, any>;
    assert.equal(response.status, 200);
    assert.equal(lifecycle.batchId, "FO-2026-001");
    assert.equal(lifecycle.contextMode, "production_sync_simulation");
    assert.equal(lifecycle.dataMode, "demo/synthetic");
    assert.equal(lifecycle.simulation.mode, "continuous_demo");
    assert.equal(lifecycle.simulation.intervalMs, 10_000);
    assert.match(lifecycle.simulation.generatedEvidenceId, /^FO-2026-001:demo-sensor:\d+$/);
    assert.match(lifecycle.events.find((item: Record<string, any>) => item.stage === "cold_chain").detail, /演示设备同步/);
  });
});

test("public product views expose parameter values and rule ranges instead of a single quality verdict", async () => {
  await withServer(async (baseUrl) => {
    const productResponse = await fetch(`${baseUrl}/api/products/FO-2026-009`);
    const product = await productResponse.json() as Record<string, any>;
    assert.equal(productResponse.status, 200);
    assert.ok(Array.isArray(product.parameterDetails));
    const epa = product.parameterDetails.find((item: Record<string, unknown>) => item.key === "epa-dha");
    assert.equal(epa.observed, 55);
    assert.equal(epa.rule, "≥ 70%");
    assert.equal(epa.status, "outside_range");
    assert.match(product.verification.summary, /EPA\+DHA 55%/);
    assert.doesNotMatch(product.verification.summary, /未达到标准/);

    const overviewResponse = await fetch(`${baseUrl}/api/public/batches/FO-2026-009/overview`);
    const overview = await overviewResponse.json() as Record<string, any>;
    assert.equal(overviewResponse.status, 200);
    assert.equal(overview.batchId, "FO-2026-009");
    assert.equal(overview.batch.batchId, "FO-2026-009");
    assert.ok(Array.isArray(overview.parameterDetails));
    assert.equal(overview.parameterDetails.find((item: Record<string, unknown>) => item.key === "peroxide").observed, 2.5);
    const pendingChainEvidence = overview.evidence.find((item: Record<string, unknown>) => item.icon === "chain");
    assert.equal(pendingChainEvidence.status, "anchor_pending");
    assert.equal(pendingChainEvidence.explorerUrl, undefined);
    assert.match(String(pendingChainEvidence.description), /没有.*真实 receipt/);
    assert.match(String(overview.verification.reasons?.[0]), /EPA\+DHA 实测 55%/);

    const historicalResponse = await fetch(`${baseUrl}/api/public/batches/FO-2026-001/overview`);
    const historical = await historicalResponse.json() as Record<string, any>;
    assert.equal(historical.batch.status, "review");
    assert.equal(historical.batch.parameterStatus, "accepted");
    assert.equal(historical.verification.status, "review");
    assert.match(String(historical.verification.reasons?.[0]), /浓缩|脱臭|灌装|包装|仓储/);

    const primaryProductResponse = await fetch(`${baseUrl}/api/products/FO-2026-001`);
    const primaryProduct = await primaryProductResponse.json() as Record<string, any>;
    assert.equal(primaryProductResponse.status, 200);
    // The product view and the public overview must describe the same fixture
    // batch, even when the repository contains a separately seeded record.
    assert.equal(primaryProduct.name, historical.product.name);
    assert.equal(primaryProduct.productionDate, historical.product.productionDate);
    assert.equal(primaryProduct.dataMode, historical.dataMode);
    assert.equal(primaryProduct.dataSource, "fixtures");
    const historicalChainEvidence = historical.evidence.find((item: Record<string, unknown>) => item.icon === "chain");
    assert.equal(historicalChainEvidence.status, "replay_verified");
    assert.match(String(historicalChainEvidence.description), /历史回放/);
  });
});

test("verification endpoint stays batch-scoped and exposes concrete gate reasons", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/verification?batchId=FO-2026-009`);
    const body = await response.json() as Record<string, any>;
    assert.equal(response.status, 200);
    assert.equal(body.batchId, "FO-2026-009");
    assert.equal(body.status, "rejected");
    assert.match(String(body.reasons?.[0]), /EPA\+DHA 实测 55%/);
    assert.ok(Array.isArray(body.parameterDetails));
    assert.equal(body.productionProcess.dataMode, "demo/synthetic");

    const unknownResponse = await fetch(`${baseUrl}/api/verification?batchId=UNKNOWN-2026-001`);
    const unknown = await unknownResponse.json() as Record<string, any>;
    assert.equal(unknownResponse.status, 404);
    assert.equal(unknown.error, "unknown_batch");

    const unknownObserverResponse = await fetch(`${baseUrl}/api/observer?batchId=UNKNOWN-2026-001`);
    const unknownObserver = await unknownObserverResponse.json() as Record<string, any>;
    assert.equal(unknownObserverResponse.status, 404);
    assert.equal(unknownObserver.error, "unknown_batch");
  });
});

test("recommendation output is scoped to registered production parameters", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/recommend?batchId=FO-2026-009`);
    const items = await response.json() as Array<Record<string, any>>;
    assert.equal(response.status, 200);
    assert.equal(items.length, 1);
    assert.equal(items[0].batchId, "FO-2026-009");
    assert.equal(items[0].recommendationStatus, "do_not_recommend");
    assert.match(items[0].reason, /EPA\+DHA 55%/);
    assert.ok(Array.isArray(items[0].productionEvidence.stages));
    assert.ok(Array.isArray(items[0].parameterDetails));
    assert.equal(items[0].dataMode, "demo/synthetic");

    const contractResponse = await fetch(`${baseUrl}/api/recommendation?batchId=FO-2026-009`);
    const contract = await contractResponse.json() as Record<string, any>;
    assert.equal(contractResponse.status, 200);
    assert.equal(contract.schemaVersion, "truthpass.recommendation.v1");
    assert.equal(contract.batchId, "FO-2026-009");
    assert.equal(contract.recommendationStatus, "do_not_recommend");
    assert.equal(contract.verificationStatus, "rejected");
    assert.ok(Array.isArray(contract.evidenceIds));
    assert.match(contract.traceId, /^0x[0-9a-f]{64}$/);

    const partialResponse = await fetch(`${baseUrl}/api/recommendation?batchId=FO-2026-001`);
    const partial = await partialResponse.json() as Record<string, any>;
    assert.equal(partialResponse.status, 200);
    assert.equal(partial.recommendationStatus, "review_before_recommendation");
    assert.equal(partial.verificationStatus, "review");
    assert.ok(partial.missingItems.some((item: string) => item.includes("浓缩")));

    const legacyPartialResponse = await fetch(`${baseUrl}/api/recommend?batchId=FO-2026-001`);
    const legacyPartial = await legacyPartialResponse.json() as Array<Record<string, any>>;
    assert.equal(legacyPartialResponse.status, 200);
    assert.equal(legacyPartial[0].recommendationStatus, "review_before_recommendation");

    const riceResponse = await fetch(`${baseUrl}/api/recommendation?batchId=RC-2026-001`);
    const rice = await riceResponse.json() as Record<string, any>;
    assert.equal(riceResponse.status, 200);
    assert.equal(rice.batchId, "RC-2026-001");
    assert.equal(rice.tenantId, "tenant-rice-demo");
    assert.equal(rice.productId, "rice-wuchang");
    assert.equal(rice.dataMode, "demo/synthetic");
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

test("unified Agent query returns retrieval hits and one batch-scoped trace", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/agent/query`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-truthpass-request-id": "agent-query-001" },
      body: JSON.stringify({ batchId: "FO-2026-001", question: "检测、冷链和当前缺口是什么？" }),
    });
    assert.equal(response.status, 200);
    const body = await response.json() as Record<string, any>;
    assert.equal(body.schemaVersion, "truthpass.agent.query.v1");
    assert.equal(body.batchId, "FO-2026-001");
    assert.equal(body.traceId, "agent-query-001");
    assert.equal(body.dataMode, "demo/synthetic");
    assert.ok(body.retrieval.hits.length > 0);
    assert.ok(body.retrieval.hits.every((hit: any) => hit.batchId === "FO-2026-001"));
    assert.equal(body.writeBoundary.submitted, false);
    assert.ok(Array.isArray(body.stages));
  });
});

test("unified Agent query stream exposes retrieval completion before verification", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/agent/query/stream`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-truthpass-request-id": "agent-stream-retrieval-001" },
      body: JSON.stringify({ batchId: "FO-2026-001", question: "冷链和检测有什么缺口？", locale: "zh" }),
    });
    const stream = await response.text();
    assert.equal(response.status, 200);
    assert.match(stream, /"kind":"stage","stage":"reading_batch","status":"active"/);
    assert.match(stream, /"kind":"stage","stage":"retrieval_completed","status":"completed"/);
    assert.match(stream, /"kind":"stage","stage":"verifier_checked","status":"completed"/);
    assert.match(stream, /"kind":"answer"/);
    assert.match(stream, /"kind":"done"/);
    const traceIds = [...stream.matchAll(/"traceId":"([^"]+)"/g)].map((match) => match[1]);
    assert.ok(traceIds.length > 3);
    assert.ok(traceIds.every((traceId) => traceId === "agent-stream-retrieval-001"));
  });
});

test("public Agent search rejects unknown batch instead of falling through", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/agent/search?batchId=FO-9999-999&q=冷链`, {
      headers: { "x-truthpass-request-id": "agent-search-unknown" },
    });
    assert.equal(response.status, 404);
    const body = await response.json() as Record<string, any>;
    assert.equal(body.batchId, "FO-9999-999");
    assert.equal(body.error, "BATCH_NOT_FOUND");
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
    assert.equal(status.provider, "deterministic");
    assert.equal(status.model, "deterministic-fallback");
    assert.equal(status.configuredProvider, "deterministic");
    assert.equal(status.configuredModel, "deterministic-fallback");
    assert.equal(status.lastSuccessfulProvider, null);
    assert.equal(status.lastSuccessfulModel, null);
    assert.equal(status.configured, false);
    assert.equal(status.lastRequestVerified, false);
    assert.equal(status.lastRequestFallback, false);
    assert.equal(status.runtimeStatus, "runtime_unknown");

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
    assert.match(stream, /"promptPolicyVersion":"truthpass\.consumer\.v2"/);
    assert.match(stream, /"modelContractVersion":"truthpass\.consumer\.v2"/);
    assert.match(stream, /"validationStatus":"fallback"/);
    assert.match(stream, /"stage":"reading_batch"/);
    assert.match(stream, /"stage":"verifier_checked"/);
    assert.match(stream, /"stage":"jev_routed"/);
    assert.match(stream, /"stage":"model_completed"/);
    assert.match(stream, /"kind":"done"/);
  });
});

test("OpenCode billing failures stay visible and fall back safely", async () => {
  const previous = {
    provider: process.env.AGENT_PROVIDER,
    key: process.env.OPENCODE_API_KEY,
    baseUrl: process.env.OPENCODE_BASE_URL,
    model: process.env.OPENCODE_MODEL,
  };
  const originalFetch = globalThis.fetch;
  process.env.AGENT_PROVIDER = "opencode";
  process.env.OPENCODE_API_KEY = "test-opencode-key";
  process.env.OPENCODE_BASE_URL = "https://opencode.ai/inference/openai/v1";
  process.env.OPENCODE_MODEL = "deepseek-v4.1-flash";
  let opencodeHeaders: Headers | undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (target.startsWith("https://opencode.ai/")) {
      opencodeHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({ error: { message: "billing required" } }), {
        status: 402,
        headers: { "content-type": "application/json" },
      });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/agent/query/stream`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-truthpass-request-id": "opencode-billing-001" },
        body: JSON.stringify({ batchId: "FO-2026-001", question: "请解释检测和冷链", locale: "zh" }),
      });
      const stream = await response.text();
      assert.equal(response.status, 200);
      assert.match(stream, /"provider":"opencode"/);
      assert.match(stream, /"model":"deepseek-v4\.1-flash"/);
      assert.match(stream, /"providerIssue":"billing_required"/);
      assert.match(stream, /"providerResponseStatus":402/);
      assert.match(stream, /"runtimeStatus":"billing_required"/);
      assert.match(stream, /"stage":"model_completed","status":"billing_required"/);
      assert.match(stream, /"modelAssisted":false/);
      assert.match(stream, /"validationStatus":"fallback"/);
      assert.match(stream, /"kind":"done"/);
      const statusResponse = await fetch(`${baseUrl}/api/agent/status?diagnostics=true`);
      const status = await statusResponse.json() as Record<string, any>;
      assert.equal(status.configured, true);
      assert.equal(status.lastRequestVerified, false);
      assert.equal(status.lastRequestFallback, true);
      assert.equal(status.runtimeStatus, "billing_required");
      assert.equal(status.lastProviderResponseStatus, 402);
      assert.equal(status.lastProviderIssue, "billing_required");
      assert.equal(opencodeHeaders?.get("x-opencode-session"), "truthpass:FO-2026-001:zh");
      assert.match(opencodeHeaders?.get("user-agent") ?? "", /^TruthPass-Agent\/1\.0/);
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (previous.provider === undefined) delete process.env.AGENT_PROVIDER; else process.env.AGENT_PROVIDER = previous.provider;
    if (previous.key === undefined) delete process.env.OPENCODE_API_KEY; else process.env.OPENCODE_API_KEY = previous.key;
    if (previous.baseUrl === undefined) delete process.env.OPENCODE_BASE_URL; else process.env.OPENCODE_BASE_URL = previous.baseUrl;
    if (previous.model === undefined) delete process.env.OPENCODE_MODEL; else process.env.OPENCODE_MODEL = previous.model;
  }
});

test("OpenCode HTTP 200 is published only after contract validation", async () => {
  const previous = {
    provider: process.env.AGENT_PROVIDER,
    key: process.env.OPENCODE_API_KEY,
    baseUrl: process.env.OPENCODE_BASE_URL,
    model: process.env.OPENCODE_MODEL,
  };
  const originalFetch = globalThis.fetch;
  process.env.AGENT_PROVIDER = "opencode";
  process.env.OPENCODE_API_KEY = "test-opencode-key";
  process.env.OPENCODE_BASE_URL = "https://opencode.ai/inference/openai/v1";
  process.env.OPENCODE_MODEL = "deepseek-v4.1-flash";
  let opencodeHeaders: Headers | undefined;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const target = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    if (target.startsWith("https://opencode.ai/")) {
      opencodeHeaders = new Headers(init?.headers);
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: JSON.stringify({
              conclusion: "这批资料可以继续了解",
              evidence: "依据来自当前批次 evidence_card",
              uncertainty: "当前资料是演示数据，不能替代真实商品认证",
              nextAction: "打开证据卡核对来源",
              citations: ["evidence_card"],
            }),
          },
        }],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return originalFetch(input, init);
  }) as typeof fetch;
  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/agent/query/stream`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-truthpass-request-id": "opencode-success-001" },
        body: JSON.stringify({ batchId: "FO-2026-001", question: "请解释这批资料", locale: "zh" }),
      });
      const stream = await response.text();
      assert.equal(response.status, 200);
      assert.match(stream, /"provider":"opencode"/);
      assert.match(stream, /"model":"deepseek-v4\.1-flash"/);
      assert.match(stream, /"modelAssisted":true/);
      assert.match(stream, /"validationStatus":"accepted"/);
      assert.match(stream, /"providerResponseStatus":200/);
      assert.match(stream, /"runtimeStatus":"completed"/);
      assert.match(stream, /"stage":"model_completed","status":"completed"/);
      assert.equal(opencodeHeaders?.get("x-opencode-session"), "truthpass:FO-2026-001:zh");
      assert.match(opencodeHeaders?.get("user-agent") ?? "", /^TruthPass-Agent\/1\.0/);
    });
  } finally {
    globalThis.fetch = originalFetch;
    if (previous.provider === undefined) delete process.env.AGENT_PROVIDER; else process.env.AGENT_PROVIDER = previous.provider;
    if (previous.key === undefined) delete process.env.OPENCODE_API_KEY; else process.env.OPENCODE_API_KEY = previous.key;
    if (previous.baseUrl === undefined) delete process.env.OPENCODE_BASE_URL; else process.env.OPENCODE_BASE_URL = previous.baseUrl;
    if (previous.model === undefined) delete process.env.OPENCODE_MODEL; else process.env.OPENCODE_MODEL = previous.model;
  }
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

test("customer service caps concurrent Agent runs at ten and releases slots", async () => {
  await withServer(async (baseUrl) => {
    const responses = await Promise.all(Array.from({ length: 12 }, (_, index) => fetch(baseUrl + "/api/agent/chat", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `198.51.100.${100 + index}`,
        "x-truthpass-session": `concurrency-test-${index}`,
      },
      body: JSON.stringify({
        batchId: "FO-2026-001",
        messages: [{ role: "user", content: "检测结果怎么看？" }],
      }),
    }).then(async (response) => ({ status: response.status, body: await response.text() }))));

    const limited = responses.filter((response) => response.status === 429);
    assert.ok(limited.length >= 1, "超过十个并发请求时应返回 429");
    assert.ok(responses.some((response) => response.status === 200));
    const limitedBody = limited[0]?.body ?? "";
    assert.match(limitedBody, /AGENT_CONCURRENCY_LIMITED|agent_concurrency_limit/);

    // All accepted requests must finish before the server closes. A follow-up
    // request proves finally{} released every slot after the first burst.
    const followUp = await fetch(baseUrl + "/api/agent/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-truthpass-session": "concurrency-follow-up" },
      body: JSON.stringify({ batchId: "FO-2026-001", messages: [{ role: "user", content: "还缺什么资料？" }] }),
    });
    assert.equal(followUp.status, 200);
    await followUp.text();
  });
});
