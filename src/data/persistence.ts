// Demo 运行结果的持久化 Sink：把一次端到端演示写进 Supabase/Postgres。
// 约束:
//   * 全部参数绑定（$1...），绝不拼接 SQL；
//   * 幂等（on conflict do nothing / 唯一索引去重），demo 重复执行不产生重复流水；
//   * TLS 严格校验：固定 Supabase Root 2021 CA + 主机名验证，绝不关闭证书校验；
//     官方 CA 可从 Dashboard → Database settings 下载后覆盖 certs/prod-ca-2021.crt；
//   * 开关 persistenceEnabled() = 存在 DATABASE_URL 且 DATA_BACKEND != memory。
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import type { RankedService } from "../registry.js";
import type { ExecutionEvidence, FeedbackRecord, ServiceAdapter, TaskRequest } from "../types.js";
import type { ConsumerConsent, ConsumerFeedback, PurchaseRecord } from "../consumer.js";
import type { ReplayGuard } from "../security/evidence-signatures.js";

/** 包装服务适配器：把 execute 返回的原始证据旁路记录下来，供 persistDemoRun 落库。 */
export function recordEvidence(
  serviceId: string,
  log: Map<string, ExecutionEvidence>,
  adapter: ServiceAdapter,
): ServiceAdapter {
  return {
    probe: (task) => adapter.probe(task),
    execute: async (task) => {
      const evidence = await adapter.execute(task);
      log.set([serviceId, task.taskId].join(":"), evidence);
      return evidence;
    },
  };
}

const CA_PATH = join(process.cwd(), "certs", "prod-ca-2021.crt");

let pool: Pool | undefined;

function sslConfig(): { ca?: string; rejectUnauthorized: true } {
  // 生产优先从 Secret 注入 CA；本地可使用仓库 certs 文件。没有自定义 CA 时仍保持 Node 系统 CA 校验。
  const configuredCa = process.env.DATABASE_CA_CERT?.trim();
  if (configuredCa) return { ca: configuredCa, rejectUnauthorized: true };
  if (existsSync(CA_PATH)) return { ca: readFileSync(CA_PATH, "utf8"), rejectUnauthorized: true };
  return { rejectUnauthorized: true };
}

function getPool(): Pool {
  pool ??= new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: sslConfig(),
    max: 2,
  });
  return pool;
}

export function getDatabasePool(): Pool {
  return getPool();
}

export function persistenceEnabled(): boolean {
  return process.env.DATA_BACKEND !== "memory" && Boolean(process.env.DATABASE_URL);
}

let replayTableReady: Promise<void> | undefined;

/** Production replay guard. The unique key is enforced by Postgres, not process memory. */
export function createPostgresReplayGuard(): ReplayGuard {
  return {
    reserve: async (replayKey) => {
      replayTableReady ??= getPool().query(
        `create table if not exists truthpass_evidence_replay_guard (
           replay_key text primary key,
           reserved_at timestamptz not null default now()
         )`,
      ).then(() => undefined);
      await replayTableReady;
      const result = await getPool().query(
        `insert into truthpass_evidence_replay_guard (replay_key) values ($1) on conflict (replay_key) do nothing returning replay_key`,
        [replayKey],
      );
      return result.rowCount === 1;
    },
  };
}

export interface KnowledgeChunkRow {
  id: number;
  sourceTable: string;
  sourceId: string;
  title: string;
  chunkText: string;
  metadata: Record<string, unknown>;
  concepts: string[];
  keywords: string[];
}

/** 知识层专用读取：SQL 全部收口在本模块，调用方只传参数，不接触 SQL 文本。 */
export async function selectKnowledgeChunks(concepts?: string[]): Promise<KnowledgeChunkRow[]> {
  const result = await getPool().query("select id, source_table, source_id, title, chunk_text, metadata, concepts, keywords from knowledge_chunks where ($1::text[] is null or concepts && $1::text[]) order by id", [concepts && concepts.length > 0 ? concepts : null]);
  return result.rows.map((row) => ({
    id: Number(row.id),
    sourceTable: String(row.source_table),
    sourceId: String(row.source_id),
    title: String(row.title),
    chunkText: String(row.chunk_text),
    metadata: (row.metadata ?? {}) as Record<string, unknown>,
    concepts: (row.concepts ?? []) as string[],
    keywords: (row.keywords ?? []) as string[],
  }));
}

export async function closePersistence(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}

