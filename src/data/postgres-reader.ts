import type { Pool } from "pg";
import { getDatabasePool } from "./persistence.js";
import type { NewEvidenceRecord, ProductRecord, BatchRecord } from "./model.js";
import { MemoryDataRepository } from "./repository.js";
import type { ExecutionEvidence } from "../types.js";

type DbRow = Record<string, unknown>;

export async function loadRepositoryFromPostgres(pool: Pool = getDatabasePool()): Promise<MemoryDataRepository> {
  const repository = new MemoryDataRepository();
  const products = await pool.query<DbRow>(
    `select product_id, name, category, supplier_id, claims, data_mode from products order by product_id`,
  );
  for (const row of products.rows) {
    repository.createProduct({
      schemaVersion: "product.v1",
      productId: String(row.product_id),
      name: String(row.name),
      category: row.category as ProductRecord["category"],
      supplierId: String(row.supplier_id),
      claims: (row.claims ?? []) as string[],
      dataMode: row.data_mode as ProductRecord["dataMode"],
    });
  }

  const batches = await pool.query<DbRow>(
    `select batch_id, product_id, supplier_id, production_at, filling_batch_id, data_mode from batches order by batch_id`,
  );
  for (const row of batches.rows) {
    repository.createBatch({
      schemaVersion: "batch.v1",
      batchId: String(row.batch_id),
      productId: String(row.product_id),
      supplierId: String(row.supplier_id),
      productionAt: new Date(String(row.production_at)).toISOString(),
      fillingBatchId: String(row.filling_batch_id),
      dataMode: row.data_mode as BatchRecord["dataMode"],
    });
  }

  const evidence = await pool.query<DbRow>(
    `select evidence_id, batch_id, kind, issuer_id, source_kind, occurred_at, payload, data_mode, attestation, status
     from evidence order by created_at, evidence_id`,
  );
  const pending = evidence.rows.map((row) => ({
    record: {
      schemaVersion: "evidence.v1" as const,
      evidenceId: String(row.evidence_id),
      batchId: String(row.batch_id),
      kind: row.kind as NewEvidenceRecord["kind"],
      issuerId: String(row.issuer_id),
      sourceKind: row.source_kind as NewEvidenceRecord["sourceKind"],
      occurredAt: new Date(String(row.occurred_at)).toISOString(),
      payload: normalizeEvidencePayload(row.kind as NewEvidenceRecord["kind"], (row.payload ?? {}) as Record<string, unknown>, new Date(String(row.occurred_at)).toISOString()),
      dataMode: row.data_mode as NewEvidenceRecord["dataMode"],
      attestation: row.attestation ? row.attestation as NewEvidenceRecord["attestation"] : undefined,
    } satisfies NewEvidenceRecord,
    status: row.status === "revoked" ? "revoked" as const : "submitted" as const,
  }));

  while (pending.length > 0) {
    const before = pending.length;
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      try {
        const item = pending[index]!;
        await repository.importEvidence(item.record, item.status);
        pending.splice(index, 1);
      } catch (error) {
        if (!(error instanceof Error) || !/sourceEvidenceId .* 不存在/.test(error.message)) throw error;
      }
    }
    if (pending.length === before) throw new Error("数据库证据存在无法解析的 sourceEvidenceId 依赖");
  }
  return repository;
}

function normalizeEvidencePayload(kind: NewEvidenceRecord["kind"], payload: Record<string, unknown>, occurredAt: string): Record<string, unknown> {
  if (kind !== "production" || payload.schemaVersion === "production.event.v1") return payload;
  return {
    schemaVersion: "production.event.v1",
    stage: "raw_material_receipt",
    sequence: 1,
    startedAt: occurredAt,
    endedAt: occurredAt,
    inputs: [],
    outputs: [],
    observations: [],
    deviations: [{ code: "legacy_payload_unmapped", description: "数据库中的旧生产记录未提供 production.event.v1 字段，不能作为完整过程证据" }],
    sourceEvidenceIds: [],
    legacyPayload: payload,
  };
}

export async function loadExecutionEvidenceFromPostgres(taskId: string, batchId: string, pool: Pool = getDatabasePool()): Promise<ExecutionEvidence[]> {
  const result = await pool.query<DbRow>(
    `select service_id, task_id, batch_id, report_batch_id, production_time, report_time,
            logistics_gap_hours, signature_valid, epa_dha_percent, peroxide_value, totox,
            cold_chain_gap_hours, payload
     from execution_evidence where task_id = $1 and batch_id = $2 order by report_time, id`,
    [taskId, batchId],
  );
  return result.rows.map((row) => {
    const payload = (row.payload ?? {}) as Record<string, unknown>;
    return {
      serviceId: String(row.service_id),
      taskId: String(row.task_id),
      batchId: String(row.batch_id),
      reportBatchId: String(row.report_batch_id),
      productionTime: new Date(String(row.production_time)).toISOString(),
      reportTime: new Date(String(row.report_time)).toISOString(),
      logisticsGapHours: Number(row.logistics_gap_hours),
      signatureValid: row.signature_valid === true,
      epaDhaPercent: row.epa_dha_percent == null ? undefined : Number(row.epa_dha_percent),
      peroxideValue: row.peroxide_value == null ? undefined : Number(row.peroxide_value),
      totox: row.totox == null ? undefined : Number(row.totox),
      coldChainGapHours: row.cold_chain_gap_hours == null ? undefined : Number(row.cold_chain_gap_hours),
      payload: {
        ...payload,
        taskId: String(row.task_id),
        reportBatchId: String(row.report_batch_id),
        logisticsGapHours: Number(row.logistics_gap_hours),
        signatureValid: row.signature_valid === true,
        epaDhaPercent: row.epa_dha_percent == null ? undefined : Number(row.epa_dha_percent),
        peroxideValue: row.peroxide_value == null ? undefined : Number(row.peroxide_value),
        totox: row.totox == null ? undefined : Number(row.totox),
        coldChainGapHours: row.cold_chain_gap_hours == null ? undefined : Number(row.cold_chain_gap_hours),
      },
    };
  });
}
