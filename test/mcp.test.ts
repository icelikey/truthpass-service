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

test("MCP exposes read-only tools with JSON-RPC tracing and CORS", async () => {
  await withServer(async (baseUrl) => {
    const initialized = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "mcp-test-001" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    const initializedBody = await initialized.json() as Record<string, any>;
    assert.equal(initialized.status, 200);
    assert.equal(initializedBody.result.serverInfo.name, "truthpass-mcp");
    assert.equal(initializedBody.result._meta.traceId, "mcp-test-001");
    assert.equal(initialized.headers.get("access-control-allow-origin"), "*");
    assert.equal(initialized.headers.get("x-truthpass-trace-id"), "mcp-test-001");

    const inspected = await fetch(`${baseUrl}/api/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-truthpass-request-id": "mcp-test-002" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "inspect", method: "tools/call", params: { name: "truthpass.inspect_batch", arguments: { batchId: "FO-2026-001" } } }),
    });
    const inspectedBody = await inspected.json() as Record<string, any>;
    assert.equal(inspected.status, 200);
    assert.equal(inspectedBody.result.structuredContent.batchId, "FO-2026-001");
    assert.equal(inspectedBody.result.structuredContent.dataMode, "demo/synthetic");
    assert.equal(inspectedBody.result._meta.traceId, "mcp-test-002");

    const fixtureInspected = await fetch(`${baseUrl}/api/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-truthpass-request-id": "mcp-test-003" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "inspect-fixture", method: "tools/call", params: { name: "truthpass.inspect_batch", arguments: { batchId: "FO-2026-009" } } }),
    });
    const fixtureBody = await fixtureInspected.json() as Record<string, any>;
    const evidence = fixtureBody.result.structuredContent.verification.evidence as Array<Record<string, unknown>>;
    assert.ok(evidence.length >= 1);
    assert.ok(evidence.every((item) => String(item.evidenceId).startsWith("FO-2026-009:evidence:")));
    assert.ok(evidence.every((item) => item.dataMode === "demo/synthetic"));
  });
});
test("MCP keeps protected operations pending confirmation and rejects invalid batches", async () => {
  await withServer(async (baseUrl) => {
    const protectedResponse = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "truthpass.anchor", arguments: { batchId: "FO-2026-001" } } }),
    });
    const protectedBody = await protectedResponse.json() as Record<string, any>;
    assert.equal(protectedBody.result.structuredContent.status, "pending_confirmation");
    assert.equal(protectedBody.result.structuredContent.submitted, false);
    assert.equal(protectedBody.result.structuredContent.privateKey, false);

    const missing = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 3, method: "truthpass.lifecycle", params: { batchId: "UNKNOWN" } }),
    });
    const missingBody = await missing.json() as Record<string, any>;
    assert.equal(missingBody.error.code, -32004);
    assert.match(missingBody.error.data.traceId, /^mcp-/);

    const cors = await fetch(`${baseUrl}/mcp`, { method: "OPTIONS" });
    assert.equal(cors.status, 204);
    assert.equal(cors.headers.get("access-control-allow-methods"), "POST, OPTIONS");
  });
});

test("MCP exposes scoped retrieval and unified Agent ask", async () => {
  await withServer(async (baseUrl) => {
    const search = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "mcp-search-001" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "truthpass.search", arguments: { batchId: "FO-2026-001", query: "冷链" } } }),
    });
    const searchBody = await search.json() as Record<string, any>;
    assert.equal(searchBody.result.structuredContent.batchId, "FO-2026-001");
    assert.ok(searchBody.result.structuredContent.hits.length > 0);
    assert.ok(searchBody.result.structuredContent.hits.every((hit: any) => hit.batchId === "FO-2026-001"));

    const asked = await fetch(`${baseUrl}/mcp`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-request-id": "mcp-ask-001" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "truthpass.ask", arguments: { batchId: "FO-2026-001", question: "请解释冷链资料和下一步。" } } }),
    });
    const askedBody = await asked.json() as Record<string, any>;
    assert.equal(askedBody.result.structuredContent.schemaVersion, "truthpass.agent.query.v1");
    assert.equal(askedBody.result.structuredContent.batchId, "FO-2026-001");
    assert.equal(askedBody.result.structuredContent.model.status, "deterministic_fallback");
    assert.ok(askedBody.result.structuredContent.traceId);
    assert.ok(askedBody.result.structuredContent.retrieval.hits.length > 0);
  });
});
