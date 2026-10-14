import assert from "node:assert/strict";
import { generateKeyPairSync, sign } from "node:crypto";
import test from "node:test";
import { fishOilBatch, fishOilEvidence, fishOilProduct } from "../src/data/fixtures.js";
import { MemoryDataRepository } from "../src/data/repository.js";
import { getAgentToolAllowlist, TruthPassTools, ToolBoundaryError } from "../src/tools/truthpass-tools.js";
import type { JevRole } from "../src/jev/model.js";
import type { ExecutionEvidence, TaskRequest } from "../src/types.js";
import { evidenceSigningPayload, InMemoryReplayGuard, TrustedIssuerKeyRegistry } from "../src/security/evidence-signatures.js";

async function setup(role: JevRole = "inspection", includeTaskReport = false): Promise<TruthPassTools> {
  const repository = new MemoryDataRepository();
  repository.createProduct(fishOilProduct);
  repository.createBatch(fishOilBatch);
  for (const evidence of fishOilEvidence) await repository.addEvidence(evidence);
  if (includeTaskReport) {
    await repository.addEvidence({
      schemaVersion: "evidence.v1",
      evidenceId: "ev-task-report-001",
      batchId: task.batchId,
      kind: "inspection",
      issuerId: "lab-demo-001",
      sourceKind: "third_party",
      occurredAt: "2026-10-06T10:00:00Z",
      dataMode: "demo/synthetic",
      payload: {
        taskId: task.taskId,
        reportBatchId: task.batchId,
        logisticsGapHours: 2,
        signatureValid: true,
        epaDhaPercent: 78,
        peroxideValue: 2.1,
        totox: 11,
        coldChainGapHours: 2,
      },
    });
    repository.createBatch({ ...fishOilBatch, batchId: "FO-OTHER", fillingBatchId: "FILL-OTHER" });
    await repository.addEvidence({
      schemaVersion: "evidence.v1",
      evidenceId: "ev-task-report-other-batch",
      batchId: "FO-OTHER",
      kind: "inspection",
      issuerId: "lab-demo-001",
      sourceKind: "third_party",
      occurredAt: "2026-10-06T10:00:00Z",
      dataMode: "demo/synthetic",
      payload: {
        taskId: task.taskId,
        reportBatchId: "FO-OTHER",
        logisticsGapHours: 2,
        signatureValid: true,
        epaDhaPercent: 78,
        peroxideValue: 2.1,
        totox: 11,
        coldChainGapHours: 2,
      },
    });
  }
  return new TruthPassTools(repository, role, undefined, true);
}

const task: TaskRequest = {
  taskId: "tool-task",
  serviceKind: "lab",
  capability: "fish-oil-batch-quality-check",
  batchId: "FO-2026-001",
  productionTime: "2026-10-06T08:00:00Z",
  acceptance: { requireSignature: true, policyId: "fish-oil-quality", policyVersion: "v1" },
};

const evidence: ExecutionEvidence = {
  serviceId: "lab-demo-001", taskId: task.taskId, batchId: task.batchId, reportBatchId: task.batchId,
  productionTime: task.productionTime, reportTime: "2026-10-06T10:00:00Z", logisticsGapHours: 2, signatureValid: true,
  epaDhaPercent: 78, peroxideValue: 2.1, totox: 11, coldChainGapHours: 2, payload: { evidenceMode: "demo/synthetic" },
};

test("tools expose role-specific read-only evidence views", async () => {
  const productionTools = await setup("production");
  const production = productionTools.getEvidenceView({ batchId: task.batchId });
  const inspection = (await setup("inspection")).getEvidenceView({ batchId: task.batchId });
  const consumer = (await setup("consumer_feedback")).getEvidenceView({ batchId: task.batchId });

  assert.deepEqual(production.context.evidence.map((item) => item.kind), ["production", "production"]);
  assert.deepEqual(inspection.context.evidence.map((item) => item.kind), ["inspection", "cold_chain"]);
  assert.equal(consumer.context.evidence.length, 4);
  production.context.batch.batchId = "tampered";
  assert.equal(productionTools.getBatch({ batchId: task.batchId }).batchId, task.batchId);
});