export interface DemoRunRecord {
  task: TaskRequest;
  ranking: RankedService[];
  /** 组合根（demo）旁路记录的原始证据，键为 `${serviceId}:${taskId}`。 */
  evidenceByServiceId: Map<string, ExecutionEvidence>;
  feedback: FeedbackRecord;
  consent: ConsumerConsent;
  purchase: PurchaseRecord;
  consumerFeedback: ConsumerFeedback;
}

const toJson = (value: unknown): string => JSON.stringify(value ?? null);

async function persistServiceCards(cards: RankedService["service"][]): Promise<void> {
  for (const card of cards) {
    await getPool().query(
      `insert into services (service_id, name, kind, endpoint, capabilities, signer, historical_score, feedback_count)
       values ($1, $2, $3, $4, $5, $6, $7, $8)
       on conflict (service_id) do update set
         name = excluded.name,
         endpoint = excluded.endpoint,
         capabilities = excluded.capabilities,
         signer = excluded.signer,
         historical_score = excluded.historical_score,
         feedback_count = excluded.feedback_count`,
      [card.id, card.name, card.kind, card.endpoint, card.capabilities, card.signer, card.historicalScore, card.feedbackCount],
    );
  }
}

async function persistTask(task: TaskRequest): Promise<void> {
  await getPool().query(
    `insert into tasks (task_id, service_kind, capability, batch_id, production_time,
                        require_signature, policy_id, policy_version, raw)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (task_id) do nothing`,
    [task.taskId, task.serviceKind, task.capability, task.batchId, task.productionTime,
     task.acceptance.requireSignature, task.acceptance.policyId, task.acceptance.policyVersion, toJson(task)],
  );
}

async function persistProbe(taskId: string, item: RankedService): Promise<void> {
  await getPool().query(
    `insert into probe_results (task_id, service_id, status, latency_ms, capability_match, schema_valid, checked_at, reason)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (task_id, service_id, checked_at) do nothing`,
    [taskId, item.service.id, item.probe.status, item.probe.latencyMs, item.probe.capabilityMatch,
     item.probe.schemaValid, item.probe.checkedAt, item.probe.reason ?? null],
  );
}

async function persistExecutionEvidence(taskId: string, evidence: ExecutionEvidence): Promise<void> {
  await getPool().query(
    `insert into execution_evidence (service_id, task_id, batch_id, report_batch_id, production_time,
                                     report_time, logistics_gap_hours, signature_valid,
                                     epa_dha_percent, peroxide_value, totox, cold_chain_gap_hours, payload)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     on conflict (task_id, service_id, report_time) do nothing`,
    [evidence.serviceId, taskId, evidence.batchId, evidence.reportBatchId, evidence.productionTime,
     evidence.reportTime, evidence.logisticsGapHours, evidence.signatureValid,
     evidence.epaDhaPercent ?? null, evidence.peroxideValue ?? null, evidence.totox ?? null,
     evidence.coldChainGapHours ?? null, toJson(evidence.payload)],
  );
}

async function persistExecutionResult(serviceId: string, taskId: string, result: NonNullable<RankedService["execution"]>): Promise<void> {
  await getPool().query(
    `insert into service_execution_results (service_id, task_id, status, score, checks, reasons, evidence_hash)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (task_id, service_id, evidence_hash) do nothing`,
    [serviceId, taskId, result.status, result.score, toJson(result.checks), result.reasons, result.evidenceHash],
  );
}

async function persistProductAssessment(serviceId: string, taskId: string, batchId: string, assessment: NonNullable<RankedService["product"]>): Promise<void> {
  await getPool().query(
    `insert into product_batch_assessments (service_id, task_id, batch_id, status, policy_id, policy_version, score, checks, reasons, evidence_hash)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (task_id, service_id, evidence_hash) do nothing`,
    [serviceId, taskId, batchId, assessment.status, assessment.policyId, assessment.policyVersion,
     assessment.score, toJson(assessment.checks), assessment.reasons, assessment.evidenceHash],
  );
}

async function persistServiceFeedback(feedback: FeedbackRecord): Promise<void> {
  await getPool().query(
    `insert into service_feedback (feedback_id, service_id, task_id, accepted, score, evidence_hash, created_at, revoked)
     values ($1, $2, $3, $4, $5, $6, $7, $8)
     on conflict (feedback_id) do nothing`,
    [feedback.feedbackId, feedback.serviceId, feedback.taskId, feedback.accepted, feedback.score,
     feedback.evidenceHash, feedback.createdAt, feedback.revoked],
  );
}

