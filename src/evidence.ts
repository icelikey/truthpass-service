import { createHash, createPrivateKey, createPublicKey, sign, verify, type KeyObject } from "node:crypto";

/** Versioned event schema used by the chain adapter and every Agent. */
export const EVIDENCE_ENVELOPE_VERSION = "evidence-envelope-v1" as const;

export type EvidenceEventType =
  | "lab_report"
  | "production_step"
  | "cold_chain_reading"
  | "material_receipt"
  | "handoff"
  | "delivery"
  | "disclosure_event"
  | "consumer_feedback"
  | (string & {});

export type EvidenceIssuerType = "lab" | "device" | "supplier" | "factory" | "carrier" | "consumer" | (string & {});
export type EvidenceAttestationLevel = "device-signed" | "lab-signed" | "supplier-declared" | "consumer-signed" | (string & {});
export type EvidenceStatus = "valid" | "partial" | "invalid" | "revoked" | "disputed";

export interface EvidenceSubjectRef {
  type: string;
  id: string;
}

export interface EvidenceIssuer {
  type: EvidenceIssuerType;
  id: string;
}

export interface EvidenceCollector {
  gatewayId: string;
}

export interface EvidenceMethod {
  id: string;
  version: string;
  units?: Record<string, string>;
}

export interface EvidenceDisclosure {
  public: string[];
  restricted?: string[];
  retentionClass?: string;
}

export interface EvidenceEnvelope {
  envelopeVersion: typeof EVIDENCE_ENVELOPE_VERSION;
  eventId: string;
  eventType: EvidenceEventType;
  /** The newer graph form. `subject` is accepted by the normalizer for old fixtures. */
  subjectRefs: EvidenceSubjectRef[];
  parentEventIds?: string[];
  issuer: EvidenceIssuer;
  collector?: EvidenceCollector;
  producedByAgent: string;
  observedAt: string;
  receivedAt?: string;
  sequence: number;
  previousEventHash?: string | null;
  nonce: string;
  payloadUri?: string;
  payloadHash: string;
  schemaHash: string;
  method?: EvidenceMethod;
  attestationLevel: EvidenceAttestationLevel;
  keyId: string;
  signature: string;
  qualityFlags?: string[];
  disclosure?: EvidenceDisclosure;
  status: EvidenceStatus;
  /** Kept out of the signed/hash payload in production; useful only for local verification. */
  subject?: EvidenceSubjectRef;
}

export interface EvidenceEnvelopeInput extends Omit<EvidenceEnvelope, "envelopeVersion" | "payloadHash" | "schemaHash" | "signature" | "subjectRefs"> {
  envelopeVersion?: typeof EVIDENCE_ENVELOPE_VERSION;
  subjectRefs?: EvidenceSubjectRef[];
  subject?: EvidenceSubjectRef;
  payload: unknown;
  schema?: unknown;
  privateKey?: string | Uint8Array | KeyObject;
}

export interface IssuerKeyRecord {
  issuerId: string;
  keyId: string;
  publicKey: string | Uint8Array | KeyObject;
  algorithm?: "ed25519";
  status?: "active" | "revoked" | "expired";
  validFrom?: string;
  validTo?: string;
}

export interface EvidenceLedgerState {
  lastSequence?: number;
  lastEventHash?: string;
  seenEventIds?: Set<string>;
  seenNonces?: Set<string>;
}

export interface EvidenceValidationOptions {
  keyRegistry?: Iterable<IssuerKeyRecord> | Map<string, IssuerKeyRecord>;
  publicKey?: string | Uint8Array | KeyObject;
  payload?: unknown;
  expectedIssuerId?: string;
  expectedBatchId?: string;
  ledger?: EvidenceLedgerState;
  /** Require a signature even when the key registry is not provided. Defaults true. */
  requireSignature?: boolean;
  now?: string;
}

export interface EvidenceValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  payloadHash: string;
  envelopeHash: string;
  issuerKey?: IssuerKeyRecord;
}

/**
 * A small RFC-8785-style canonical JSON encoder. Object keys are sorted
 * recursively, arrays retain their order, and undefined object members are
 * omitted like JSON.stringify. It is deliberately dependency-free so another
 * language can reproduce the same hashes for the demo.
 */
