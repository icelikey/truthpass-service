import { sha256Canonical } from "../evidence.js";
import { answerConsumerQuestion, type ConsumerAnswer, type ConsumerEvidenceFact, type ConsumerEvidenceSnapshot } from "../agents/consumer-assistant.js";
import { getDatabasePool, persistenceEnabled } from "../data/persistence.js";
import { validateEvidence } from "../data/validation.js";
import type { EvidenceAttestation, EvidenceKind, NewEvidenceRecord, SourceKind } from "../data/model.js";
import { verifyEvidenceAttestation, type TrustedIssuerKeyResolver } from "../security/evidence-signatures.js";
import { reconcileBatch } from "./reconciliation.js";

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


export type EnterpriseBatchPublication = {
  schemaVersion: "truthpass.enterprise.batch-publication.v1";
  publicationId: string;
  tenantId: string;
  brandId: string;
  productId: string;
  batchId: string;
  status: "published";
  dataMode: "external";
  evidenceRoot: string;
  verification: EnterpriseBatchVerification;
  publishedAt: string;
};

export type EnterpriseAuditEvent = {
  eventId: string;
  tenantId: string;
  requestId: string;
  eventType: "evidence_imported" | "evidence_rejected" | "evidence_revoked" | "batch_validated" | "batch_published";
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


function hasDemoMarker(payload: Record<string, unknown>): boolean {
  return payload.demo === true
    || payload.demoMode === true
    || payload.dataMode === "demo/synthetic"
    || payload.evidenceMode === "demo/synthetic";
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
  #publications = new Map<string, EnterpriseBatchPublication>();
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
      create table if not exists truthpass_enterprise_batch_publications (
        publication_id text primary key,
        tenant_id text not null,
        brand_id text not null,
        product_id text not null,
        batch_id text not null,
        status text not null default 'published' check (status = 'published'),
        data_mode text not null check (data_mode = 'external'),
        evidence_root text not null,
        payload jsonb not null,
        published_at timestamptz not null,
        unique (tenant_id, batch_id, evidence_root)
      );
      create index if not exists truthpass_enterprise_batch_publications_scope_idx
        on truthpass_enterprise_batch_publications (tenant_id, batch_id, published_at desc);
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
    if (input.dataMode === "external" && hasDemoMarker(input.payload)) {
      throw new Error("EXTERNAL_DEMO_MARKER_REJECTED: external 资料不能携带 demo 标记");
    }
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
    const reconciliation = reconcileBatch(batchId, evidence);
    const reconciliationChecks = reconciliation.checks.map((check) => ({
      code: `reconcile:${check.code}`,
      status: check.status === "conflict" ? "failed" as const : check.status,
      evidenceIds: check.evidenceIds,
    }));
    const allChecks = [...checks, ...reconciliationChecks];
    const failed = evidence.some((item) => item.status === "revoked");
    const missing = allChecks.some((check) => check.status === "missing");
    const review = allChecks.some((check) => check.status === "review");
    const conflict = reconciliation.status === "conflict" || allChecks.some((check) => check.status === "failed");
    const status = failed || conflict ? "rejected" : missing || review || reconciliation.status === "review" ? "review" : "accepted_with_scope";
    const reasons = [
      ...(missing ? ["核心证据未完整覆盖，当前只能进入 review。"] : []),
      ...(review ? ["部分机构证据或批次对账尚未通过当前验证。"] : []),
      ...(conflict ? ["批次对账发现冲突，发布门禁已关闭。"] : []),
      ...(evidence.some((item) => item.status === "revoked") ? ["当前批次存在已撤销证据。"] : []),
      ...reconciliation.reasons,
    ];
    const evidenceRoot = sha256Canonical(active.map((item) => [item.evidenceId, item.payloadHash, item.status]));
    const result: EnterpriseBatchVerification = {
      schemaVersion: "truthpass.enterprise.verification.v1", tenantId, brandId: first.brandId, productId: first.productId,
      batchId, status, dataMode: first.dataMode, verifierVersion: "enterprise-evidence-gate-v1", checks: allChecks, reasons,
      evidenceRoot, evaluatedAt: new Date().toISOString(),
    };
    const event: EnterpriseAuditEvent = {
      eventId: sha256Canonical([tenantId, requestId, "batch_validated", batchId, evidenceRoot]),
      tenantId, requestId, eventType: "batch_validated", batchId, payloadHash: evidenceRoot,
      createdAt: result.evaluatedAt, metadata: { status, verifierVersion: result.verifierVersion, reconciliationStatus: reconciliation.status },
    };
    this.appendAudit(event);
    await this.persistAudit(event);
    return result;
  }

  async publishBatch(tenantId: string, batchId: string, requestId: string): Promise<{ publication: EnterpriseBatchPublication; idempotent: boolean }> {
    const verification = await this.validateBatch(tenantId, batchId, requestId);
    const evidence = await this.listEvidence(tenantId, batchId);
    const reconciliation = reconcileBatch(batchId, evidence);
    if (verification.status !== "accepted_with_scope") {
      throw new Error(`PUBLISH_GATE_BLOCKED: 当前批次状态为 ${verification.status}，需要先补齐证据并通过复核`);
    }
    if (reconciliation.status !== "passed") {
      throw new Error(`PUBLISH_RECONCILIATION_BLOCKED: 当前批次对账状态为 ${reconciliation.status}，需要先解决批次、样品、时间或数量冲突`);
    }
    if (evidence.length === 0 || evidence.some((item) => item.dataMode !== "external")) {
      throw new Error("PUBLISH_EXTERNAL_DATA_REQUIRED: 发布批次必须全部使用 external 资料");
    }
    if (evidence.some((item) => hasDemoMarker(item.payload))) {
      throw new Error("PUBLISH_EXTERNAL_DEMO_MARKER: external 批次不能包含 demo 标记");
    }
    if (evidence.some((item) => !item.issuerId || !item.attestation)) {
      throw new Error("PUBLISH_ATTESTATION_REQUIRED: 发布批次的每条证据都必须带 issuerId 和 attestation");
    }
    if (evidence.some((item) => signatureState(item, this.#resolveTrustedKey) !== "verified")) {
      throw new Error("PUBLISH_SIGNATURE_UNVERIFIED: 发布批次的每条证据都必须通过当前可信公钥注册表核验");
    }
    if (evidence.some((item) => item.status !== "submitted")) {
      throw new Error("PUBLISH_REVOKED_EVIDENCE: 当前批次包含已撤销证据");
    }
    const existing = await this.loadPublication(tenantId, batchId);
    if (existing && existing.evidenceRoot === verification.evidenceRoot) {
      return { publication: structuredClone(existing), idempotent: true };
    }

    const publishedAt = new Date().toISOString();
    const publication: EnterpriseBatchPublication = {
      schemaVersion: "truthpass.enterprise.batch-publication.v1",
      publicationId: sha256Canonical([tenantId, batchId, verification.evidenceRoot, "published"]),
      tenantId,
      brandId: verification.brandId,
      productId: verification.productId,
      batchId,
      status: "published",
      dataMode: "external",
      evidenceRoot: verification.evidenceRoot,
      verification,
      publishedAt,
    };
    this.#publications.set(`${tenantId}:${batchId}`, structuredClone(publication));
    if (persistenceEnabled()) {
      await this.ensureSchema();
      await getDatabasePool().query(
        `insert into truthpass_enterprise_batch_publications
         (publication_id, tenant_id, brand_id, product_id, batch_id, status, data_mode, evidence_root, payload, published_at)
         values ($1,$2,$3,$4,$5,'published','external',$6,$7::jsonb,$8)
         on conflict (publication_id) do nothing`,
        [publication.publicationId, tenantId, publication.brandId, publication.productId, batchId, publication.evidenceRoot, JSON.stringify(publication), publishedAt],
      );
    }
    const event: EnterpriseAuditEvent = {
      eventId: sha256Canonical([tenantId, requestId, "batch_published", batchId, verification.evidenceRoot]),
      tenantId,
      requestId,
      eventType: "batch_published",
      batchId,
      payloadHash: verification.evidenceRoot,
      createdAt: publishedAt,
      metadata: { publicationId: publication.publicationId, dataMode: publication.dataMode },
    };
    this.appendAudit(event);
    await this.persistAudit(event);
    return { publication: structuredClone(publication), idempotent: false };
  }

  async getPublication(tenantId: string, batchId: string): Promise<EnterpriseBatchPublication | undefined> {
    return this.loadPublication(tenantId, batchId);
  }

  private async loadPublication(tenantId: string, batchId: string): Promise<EnterpriseBatchPublication | undefined> {
    const key = `${tenantId}:${batchId}`;
    const memory = this.#publications.get(key);
    if (memory) return structuredClone(memory);
    if (!persistenceEnabled()) return undefined;
    await this.ensureSchema();
    const result = await getDatabasePool().query(
      `select payload from truthpass_enterprise_batch_publications
       where tenant_id = $1 and batch_id = $2
       order by published_at desc limit 1`,
      [tenantId, batchId],
    );
    const payload = result.rows[0]?.payload;
    if (!payload || typeof payload !== "object") return undefined;
    const publication = payload as EnterpriseBatchPublication;
    this.#publications.set(key, structuredClone(publication));
    return structuredClone(publication);
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