export async function persistConsumerRun(consent: ConsumerConsent, purchase: PurchaseRecord, feedback: ConsumerFeedback): Promise<void> {
  // Older deployments had the consumer registry only in process memory.  Keep
  // schema creation here as a safe compatibility bridge so a configured
  // database never reports a successful feedback write before its tables exist.
  await ensureConsumerPersistenceSchema();
  await getPool().query(
    `insert into consumer_consents (consumer_id, batch_id, scopes, consent_hash, granted_at)
     values ($1, $2, $3, $4, $5)
     on conflict (consumer_id, batch_id) do nothing`,
    [consent.consumerId, consent.batchId, consent.scopes, consent.consentHash, consent.grantedAt],
  );
  await getPool().query(
    `insert into consumer_purchases (purchase_id, consumer_id, batch_id, purchase_proof_hash, created_at)
     values ($1, $2, $3, $4, $5)
     on conflict (purchase_id) do nothing`,
    [purchase.purchaseId, purchase.consumerId, purchase.batchId, purchase.purchaseProofHash, purchase.createdAt],
  );
  await getPool().query(
    `insert into consumer_feedbacks (feedback_id, purchase_id, consumer_id, batch_id, rating, categories, evidence_hash, created_at, contribution_points, data_mode)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (feedback_id) do nothing`,
    [feedback.feedbackId, feedback.purchaseId, feedback.consumerId, feedback.batchId, feedback.rating,
     feedback.categories, feedback.evidenceHash, feedback.createdAt, feedback.contributionPoints, feedback.dataMode ?? "demo/synthetic"],
  );
}

let consumerSchemaReady: Promise<void> | undefined;

/**
 * Create the minimal consumer persistence schema when the migration has not
 * been applied yet.  This is intentionally server-side only; no anon insert
 * policy is created here.
 */
export async function ensureConsumerPersistenceSchema(): Promise<void> {
  consumerSchemaReady ??= getPool().query(`
    create table if not exists consumer_consents (
      consumer_id text not null,
      batch_id text not null,
      scopes text[] not null default '{}',
      consent_hash text not null,
      granted_at timestamptz not null,
      primary key (consumer_id, batch_id)
    );
    create table if not exists consumer_purchases (
      purchase_id text primary key,
      consumer_id text not null,
      batch_id text not null,
      purchase_proof_hash text not null,
      created_at timestamptz not null
    );
    create unique index if not exists consumer_purchases_proof_idx
      on consumer_purchases (batch_id, purchase_proof_hash);
    create table if not exists consumer_feedbacks (
      feedback_id text primary key,
      purchase_id text not null references consumer_purchases(purchase_id),
      consumer_id text not null,
      batch_id text not null,
      rating integer not null check (rating between 1 and 5),
      categories text[] not null default '{}',
      evidence_hash text not null,
      created_at timestamptz not null,
      contribution_points integer not null default 0,
      data_mode text not null default 'demo/synthetic' check (data_mode in ('demo/synthetic', 'external')),
      unique (purchase_id)
    );
    alter table consumer_feedbacks add column if not exists data_mode text not null default 'demo/synthetic';
    create index if not exists consumer_feedbacks_batch_idx
      on consumer_feedbacks (batch_id, created_at desc);
  `).then(() => undefined).catch((error) => {
    consumerSchemaReady = undefined;
    throw error;
  });
  await consumerSchemaReady;
}

export interface PersistedChainTransaction {
  id: string;
  action: string;
  event: string;
  batchId: string;
  wallet: string;
  contractAddress: string;
  txHash: string;
  blockNumber?: number;
  receiptStatus?: string;
  eventVerified?: boolean;
  ids?: Record<string, string>;
  explorerUrl: string;
  createdAt: string;
}

let chainSchemaReady: Promise<void> | undefined;

async function ensureChainTransactionSchema(): Promise<void> {
  chainSchemaReady ??= getPool().query(`
    create table if not exists truthpass_session_chain_transactions (
      tx_id text primary key,
      action text not null,
      event_name text not null,
      wallet_address text not null,
      contract_address text not null,
      tx_hash text not null unique,
      batch_id text,
      block_number bigint,
      receipt_status text not null,
      event_verified boolean not null default false,
      ids jsonb not null default '{}'::jsonb,
      explorer_url text not null,
      created_at timestamptz not null default now()
    );
    alter table truthpass_session_chain_transactions
      add column if not exists ids jsonb not null default '{}'::jsonb;
    create index if not exists truthpass_chain_tx_batch_idx
      on truthpass_session_chain_transactions (batch_id, created_at desc);
  `).then(() => undefined).catch((error) => {
    chainSchemaReady = undefined;
    throw error;
  });
  await chainSchemaReady;
}

