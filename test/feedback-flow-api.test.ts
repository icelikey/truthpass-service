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

const purchaseId = "0x" + "1".repeat(64);
const purchaseTxHash = "0x" + "2".repeat(64);

test("feedback prepare only creates a pending payload and confirm fails without the matching receipt", async () => {
  await withServer(async (baseUrl) => {
    const manifest = await fetch(`${baseUrl}/api/agent/manifest`).then((response) => response.json()) as Record<string, any>;
    assert.match(manifest.endpoints.feedbackPrepare, /\/api\/feedback\/prepare$/);
    assert.match(manifest.endpoints.feedbackConfirm, /\/api\/feedback\/confirm$/);
    const before = await fetch(`${baseUrl}/api/feedback/summary?batchId=FO-2026-001`).then((response) => response.json()) as Record<string, any>;
    assert.ok(before && typeof before.categoryCounts === "object");
    assert.ok("sampleMode" in before);
    assert.ok("lastUpdated" in before);
    const payload = {
      batchId: "FO-2026-001",
      purchaseId,
      purchaseTxHash,
      rating: 4,
      categories: ["包装完好"],
      comment: "包装完整",
      consent: true,
      purchaseConfirmed: true,
      dataMode: "external",
    };
    const prepareResponse = await fetch(`${baseUrl}/api/feedback/prepare`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
    const prepare = await prepareResponse.json() as Record<string, any>;
    assert.equal(prepareResponse.status, 200);
    assert.equal(prepare.status, "pending_confirmation");
    assert.equal(prepare.purchaseId, purchaseId);
    assert.equal(prepare.purchaseTxHash, purchaseTxHash);
    assert.match(prepare.prepareId, /^0x[0-9a-f]{64}$/);
    assert.match(prepare.feedbackHash, /^0x[0-9a-f]{64}$/);

    const afterPrepare = await fetch(`${baseUrl}/api/feedback/summary?batchId=FO-2026-001`).then((response) => response.json()) as Record<string, any>;
    assert.equal(afterPrepare.count, before.count);

    const confirmResponse = await fetch(`${baseUrl}/api/feedback/confirm`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...payload, prepareId: prepare.prepareId }) });
    const confirm = await confirmResponse.json() as Record<string, any>;
    assert.equal(confirmResponse.status, 422);
    assert.equal(confirm.status, "purchase_receipt_unverified");
    assert.equal(confirm.purchaseId, purchaseId);

    const afterConfirm = await fetch(`${baseUrl}/api/feedback/summary?batchId=FO-2026-001`).then((response) => response.json()) as Record<string, any>;
    assert.equal(afterConfirm.count, before.count);
  });
});

test("legacy feedback endpoint rejects an external submission without a verified receipt", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/feedback`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      batchId: "FO-2026-001",
      purchaseId,
      txHash: purchaseTxHash,
      rating: 4,
      categories: ["包装完好"],
      consent: true,
      purchaseConfirmed: true,
      dataMode: "external",
    }) });
    const result = await response.json() as Record<string, any>;
    assert.equal(response.status, 422);
    assert.equal(result.status, "purchase_receipt_unverified");
  });
});

test("feedback summary preserves demo mode and only exposes aggregate categories", async () => {
  await withServer(async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/feedback`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        batchId: "FO-2026-001",
        rating: 5,
        categories: ["包装完好"],
        consent: true,
        purchaseConfirmed: true,
        dataMode: "demo/synthetic",
      }),
    });
    assert.equal(response.status, 200);
    const summary = await fetch(`${baseUrl}/api/feedback/summary?batchId=FO-2026-001`).then((item) => item.json()) as Record<string, any>;
    assert.equal(summary.sampleMode, "demo/synthetic");
    assert.equal(summary.dataMode, "demo/synthetic");
    assert.equal(summary.categoryCounts["包装完好"], 1);
    assert.equal(summary.returnRate, null);
    assert.equal(summary.deliveryIssueRate, null);
    assert.equal("rawComment" in summary, false);
  });
});

