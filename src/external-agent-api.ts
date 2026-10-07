import {
  buildConsumerEvidenceReport,
  type ConsumerEvidenceReport,
  type EvidenceEnvelope,
  type EvidenceGateway,
} from "./evidence.js";
import { selectRandomAudits, type AuditCandidate } from "./audit.js";

export interface AgentApiRequest {
  method: "GET" | "POST";
  path: string;
  body?: unknown;
  query?: Record<string, string | undefined>;
}

export interface AgentApiResponse {
  status: number;
  body: Record<string, unknown>;
}

type VerificationInput = {
  status: "accepted" | "rejected" | "partial";
  checks: Record<string, boolean>;
  reasons: string[];
};

function asEnvelope(value: unknown): EvidenceEnvelope {
  if (typeof value !== "object" || value === null) throw new Error("request body must be an evidence envelope");
  return value as EvidenceEnvelope;
}

function asVerification(value: unknown): VerificationInput {
  if (typeof value !== "object" || value === null) throw new Error("verification is required");
  return value as VerificationInput;
}

export class ExternalAgentApi {
  constructor(private readonly gateway: EvidenceGateway) {}

  async handle(request: AgentApiRequest): Promise<AgentApiResponse> {
    try {
      if (request.method === "POST" && request.path === "/v1/evidence/events") {
        const stored = await this.gateway.ingest(asEnvelope(request.body));
        return {
          status: stored.validation.status === "rejected" ? 422 : 202,
          body: {
            eventId: stored.envelope.eventId,
            status: stored.validation.status,
            evidenceHash: stored.validation.eventHash,
            reasons: stored.validation.reasons,
            checks: stored.validation.checks,
          },
        };
      }

      const batchMatch = request.path.match(/^\/v1\/batches\/([^/]+)\/evidence$/);
      if (request.method === "GET" && batchMatch) {
        const batchId = decodeURIComponent(batchMatch[1]);
        return {
          status: 200,
          body: {
            batchId,
            evidence: this.gateway.listForBatch(batchId, {
              allowRaw: request.query?.allowRaw === "true",
            }),
          },
        };
      }

      const reportMatch = request.path.match(/^\/v1\/batches\/([^/]+)\/consumer-report$/);
      if (request.method === "POST" && reportMatch) {
        const body = (request.body ?? {}) as {
          verification?: unknown;
          requestedChecks?: unknown;
        };
        const batchId = decodeURIComponent(reportMatch[1]);
        const requestedChecks = Array.isArray(body.requestedChecks)
          ? body.requestedChecks.filter((value): value is string => typeof value === "string")
          : [];
        const report = buildConsumerEvidenceReport(
          batchId,
          asVerification(body.verification),
          this.gateway.listForBatch(batchId),
          requestedChecks,
        );
        return { status: 200, body: report as unknown as Record<string, unknown> };
      }

      if (request.method === "POST" && request.path === "/v1/audits/random") {
        const body = (request.body ?? {}) as { candidates?: unknown; count?: unknown; seed?: unknown };
        if (!Array.isArray(body.candidates) || typeof body.seed !== "string" || typeof body.count !== "number") {
          throw new Error("candidates, count and seed are required");
        }
        const selection = await selectRandomAudits(
          body.candidates as AuditCandidate[],
          body.count,
          body.seed,
        );
        return { status: 200, body: selection as unknown as Record<string, unknown> };
      }

      return { status: 404, body: { error: "route_not_found" } };
    } catch (error) {
      return {
        status: 400,
        body: { error: error instanceof Error ? error.message : String(error) },
      };
    }
  }
}

export type ConsumerReportResponse = ConsumerEvidenceReport;