/** Persist a receipt that has already passed the server-side event checks. */
export async function persistChainTransaction(record: PersistedChainTransaction): Promise<void> {
  await ensureChainTransactionSchema();
  await getPool().query(
    `insert into truthpass_session_chain_transactions
      (tx_id, action, event_name, wallet_address, contract_address, tx_hash,
       batch_id, block_number, receipt_status, event_verified, ids, explorer_url, created_at)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12,$13)
     on conflict (tx_hash) do update set
       action = excluded.action,
       event_name = excluded.event_name,
       wallet_address = excluded.wallet_address,
       contract_address = excluded.contract_address,
       batch_id = excluded.batch_id,
       block_number = excluded.block_number,
       receipt_status = excluded.receipt_status,
       event_verified = excluded.event_verified,
       ids = excluded.ids,
       explorer_url = excluded.explorer_url`,
    [
      record.id,
      record.action,
      record.event,
      record.wallet.toLowerCase(),
      record.contractAddress.toLowerCase(),
      record.txHash.toLowerCase(),
      record.batchId,
      record.blockNumber ?? null,
      record.receiptStatus ?? "0x0",
      record.eventVerified === true,
      JSON.stringify(record.ids ?? {}),
      record.explorerUrl,
      record.createdAt,
    ],
  );
}

export async function loadPersistedChainTransactions(batchId?: string): Promise<PersistedChainTransaction[]> {
  await ensureChainTransactionSchema();
  const result = await getPool().query(
    `select tx_id, action, event_name, wallet_address, contract_address, tx_hash,
            batch_id, block_number, receipt_status, event_verified, ids, explorer_url, created_at
       from truthpass_session_chain_transactions
      where ($1::text is null or batch_id = $1)
      order by created_at desc`,
    [batchId ?? null],
  );
  return result.rows.map((row) => ({
    id: String(row.tx_id),
    action: String(row.action),
    event: String(row.event_name),
    batchId: String(row.batch_id ?? "").toUpperCase(),
    wallet: String(row.wallet_address).toLowerCase(),
    contractAddress: String(row.contract_address),
    txHash: String(row.tx_hash),
    blockNumber: row.block_number == null ? undefined : Number(row.block_number),
    receiptStatus: String(row.receipt_status),
    eventVerified: row.event_verified === true,
    ids: row.ids && typeof row.ids === "object"
      ? Object.fromEntries(Object.entries(row.ids as Record<string, unknown>).filter(([, value]) => typeof value === "string").map(([key, value]) => [key, String(value)])) as Record<string, string>
      : {},
    explorerUrl: String(row.explorer_url),
    createdAt: new Date(String(row.created_at)).toISOString(),
  }));
}

export interface PersistedFeedbackDraft {
  prepareId: string;
  batchId: string;
  purchaseId: string;
  purchaseTxHash: string;
  walletAddress?: string;
  rating: number;
  categories: string[];
  comment: string;
  feedbackHash: string;
  dataMode: "demo/synthetic" | "external";
  createdAt: string;
  expiresAt: string;
  consumed: boolean;
}

let feedbackDraftSchemaReady: Promise<void> | undefined;

async function ensureFeedbackDraftSchema(): Promise<void> {
  feedbackDraftSchemaReady ??= getPool().query(`
    create table if not exists truthpass_feedback_drafts (
      prepare_id text primary key,
      batch_id text not null,
      purchase_id text not null,
      purchase_tx_hash text not null,
      wallet_address text,
      rating integer not null check (rating between 1 and 5),
      categories text[] not null default '{}',
      comment text not null default '',
      feedback_hash text not null,
      data_mode text not null check (data_mode in ('demo/synthetic', 'external')),
      created_at timestamptz not null,
      expires_at timestamptz not null,
      consumed boolean not null default false
    );
    create index if not exists truthpass_feedback_drafts_expiry_idx
      on truthpass_feedback_drafts (expires_at);
  `).then(() => undefined).catch((error) => {
    feedbackDraftSchemaReady = undefined;
    throw error;
  });
  await feedbackDraftSchemaReady;
}