test("role is fixed when tools are created and cannot be upgraded per call", async () => {
  const repository = new MemoryDataRepository();
  repository.createProduct(fishOilProduct);
  repository.createBatch(fishOilBatch);
  for (const item of fishOilEvidence) await repository.addEvidence(item);

  const productionTools = new TruthPassTools(repository, "production");
  Object.assign(productionTools, { role: "consumer_feedback" });
  const forgedCall = productionTools.getEvidenceView as unknown as (input: { batchId: string }, role: string) => ReturnType<typeof productionTools.getEvidenceView>;
  const view = forgedCall.call(productionTools, { batchId: task.batchId }, "consumer_feedback");

  assert.deepEqual(view.context.evidence.map((item) => item.kind), ["production", "production"]);
});

test("only the inspection role can invoke deterministic assessment tools", async () => {
  const productionTools = await setup("production");
  const inspectionTools = await setup("inspection", true);
  const consumerTools = await setup("consumer_feedback");

  await assert.rejects(
    () => productionTools.assessProductBatch({ task, evidenceId: "ev-task-report-001" }),
    (error) => error instanceof ToolBoundaryError && error.code === "TOOL_FORBIDDEN",
  );
  await assert.rejects(
    () => consumerTools.verifyServiceExecution({ task, evidenceId: "ev-task-report-001" }),
    (error) => error instanceof ToolBoundaryError && error.code === "TOOL_FORBIDDEN",
  );
  assert.equal((await inspectionTools.assessProductBatch({ task, evidenceId: "ev-task-report-001" })).status, "accepted");
});

test("tools expose approved policy and deterministic rule results", async () => {
  const tools = await setup("inspection", true);
  const policy = tools.getPolicy({ policyId: "fish-oil-quality", policyVersion: "v1" });
  const product = await tools.assessProductBatch({ task, evidenceId: "ev-task-report-001" });

  assert.equal(policy.thresholds.minEpaDhaPercent, 70);
  assert.equal(product.status, "accepted");
  assert.equal(product.policyVersion, policy.version);
});

test("tools fail closed for unknown batches, policies, and mismatched evidence", async () => {
  const tools = await setup("inspection", true);
  assert.throws(() => tools.getBatch({ batchId: "FO-UNKNOWN" }), (error) => error instanceof ToolBoundaryError && error.code === "BATCH_NOT_FOUND");
  assert.throws(() => tools.getPolicy({ policyId: "caller-policy", policyVersion: "v1" }), (error) => error instanceof ToolBoundaryError && error.code === "POLICY_NOT_FOUND");
  await assert.rejects(
    () => tools.verifyServiceExecution({ task, evidenceId: "ev-task-report-other-batch" }),
    (error) => error instanceof ToolBoundaryError && error.code === "BATCH_MISMATCH",
  );
});

test("assessment tools load evidence by registered ID and reject caller-supplied evidence", async () => {
  const tools = await setup("inspection", true);
  const unsafeCall = tools.assessProductBatch as unknown as (input: Record<string, unknown>) => Promise<unknown>;

  await assert.rejects(
    () => unsafeCall.call(tools, { task, evidence }),
    (error) => error instanceof ToolBoundaryError && error.code === "EVIDENCE_NOT_FOUND",
  );
});

test("assessment tools reject unregistered evidence kinds and malformed numeric payloads", async () => {
  const tools = await setup("inspection", true);
  await assert.rejects(
    () => tools.assessProductBatch({ task, evidenceId: "ev-production-001" }),
    (error) => error instanceof ToolBoundaryError && error.code === "EVIDENCE_KIND_INVALID",
  );

  const repository = new MemoryDataRepository();
  repository.createProduct(fishOilProduct);
  repository.createBatch(fishOilBatch);
  await repository.addEvidence({
    schemaVersion: "evidence.v1",
    evidenceId: "ev-malformed-report",
    batchId: task.batchId,
    kind: "inspection",
    issuerId: "lab-demo-001",
    sourceKind: "third_party",
    occurredAt: "2026-10-06T10:00:00Z",
    dataMode: "demo/synthetic",
    payload: { taskId: task.taskId, reportBatchId: task.batchId, logisticsGapHours: Number.NaN, signatureValid: true },
  });
  const malformedTools = new TruthPassTools(repository, "inspection", undefined, true);
  await assert.rejects(
    () => malformedTools.assessProductBatch({ task, evidenceId: "ev-malformed-report" }),
    (error) => error instanceof ToolBoundaryError && error.code === "EVIDENCE_PAYLOAD_INVALID",
  );
});

