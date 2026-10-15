import { sha256Canonical } from "../evidence.js";
import { answerConsumerQuestion, type ConsumerAnswer, type ConsumerEvidenceFact, type ConsumerEvidenceSnapshot } from "../agents/consumer-assistant.js";
import { getDatabasePool, persistenceEnabled } from "../data/persistence.js";
import { validateEvidence } from "../data/validation.js";
import type { EvidenceAttestation, EvidenceKind, NewEvidenceRecord, SourceKind } from "../data/model.js";
import { verifyEvidenceAttestation, type TrustedIssuerKeyResolver } from "../security/evidence-signatures.js";

export type EnterpriseEvidenceEnvelope = NewEvidenceRecord & {
  tenantId: string;
  brandId: string;
  productId: string;
  sampleId?: string;
  rawObjectRef?: string;
};

export type EnterpriseEvidenceRecord = EnterpriseEvidenceEnvelope & {
  payloadHash: string;
  status: "submitted" | "revoked";
  createdAt: string;
};

export type EnterpriseBatchVerification = {
  schemaVersion: "truthpass.enterprise.verification.v1";
  tenantId: string;
  brandId: string;
  productId: string;
  batchId: string;
  status: "accepted_with_scope" | "review" | "rejected";
  dataMode: "demo/synthetic" | "external";
  verifierVersion: "enterprise-evidence-gate-v1";
  checks: Array<{ code: string; status: "passed" | "failed" | "missing" | "review"; evidenceIds: string[] }>;
  reasons: string[];
  evidenceRoot: string;
  evaluatedAt: string;
};

export type EnterpriseAuditEvent = {
  eventId: string;
  tenantId: string;
  requestId: string;
  eventType: "evidence_imported" | "evidence_rejected" | "evidence_revoked" | "batch_validated";
  evidenceId?: string;
  batchId?: string;
  payloadHash?: string;
  createdAt: string;
  metadata: Record<string, unknown>;
};

type PilotStoreOptions = {
  resolveTrustedKey?: TrustedIssuerKeyResolver;
};

const REQUIRED_KINDS: readonly EvidenceKind[] = ["production", "inspection", "cold_chain", "shipment"];
const evidenceKey = (tenantId: string, evidenceId: string): string => `${tenantId}:${evidenceId}`;