export function canonicalizeJson(value: unknown): string {
  const encode = (input: unknown, inArray = false): string | undefined => {
    if (input === null) return "null";
    if (typeof input === "string") return JSON.stringify(input);
    if (typeof input === "boolean") return input ? "true" : "false";
    if (typeof input === "number") {
      if (!Number.isFinite(input)) throw new TypeError("规范化 JSON 不允许 NaN 或 Infinity");
      return JSON.stringify(input);
    }
    if (typeof input === "bigint") throw new TypeError("规范化 JSON 不支持 bigint");
    if (typeof input === "undefined" || typeof input === "function" || typeof input === "symbol") {
      return inArray ? "null" : undefined;
    }
    if (Array.isArray(input)) {
      return `[${input.map((item) => encode(item, true) ?? "null").join(",")}]`;
    }
    if (typeof input === "object") {
      const entries = Object.entries(input as Record<string, unknown>)
        .filter(([, item]) => item !== undefined && typeof item !== "function" && typeof item !== "symbol")
        .sort(([a], [b]) => a.localeCompare(b));
      return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${encode(item)}`).join(",")}}`;
    }
    throw new TypeError(`无法规范化值类型: ${typeof input}`);
  };
  const encoded = encode(value);
  if (encoded === undefined) throw new TypeError("根值不能是 undefined");
  return encoded;
}

function hashBytes(bytes: Uint8Array): string {
  return `0x${createHash("sha256").update(bytes).digest("hex")}`;
}

export function sha256Canonical(value: unknown): string {
  return hashBytes(Buffer.from(canonicalizeJson(value), "utf8"));
}

export const canonicalHash = sha256Canonical;

function decodeBytes(value: string | Uint8Array): Buffer {
  if (value instanceof Uint8Array) return Buffer.from(value);
  const trimmed = value.trim();
  if (/^(0x)?[0-9a-f]+$/i.test(trimmed) && trimmed.replace(/^0x/i, "").length % 2 === 0) {
    return Buffer.from(trimmed.replace(/^0x/i, ""), "hex");
  }
  return Buffer.from(trimmed, "base64");
}

function asPublicKey(value: string | Uint8Array | KeyObject): KeyObject {
  if (typeof value !== "string" && !(value instanceof Uint8Array)) return value;
  if (typeof value === "string" && value.includes("BEGIN")) return createPublicKey(value);
  const raw = decodeBytes(value);
  if (raw.length !== 32) throw new Error("Ed25519 原始公钥必须为 32 字节，或提供 PEM 公钥");
  // SubjectPublicKeyInfo prefix for Ed25519 (RFC 8410).
  return createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), raw]), format: "der", type: "spki" });
}

function asPrivateKey(value: string | Uint8Array | KeyObject): KeyObject {
  if (typeof value !== "string" && !(value instanceof Uint8Array)) return value;
  if (typeof value === "string" && value.includes("BEGIN")) return createPrivateKey(value);
  const raw = decodeBytes(value);
  // PKCS#8 prefix for a 32-byte Ed25519 seed.
  const der = raw.length === 32 ? Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), raw]) : raw;
  return createPrivateKey({ key: der, format: "der", type: "pkcs8" });
}

function unsignedEnvelope(envelope: EvidenceEnvelope): Record<string, unknown> {
  const copy = { ...envelope } as Record<string, unknown>;
  delete copy.signature;
  // Alias is an input convenience and must never create a second signed subject.
  delete copy.subject;
  return copy;
}

export function envelopeSigningBytes(envelope: EvidenceEnvelope): Buffer {
  return Buffer.from(canonicalizeJson(unsignedEnvelope(envelope)), "utf8");
}

export function signEvidenceEnvelope(envelope: EvidenceEnvelope, privateKey: string | Uint8Array | KeyObject): string {
  return `0x${sign(null, envelopeSigningBytes(envelope), asPrivateKey(privateKey)).toString("hex")}`;
}

export function verifyEd25519Signature(
  payload: string | Uint8Array,
  signature: string | Uint8Array,
  publicKey: string | Uint8Array | KeyObject,
): boolean {
  try {
    return verify(null, Buffer.from(payload), asPublicKey(publicKey), decodeBytes(signature));
  } catch {
    return false;
  }
}

export function verifyEvidenceEnvelopeSignature(envelope: EvidenceEnvelope, publicKey: string | Uint8Array | KeyObject): boolean {
  return verifyEd25519Signature(envelopeSigningBytes(envelope), envelope.signature, publicKey);
}

function parseTime(value: string | undefined): number | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/.test(value)) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function keyFromRegistry(
  envelope: EvidenceEnvelope,
  registry?: Iterable<IssuerKeyRecord> | Map<string, IssuerKeyRecord>,
): IssuerKeyRecord | undefined {
  if (!registry) return undefined;
  if (registry instanceof Map) return registry.get(envelope.keyId);
  return [...registry].find((entry) => entry.keyId === envelope.keyId);
}

function hashLooksValid(value: string | undefined): boolean {
  return typeof value === "string" && /^(?:0x)?[0-9a-f]{64}$/i.test(value);
}

