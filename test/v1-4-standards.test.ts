import assert from "node:assert/strict";
import test from "node:test";
import {
  AnonymousConsumerRegistry,
  CFI_MANIFEST_SCHEMA,
  CONSUMER_CREDENTIAL_SCHEMA,
  HONEY_PUBLIC_POLICY,
  ProductPolicyRegistry,
  PRODUCT_POLICY_SCHEMA,
  buildCfiManifest,
  createDefaultProductPolicyRegistry,
  publicStandardDocument,
} from "../src/standards/v1_4.js";
import { sha256Canonical } from "../src/evidence.js";

test("v1.4 canonical hashes are stable and policy registry is cross-category", () => {
  assert.equal(sha256Canonical({ b: 2, a: 1 }), sha256Canonical({ a: 1, b: 2 }));
  const registry = createDefaultProductPolicyRegistry();
  const policies = registry.list({ status: "active" });
  assert.deepEqual(policies.map((policy) => policy.productCategory), ["fish-oil", "honey"]);
  assert.equal(policies[1].schemaVersion, PRODUCT_POLICY_SCHEMA);
  assert.match(policies[1].policyHash, /^0x[0-9a-f]{64}$/);
  const copy = registry.get("honey-quality", "v1");
  copy.publicRules.maxMoisturePercent = 99;
  assert.equal(registry.get("honey-quality", "v1").publicRules.maxMoisturePercent, 20);
});

test("policy registration is idempotent only for the same hash", () => {
  const registry = new ProductPolicyRegistry();
  const first = registry.register(HONEY_PUBLIC_POLICY);
  assert.equal(registry.register({ ...HONEY_PUBLIC_POLICY, policyHash: first.policyHash }).policyHash, first.policyHash);
  assert.throws(() => registry.register({ ...HONEY_PUBLIC_POLICY, publicRules: { ...HONEY_PUBLIC_POLICY.publicRules, maxMoisturePercent: 19 }, policyHash: first.policyHash }), /policyHash/);
  assert.throws(() => registry.register({ ...HONEY_PUBLIC_POLICY, publicRules: { ...HONEY_PUBLIC_POLICY.publicRules, maxMoisturePercent: 19 } }), /内容不一致/);
});

test("CFI manifest exposes public schemas, policy hashes, and no private data", () => {
  const manifest = buildCfiManifest("https://truthpass.example///", createDefaultProductPolicyRegistry(), "2026-10-15T00:00:00.000Z");
  assert.equal(manifest.schemaVersion, CFI_MANIFEST_SCHEMA);
  assert.equal(manifest.endpoints.manifest, "https://truthpass.example/api/cfi/manifest");
  assert.equal(manifest.policies.length, 2);
  assert.equal(manifest.publicDataBoundary.personalData, "off_chain");
  assert.equal("privateKey" in manifest, false);
  assert.match(manifest.manifestId, /^0x[0-9a-f]{64}$/);
  assert.equal(publicStandardDocument().schemaVersion, "truthpass.public-standard.v1");
});

test("anonymous consumer credentials never retain nonce and feedback is one-per-batch", () => {
  const consumers = new AnonymousConsumerRegistry();
  const credential = consumers.issue({ nonce: "a-long-random-nonce-001", scopes: ["feedback"], issuedAt: "2026-10-15T00:00:00.000Z" });
  assert.equal(credential.schemaVersion, CONSUMER_CREDENTIAL_SCHEMA);
  assert.equal(JSON.stringify(credential).includes("a-long-random-nonce-001"), false);
  assert.match(credential.subjectCommitment, /^0x[0-9a-f]{64}$/);
  const feedback = consumers.submitFeedback({ credentialId: credential.credentialId, batchId: "FO-2026-001", rating: 4, categories: ["包装"], evidenceRefs: ["0x" + "a".repeat(64)], createdAt: "2026-10-15T00:05:00.000Z" });
  assert.equal(feedback.schemaVersion, "truthpass.consumer.feedback.v1");
  assert.equal(feedback.credentialId, credential.credentialId);
  assert.throws(() => consumers.submitFeedback({ credentialId: credential.credentialId, batchId: "FO-2026-001", rating: 5 }), /只能提交一次/);
  assert.equal(consumers.revoke(credential.credentialId), true);
  assert.throws(() => consumers.submitFeedback({ credentialId: credential.credentialId, batchId: "FO-2026-002", rating: 5 }), /不存在、已撤销/);
});

test("anonymous feedback rejects non-hash evidence and invalid ratings", () => {
  const consumers = new AnonymousConsumerRegistry();
  const credential = consumers.issue({ nonce: "a-long-random-nonce-002", scopes: ["feedback"] });
  assert.throws(() => consumers.submitFeedback({ credentialId: credential.credentialId, batchId: "FO-1", rating: 6 }), /rating/);
  assert.throws(() => consumers.submitFeedback({ credentialId: credential.credentialId, batchId: "FO-1", rating: 3, evidenceRefs: ["not-a-hash"] }), /evidenceRefs/);
});
