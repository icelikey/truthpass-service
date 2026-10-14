// Demo 运行结果的持久化 Sink：把一次端到端演示写进 Supabase/Postgres。
// 约束:
//   * 全部参数绑定（$1...），绝不拼接 SQL；
//   * 幂等（on conflict do nothing / 唯一索引去重），demo 重复执行不产生重复流水；
//   * TLS 严格校验：固定 Supabase Root 2021 CA + 主机名验证，绝不关闭证书校验；
//     官方 CA 可从 Dashboard → Database settings 下载后覆盖 certs/prod-ca-2021.crt；
//   * 开关 persistenceEnabled() = 存在 DATABASE_URL 且 DATA_BACKEND != memory。
import { readFileSync } from "node:fs";
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

function sslConfig(): { ca: string; rejectUnauthorized: true } {
  // 固定路径：项目 certs 目录下的 Supabase Root CA（公开证书，非用户可控输入）
  return { ca: readFileSync(CA_PATH, "utf8"), rejectUnauthorized: true };
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
    `insert into consumer_feedbacks (feedback_id, purchase_id, consumer_id, batch_id, rating, categories, evidence_hash, created_at, contribution_points)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (feedback_id) do nothing`,
    [feedback.feedbackId, feedback.purchaseId, feedback.consumerId, feedback.batchId, feedback.rating,
     feedback.categories, feedback.evidenceHash, feedback.createdAt, feedback.contributionPoints],
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