/** Normalize aliases and values before signing, persisting or hashing. */
export function normalizeEvidenceEnvelope(input: EvidenceEnvelope | (Partial<EvidenceEnvelope> & { subject?: EvidenceSubjectRef })): EvidenceEnvelope {
  const subjectRefs = input.subjectRefs?.length ? input.subjectRefs : input.subject ? [input.subject] : [];
  const normalized: EvidenceEnvelope = {
    envelopeVersion: EVIDENCE_ENVELOPE_VERSION,
    eventId: String(input.eventId ?? ""),
    eventType: (input.eventType ?? "") as EvidenceEventType,
    subjectRefs: subjectRefs.map((subject) => ({ type: String(subject.type), id: String(subject.id) })),
    parentEventIds: input.parentEventIds?.map(String),
    issuer: { type: String(input.issuer?.type ?? ""), id: String(input.issuer?.id ?? "") },
    collector: input.collector ? { gatewayId: String(input.collector.gatewayId) } : undefined,
    producedByAgent: String(input.producedByAgent ?? ""),
    observedAt: String(input.observedAt ?? ""),
    receivedAt: input.receivedAt === undefined ? undefined : String(input.receivedAt),
    sequence: Number(input.sequence),
    previousEventHash: input.previousEventHash ?? null,
    nonce: String(input.nonce ?? ""),
    payloadUri: input.payloadUri,
    payloadHash: String(input.payloadHash ?? ""),
    schemaHash: String(input.schemaHash ?? ""),
    method: input.method,
    attestationLevel: (input.attestationLevel ?? "supplier-declared") as EvidenceAttestationLevel,
    keyId: String(input.keyId ?? ""),
    signature: String(input.signature ?? ""),
    qualityFlags: input.qualityFlags?.map(String),
    disclosure: input.disclosure,
    status: (input.status ?? "valid") as EvidenceStatus,
  };
  return JSON.parse(canonicalizeJson(normalized)) as EvidenceEnvelope;
}

/** Create a signed envelope from a payload; useful for gateways and tests. */
export function createEvidenceEnvelope(input: EvidenceEnvelopeInput): EvidenceEnvelope {
  const subjectRefs = input.subjectRefs?.length ? input.subjectRefs : input.subject ? [input.subject] : [];
  const envelope = normalizeEvidenceEnvelope({
    ...input,
    subjectRefs,
    payloadHash: sha256Canonical(input.payload),
    schemaHash: sha256Canonical(input.schema ?? { envelopeVersion: EVIDENCE_ENVELOPE_VERSION }),
    signature: "",
  });
  if (input.privateKey) envelope.signature = signEvidenceEnvelope(envelope, input.privateKey);
  return envelope;
}

export function computeEnvelopeHash(envelope: EvidenceEnvelope): string {
  return sha256Canonical(envelope);
}

/** Stable root for a batch graph. Sorting prevents insertion order changing the commitment. */
export function computeEvidenceRoot(envelopes: EvidenceEnvelope[]): string {
  const leaves = [...envelopes]
    .sort((a, b) => a.eventId.localeCompare(b.eventId))
    .map((event) => ({ eventId: event.eventId, payloadHash: event.payloadHash }));
  return sha256Canonical(leaves);
}

