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

test("personal Agent access is advertised and fails closed without a user grant", async () => {
  await withServer(async (baseUrl) => {
    const manifestResponse = await fetch(`${baseUrl}/api/agent/manifest`);
    const manifest = await manifestResponse.json() as Record<string, any>;
    assert.equal(manifestResponse.status, 200);
    assert.match(manifest.endpoints.consumerAgentGrants, /\/api\/consumer\/agent\/grants$/);
    assert.match(manifest.endpoints.consumerAgentQuery, /\/api\/consumer\/agent\/query$/);

    const cases = [
      ["/api/consumer/agent/profile", 401],
      ["/api/consumer/agent/purchases", 401],
      ["/api/consumer/agent/updates?batch=FO-2026-001", 401],
      ["/api/consumer/agent/guidance?batch=FO-2026-001", 401],
      ["/api/consumer/agent/grants", 401],
    ] as const;
    for (const [path, expectedStatus] of cases) {
      const response = await fetch(baseUrl + path);
      const body = await response.json() as Record<string, any>;
      assert.equal(response.status, expectedStatus, path);
      assert.match(String(body.error), /CONSUMER_AGENT_/);
    }
  });
});
