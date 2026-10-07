import type { ProductBatchAssessment } from "../types.js";

export const CLI_SCHEMA_VERSION = "truthpass.cli.result.v1" as const;

export type CliStatus = "accepted" | "rejected" | "partial" | "missing_evidence" | "service_offline";

export interface CliEvidenceReference {
  evidenceId: string;
  kind: string;
  sourceKind: string;
  status: string;
  dataMode: "demo/synthetic" | "external";
}

export interface CliVerificationResult {
  schemaVersion: typeof CLI_SCHEMA_VERSION;
  dataClass: "demo/synthetic" | "external";
  command: "verify";
  batchId: string;
  status: CliStatus;
  policy: { id: string; version: string };
  assessment?: ProductBatchAssessment;
  evidence: CliEvidenceReference[];
  evidenceRoot: string;
  anchor: { status: "not_requested" | "anchor_pending"; network?: string; submitted: false };
  reasons: string[];
}