export async function persistFeedbackDraft(draft: PersistedFeedbackDraft): Promise<void> {
  await ensureFeedbackDraftSchema();
  await getPool().query(
    `insert into truthpass_feedback_drafts
      (prepare_id, batch_id, purchase_id, purchase_tx_hash, wallet_address, rating,
       categories, comment, feedback_hash, data_mode, created_at, expires_at, consumed)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     on conflict (prepare_id) do update set
       consumed = excluded.consumed,
       expires_at = excluded.expires_at`,
    [
      draft.prepareId,
      draft.batchId,
      draft.purchaseId,
      draft.purchaseTxHash,
      draft.walletAddress ?? null,
      draft.rating,
      draft.categories,
      draft.comment,
      draft.feedbackHash,
      draft.dataMode,
      draft.createdAt,
      draft.expiresAt,
      draft.consumed,
    ],
  );
}

export async function loadPersistedFeedbackDraft(prepareId: string): Promise<PersistedFeedbackDraft | undefined> {
  await ensureFeedbackDraftSchema();
  const result = await getPool().query(
    `select prepare_id, batch_id, purchase_id, purchase_tx_hash, wallet_address,
            rating, categories, comment, feedback_hash, data_mode, created_at,
            expires_at, consumed
       from truthpass_feedback_drafts where prepare_id = $1`,
    [prepareId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    prepareId: String(row.prepare_id),
    batchId: String(row.batch_id).toUpperCase(),
    purchaseId: String(row.purchase_id),
    purchaseTxHash: String(row.purchase_tx_hash),
    walletAddress: row.wallet_address == null ? undefined : String(row.wallet_address),
    rating: Number(row.rating),
    categories: Array.isArray(row.categories) ? row.categories.map(String) : [],
    comment: String(row.comment ?? ""),
    feedbackHash: String(row.feedback_hash),
    dataMode: row.data_mode === "external" ? "external" : "demo/synthetic",
    createdAt: new Date(String(row.created_at)).toISOString(),
    expiresAt: new Date(String(row.expires_at)).toISOString(),
    consumed: row.consumed === true,
  };
}

export async function markFeedbackDraftConsumed(prepareId: string): Promise<void> {
  await ensureFeedbackDraftSchema();
  await getPool().query(
    `update truthpass_feedback_drafts set consumed = true where prepare_id = $1`,
    [prepareId],
  );
}

export interface PersistedLifecycleState {
  batchId: string;
  revision: number;
  syncedAt: string;
  events: unknown[];
}

let lifecycleSchemaReady: Promise<void> | undefined;

async function ensureLifecycleSchema(): Promise<void> {
  lifecycleSchemaReady ??= getPool().query(`
    create table if not exists truthpass_lifecycle_states (
      batch_id text primary key,
      revision integer not null,
      synced_at timestamptz not null,
      events jsonb not null default '[]'::jsonb,
      data_mode text not null default 'demo/synthetic',
      updated_at timestamptz not null default now()
    );
  `).then(() => undefined).catch((error) => {
    lifecycleSchemaReady = undefined;
    throw error;
  });
  await lifecycleSchemaReady;
}

export async function persistLifecycleState(state: PersistedLifecycleState): Promise<void> {
  await ensureLifecycleSchema();
  await getPool().query(
    `insert into truthpass_lifecycle_states (batch_id, revision, synced_at, events, data_mode, updated_at)
     values ($1,$2,$3,$4::jsonb,'demo/synthetic',now())
     on conflict (batch_id) do update set
       revision = excluded.revision,
       synced_at = excluded.synced_at,
       events = excluded.events,
       data_mode = excluded.data_mode,
       updated_at = now()`,
    [state.batchId, state.revision, state.syncedAt, JSON.stringify(state.events)],
  );
}

export async function loadPersistedLifecycleState(batchId: string): Promise<PersistedLifecycleState | undefined> {
  await ensureLifecycleSchema();
  const result = await getPool().query(
    `select batch_id, revision, synced_at, events
       from truthpass_lifecycle_states where batch_id = $1`,
    [batchId],
  );
  const row = result.rows[0];
  if (!row) return undefined;
  return {
    batchId: String(row.batch_id),
    revision: Number(row.revision),
    syncedAt: new Date(String(row.synced_at)).toISOString(),
    events: Array.isArray(row.events) ? row.events : [],
  };
}

export interface PersistedTenantSiteRevision {
  revisionId: string;
  slug: string;
  status: string;
  createdAt: string;
  config: Record<string, unknown>;
}

export interface PersistedTenantSite {
  slug: string;
  config: Record<string, unknown>;
  revisions: PersistedTenantSiteRevision[];
}

let tenantSiteSchemaReady: Promise<void> | undefined;

async function ensureTenantSiteSchema(): Promise<void> {
  tenantSiteSchemaReady ??= getPool().query(`
    create table if not exists tenant_sites (
      slug text primary key,
      tenant_id text not null unique,
      site_status text not null check (site_status in ('draft','preview','published','archived')),
      template_version text not null,
      config jsonb not null default '{}'::jsonb,
      updated_at timestamptz not null default now()
    );
    create table if not exists tenant_site_revisions (
      revision_id text primary key,
      slug text not null references tenant_sites(slug) on delete cascade,
      status text not null check (status in ('draft','preview','published','archived')),
      config jsonb not null default '{}'::jsonb,
      created_at timestamptz not null default now()
    );
    create index if not exists tenant_site_revisions_slug_idx
      on tenant_site_revisions(slug, created_at desc);
  `).then(() => undefined).catch((error) => {
    tenantSiteSchemaReady = undefined;
    throw error;
  });
  await tenantSiteSchemaReady;
}

/** Load tenant site configuration and immutable revisions after a restart. */
export async function loadPersistedTenantSites(): Promise<PersistedTenantSite[]> {
  await ensureTenantSiteSchema();
  const sites = await getPool().query(`
    select slug, config from tenant_sites order by slug
  `);
  const revisions = await getPool().query(`
    select revision_id, slug, status, config, created_at
      from tenant_site_revisions
     order by created_at asc
  `);
  const bySlug = new Map<string, PersistedTenantSite>();
  for (const row of sites.rows) {
    bySlug.set(String(row.slug), {
      slug: String(row.slug),
      config: row.config && typeof row.config === "object" ? row.config as Record<string, unknown> : {},
      revisions: [],
    });
  }
  for (const row of revisions.rows) {
    const slug = String(row.slug);
    const site = bySlug.get(slug);
    if (!site) continue;
    site.revisions.push({
      revisionId: String(row.revision_id),
      slug,
      status: String(row.status),
      createdAt: new Date(String(row.created_at)).toISOString(),
      config: row.config && typeof row.config === "object" ? row.config as Record<string, unknown> : {},
    });
  }
  return [...bySlug.values()];
}

/** Persist the current published site pointer and one immutable revision. */
export async function persistTenantSite(site: PersistedTenantSite): Promise<void> {
  await ensureTenantSiteSchema();
  const tenantId = typeof site.config.tenantId === "string" && site.config.tenantId.trim()
    ? site.config.tenantId.trim()
    : `tenant-${site.slug}`;
  const siteStatus = typeof site.config.siteStatus === "string" ? site.config.siteStatus : "draft";
  const templateVersion = typeof site.config.templateVersion === "string" ? site.config.templateVersion : "truthpass-site-v1";
  await getPool().query(
    `insert into tenant_sites (slug, tenant_id, site_status, template_version, config, updated_at)
     values ($1,$2,$3,$4,$5::jsonb,now())
     on conflict (slug) do update set
       tenant_id = excluded.tenant_id,
       site_status = excluded.site_status,
       template_version = excluded.template_version,
       config = excluded.config,
       updated_at = now()`,
    [site.slug, tenantId, siteStatus, templateVersion, JSON.stringify(site.config)],
  );
  const latest = site.revisions.at(-1);
  if (!latest) return;
  await getPool().query(
    `insert into tenant_site_revisions (revision_id, slug, status, config, created_at)
     values ($1,$2,$3,$4::jsonb,$5)
     on conflict (revision_id) do nothing`,
    [latest.revisionId, site.slug, latest.status, JSON.stringify(latest.config), latest.createdAt],
  );
}

/** 一次 demo 运行的完整落库。调用方负责先确认 persistenceEnabled()。 */
export async function persistDemoRun(run: DemoRunRecord): Promise<void> {
  await persistServiceCards(run.ranking.map((item) => item.service));
  await persistTask(run.task);
  for (const item of run.ranking) {
    await persistProbe(run.task.taskId, item);
    const evidence = run.evidenceByServiceId.get(`${item.service.id}:${run.task.taskId}`);
    if (evidence) await persistExecutionEvidence(run.task.taskId, evidence);
    if (item.execution) await persistExecutionResult(item.service.id, run.task.taskId, item.execution);
    if (item.product) await persistProductAssessment(item.service.id, run.task.taskId, run.task.batchId, item.product);
  }
  await persistServiceFeedback(run.feedback);
  await persistConsumerRun(run.consent, run.purchase, run.consumerFeedback);
}
