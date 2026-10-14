import assert from "node:assert/strict";
import test from "node:test";
import { canonicalJson } from "../src/data/canonical.js";
import { fishOilBatch, fishOilEvidence, fishOilProduct } from "../src/data/fixtures.js";
import { MemoryDataRepository } from "../src/data/repository.js";
import { validateBatch, validateEvidence, validateProduct } from "../src/data/validation.js";

test("stores a valid fish-oil product, batch, and evidence chain", async () => {
  const repository = new MemoryDataRepository();
  repository.createProduct(fishOilProduct);
  repository.createBatch(fishOilBatch);
  const stored = await repository.addEvidence(fishOilEvidence[1]);

  assert.equal(repository.getProduct(fishOilProduct.productId)?.productId, fishOilProduct.productId);
  assert.equal(repository.getBatch(fishOilBatch.batchId)?.batchId, fishOilBatch.batchId);
  assert.equal(stored.status, "submitted");
  assert.match(stored.payloadHash, /^[0-9a-f]{64}$/);
  assert.equal(stored.dataMode, "demo/synthetic");
});

test("rejects invalid records before persistence", () => {
  assert.equal(validateProduct({ ...fishOilProduct, productId: "" }).ok, false);
  assert.equal(validateBatch({ ...fishOilBatch, productionAt: "not-a-date" }).ok, false);
  assert.equal(validateEvidence({ ...fishOilEvidence[0], kind: "unknown" }).ok, false);
  assert.equal(validateEvidence({ ...fishOilEvidence[0], attestation: { algorithm: "RSA", keyId: "key-1", signature: "fake" } }).ok, false);
});

test("enforces product, batch, and evidence foreign-key boundaries", async () => {
  const repository = new MemoryDataRepository();
  assert.throws(() => repository.createBatch(fishOilBatch), /product 不存在/);
  repository.createProduct(fishOilProduct);
  repository.createBatch(fishOilBatch);
  await assert.rejects(() => repository.addEvidence({ ...fishOilEvidence[0], batchId: "FO-UNKNOWN" }), /batch 不存在/);
});

test("rejects duplicate IDs and preserves append-only records", async () => {
  const repository = new MemoryDataRepository();
  repository.createProduct(fishOilProduct);
  repository.createBatch(fishOilBatch);
  await repository.addEvidence(fishOilEvidence[0]);

  assert.throws(() => repository.createProduct(fishOilProduct), /productId 已存在/);
  assert.throws(() => repository.createBatch(fishOilBatch), /batchId 已存在/);
  await assert.rejects(() => repository.addEvidence(fishOilEvidence[0]), /evidenceId 已存在/);
  assert.equal(repository.listEvidence(fishOilBatch.batchId).length, 1);
});

test("imports revoked database evidence as revoked instead of restoring it as active", async () => {
  const repository = new MemoryDataRepository();
  repository.createProduct(fishOilProduct);
  repository.createBatch(fishOilBatch);
  const imported = await repository.importEvidence(fishOilEvidence[1]!, "revoked");

  assert.equal(imported.status, "revoked");
  assert.equal(repository.getEvidence(imported.evidenceId)?.status, "revoked");
});

test("keeps repository records isolated from caller mutations", async () => {
  const repository = new MemoryDataRepository();
  const product = structuredClone(fishOilProduct);
  const batch = structuredClone(fishOilBatch);
  repository.createProduct(product);
  repository.createBatch(batch);
  const evidence = await repository.addEvidence(structuredClone(fishOilEvidence[0]!));

  product.claims.push("caller mutation");
  batch.fillingBatchId = "caller-mutation";
  evidence.payload.tampered = true;

  const storedProduct = repository.getProduct(product.productId)!;
  const storedBatch = repository.getBatch(batch.batchId)!;
  const storedEvidence = repository.getEvidence(evidence.evidenceId)!;
  assert.equal(storedProduct.claims.includes("caller mutation"), false);
  assert.notEqual(storedBatch.fillingBatchId, "caller-mutation");
  assert.equal(storedEvidence.payload.tampered, undefined);

  storedProduct.claims.push("read mutation");
  storedBatch.fillingBatchId = "read-mutation";
  storedEvidence.payload.tampered = true;
  const listed = repository.listEvidence(batch.batchId);
  listed[0]!.payload.tampered = true;

  assert.equal(repository.getProduct(product.productId)!.claims.includes("read mutation"), false);
  assert.notEqual(repository.getBatch(batch.batchId)!.fillingBatchId, "read-mutation");
  assert.equal(repository.getEvidence(evidence.evidenceId)!.payload.tampered, undefined);
});

test("canonical JSON hashes equivalent object key order identically", () => {
  assert.equal(
    canonicalJson({ b: 2, a: { d: 4, c: 3 } }),
    canonicalJson({ a: { c: 3, d: 4 }, b: 2 }),
  );
});
