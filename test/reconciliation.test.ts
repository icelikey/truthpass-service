import assert from "node:assert/strict";
import test from "node:test";
import { reconcileBatch } from "../src/enterprise/reconciliation.js";
import type { EnterpriseEvidenceRecord } from "../src/enterprise/pilot-store.js";

function record(kind: EnterpriseEvidenceRecord["kind"], evidenceId: string, extra: Partial<EnterpriseEvidenceRecord> = {}): EnterpriseEvidenceRecord {
  return {
    schemaVersion: "evidence.v1",
    tenantId: "tenant-a",
    brandId: "brand-a",
    productId: "product-a",
    batchId: "FO-2026-001",
    evidenceId,
    kind,
    issuerId: "issuer-a",
    sourceKind: "manufacturer",
    occurredAt: "2026-10-17T09:00:00.000Z",
    payload: {},
    dataMode: "external",
    payloadHash: "0x" + evidenceId.padEnd(64, "0").slice(0, 64),
    status: "submitted",
    createdAt: "2026-10-17T09:00:00.000Z",
    ...extra,
  };
}

test("reconciliation passes a complete batch with bound samples", () => {
  const result = reconcileBatch("FO-2026-001", [
    record("production", "production-1", { payload: { outputQuantity: 10 } }),
    record("inspection", "inspection-1", { sampleId: "sample-1" }),
    record("cold_chain", "cold-1"),
    record("shipment", "shipment-1", { payload: { shipmentQuantity: 8 } }),
  ]);
  assert.equal(result.status, "passed");
  assert.deepEqual(result.reasons, []);
});

test("reconciliation reports missing evidence and missing sample binding", () => {
  const result = reconcileBatch("FO-2026-001", [record("inspection", "inspection-1")]);
  assert.equal(result.status, "review");
  assert.ok(result.reasons.some((reason) => reason.includes("缺少")));
  assert.ok(result.reasons.some((reason) => reason.includes("sampleId")));
});

test("reconciliation fails closed when shipment exceeds recorded production", () => {
  const result = reconcileBatch("FO-2026-001", [
    record("production", "production-1", { payload: { outputQuantity: 10 } }),
    record("inspection", "inspection-1", { sampleId: "sample-1" }),
    record("cold_chain", "cold-1"),
    record("shipment", "shipment-1", { payload: { shipmentQuantity: 11 } }),
  ]);
  assert.equal(result.status, "conflict");
  assert.ok(result.reasons.some((reason) => reason.includes("出货数量")));
});