test("tools reject external evidence without a trusted cryptographic signature", async () => {
  const repository = new MemoryDataRepository();
  repository.createProduct(fishOilProduct);
  repository.createBatch(fishOilBatch);
  await repository.addEvidence({
    schemaVersion: "evidence.v1",
    evidenceId: "ev-external-unverified",
    batchId: task.batchId,
    kind: "inspection",
    issuerId: "external-lab",
    sourceKind: "third_party",
    occurredAt: "2026-10-06T10:00:00Z",
    dataMode: "external",
    payload: { taskId: task.taskId, reportBatchId: task.batchId, logisticsGapHours: 1, signatureValid: true, epaDhaPercent: 99, peroxideValue: 0.1, totox: 1, coldChainGapHours: 1 },
  });
  const tools = new TruthPassTools(repository, "inspection");
  await assert.rejects(
    () => tools.assessProductBatch({ task, evidenceId: "ev-external-unverified" }),
    (error) => error instanceof ToolBoundaryError && error.code === "EVIDENCE_SIGNATURE_INVALID",
  );
});

test("agent tool allowlists are role-scoped and cannot be widened by callers", async () => {
  const productionTools = await setup("production");
  const allowlist = getAgentToolAllowlist("production") as string[];
  allowlist.push("assessProductBatch");
  assert.ok(!getAgentToolAllowlist("production").includes("assessProductBatch" as never));
  assert.throws(
    () => productionTools.getPolicy({ policyId: "fish-oil-quality", policyVersion: "v1" }),
    (error) => error instanceof ToolBoundaryError && error.code === "TOOL_FORBIDDEN",
  );
});

test("demo evidence markers are not trusted unless the server explicitly enables demo mode", async () => {
  const repository = new MemoryDataRepository();
  repository.createProduct(fishOilProduct);
  repository.createBatch(fishOilBatch);
  await repository.addEvidence({
    schemaVersion: "evidence.v1", evidenceId: "ev-untrusted-demo-flag", batchId: task.batchId, kind: "inspection",
    issuerId: "lab-demo-001", sourceKind: "third_party", occurredAt: "2026-10-06T10:00:00Z", dataMode: "demo/synthetic",
    payload: { taskId: task.taskId, reportBatchId: task.batchId, logisticsGapHours: 1, signatureValid: true, epaDhaPercent: 78, peroxideValue: 2, totox: 10, coldChainGapHours: 1 },
  });
  const tools = new TruthPassTools(repository, "inspection");

  await assert.rejects(
    () => tools.assessProductBatch({ task, evidenceId: "ev-untrusted-demo-flag" }),
    (error) => error instanceof ToolBoundaryError && error.code === "EVIDENCE_SIGNATURE_INVALID",
  );
});

test("tools verify external evidence signatures before deterministic assessment", async () => {
  const repository = new MemoryDataRepository();
  repository.createProduct(fishOilProduct);
  repository.createBatch(fishOilBatch);
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const registry = new TrustedIssuerKeyRegistry([{
    issuerId: "trusted-lab", keyId: "trusted-lab-key-1",
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }).toString(),
  }]);
  const evidenceInput = {
    schemaVersion: "evidence.v1" as const, evidenceId: "ev-signed-report", batchId: task.batchId, kind: "inspection" as const,
    issuerId: "trusted-lab", sourceKind: "third_party" as const, occurredAt: "2026-10-06T10:00:00Z", dataMode: "external" as const,
    payload: { taskId: task.taskId, reportBatchId: task.batchId, logisticsGapHours: 1, epaDhaPercent: 78, peroxideValue: 2, totox: 10, coldChainGapHours: 1 },
  };
  const keyId = "trusted-lab-key-1";
  const claims = { keyId, nonce: "d".repeat(32), expiresAt: "2026-12-31T23:59:59Z" };
  const signature = sign(null, Buffer.from(evidenceSigningPayload(evidenceInput, claims)), privateKey).toString("base64");
  await repository.addEvidence({ ...evidenceInput, attestation: { algorithm: "Ed25519", ...claims, signature } });
  const tools = new TruthPassTools(repository, "inspection", registry.resolve, false, new InMemoryReplayGuard());

  const result = await tools.assessProductBatch({ task, evidenceId: evidenceInput.evidenceId });
  assert.equal(result.status, "accepted");
});

test("tools reject a task that disables required service-signature verification", async () => {
  const tools = await setup("inspection", true);
  await assert.rejects(
    () => tools.verifyServiceExecution({
      task: { ...task, acceptance: { ...task.acceptance, requireSignature: false } },
      evidenceId: "ev-task-report-001",
    }),
    (error) => error instanceof ToolBoundaryError && error.code === "TASK_POLICY_INVALID",
  );
});
