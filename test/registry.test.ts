import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { ServiceRegistry } from "../src/registry.js";
import type { ExecutionEvidence, ServiceAdapter, ServiceCard, TaskRequest } from "../src/types.js";
import { executionEvidenceSigningPayload, InMemoryReplayGuard, TrustedIssuerKeyRegistry } from "../src/security/evidence-signatures.js";

const task: TaskRequest = {
  taskId: "route-task",
  serviceKind: "lab",
  capability: "fish-oil-batch-quality-check",
  batchId: "FO-1",
  productionTime: "2026-10-06T08:00:00Z",
  acceptance: { requireSignature: true, policyId: "fish-oil-quality", policyVersion: "v1" },
};

function adapter(card: ServiceCard, reportBatchId: string, productPasses = true): ServiceAdapter {
  return {
    async probe() {
      return {
        serviceId: card.id,
        status: "healthy",
        latencyMs: 10,
        capabilityMatch: true,
        schemaValid: true,
        checkedAt: "2026-10-06T08:01:00Z",
      };
    },
    async execute(request) {
      return {
        serviceId: card.id,
        taskId: request.taskId,
        batchId: request.batchId,
        reportBatchId,
        productionTime: request.productionTime,
        reportTime: "2026-10-06T10:00:00Z",
        logisticsGapHours: 1,
        signatureValid: true,
        epaDhaPercent: productPasses ? 78 : 60,
        peroxideValue: 2,
        totox: 10,
        coldChainGapHours: 1,
        payload: { evidenceMode: "demo/synthetic" },
      };
    },
  };
}

function card(id: string, historicalScore: number): ServiceCard {
  return {
    id,
    name: id,
    kind: "lab",
    endpoint: `https://example.test/${id}`,
    capabilities: ["fish-oil-batch-quality-check"],
    signer: `signer-${id}`,
    historicalScore,
    feedbackCount: 10,
  };
}

test("filters failed service execution before ranking", async () => {
  const registry = new ServiceRegistry();
  const historicallyTrusted = card("historically-trusted", 99);
  const valid = card("valid", 70);
  registry.register(historicallyTrusted, adapter(historicallyTrusted, "FO-other"), "demo/synthetic");
  registry.register(valid, adapter(valid, "FO-1"), "demo/synthetic");

  const ranked = await registry.evaluate(task);

  assert.equal(ranked[0]?.service.id, "valid");
  assert.equal(ranked[0]?.eligible, true);
  assert.equal(ranked[1]?.service.id, "historically-trusted");
  assert.equal(ranked[1]?.eligible, false);
});

test("does not mark a service eligible when product assessment fails", async () => {
  const registry = new ServiceRegistry();
  const service = card("bad-product", 99);
  registry.register(service, adapter(service, "FO-1", false), "demo/synthetic");

  const [result] = await registry.evaluate(task);

  assert.equal(result?.execution?.status, "accepted");
  assert.equal(result?.product?.status, "rejected");
  assert.equal(result?.eligible, false);
});

test("rejects an external service that only claims its signature is valid", async () => {
  const registry = new ServiceRegistry();
  const service = card("external-lab", 99);
  registry.register(service, adapter(service, "FO-1"));

  const [result] = await registry.evaluate(task);

  assert.equal(result?.execution?.checks.signatureValid, false);
  assert.equal(result?.eligible, false);
});

test("accepts external service evidence only after issuer signature verification", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keyId = "external-lab-key-1";
  const evidence: ExecutionEvidence = {
    serviceId: "external-lab", taskId: task.taskId, batchId: task.batchId, reportBatchId: task.batchId,
    productionTime: task.productionTime, reportTime: "2026-10-06T10:00:00Z", logisticsGapHours: 1,
    signatureValid: true, epaDhaPercent: 78, peroxideValue: 2, totox: 10, coldChainGapHours: 1,
    payload: { report: "lab report" },
  };
  const claims = { keyId, nonce: "c".repeat(32), expiresAt: "2026-12-31T23:59:59Z" };
  const signature = sign(null, Buffer.from(executionEvidenceSigningPayload(evidence, claims)), privateKey).toString("base64");
  const signedEvidence = { ...evidence, attestation: { algorithm: "Ed25519" as const, ...claims, signature } };
  const service = card("external-lab", 90);
  const adapter: ServiceAdapter = {
    async probe() { return { serviceId: service.id, status: "healthy", latencyMs: 1, capabilityMatch: true, schemaValid: true, checkedAt: "2026-10-06T08:00:00Z" }; },
    async execute() { return signedEvidence; },
  };
  const keys = new TrustedIssuerKeyRegistry([{
    issuerId: service.id, keyId, publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  }]);
  const registry = new ServiceRegistry(keys.resolve, new InMemoryReplayGuard());
  registry.register(service, adapter, "external");

  const [result] = await registry.evaluate(task);

  assert.equal(result?.execution?.checks.signatureValid, true);
  assert.equal(result?.eligible, true);
});

test("rejects replaying the same signed external service evidence", async () => {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const keyId = "replay-lab-key-1";
  const evidence: ExecutionEvidence = {
    serviceId: "replay-lab", taskId: task.taskId, batchId: task.batchId, reportBatchId: task.batchId,
    productionTime: task.productionTime, reportTime: "2026-10-06T10:00:00Z", logisticsGapHours: 1,
    epaDhaPercent: 78, peroxideValue: 2, totox: 10, coldChainGapHours: 1, payload: { report: "same report" },
  };
  const claims = { keyId, nonce: "f".repeat(32), expiresAt: "2026-12-31T23:59:59Z" };
  const signature = sign(null, Buffer.from(executionEvidenceSigningPayload(evidence, claims)), privateKey).toString("base64");
  const service = card("replay-lab", 90);
  const adapter: ServiceAdapter = {
    async probe() { return { serviceId: service.id, status: "healthy", latencyMs: 1, capabilityMatch: true, schemaValid: true, checkedAt: "2026-10-06T08:00:00Z" }; },
    async execute() { return { ...evidence, attestation: { algorithm: "Ed25519" as const, ...claims, signature } }; },
  };
  const keys = new TrustedIssuerKeyRegistry([{ issuerId: service.id, keyId, publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString() }]);
  const registry = new ServiceRegistry(keys.resolve, new InMemoryReplayGuard());
  registry.register(service, adapter, "external");

  const first = (await registry.evaluate(task))[0]!;
  const second = (await registry.evaluate(task))[0]!;

  assert.equal(first.eligible, true);
  assert.equal(second.execution?.checks.signatureValid, false);
  assert.equal(second.eligible, false);
});
