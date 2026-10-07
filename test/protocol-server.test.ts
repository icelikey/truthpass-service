import { test } from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { createEvidenceEnvelope } from "../src/evidence.js";
import { createProtocolServer, ProtocolStore } from "../src/protocol-server.js";

test("统一协议服务器验签、幂等接收并路由验证", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ format: "pem", type: "spki" }).toString();
  const privatePem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  const payload = { batchId: "FO-2026-001", epaDhaPercent: 78, peroxideValue: 2.1, totox: 11 };
  const envelope = createEvidenceEnvelope({
    eventId: "evt-protocol-001",
    eventType: "lab_report",
    subjectRefs: [{ type: "batch", id: "FO-2026-001" }],
    issuer: { type: "lab", id: "lab-c" },
    producedByAgent: "lab-agent-c",
    observedAt: "2026-10-07T10:00:00Z",
    receivedAt: "2026-10-07T10:01:00Z",
    sequence: 0,
    previousEventHash: null,
    nonce: "nonce-protocol-001",
    attestationLevel: "lab-signed",
    keyId: "lab-key-1",
    status: "valid",
    payload,
    privateKey: privatePem,
  });
  const server = createProtocolServer(new ProtocolStore());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  try {
    const issuer = await fetch(`${base}/v1/issuers`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ issuerId: "lab-c", keyId: "lab-key-1", publicKey: publicPem }) });
    assert.equal(issuer.status, 201);
    const accepted = await fetch(`${base}/v1/evidence`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ envelope, payload }) });
    assert.equal(accepted.status, 202);
    const duplicate = await fetch(`${base}/v1/evidence`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ envelope, payload }) });
    assert.equal(duplicate.status, 202);
    const verify = await fetch(`${base}/v1/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task: { taskId: "task-1", serviceKind: "lab", capability: "fish-oil-batch-quality-check", batchId: "FO-2026-001", productionTime: "2026-10-07T08:00:00Z", acceptance: { requireSignature: true, maxLogisticsGapHours: 6, minEpaDhaPercent: 70, maxPeroxideValue: 5, maxTotox: 20 } }, evidence: { serviceId: "lab-c", taskId: "task-1", batchId: "FO-2026-001", reportBatchId: "FO-2026-001", productionTime: "2026-10-07T08:00:00Z", reportTime: "2026-10-07T10:01:00Z", logisticsGapHours: 2, signatureValid: true, epaDhaPercent: 78, peroxideValue: 2.1, totox: 11, payload } }) });
    const result = await verify.json() as { status: string; result: { status: string }; chainAction: string };
    assert.equal(verify.status, 200);
    assert.equal(result.result.status, "accepted");
    assert.equal(result.chainAction, "prepare_anchor_and_verification");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
