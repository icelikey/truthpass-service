import assert from "node:assert/strict";
import test from "node:test";
import { createApiServer } from "../api-server.js";
import { CliReferenceRegistry } from "../src/cli-reference/v1.js";

test("CLI reference registry exposes a discoverable product, batch verification, and checkout boundary", () => {
  const registry = new CliReferenceRegistry();
  const manifest = registry.manifest("https://demo.example");
  assert.equal(manifest.protocol, "CLI_REFERENCE");
  assert.equal(manifest.dataMode, "demo/synthetic");
  assert.equal(manifest.endpoints.verification, "https://demo.example/api/cli/reference/batches/{batchId}/verification");

  const verification = registry.verifyBatch("FO-2026-001");
  assert.equal(verification.status, "accepted_with_scope");
  assert.equal(verification.anchor.status, "anchor_pending");
  assert.equal(verification.dataMode, "demo/synthetic");

  const order = registry.prepareOrder({ batchId: "FO-2026-001", quantity: 2, clientRequestId: "cli-reference-test-001" });
  assert.equal(order.status, "prepared_pending_checkout");
  assert.equal(order.paymentStatus, "not_started");
  assert.equal(order.nextAction, "send_to_checkout_adapter");
  assert.equal(order.quantity, 2);
  assert.equal(order.chainStatus, "anchor_pending");
});

test("CLI reference rejects a batch with invalid inspection evidence before order preparation", () => {
  const registry = new CliReferenceRegistry();
  const verification = registry.verifyBatch("FO-2026-002");
  assert.equal(verification.status, "rejected");
  assert.throws(() => registry.prepareOrder({ batchId: "FO-2026-002" }), /不能进入购买准备/);
});

test("CLI reference HTTP APIs expose manifest, evidence, assistant and safe order state", async () => {
  const server = createApiServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = "http://127.0.0.1:" + (address as { port: number }).port;
  try {
    const manifestResponse = await fetch(baseUrl + "/api/cli/reference/manifest");
    const manifest = await manifestResponse.json() as Record<string, any>;
    assert.equal(manifestResponse.status, 200);
    assert.equal(manifest.protocol, "CLI_REFERENCE");

    const verificationResponse = await fetch(baseUrl + "/api/cli/reference/batches/FO-2026-001/verification");
    const verification = await verificationResponse.json() as Record<string, any>;
    assert.equal(verification.status, "accepted_with_scope");
    assert.equal(verification.anchor.status, "anchor_pending");

    const assistantResponse = await fetch(baseUrl + "/api/cli/reference/products/HLN-FISH-OIL-001/assistant");
    const assistant = await assistantResponse.json() as Record<string, any>;
    assert.deepEqual(assistant.excludedTopics, ["diagnosis", "disease", "medication", "health_outcome"]);

    const orderResponse = await fetch(baseUrl + "/api/cli/reference/orders/prepare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ batchId: "FO-2026-001", quantity: 1, clientRequestId: "cli-reference-api-test" }),
    });
    const order = await orderResponse.json() as Record<string, any>;
    assert.equal(orderResponse.status, 200);
    assert.equal(order.status, "prepared_pending_checkout");
    assert.equal(order.paymentStatus, "not_started");
    assert.equal(order.chainStatus, "anchor_pending");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

