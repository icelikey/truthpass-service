import { readFile } from "node:fs/promises";
import { ExternalAgentApi } from "./external-agent-api.js";
import {
  canonicalJson,
  EvidenceGateway,
  signEnvelopeWithHmac,
  type EvidenceEnvelope,
} from "./evidence.js";
import { sha256Hex } from "./hash.js";
import { verifyExecution } from "./verifier.js";
import type { ExecutionEvidence, TaskRequest } from "./types.js";

const source = JSON.parse(
  await readFile(new URL("../examples/fish-oil-real-sourced-production-demo.json", import.meta.url), "utf8"),
) as {
  verifierFixture: { task: TaskRequest; evidence: ExecutionEvidence };
};

async function makeEvent(
  eventId: string,
  eventType: string,
  issuerId: string,
  keyId: string,
  secret: string,
  payload: Record<string, unknown>,
): Promise<EvidenceEnvelope> {
  const envelope: EvidenceEnvelope = {
    envelopeVersion: "evidence-envelope-v1",
    eventId,
    eventType,
    subjectRefs: [{ type: "batch", id: source.verifierFixture.task.batchId }],
    issuer: { type: eventType === "lab_report" ? "lab" : "device", id: issuerId },
    producedByAgent: "edge-gateway-demo",
    observedAt: "2026-10-07T04:20:00Z",
    receivedAt: "2026-10-07T04:20:05Z",
    sequence: 1,
    payload,
    payloadHash: await sha256Hex(canonicalJson(payload)),
    schemaHash: "schema-fish-oil-demo-v1",
    methodId: "simulated-public-source",
    unitSystem: "SI",
    attestationLevel: eventType === "lab_report" ? "lab-signed" : "device-signed",
    keyId,
  };
  envelope.signature = await signEnvelopeWithHmac(envelope, secret);
  return envelope;
}

const gateway = new EvidenceGateway();
gateway.registerKey({
  issuerId: "device-cold-07",
  keyId: "device-cold-07-key",
  attestationLevel: "device-signed",
  secret: "demo-device-secret",
});
gateway.registerKey({
  issuerId: "lab-demo-17025",
  keyId: "lab-demo-17025-key",
  attestationLevel: "lab-signed",
  secret: "demo-lab-secret",
});

const eventResults = [];
eventResults.push(await gateway.ingest(await makeEvent(
  "evt-agent-demo-temp",
  "temperature_reading",
  "device-cold-07",
  "device-cold-07-key",
  "demo-device-secret",
  { temperatureC: 4.2, calibrated: true },
)));
eventResults.push(await gateway.ingest(await makeEvent(
  "evt-agent-demo-lab",
  "lab_report",
  "lab-demo-17025",
  "lab-demo-17025-key",
  "demo-lab-secret",
  { epaDhaPercent: 73, peroxideValue: 2.1, totox: 16 },
)));

const verification = await verifyExecution(
  source.verifierFixture.task,
  source.verifierFixture.evidence,
);
const api = new ExternalAgentApi(gateway);
const report = await api.handle({
  method: "POST",
  path: "/v1/batches/" + source.verifierFixture.task.batchId + "/consumer-report",
  body: {
    requestedChecks: ["temperature_reading", "lab_report"],
    verification,
  },
});

console.log(JSON.stringify({
  simulated: true,
  batchId: source.verifierFixture.task.batchId,
  ingested: eventResults.map((result) => ({
    status: result.validation.status,
    eventId: result.envelope.eventId,
    evidenceHash: result.validation.eventHash,
  })),
  verification: {
    status: verification.status,
    score: verification.score,
    evidenceHash: verification.evidenceHash,
  },
  consumerReport: report.body,
}, null, 2));

