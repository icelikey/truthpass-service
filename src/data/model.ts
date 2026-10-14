export type DataMode = "demo/synthetic" | "external";
export type ProductCategory = "fish-oil";
export type EvidenceKind =
  | "production"
  | "inspection"
  | "cold_chain"
  | "shipment"
  | "purchase"
  | "consumer_feedback";
export type SourceKind = "manufacturer" | "third_party" | "platform_device" | "consumer";
export type EvidenceStatus = "submitted" | "revoked";

export const PRODUCTION_STAGES = [
  "raw_material_receipt",
  "refining",
  "concentration",
  "deodorization",
  "encapsulation",
  "packaging",
  "storage",
] as const;
export type ProductionStage = typeof PRODUCTION_STAGES[number];

export interface ProductionLot {
  lotId: string;
  quantity: number;
  unit: string;
}

export interface ProductionObservation {
  code: string;
  value: number;
  unit: string;
}

export interface ProductionDeviation {
  code: string;
  description: string;
  dispositionRef?: string;
}

export interface ProductionTraceability {
  originRegion: string;
}

export interface ProductionEvent {
  schemaVersion: "production.event.v1";
  stage: ProductionStage;
  sequence: number;
  startedAt: string;
  endedAt: string;
  inputs: ProductionLot[];
  outputs: ProductionLot[];
  observations: ProductionObservation[];
  deviations: ProductionDeviation[];
  sourceEvidenceIds: string[];
  legacyPayload?: Record<string, unknown>;
  traceability?: ProductionTraceability;
}

export interface EvidenceAttestation {
  algorithm: "Ed25519";
  keyId: string;
  nonce: string;
  expiresAt: string;
  signature: string;
}

export interface ProductRecord {
  schemaVersion: "product.v1";
  productId: string;
  name: string;
  category: ProductCategory;
  supplierId: string;
  claims: string[];
  dataMode: DataMode;
}

export interface BatchRecord {
  schemaVersion: "batch.v1";
  batchId: string;
  productId: string;
  supplierId: string;
  productionAt: string;
  fillingBatchId: string;
  dataMode: DataMode;
}

export interface NewEvidenceRecord {
  schemaVersion: "evidence.v1";
  evidenceId: string;
  batchId: string;
  kind: EvidenceKind;
  issuerId: string;
  sourceKind: SourceKind;
  occurredAt: string;
  payload: Record<string, unknown>;
  dataMode: DataMode;
  attestation?: EvidenceAttestation;
}

export interface EvidenceRecord extends NewEvidenceRecord {
  payloadHash: string;
  status: EvidenceStatus;
  createdAt: string;
}
