import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { loadExecutionEvidenceFromPostgres, loadRepositoryFromPostgres } from "../src/data/postgres-reader.js";

test("loads PostgreSQL product, batch, evidence, revocation, and metric columns without writes", async () => {
  const queries: string[] = [];
  const pool = {
    async query(sql: string) {
      queries.push(sql);
      if (sql.includes("from products")) return { rows: [{ product_id: "P-1", name: "Fish oil", category: "fish-oil", supplier_id: "S-1", claims: ["EPA"], data_mode: "demo/synthetic" }] };
      if (sql.includes("from batches")) return { rows: [{ batch_id: "B-1", product_id: "P-1", supplier_id: "S-1", production_at: "2026-10-06T08:00:00Z", filling_batch_id: "F-1", data_mode: "demo/synthetic" }] };
      if (sql.includes("from evidence")) return { rows: [{ evidence_id: "E-1", batch_id: "B-1", kind: "inspection", issuer_id: "L-1", source_kind: "third_party", occurred_at: "2026-10-06T10:00:00Z", payload: { epaDhaPercent: 78 }, data_mode: "demo/synthetic", attestation: null, status: "revoked" }] };
      if (sql.includes("from execution_evidence")) return { rows: [{ service_id: "L-1", task_id: "T-1", batch_id: "B-1", report_batch_id: "B-1", production_time: "2026-10-06T08:00:00Z", report_time: "2026-10-06T10:00:00Z", logistics_gap_hours: "2", signature_valid: true, epa_dha_percent: "78", peroxide_value: "2.1", totox: "11", cold_chain_gap_hours: "2", payload: { evidenceMode: "demo/synthetic" } }] };
      throw new Error("unexpected query");
    },
  } as unknown as Pool;

  const repository = await loadRepositoryFromPostgres(pool);
  const execution = await loadExecutionEvidenceFromPostgres("T-1", "B-1", pool);

  assert.equal(repository.getProduct("P-1")?.name, "Fish oil");
  assert.equal(repository.getBatch("B-1")?.fillingBatchId, "F-1");
  assert.equal(repository.getEvidence("E-1")?.status, "revoked");
  assert.equal(execution[0]?.epaDhaPercent, 78);
  assert.equal(execution[0]?.payload.epaDhaPercent, 78);
  assert.equal(queries.length, 4);
  assert.ok(queries.every((query) => /^\s*select\b/i.test(query)));
});
