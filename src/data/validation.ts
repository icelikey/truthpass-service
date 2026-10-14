import { PRODUCTION_STAGES, type BatchRecord, type NewEvidenceRecord, type ProductRecord, type ProductionEvent } from "./model.js";

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

const nonEmpty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
const validDate = (value: unknown): value is string => nonEmpty(value) && !Number.isNaN(Date.parse(value));
const plainObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const exactKeys = (value: Record<string, unknown>, allowed: string[]): boolean => Object.keys(value).every((key) => allowed.includes(key));

export function validateProduct(value: unknown): ValidationResult {
  const product = value as Partial<ProductRecord>;
  const errors: string[] = [];
  if (product.schemaVersion !== "product.v1") errors.push("schemaVersion 必须为 product.v1");
  if (!nonEmpty(product.productId)) errors.push("productId 不能为空");
  if (!nonEmpty(product.name)) errors.push("name 不能为空");
  if (product.category !== "fish-oil") errors.push("category 必须为 fish-oil");
  if (!nonEmpty(product.supplierId)) errors.push("supplierId 不能为空");
  if (!Array.isArray(product.claims) || product.claims.some((claim) => !nonEmpty(claim))) errors.push("claims 必须是非空字符串数组");
  if (product.dataMode !== "demo/synthetic" && product.dataMode !== "external") errors.push("dataMode 不合法");
  return { ok: errors.length === 0, errors };
}

export function validateBatch(value: unknown): ValidationResult {
  const batch = value as Partial<BatchRecord>;
  const errors: string[] = [];
  if (batch.schemaVersion !== "batch.v1") errors.push("schemaVersion 必须为 batch.v1");
  if (!nonEmpty(batch.batchId)) errors.push("batchId 不能为空");
  if (!nonEmpty(batch.productId)) errors.push("productId 不能为空");
  if (!nonEmpty(batch.supplierId)) errors.push("supplierId 不能为空");
  if (!validDate(batch.productionAt)) errors.push("productionAt 必须是有效时间");
  if (!nonEmpty(batch.fillingBatchId)) errors.push("fillingBatchId 不能为空");
  if (batch.dataMode !== "demo/synthetic" && batch.dataMode !== "external") errors.push("dataMode 不合法");
  return { ok: errors.length === 0, errors };
}

export function validateEvidence(value: unknown): ValidationResult {
  const evidence = value as Partial<NewEvidenceRecord>;
  const errors: string[] = [];
  if (evidence.schemaVersion !== "evidence.v1") errors.push("schemaVersion 必须为 evidence.v1");
  if (!nonEmpty(evidence.evidenceId)) errors.push("evidenceId 不能为空");
  if (!nonEmpty(evidence.batchId)) errors.push("batchId 不能为空");
  if (!["production", "inspection", "cold_chain", "shipment", "purchase", "consumer_feedback"].includes(evidence.kind ?? "")) errors.push("kind 不合法");
  if (!nonEmpty(evidence.issuerId)) errors.push("issuerId 不能为空");
  if (!["manufacturer", "third_party", "platform_device", "consumer"].includes(evidence.sourceKind ?? "")) errors.push("sourceKind 不合法");
  if (!validDate(evidence.occurredAt)) errors.push("occurredAt 必须是有效时间");
  if (!evidence.payload || typeof evidence.payload !== "object" || Array.isArray(evidence.payload)) errors.push("payload 必须是对象");
  if (evidence.kind === "production" && plainObject(evidence.payload)) {
    errors.push(...validateProductionEvent(evidence.payload).errors.map((error) => "payload." + error));
  }
  if (evidence.dataMode !== "demo/synthetic" && evidence.dataMode !== "external") errors.push("dataMode 不合法");
  if (evidence.attestation !== undefined) {
    const attestation = evidence.attestation as unknown;
    if (!attestation || typeof attestation !== "object" || Array.isArray(attestation)) {
      errors.push("attestation 必须是对象");
    } else {
      const fields = attestation as Record<string, unknown>;
      if (Object.keys(fields).some((key) => !["algorithm", "keyId", "nonce", "expiresAt", "signature"].includes(key))) errors.push("attestation 包含未知字段");
      if (fields.algorithm !== "Ed25519") errors.push("attestation.algorithm 必须为 Ed25519");
      if (!nonEmpty(fields.keyId)) errors.push("attestation.keyId 不能为空");
      if (typeof fields.nonce !== "string" || !/^[a-f0-9]{32}$/.test(fields.nonce)) errors.push("attestation.nonce 必须是 32 位十六进制字符串");
      if (typeof fields.expiresAt !== "string" || Number.isNaN(Date.parse(fields.expiresAt))) errors.push("attestation.expiresAt 必须是有效时间");
      if (typeof fields.signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(fields.signature)) errors.push("attestation.signature 必须是 Ed25519 Base64 签名");
    }
  }
  return { ok: errors.length === 0, errors };
}

