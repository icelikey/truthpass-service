import { sha256Hex } from "./hash.js";

export type AttestationLevel = "supplier-declared" | "device-signed" | "lab-signed";
export type EvidenceIngestStatus = "accepted" | "review" | "rejected";

export interface SubjectRef {
  type: "batch" | "sample" | "device" | "equipment" | "shipment" | "order";
  id: string;
}

export interface EvidenceIssuer {
  type: "supplier" | "factory" | "device" | "lab" | "carrier" | "consumer";
  id: string;
}

export interface EvidenceEnvelope {
  envelopeVersion: string;
  eventId: string;
  eventType: string;
  subjectRefs: SubjectRef[];
  parentEventIds?: string[];
  issuer: EvidenceIssuer;
  producedByAgent: string;
  observedAt: string;
  receivedAt: string;
  sequence?: number;
  previousEventHash?: string;
  payload?: Record<string, unknown>;
  payloadUri?: string;
  payloadHash: string;
  schemaHash: string;
  methodId?: string;
  unitSystem?: string;
  attestationLevel: AttestationLevel;
  keyId?: string;
  signature?: string;
  qualityFlags?: string[];
}

export interface EvidencePrincipalKey {
  issuerId: string;
  keyId: string;
  attestationLevel: AttestationLevel;
  secret: string;
}

export interface EvidenceValidation {
  status: EvidenceIngestStatus;
  eventHash: string;
  reasons: string[];
  checks: Record<string, boolean>;
}

export interface StoredEvidence {
  envelope: EvidenceEnvelope;
  validation: EvidenceValidation;
  storedAt: string;
}

export interface ConsumerEvidenceView {
  eventId: string;
  eventType: string;
  batchId: string;
  sourceClass: EvidenceIssuer["type"];
  attestationLevel: AttestationLevel;
  observedAt: string;
  status: "verified" | "failed" | "missing" | "restricted" | "not_covered" | "review";
  evidenceHash: string;
  reasons: string[];
  payload?: Record<string, unknown>;
}

export interface ConsumerEvidenceReport {
  batchId: string;
  status: "accepted" | "accepted_with_scope" | "review" | "rejected";
  scope: string[];
  checks: Record<string, "pass" | "fail" | "review" | "not_covered">;
  evidence: ConsumerEvidenceView[];
  missing: string[];
  conflicts: string[];
  nextAction: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (!isRecord(value)) return value;
  return Object.keys(value).sort().reduce<Record<string, unknown>>((result, key) => {
    result[key] = sortValue(value[key]);
    return result;
  }, {});
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function base64Url(bytes: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return Buffer.from(binary, "binary").toString("base64url");
}

function envelopeForSigning(envelope: EvidenceEnvelope): string {
  const { signature: _signature, ...unsigned } = envelope;
  return canonicalJson(unsigned);
}

export async function signEnvelopeWithHmac(
  envelope: EvidenceEnvelope,
  secret: string,
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(envelopeForSigning(envelope)),
  );
  return base64Url(signature);
}

async function verifyEnvelopeHmac(
  envelope: EvidenceEnvelope,
  secret: string,
): Promise<boolean> {
  const expected = await signEnvelopeWithHmac(envelope, secret);
  return expected === envelope.signature;
}

