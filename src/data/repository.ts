import { sha256Hex } from "../hash.js";
import { canonicalJson } from "./canonical.js";
import type { BatchRecord, EvidenceRecord, EvidenceStatus, NewEvidenceRecord, ProductRecord, ProductionEvent } from "./model.js";
import { validateBatch, validateEvidence, validateProduct, validateProductionEvent } from "./validation.js";

export class MemoryDataRepository {
  private readonly products = new Map<string, ProductRecord>();
  private readonly batches = new Map<string, BatchRecord>();
  private readonly evidence = new Map<string, EvidenceRecord>();

  createProduct(product: ProductRecord): ProductRecord {
    assertValid(validateProduct(product));
    if (this.products.has(product.productId)) throw new Error("productId 已存在");
    const stored = structuredClone(product);
    this.products.set(stored.productId, stored);
    return structuredClone(stored);
  }

  createBatch(batch: BatchRecord): BatchRecord {
    assertValid(validateBatch(batch));
    if (!this.products.has(batch.productId)) throw new Error("batch 绑定的 product 不存在");
    if (this.batches.has(batch.batchId)) throw new Error("batchId 已存在");
    const stored = structuredClone(batch);
    this.batches.set(stored.batchId, stored);
    return structuredClone(stored);
  }

  async addEvidence(input: NewEvidenceRecord): Promise<EvidenceRecord> {
    assertValid(validateEvidence(input));
    if (!this.batches.has(input.batchId)) throw new Error("evidence 绑定的 batch 不存在");
    if (this.evidence.has(input.evidenceId)) throw new Error("evidenceId 已存在");
    if (input.kind === "production") {
      const event = input.payload as unknown as ProductionEvent;
      assertValid(validateProductionEvent(event));
      for (const sourceEvidenceId of event.sourceEvidenceIds) {
        const source = this.evidence.get(sourceEvidenceId);
        if (!source) throw new Error("sourceEvidenceId " + sourceEvidenceId + " 不存在");
        if (source.batchId !== input.batchId) throw new Error("sourceEvidenceId " + sourceEvidenceId + " 不属于同一批次");
      }
    }
    const record: EvidenceRecord = {
      ...input,
      payloadHash: await sha256Hex(canonicalJson(input.payload)),
      status: "submitted",
      createdAt: new Date().toISOString(),
    };
    const stored = structuredClone(record);
    this.evidence.set(stored.evidenceId, stored);
    return structuredClone(stored);
  }

  async importEvidence(input: NewEvidenceRecord, status: EvidenceStatus): Promise<EvidenceRecord> {
    const imported = await this.addEvidence(input);
    if (status === "revoked") this.revokeEvidence(imported.evidenceId);
    return this.getEvidence(imported.evidenceId)!;
  }

  getProduct(productId: string): ProductRecord | undefined {
    const product = this.products.get(productId);
    return product ? structuredClone(product) : undefined;
  }

  getBatch(batchId: string): BatchRecord | undefined {
    const batch = this.batches.get(batchId);
    return batch ? structuredClone(batch) : undefined;
  }

  getEvidence(evidenceId: string): EvidenceRecord | undefined {
    const evidence = this.evidence.get(evidenceId);
    return evidence ? structuredClone(evidence) : undefined;
  }

  listEvidence(batchId: string): EvidenceRecord[] {
    return [...this.evidence.values()]
      .filter((record) => record.batchId === batchId)
      .map((record) => structuredClone(record));
  }

  revokeEvidence(evidenceId: string): boolean {
    const evidence = this.evidence.get(evidenceId);
    if (!evidence || evidence.status === "revoked") return false;
    evidence.status = "revoked";
    return true;
  }
}

function assertValid(result: { ok: boolean; errors: string[] }): asserts result is { ok: true; errors: [] } {
  if (!result.ok) throw new Error(result.errors.join("；"));
}
