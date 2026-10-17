import assert from "node:assert/strict";
import test from "node:test";
import { prepareMediaEvidence } from "../src/enterprise/media-intake.js";

const hash = "0x" + "a".repeat(64);

test("media intake binds a media hash to batch and returns confirmation state", () => {
  const prepared = prepareMediaEvidence({
    tenantId: "tenant-a",
    brandId: "brand-a",
    productId: "product-a",
    batchId: "FO-2026-001",
    evidenceKind: "production",
    mediaKind: "video",
    issuerId: "factory-a",
    sourceKind: "manufacturer",
    capturedAt: "2026-10-17T09:00:00Z",
    contentHash: hash,
    rawObjectRef: "s3://truthpass/demo/factory-a/fo-2026-001.mp4",
    dataMode: "external",
  });

  assert.equal(prepared.schemaVersion, "evidence.v1");
  assert.equal(prepared.batchId, "FO-2026-001");
  assert.equal(prepared.payload.contentHash, hash);
  assert.equal(prepared.status, "awaiting_confirmation");
  assert.equal(prepared.dataMode, "external");
});

test("media intake rejects a non SHA-256 hash before persistence", () => {
  assert.throws(() => prepareMediaEvidence({
    tenantId: "tenant-a",
    brandId: "brand-a",
    productId: "product-a",
    batchId: "FO-2026-001",
    evidenceKind: "inspection",
    mediaKind: "pdf",
    issuerId: "lab-a",
    sourceKind: "third_party",
    capturedAt: "2026-10-17T09:00:00Z",
    contentHash: "not-a-hash",
  }), /contentHash/);
});

test("media intake derives a stable evidence ID when the caller omits one", () => {
  const input = {
    tenantId: "tenant-a",
    brandId: "brand-a",
    productId: "product-a",
    batchId: "FO-2026-001",
    evidenceKind: "cold_chain" as const,
    mediaKind: "sensor" as const,
    issuerId: "carrier-a",
    sourceKind: "platform_device" as const,
    capturedAt: "2026-10-17T09:00:00Z",
    contentHash: hash,
  };
  assert.equal(prepareMediaEvidence(input).evidenceId, prepareMediaEvidence(input).evidenceId);
});