function parseTime(value: string): number {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

function batchIdOf(envelope: EvidenceEnvelope): string | undefined {
  return envelope.subjectRefs.find((ref) => ref.type === "batch")?.id;
}

function keyFor(envelope: EvidenceEnvelope): string {
  return [
    envelope.issuer.id,
    envelope.keyId ?? "no-key",
    batchIdOf(envelope) ?? "no-batch",
  ].join(":");
}

export class EvidenceGateway {
  private readonly keys = new Map<string, EvidencePrincipalKey>();
  private readonly events = new Map<string, StoredEvidence>();
  private readonly lastByStream = new Map<string, { sequence: number; eventHash: string }>();
  private readonly payloadHashes = new Set<string>();

  registerKey(input: EvidencePrincipalKey): void {
    this.keys.set(input.issuerId + ":" + input.keyId, input);
  }

  async ingest(envelope: EvidenceEnvelope): Promise<StoredEvidence> {
    const eventHash = await sha256Hex(canonicalJson(envelope));
    const existing = this.events.get(envelope.eventId);
    if (existing) {
      if (existing.validation.eventHash === eventHash) return existing;
      return this.store(envelope, {
        status: "rejected",
        eventHash,
        reasons: ["event_id_conflict"],
        checks: { eventIdUnique: false },
      });
    }

    const checks: Record<string, boolean> = {
      eventIdPresent: envelope.eventId.length > 0,
      subjectPresent: envelope.subjectRefs.length > 0,
      issuerPresent: envelope.issuer.id.length > 0,
      eventTimeValid: Number.isFinite(parseTime(envelope.observedAt)),
      receivedTimeValid: Number.isFinite(parseTime(envelope.receivedAt)),
      eventBeforeReceipt: parseTime(envelope.observedAt) <= parseTime(envelope.receivedAt),
      payloadHashValid: envelope.payload === undefined ||
        envelope.payloadHash === await sha256Hex(canonicalJson(envelope.payload)),
      schemaPresent: envelope.schemaHash.length > 0,
    };
    const reasons: string[] = [];
    if (!checks.eventIdPresent) reasons.push("event_id_missing");
    if (!checks.subjectPresent) reasons.push("subject_missing");
    if (!checks.issuerPresent) reasons.push("issuer_missing");
    if (!checks.eventTimeValid || !checks.receivedTimeValid) reasons.push("invalid_timestamp");
    if (!checks.eventBeforeReceipt) reasons.push("observed_after_received");
    if (!checks.payloadHashValid) reasons.push("payload_hash_mismatch");
    if (!checks.schemaPresent) reasons.push("schema_hash_missing");

    const key = envelope.keyId === undefined
      ? undefined
      : this.keys.get(envelope.issuer.id + ":" + envelope.keyId);
    checks.keyRegistered = envelope.keyId === undefined || key !== undefined;
    if (!checks.keyRegistered) reasons.push("key_not_registered");

    checks.signatureValid = envelope.attestationLevel === "supplier-declared"
      ? envelope.signature === undefined || key === undefined
        ? true
        : await verifyEnvelopeHmac(envelope, key.secret)
      : key !== undefined &&
        envelope.signature !== undefined &&
        await verifyEnvelopeHmac(envelope, key.secret);
    if (!checks.signatureValid) reasons.push("signature_invalid");

    const streamKey = keyFor(envelope);
    const previous = this.lastByStream.get(streamKey);
    checks.sequenceContinuous = envelope.sequence === undefined
      ? true
      : previous === undefined
        ? envelope.sequence > 0
        : envelope.sequence === previous.sequence + 1 &&
          envelope.previousEventHash === previous.eventHash;
    if (!checks.sequenceContinuous) reasons.push("sequence_gap_or_previous_hash_mismatch");

    checks.replayFree = !this.payloadHashes.has(envelope.payloadHash);
    if (!checks.replayFree) reasons.push("payload_replay_detected");

    const structuralPass = Object.entries(checks)
      .filter(([name]) => name !== "signatureValid" && name !== "replayFree")
      .every(([, value]) => value);
    let status: EvidenceIngestStatus = structuralPass && checks.signatureValid && checks.replayFree
      ? "accepted"
      : "rejected";
    if (status === "accepted" && envelope.attestationLevel === "supplier-declared") {
      status = "review";
      reasons.push("supplier_declared_requires_independent_confirmation");
    }

    const stored = await this.store(envelope, { status, eventHash, reasons, checks });
    if (status === "accepted") {
      this.lastByStream.set(streamKey, {
        sequence: envelope.sequence ?? (previous?.sequence ?? 0) + 1,
        eventHash,
      });
    }
    if ((status === "accepted" || status === "review") && checks.payloadHashValid) {
      this.payloadHashes.add(envelope.payloadHash);
    }
    return stored;
  }

  private async store(envelope: EvidenceEnvelope, validation: EvidenceValidation): Promise<StoredEvidence> {
    const stored = {
      envelope,
      validation,
      storedAt: new Date().toISOString(),
    };
    this.events.set(envelope.eventId, stored);
    return stored;
  }

  listForBatch(batchId: string, options: { allowRaw?: boolean } = {}): ConsumerEvidenceView[] {
    return [...this.events.values()]
      .filter((stored) => batchIdOf(stored.envelope) === batchId)
      .map((stored) => {
        const status = stored.validation.status === "accepted"
          ? "verified"
          : stored.validation.status === "review"
            ? "review"
            : "failed";
        const view: ConsumerEvidenceView = {
          eventId: stored.envelope.eventId,
          eventType: stored.envelope.eventType,
          batchId,
          sourceClass: stored.envelope.issuer.type,
          attestationLevel: stored.envelope.attestationLevel,
          observedAt: stored.envelope.observedAt,
          status,
          evidenceHash: stored.validation.eventHash,
          reasons: stored.validation.reasons,
        };
        if (options.allowRaw && stored.envelope.payload !== undefined) {
          view.payload = stored.envelope.payload;
        }
        return view;
      });
  }

  getRaw(eventId: string): EvidenceEnvelope | undefined {
    return this.events.get(eventId)?.envelope;
  }
}

export function buildConsumerEvidenceReport(
  batchId: string,
  verification: {
    status: "accepted" | "rejected" | "partial";
    checks: Record<string, boolean>;
    reasons: string[];
  },
  evidence: ConsumerEvidenceView[],
  requestedChecks: string[],
): ConsumerEvidenceReport {
  const checks = Object.fromEntries(
    Object.entries(verification.checks).map(([key, passed]) => [
      key,
      passed ? "pass" : "fail",
    ]),
  ) as ConsumerEvidenceReport["checks"];
  const missing = requestedChecks.filter((check) =>
    !evidence.some((item) => item.eventType === check && item.status === "verified"),
  );
  const conflicts = evidence
    .flatMap((item) => item.reasons.filter((reason) =>
      reason.includes("mismatch") || reason.includes("conflict") || reason.includes("replay"),
    ));
  const hasReview = evidence.some((item) => item.status === "review");
  const status = verification.status === "rejected"
    ? "rejected"
    : hasReview || missing.length > 0
      ? "review"
      : verification.status === "partial"
        ? "accepted_with_scope"
        : "accepted";
  return {
    batchId,
    status,
    scope: requestedChecks,
    checks,
    evidence,
    missing,
    conflicts,
    nextAction: status === "accepted"
      ? "可在当前声明范围内继续；如需扩大范围，请请求未覆盖证据"
      : status === "rejected"
        ? "暂停购买或启动复检"
        : "补充证据或发起独立复检",
  };
}

