import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import type { EvidenceRecord } from "../src/data/model.js";
import { evidenceSigningPayload, InMemoryReplayGuard, TrustedIssuerKeyRegistry, verifyEvidenceAttestation } from "../src/security/evidence-signatures.js";

const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();

function signedEvidence(): EvidenceRecord {
  const evidence = {
    schemaVersion: "evidence.v1" as const, evidenceId: "ev-signed-1", batchId: "B-1", kind: "inspection" as const,
    issuerId: "lab-1", sourceKind: "third_party" as const, occurredAt: "2026-10-06T10:00:00Z",
    payload: { reportBatchId: "B-1", result: 78 }, dataMode: "external" as const,
  };
  const keyId = "lab-1-key-1";
  const claims = { keyId, nonce: "a".repeat(32), expiresAt: "2026-12-31T23:59:59Z" };
  const signature = sign(null, Buffer.from(evidenceSigningPayload(evidence, claims)), privateKey).toString("base64");
  return { ...evidence, attestation: { algorithm: "Ed25519", ...claims, signature }, payloadHash: "unused", status: "submitted", createdAt: "2026-10-06T10:01:00Z" };
}

test("verifies evidence only with the trusted issuer key and unchanged signed fields", () => {
  const evidence = signedEvidence();
  const resolveTrustedKey = (issuerId: string, keyId: string) => issuerId === "lab-1" && keyId === "lab-1-key-1" ? publicKeyPem : undefined;

  assert.equal(verifyEvidenceAttestation(evidence, resolveTrustedKey), true);
  assert.equal(verifyEvidenceAttestation({ ...evidence, issuerId: "attacker" }, resolveTrustedKey), false);
  assert.equal(verifyEvidenceAttestation({ ...evidence, batchId: "B-2" }, resolveTrustedKey), false);
  assert.equal(verifyEvidenceAttestation({ ...evidence, payload: { reportBatchId: "B-1", result: 99 } }, resolveTrustedKey), false);
  assert.equal(verifyEvidenceAttestation(evidence, () => undefined), false);
});

test("supports issuer key rotation and rejects revoked keys", () => {
  const next = generateKeyPairSync("ed25519");
  const registry = new TrustedIssuerKeyRegistry([
    { issuerId: "lab-1", keyId: "lab-1-key-1", publicKeyPem },
    { issuerId: "lab-1", keyId: "lab-1-key-2", publicKeyPem: next.publicKey.export({ type: "spki", format: "pem" }).toString() },
  ]);
  const oldEvidence = signedEvidence();
  const nextKeyId = "lab-1-key-2";
  const nextClaims = { keyId: nextKeyId, nonce: "b".repeat(32), expiresAt: "2026-12-31T23:59:59Z" };
  const nextSignature = sign(null, Buffer.from(evidenceSigningPayload(oldEvidence, nextClaims)), next.privateKey).toString("base64");
  const nextEvidence = { ...oldEvidence, attestation: { algorithm: "Ed25519" as const, ...nextClaims, signature: nextSignature } };

  assert.equal(verifyEvidenceAttestation(oldEvidence, registry.resolve), true);
  assert.equal(verifyEvidenceAttestation(nextEvidence, registry.resolve), true);
  assert.equal(registry.revoke("lab-1", "lab-1-key-1"), true);
  assert.equal(registry.revoke("lab-1", "lab-1-key-1"), false);
  assert.equal(verifyEvidenceAttestation(oldEvidence, registry.resolve), false);
  assert.equal(verifyEvidenceAttestation(nextEvidence, registry.resolve), true);
});

test("trusted key registry rejects malformed and non-Ed25519 keys", () => {
  const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const rsaPublicKeyPem = rsa.publicKey.export({ type: "spki", format: "pem" }).toString();

  assert.throws(() => new TrustedIssuerKeyRegistry([{ issuerId: "lab-1", keyId: "rsa-key", publicKeyPem: rsaPublicKeyPem }]), /必须是 Ed25519/);
  assert.throws(() => new TrustedIssuerKeyRegistry([{ issuerId: "lab-1", keyId: "bad-key", publicKeyPem: "not a public key" }]));
});

test("rejects expired attestations and reserves a nonce only once", () => {
  const evidence = signedEvidence();
  const expiredClaims = { keyId: "lab-1-key-1", nonce: "e".repeat(32), expiresAt: "2026-10-01T00:00:00Z" };
  const expiredSignature = sign(null, Buffer.from(evidenceSigningPayload(evidence, expiredClaims)), privateKey).toString("base64");
  const expired = { ...evidence, attestation: { algorithm: "Ed25519" as const, ...expiredClaims, signature: expiredSignature } };
  const guard = new InMemoryReplayGuard();

  assert.equal(verifyEvidenceAttestation(expired, (issuerId, keyId) => issuerId === "lab-1" && keyId === "lab-1-key-1" ? publicKeyPem : undefined), false);
  assert.equal(guard.reserve("lab-1:key-1:nonce"), true);
  assert.equal(guard.reserve("lab-1:key-1:nonce"), false);
});
