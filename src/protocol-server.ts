import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { verifyEvidenceEnvelope, type EvidenceEnvelope, type IssuerKeyRecord } from "./evidence.js";
import { buildJevState, DeterministicDecisionGate } from "./jev/context.js";
import { verifyExecution } from "./verifier.js";
import type { ExecutionEvidence, TaskRequest } from "./types.js";

export const PROTOCOL_VERSION = "truthpass-iot-protocol-v1" as const;

export interface ProtocolIngestRequest {
  protocolVersion?: typeof PROTOCOL_VERSION;
  envelope: EvidenceEnvelope;
  payload?: unknown;
  publicKey?: string;
}

export interface ProtocolRecord {
  protocolVersion: typeof PROTOCOL_VERSION;
  receivedAt: string;
  batchId: string;
  eventId: string;
  envelopeHash: string;
  payloadHash: string;
  issuerId: string;
  keyId: string;
  status: "accepted";
}

export interface ProtocolStoreOptions {
  path?: string;
  keyRegistry?: Iterable<IssuerKeyRecord>;
}

/** Append-only protocol store. Replace this with a database adapter in production. */
export class ProtocolStore {
  private readonly records = new Map<string, ProtocolRecord>();
  private readonly ledgers = new Map<string, { lastSequence?: number; lastEventHash?: string; seenEventIds: Set<string>; seenNonces: Set<string> }>();
  private readonly keys = new Map<string, IssuerKeyRecord>();
  private readonly path?: string;

  constructor(options: ProtocolStoreOptions = {}) {
    this.path = options.path;
    for (const key of options.keyRegistry ?? []) this.keys.set(key.keyId, key);
  }

  registerKey(key: IssuerKeyRecord): void { this.keys.set(key.keyId, key); }
  getKeyRegistry(): Map<string, IssuerKeyRecord> { return this.keys; }
  getRecords(batchId: string): ProtocolRecord[] { return [...this.records.values()].filter((record) => record.batchId === batchId); }

  async append(record: ProtocolRecord, sequence: number, previousEventHash: string | null, nonce: string): Promise<void> {
    if (this.records.has(record.eventId)) {
      const existing = this.records.get(record.eventId);
      if (existing?.envelopeHash !== record.envelopeHash) throw new Error("eventId 已存在但内容不一致");
      return;
    }
    const ledger = this.ledgers.get(record.batchId) ?? { seenEventIds: new Set<string>(), seenNonces: new Set<string>() };
    if (ledger.seenNonces.has(nonce)) throw new Error("nonce 已被重放");
    if (ledger.lastSequence !== undefined && sequence !== ledger.lastSequence + 1) throw new Error("sequence 不是按批次连续递增");
    if (ledger.lastSequence !== undefined && ledger.lastEventHash !== previousEventHash) throw new Error("previousEventHash 未连接到上一事件");
    this.records.set(record.eventId, record);
    ledger.lastSequence = sequence;
    ledger.lastEventHash = record.envelopeHash;
    ledger.seenEventIds.add(record.eventId);
    ledger.seenNonces.add(nonce);
    this.ledgers.set(record.batchId, ledger);
    if (this.path) {
      await mkdir(dirname(this.path), { recursive: true });
      await appendFile(this.path, JSON.stringify(record) + "\n", "utf8");
    }
  }
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(body));
}

async function body(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  if (Buffer.concat(chunks).length > 2_000_000) throw new Error("request body too large");
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function batchIdOf(envelope: EvidenceEnvelope): string | undefined {
  return envelope.subjectRefs.find((subject) => subject.type === "batch")?.id;
}

export function createProtocolServer(store = new ProtocolStore()): ReturnType<typeof createServer> {
  return createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? "/", "http://localhost");
      if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { status: "ok", protocolVersion: PROTOCOL_VERSION });
      if (request.method === "POST" && url.pathname === "/v1/issuers") {
        const input = await body(request) as IssuerKeyRecord;
        if (!input?.issuerId || !input.keyId || !input.publicKey) return json(response, 400, { error: "issuerId、keyId、publicKey 必填" });
        store.registerKey(input);
        return json(response, 201, { status: "registered", issuerId: input.issuerId, keyId: input.keyId });
      }
      if (request.method === "POST" && url.pathname === "/v1/evidence") {
        const input = await body(request) as ProtocolIngestRequest;
        const envelope = input?.envelope;
        const batchId = envelope && batchIdOf(envelope);
        if (!envelope || !batchId) return json(response, 400, { error: "envelope 和 batch subject 必填" });
        const key = store.getKeyRegistry().get(envelope.keyId);
        const validation = verifyEvidenceEnvelope(envelope, { keyRegistry: store.getKeyRegistry(), payload: input.payload, expectedBatchId: batchId, publicKey: input.publicKey ?? key?.publicKey });
        if (!validation.valid) return json(response, 422, { status: "rejected", errors: validation.errors, warnings: validation.warnings });
        const record: ProtocolRecord = { protocolVersion: PROTOCOL_VERSION, receivedAt: new Date().toISOString(), batchId, eventId: envelope.eventId, envelopeHash: validation.envelopeHash, payloadHash: validation.payloadHash, issuerId: envelope.issuer.id, keyId: envelope.keyId, status: "accepted" };
        await store.append(record, envelope.sequence, envelope.previousEventHash ?? null, envelope.nonce);
        return json(response, 202, { status: "accepted", record, next: "route_to_jev_and_rule_verifier" });
      }
      if (request.method === "POST" && url.pathname === "/v1/verify") {
        const input = await body(request) as { task: TaskRequest; evidence: ExecutionEvidence | ExecutionEvidence[] };
        if (!input?.task || !input.evidence) return json(response, 400, { error: "task 和 evidence 必填" });
        const jevState = buildJevState(input.task, input.evidence);
        const jev = await new DeterministicDecisionGate().decide(jevState);
        const execution = Array.isArray(input.evidence) ? input.evidence[0] : input.evidence;
        const result = await verifyExecution(input.task, execution, { jevDecision: jev });
        return json(response, 200, { protocolVersion: PROTOCOL_VERSION, status: "verified", jev, result, chainAction: result.status === "accepted" || result.status === "accepted_with_scope" ? "prepare_anchor_and_verification" : "hold_for_review" });
      }
      const match = url.pathname.match(/^\/v1\/batches\/([^/]+)\/evidence$/);
      if (request.method === "GET" && match) return json(response, 200, { protocolVersion: PROTOCOL_VERSION, batchId: decodeURIComponent(match[1]), records: store.getRecords(decodeURIComponent(match[1])) });
      return json(response, 404, { error: "not found" });
    } catch (error) {
      return json(response, 400, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

if (process.argv[1]?.endsWith("protocol-server.ts")) {
  const port = Number(process.env.TRUTHPASS_PROTOCOL_PORT ?? 8787);
  createProtocolServer(new ProtocolStore({ path: process.env.TRUTHPASS_PROTOCOL_STORE ?? "data/protocol-events.jsonl" })).listen(port, "0.0.0.0", () => console.log(`TruthPass protocol server listening on ${port}`));
}
