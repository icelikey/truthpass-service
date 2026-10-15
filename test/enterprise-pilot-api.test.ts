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

function shipmentEvidence(evidenceId: string) {
  return {
    schemaVersion: "evidence.v1",
    brandId: "brand-api",
    productId: "product-api",
    batchId: "BATCH-API-001",
    evidenceId,
    kind: "shipment",
    issuerId: "carrier-api",
    sourceKind: "manufacturer",
    occurredAt: "2026-10-15T08:00:00.000Z",
    payload: { shipmentId: "SHIP-001", batchId: "BATCH-API-001" },
    dataMode: "external",
  };
}

test("enterprise APIs require tenant-scoped gateway auth and never export raw payloads", async () => {
  const before = process.env.TRUTHPASS_AGENT_GATEWAY_TOKEN;
  delete process.env.TRUTHPASS_AGENT_GATEWAY_TOKEN;
  try {
    await withServer(async (baseUrl) => {
      const unavailable = await fetch(`${baseUrl}/api/tenants/tenant-api/evidence/import`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(shipmentEvidence("EV-API-001")),
      });
      assert.equal(unavailable.status, 503);
    });

    process.env.TRUTHPASS_AGENT_GATEWAY_TOKEN = "test-gateway-token";
    await withServer(async (baseUrl) => {
      const headers = {
        "content-type": "application/json",
        authorization: "Bearer test-gateway-token",
        "x-truthpass-tenant": "tenant-api",
        "x-truthpass-request-id": "api-import-001",
      };
      const imported = await fetch(`${baseUrl}/api/tenants/tenant-api/evidence/import`, {
        method: "POST", headers, body: JSON.stringify(shipmentEvidence("EV-API-001")),
      });
      const body = await imported.json() as Record<string, any>;
      assert.equal(imported.status, 201);
      assert.equal(body.tenantId, "tenant-api");
      assert.equal(body.evidence.payload, undefined);

      const wrongTenant = await fetch(`${baseUrl}/api/tenants/tenant-other/evidence/import`, {
        method: "POST", headers, body: JSON.stringify(shipmentEvidence("EV-API-002")),
      });
      assert.equal(wrongTenant.status, 401);

      const audit = await fetch(`${baseUrl}/api/tenants/tenant-api/audit/export`, {
        headers: { authorization: headers.authorization, "x-truthpass-tenant": "tenant-api", "x-truthpass-request-id": "api-export-001" },
      });
      const exported = await audit.json() as Record<string, any>;
      assert.equal(audit.status, 200);
      assert.equal(exported.tenantId, "tenant-api");
      assert.equal("payload" in exported.evidence[0], false);
    });
  } finally {
    if (before === undefined) delete process.env.TRUTHPASS_AGENT_GATEWAY_TOKEN; else process.env.TRUTHPASS_AGENT_GATEWAY_TOKEN = before;
  }
});