export function verifyEvidenceEnvelope(
  rawEnvelope: EvidenceEnvelope | (Partial<EvidenceEnvelope> & { subject?: EvidenceSubjectRef }),
  options: EvidenceValidationOptions = {},
): EvidenceValidationResult {
  const envelope = normalizeEvidenceEnvelope(rawEnvelope);
  const errors: string[] = [];
  const warnings: string[] = [];
  const observedAt = parseTime(envelope.observedAt);
  const receivedAt = envelope.receivedAt === undefined ? undefined : parseTime(envelope.receivedAt);
  const now = options.now ? parseTime(options.now) ?? Date.now() : Date.now();

  if (envelope.envelopeVersion !== EVIDENCE_ENVELOPE_VERSION) errors.push("未知的 evidence envelope 版本");
  if (!envelope.eventId) errors.push("缺少 eventId");
  if (!envelope.eventType) errors.push("缺少 eventType");
  if (!envelope.subjectRefs.length) errors.push("缺少批次或样品 subjectRefs");
  if (!envelope.issuer.id) errors.push("缺少 issuer");
  if (!envelope.producedByAgent) errors.push("缺少 producedByAgent");
  if (observedAt === undefined) errors.push("observedAt 必须是 UTC ISO 8601 时间");
  if (receivedAt === undefined && envelope.receivedAt !== undefined) errors.push("receivedAt 必须是 UTC ISO 8601 时间");
  if (!Number.isSafeInteger(envelope.sequence) || envelope.sequence < 0) errors.push("sequence 必须是非负整数");
  if (!envelope.keyId) errors.push("缺少 keyId");
  if (!hashLooksValid(envelope.payloadHash)) errors.push("payloadHash 格式无效");
  if (!hashLooksValid(envelope.schemaHash)) errors.push("schemaHash 格式无效");
  if (!envelope.nonce && !(envelope as unknown as { nonce?: string }).nonce) errors.push("缺少 nonce");
  if (!["valid", "partial", "invalid", "revoked", "disputed"].includes(envelope.status)) errors.push("未知 evidence status");

  const batch = envelope.subjectRefs.find((subject) => subject.type === "batch");
  if (options.expectedBatchId && batch?.id !== options.expectedBatchId) errors.push("证据批次与任务批次不一致");
  if (options.expectedIssuerId && envelope.issuer.id !== options.expectedIssuerId) errors.push("证据 issuer 与预期主体不一致");
  if (envelope.status === "revoked") errors.push("证据已撤销");
  if (envelope.status === "invalid") errors.push("证据已标记为无效");
  if (envelope.status === "disputed") warnings.push("证据处于争议状态");

  if (envelope.sequence === 0 && envelope.previousEventHash) warnings.push("首个事件包含 previousEventHash，将按提供值保留");
  if (envelope.sequence > 0 && !envelope.previousEventHash) errors.push("非首个事件必须提供 previousEventHash");
  if (options.ledger) {
    const ledger = options.ledger;
    if (ledger.seenEventIds?.has(envelope.eventId)) errors.push("eventId 已被重放");
    const nonce = (envelope as unknown as { nonce?: string }).nonce;
    if (nonce && ledger.seenNonces?.has(nonce)) errors.push("nonce 已被重放");
    if (ledger.lastSequence !== undefined) {
      if (envelope.sequence !== ledger.lastSequence + 1) errors.push("sequence 不是连续递增值");
      if (ledger.lastEventHash && envelope.previousEventHash !== ledger.lastEventHash) errors.push("previousEventHash 未连接到前一事件");
    }
  }

  if (observedAt !== undefined && receivedAt !== undefined && receivedAt < observedAt) errors.push("receivedAt 早于 observedAt");
  if (observedAt !== undefined && observedAt > now + 5 * 60_000) errors.push("observedAt 超出允许的未来时钟偏差");
  const key = keyFromRegistry(envelope, options.keyRegistry);
  if (options.keyRegistry && !key) errors.push("issuer key 未注册");
  if (key) {
    if (key.issuerId !== envelope.issuer.id) errors.push("issuer key 与 issuer 不匹配");
    if (key.status && key.status !== "active") errors.push("issuer key 已吊销或过期");
    const validFrom = key.validFrom ? parseTime(key.validFrom) : undefined;
    const validTo = key.validTo ? parseTime(key.validTo) : undefined;
    if (key.validFrom && validFrom === undefined) errors.push("issuer key validFrom 无效");
    if (key.validTo && validTo === undefined) errors.push("issuer key validTo 无效");
    if (observedAt !== undefined && validFrom !== undefined && observedAt < validFrom) errors.push("证据发生时 issuer key 尚未生效");
    if (observedAt !== undefined && validTo !== undefined && observedAt > validTo) errors.push("证据发生时 issuer key 已过期");
  }
  const verificationKey = options.publicKey ?? key?.publicKey;
  if (options.requireSignature !== false && !envelope.signature) errors.push("缺少证据签名");
  if (envelope.signature && verificationKey && !verifyEvidenceEnvelopeSignature(envelope, verificationKey)) errors.push("证据签名验证失败");
  if (envelope.signature && !verificationKey) warnings.push("未提供 issuer 公钥，未执行密码学验签");
  if (options.payload !== undefined && sha256Canonical(options.payload).toLowerCase() !== envelope.payloadHash.toLowerCase()) errors.push("payloadHash 与原始 payload 不一致");

  const nonce = (envelope as unknown as { nonce?: string }).nonce;
  if (nonce && typeof nonce !== "string") errors.push("nonce 必须是字符串");
  return {
    valid: errors.length === 0,
    errors,
    warnings,
    payloadHash: envelope.payloadHash,
    envelopeHash: computeEnvelopeHash(envelope),
    issuerKey: key,
  };
}

/** Apply a validated event to a local replay ledger. */
export function appendEvidenceToLedger(state: EvidenceLedgerState, envelope: EvidenceEnvelope, result?: EvidenceValidationResult): EvidenceValidationResult {
  const validation = result ?? verifyEvidenceEnvelope(envelope, { ledger: state });
  if (!validation.valid) return validation;
  state.lastSequence = envelope.sequence;
  state.lastEventHash = validation.envelopeHash;
  (state.seenEventIds ??= new Set()).add(envelope.eventId);
  const nonce = (envelope as unknown as { nonce?: string }).nonce;
  if (nonce) (state.seenNonces ??= new Set()).add(nonce);
  return validation;
}