function nonEmpty(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${label} 不能为空`);
  return value.trim();
}

function signatureState(record: EnterpriseEvidenceRecord, resolveTrustedKey?: TrustedIssuerKeyResolver): ConsumerEvidenceFact["signature"] {
  if (!record.attestation) return "not_checked";
  if (!resolveTrustedKey) return "not_checked";
  const evidence = {
    ...record,
    payloadHash: record.payloadHash,
  } as EnterpriseEvidenceRecord;
  return verifyEvidenceAttestation(evidence as never, resolveTrustedKey) ? "verified" : "invalid";
}

function toConsumerFact(record: EnterpriseEvidenceRecord, resolveTrustedKey?: TrustedIssuerKeyResolver): ConsumerEvidenceFact {
  return {
    evidenceId: record.evidenceId,
    kind: record.kind as ConsumerEvidenceFact["kind"],
    issuerId: record.issuerId,
    sourceKind: record.sourceKind as ConsumerEvidenceFact["sourceKind"],
    status: record.status,
    dataMode: record.dataMode,
    signature: signatureState(record, resolveTrustedKey),
  };
}

export class EnterprisePilotStore {
  #evidence = new Map<string, EnterpriseEvidenceRecord>();
  #audit: EnterpriseAuditEvent[] = [];
  #schemaReady: Promise<void> | undefined;
  #resolveTrustedKey?: TrustedIssuerKeyResolver;

  constructor(options: PilotStoreOptions = {}) {
    this.#resolveTrustedKey = options.resolveTrustedKey;
  }

  private async ensureSchema(): Promise<void> {
    if (!persistenceEnabled()) return;
    this.#schemaReady ??= getDatabasePool().query(`
      create table if not exists truthpass_enterprise_evidence (
        tenant_id text not null,
        brand_id text not null,
        product_id text not null,
        batch_id text not null,
        sample_id text,
        evidence_id text not null,
        kind text not null,
        issuer_id text not null,
        source_kind text not null,
        occurred_at timestamptz not null,
        payload jsonb not null,
        data_mode text not null,
        attestation jsonb,
        raw_object_ref text,
        payload_hash text not null,
        status text not null default 'submitted',
        created_at timestamptz not null default now(),
        primary key (tenant_id, evidence_id)
      );
      create index if not exists truthpass_enterprise_evidence_batch_idx
        on truthpass_enterprise_evidence (tenant_id, batch_id, created_at);
      create table if not exists truthpass_enterprise_audit_events (
        event_id text primary key,
        tenant_id text not null,
        request_id text not null,
        event_type text not null,
        evidence_id text,
        batch_id text,
        payload_hash text,
        metadata jsonb not null default '{}'::jsonb,
        created_at timestamptz not null default now()
      );
      create index if not exists truthpass_enterprise_audit_tenant_idx
        on truthpass_enterprise_audit_events (tenant_id, created_at, event_id);
    `).then(() => undefined);
    await this.#schemaReady;
  }

  private appendAudit(event: EnterpriseAuditEvent): void {
    this.#audit.push(structuredClone(event));
  }

  private async persistAudit(event: EnterpriseAuditEvent): Promise<void> {
    if (!persistenceEnabled()) return;
    await this.ensureSchema();
    await getDatabasePool().query(
      `insert into truthpass_enterprise_audit_events
       (event_id, tenant_id, request_id, event_type, evidence_id, batch_id, payload_hash, metadata, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (event_id) do nothing`,
      [event.eventId, event.tenantId, event.requestId, event.eventType, event.evidenceId ?? null, event.batchId ?? null,
       event.payloadHash ?? null, JSON.stringify(event.metadata), event.createdAt],
    );
  }

  private async loadExisting(tenantId: string, evidenceId: string): Promise<EnterpriseEvidenceRecord | undefined> {
    const memory = this.#evidence.get(evidenceKey(tenantId, evidenceId));
    if (memory) return structuredClone(memory);
    if (!persistenceEnabled()) return undefined;
    await this.ensureSchema();
    const result = await getDatabasePool().query(
      `select tenant_id, brand_id, product_id, batch_id, sample_id, evidence_id, kind, issuer_id, source_kind,
              occurred_at, payload, data_mode, attestation, raw_object_ref, payload_hash, status, created_at
       from truthpass_enterprise_evidence where tenant_id = $1 and evidence_id = $2`,
      [tenantId, evidenceId],
    );
    const row = result.rows[0];
    if (!row) return undefined;
    const record: EnterpriseEvidenceRecord = {
      schemaVersion: "evidence.v1", tenantId: String(row.tenant_id), brandId: String(row.brand_id), productId: String(row.product_id),
      batchId: String(row.batch_id), sampleId: row.sample_id ? String(row.sample_id) : undefined,
      evidenceId: String(row.evidence_id), kind: row.kind as EvidenceKind, issuerId: String(row.issuer_id),
      sourceKind: row.source_kind as SourceKind, occurredAt: new Date(String(row.occurred_at)).toISOString(),
      payload: (row.payload ?? {}) as Record<string, unknown>, dataMode: row.data_mode as EnterpriseEvidenceRecord["dataMode"],
      attestation: row.attestation ? row.attestation as EvidenceAttestation : undefined,
      rawObjectRef: row.raw_object_ref ? String(row.raw_object_ref) : undefined,
      payloadHash: String(row.payload_hash), status: row.status as EnterpriseEvidenceRecord["status"],
      createdAt: new Date(String(row.created_at)).toISOString(),
    };
    this.#evidence.set(evidenceKey(tenantId, evidenceId), structuredClone(record));
    return record;
  }

  async importEvidence(input: EnterpriseEvidenceEnvelope, requestId: string): Promise<{ record: EnterpriseEvidenceRecord; idempotent: boolean }> {
    const tenantId = nonEmpty(input.tenantId, "tenantId");
    const brandId = nonEmpty(input.brandId, "brandId");
    const productId = nonEmpty(input.productId, "productId");
    const batchId = nonEmpty(input.batchId, "batchId");
    const evidenceId = nonEmpty(input.evidenceId, "evidenceId");
    const validation = validateEvidence(input);
    if (!validation.ok) throw new Error("证据格式无效：" + validation.errors.join("；"));
    const payloadHash = sha256Canonical(input.payload);
    const existing = await this.loadExisting(tenantId, evidenceId);
    if (existing) {
      if (existing.payloadHash !== payloadHash || existing.batchId !== batchId || existing.productId !== productId) {
        throw new Error("EVIDENCE_ID_CONFLICT: evidenceId 已绑定其他内容");
      }
      return { record: existing, idempotent: true };
    }
    const record: EnterpriseEvidenceRecord = {
      ...structuredClone(input), tenantId, brandId, productId, batchId, evidenceId,
      payloadHash, status: "submitted", createdAt: new Date().toISOString(),
    };
    this.#evidence.set(evidenceKey(tenantId, evidenceId), structuredClone(record));
    if (persistenceEnabled()) {
      await this.ensureSchema();
      await getDatabasePool().query(
        `insert into truthpass_enterprise_evidence
         (tenant_id, brand_id, product_id, batch_id, sample_id, evidence_id, kind, issuer_id, source_kind,
          occurred_at, payload, data_mode, attestation, raw_object_ref, payload_hash, status, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
         on conflict (tenant_id, evidence_id) do nothing`,
        [tenantId, brandId, productId, batchId, input.sampleId ?? null, evidenceId, input.kind, input.issuerId,
         input.sourceKind, input.occurredAt, JSON.stringify(input.payload), input.dataMode,
         input.attestation ? JSON.stringify(input.attestation) : null, input.rawObjectRef ?? null, payloadHash,
         "submitted", record.createdAt],
      );
    }
    const event: EnterpriseAuditEvent = {
      eventId: sha256Canonical([tenantId, requestId, "evidence_imported", evidenceId, payloadHash]),
      tenantId, requestId, eventType: "evidence_imported", evidenceId, batchId, payloadHash,
      createdAt: record.createdAt, metadata: { brandId, productId, kind: input.kind },
    };
    this.appendAudit(event);
    await this.persistAudit(event);
    return { record: structuredClone(record), idempotent: false };
  }

  async listEvidence(tenantId: string, batchId: string): Promise<EnterpriseEvidenceRecord[]> {
    const memory = [...this.#evidence.values()].filter((item) => item.tenantId === tenantId && item.batchId === batchId);
    if (!persistenceEnabled()) return structuredClone(memory).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    await this.ensureSchema();
    const result = await getDatabasePool().query(
      `select tenant_id, brand_id, product_id, batch_id, sample_id, evidence_id, kind, issuer_id, source_kind,
              occurred_at, payload, data_mode, attestation, raw_object_ref, payload_hash, status, created_at
       from truthpass_enterprise_evidence where tenant_id = $1 and batch_id = $2 order by created_at, evidence_id`,
      [tenantId, batchId],
    );
    const loaded: EnterpriseEvidenceRecord[] = result.rows.map((row) => ({
      schemaVersion: "evidence.v1", tenantId: String(row.tenant_id), brandId: String(row.brand_id), productId: String(row.product_id),
      batchId: String(row.batch_id), sampleId: row.sample_id ? String(row.sample_id) : undefined,
      evidenceId: String(row.evidence_id), kind: row.kind as EvidenceKind, issuerId: String(row.issuer_id),
      sourceKind: row.source_kind as SourceKind, occurredAt: new Date(String(row.occurred_at)).toISOString(),
      payload: (row.payload ?? {}) as Record<string, unknown>, dataMode: row.data_mode as EnterpriseEvidenceRecord["dataMode"],
      attestation: row.attestation ? row.attestation as EvidenceAttestation : undefined,
      rawObjectRef: row.raw_object_ref ? String(row.raw_object_ref) : undefined,
      payloadHash: String(row.payload_hash), status: row.status as EnterpriseEvidenceRecord["status"],
      createdAt: new Date(String(row.created_at)).toISOString(),
    }));
    for (const item of loaded) this.#evidence.set(evidenceKey(tenantId, item.evidenceId), structuredClone(item));
    const merged = [...new Map([...memory, ...loaded].map((item) => [item.evidenceId, item])).values()];
    return structuredClone(merged).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async validateBatch(tenantId: string, batchId: string, requestId: string): Promise<EnterpriseBatchVerification> {
    const evidence = await this.listEvidence(tenantId, batchId);
    const first = evidence[0];
    if (!first) throw new Error("BATCH_NOT_FOUND: 当前租户没有登记该批次证据");
    const active = evidence.filter((item) => item.status === "submitted");
    const checks = REQUIRED_KINDS.map((kind) => {
      const items = active.filter((item) => item.kind === kind);
      if (!items.length) return { code: kind, status: "missing" as const, evidenceIds: [] };
      const signatureRequired = kind === "inspection" || kind === "cold_chain";
      const signatureOk = !signatureRequired || items.some((item) => signatureState(item, this.#resolveTrustedKey) === "verified");
      return { code: kind, status: signatureOk ? "passed" as const : "review" as const, evidenceIds: items.map((item) => item.evidenceId) };
    });
    const failed = evidence.some((item) => item.status === "revoked");
    const missing = checks.some((check) => check.status === "missing");
    const review = checks.some((check) => check.status === "review");
    const status = failed ? "rejected" : missing || review ? "review" : "accepted_with_scope";
    const reasons = [
      ...(missing ? ["核心证据未完整覆盖，当前只能进入 review。"] : []),
      ...(review ? ["部分机构证据尚未通过当前公钥注册表验证。"] : []),
      ...(evidence.some((item) => item.status === "revoked") ? ["当前批次存在已撤销证据。"] : []),
    ];
    const evidenceRoot = sha256Canonical(active.map((item) => [item.evidenceId, item.payloadHash, item.status]));
    const result: EnterpriseBatchVerification = {
      schemaVersion: "truthpass.enterprise.verification.v1", tenantId, brandId: first.brandId, productId: first.productId,
      batchId, status, dataMode: first.dataMode, verifierVersion: "enterprise-evidence-gate-v1", checks, reasons,
      evidenceRoot, evaluatedAt: new Date().toISOString(),
    };
    const event: EnterpriseAuditEvent = {
      eventId: sha256Canonical([tenantId, requestId, "batch_validated", batchId, evidenceRoot]),
      tenantId, requestId, eventType: "batch_validated", batchId, payloadHash: evidenceRoot,
      createdAt: result.evaluatedAt, metadata: { status, verifierVersion: result.verifierVersion },
    };
    this.appendAudit(event);
    await this.persistAudit(event);
    return result;
  }

  async evidenceCard(tenantId: string, batchId: string, question: string, requestId: string): Promise<{ verification: EnterpriseBatchVerification; card: ConsumerAnswer }> {
    const verification = await this.validateBatch(tenantId, batchId, requestId);
    const evidence = await this.listEvidence(tenantId, batchId);
    const snapshot: ConsumerEvidenceSnapshot = {
      batchId, dataMode: verification.dataMode,
      decision: verification.status === "accepted_with_scope" ? "accepted" : verification.status === "rejected" ? "rejected" : "review",
      decisionScope: "enterprise-evidence-gate-v1",
      decisionReasons: verification.reasons,
      evidence: evidence.map((item) => toConsumerFact(item, this.#resolveTrustedKey)),
    };
    return { verification, card: answerConsumerQuestion(question, snapshot) };
  }

  async revoke(tenantId: string, evidenceId: string, requestId: string): Promise<boolean> {
    const existing = await this.loadExisting(tenantId, evidenceId);
    if (!existing || existing.status === "revoked") return false;
    existing.status = "revoked";
    this.#evidence.set(evidenceKey(tenantId, evidenceId), structuredClone(existing));
    if (persistenceEnabled()) {
      await this.ensureSchema();
      await getDatabasePool().query(
        `update truthpass_enterprise_evidence set status = 'revoked' where tenant_id = $1 and evidence_id = $2`,
        [tenantId, evidenceId],
      );
    }
    const event: EnterpriseAuditEvent = {
      eventId: sha256Canonical([tenantId, requestId, "evidence_revoked", evidenceId, existing.payloadHash]),
      tenantId, requestId, eventType: "evidence_revoked", evidenceId, batchId: existing.batchId,
      payloadHash: existing.payloadHash, createdAt: new Date().toISOString(), metadata: {},
    };
    this.appendAudit(event);
    await this.persistAudit(event);
    return true;
  }

  async exportAudit(tenantId: string): Promise<{ tenantId: string; evidence: Array<Omit<EnterpriseEvidenceRecord, "payload"> & { payloadRef: string | null }>; events: EnterpriseAuditEvent[] }> {
    const evidence = persistenceEnabled()
      ? await this.loadAllFromDatabase(tenantId)
      : [...this.#evidence.values()].filter((item) => item.tenantId === tenantId);
    const events = persistenceEnabled() ? await this.loadAuditFromDatabase(tenantId) : this.#audit.filter((item) => item.tenantId === tenantId);
    return {
      tenantId,
      evidence: evidence.map(({ payload: _payload, rawObjectRef, ...item }) => ({ ...item, payloadRef: rawObjectRef ?? null })),
      events: structuredClone(events),
    };
  }

  private async loadAllFromDatabase(tenantId: string): Promise<EnterpriseEvidenceRecord[]> {
    await this.ensureSchema();
    const result = await getDatabasePool().query(
      `select tenant_id, brand_id, product_id, batch_id, sample_id, evidence_id, kind, issuer_id, source_kind,
              occurred_at, payload, data_mode, attestation, raw_object_ref, payload_hash, status, created_at
       from truthpass_enterprise_evidence where tenant_id = $1 order by created_at, evidence_id`, [tenantId],
    );
    return result.rows.map((row) => ({
      schemaVersion: "evidence.v1", tenantId: String(row.tenant_id), brandId: String(row.brand_id), productId: String(row.product_id),
      batchId: String(row.batch_id), sampleId: row.sample_id ? String(row.sample_id) : undefined,
      evidenceId: String(row.evidence_id), kind: row.kind as EvidenceKind, issuerId: String(row.issuer_id),
      sourceKind: row.source_kind as SourceKind, occurredAt: new Date(String(row.occurred_at)).toISOString(),
      payload: (row.payload ?? {}) as Record<string, unknown>, dataMode: row.data_mode as EnterpriseEvidenceRecord["dataMode"],
      attestation: row.attestation ? row.attestation as EvidenceAttestation : undefined,
      rawObjectRef: row.raw_object_ref ? String(row.raw_object_ref) : undefined,
      payloadHash: String(row.payload_hash), status: row.status as EnterpriseEvidenceRecord["status"],
      createdAt: new Date(String(row.created_at)).toISOString(),
    }));
  }

  private async loadAuditFromDatabase(tenantId: string): Promise<EnterpriseAuditEvent[]> {
    await this.ensureSchema();
    const result = await getDatabasePool().query(
      `select event_id, tenant_id, request_id, event_type, evidence_id, batch_id, payload_hash, metadata, created_at
       from truthpass_enterprise_audit_events where tenant_id = $1 order by created_at, event_id`, [tenantId],
    );
    return result.rows.map((row) => ({
      eventId: String(row.event_id), tenantId: String(row.tenant_id), requestId: String(row.request_id),
      eventType: row.event_type as EnterpriseAuditEvent["eventType"], evidenceId: row.evidence_id ? String(row.evidence_id) : undefined,
      batchId: row.batch_id ? String(row.batch_id) : undefined, payloadHash: row.payload_hash ? String(row.payload_hash) : undefined,
      createdAt: new Date(String(row.created_at)).toISOString(), metadata: (row.metadata ?? {}) as Record<string, unknown>,
    }));
  }
}