export function validateProductionEvent(value: unknown): ValidationResult {
  const errors: string[] = [];
  if (!plainObject(value)) return { ok: false, errors: ["必须是对象"] };
  if (!exactKeys(value, ["schemaVersion", "stage", "sequence", "startedAt", "endedAt", "inputs", "outputs", "observations", "deviations", "sourceEvidenceIds", "legacyPayload", "traceability"])) errors.push("包含未定义字段");
  const event = value as Partial<ProductionEvent>;
  if (event.schemaVersion !== "production.event.v1") errors.push("schemaVersion 必须为 production.event.v1");
  if (!PRODUCTION_STAGES.includes(event.stage as ProductionEvent["stage"])) errors.push("stage 不合法");
  if (!Number.isInteger(event.sequence) || (event.sequence ?? 0) <= 0) errors.push("sequence 必须是正整数");
  if (!validDate(event.startedAt)) errors.push("startedAt 必须是有效时间");
  if (!validDate(event.endedAt)) errors.push("endedAt 必须是有效时间");
  if (validDate(event.startedAt) && validDate(event.endedAt) && Date.parse(event.endedAt) < Date.parse(event.startedAt)) errors.push("endedAt 不能早于 startedAt");
  validateLots(event.inputs, "inputs", errors);
  validateLots(event.outputs, "outputs", errors);
  if (!Array.isArray(event.observations)) errors.push("observations 必须是数组");
  else for (const [index, observation] of event.observations.entries()) {
    if (!plainObject(observation) || !exactKeys(observation, ["code", "value", "unit"]) || !nonEmpty(observation.code) || !Number.isFinite(observation.value) || !nonEmpty(observation.unit)) errors.push("observations[" + index + "] 无效");
  }
  if (!Array.isArray(event.deviations)) errors.push("deviations 必须是数组");
  else for (const [index, deviation] of event.deviations.entries()) {
    if (!plainObject(deviation) || !exactKeys(deviation, ["code", "description", "dispositionRef"]) || !nonEmpty(deviation.code) || !nonEmpty(deviation.description) || (deviation.dispositionRef !== undefined && !nonEmpty(deviation.dispositionRef))) errors.push("deviations[" + index + "] 无效");
  }
  if (!Array.isArray(event.sourceEvidenceIds) || event.sourceEvidenceIds.some((id) => !nonEmpty(id))) errors.push("sourceEvidenceIds 必须是字符串数组");
  if (event.legacyPayload !== undefined && !plainObject(event.legacyPayload)) errors.push("legacyPayload 必须是对象");
  if (event.traceability !== undefined && (!plainObject(event.traceability) || !exactKeys(event.traceability, ["originRegion"]) || !nonEmpty(event.traceability.originRegion))) errors.push("traceability.originRegion 必须是非空字符串");
  return { ok: errors.length === 0, errors };
}

function validateLots(value: unknown, name: string, errors: string[]): void {
  if (!Array.isArray(value)) {
    errors.push(name + " 必须是数组");
    return;
  }
  for (const [index, lot] of value.entries()) {
    if (!plainObject(lot) || !exactKeys(lot, ["lotId", "quantity", "unit"]) || !nonEmpty(lot.lotId) || typeof lot.quantity !== "number" || !Number.isFinite(lot.quantity) || lot.quantity < 0 || !nonEmpty(lot.unit)) errors.push(name + "[" + index + "] 无效");
  }
}
