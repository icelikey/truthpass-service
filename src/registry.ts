import { sha256Hex } from "./hash.js";
import { assessProductBatch, verifyServiceExecution } from "./verifier.js";
import type {
  FeedbackRecord,
  ProbeResult,
  ServiceAdapter,
  ServiceCard,
  TaskRequest,
  ProductBatchAssessment,
  ServiceExecutionResult,
  EvidenceMode,
  SignatureVerification,
} from "./types.js";
import { attestationReplayKey, verifyExecutionEvidenceAttestation, type ReplayGuard, type TrustedIssuerKeyResolver } from "./security/evidence-signatures.js";

interface RegisteredService {
  card: ServiceCard;
  adapter: ServiceAdapter;
  evidenceMode: EvidenceMode;
}

export interface RankedService {
  service: ServiceCard;
  probe: ProbeResult;
  execution?: ServiceExecutionResult;
  /** Legacy alias retained for the CLI/replay contract. */
  verification?: ServiceExecutionResult;
  product?: ProductBatchAssessment;
  eligible: boolean;
  score: number;
}

export class ServiceRegistry {
  private readonly services = new Map<string, RegisteredService>();
  private readonly feedback = new Map<string, FeedbackRecord>();
  private readonly resolveTrustedKey?: TrustedIssuerKeyResolver;
  private readonly replayGuard?: ReplayGuard;

  constructor(resolveTrustedKey?: TrustedIssuerKeyResolver, replayGuard?: ReplayGuard) {
    this.resolveTrustedKey = resolveTrustedKey;
    this.replayGuard = replayGuard;
  }

  register(card: ServiceCard, adapter: ServiceAdapter, evidenceMode: EvidenceMode = "external"): void {
    this.services.set(card.id, { card, adapter, evidenceMode });
  }

  async evaluate(task: TaskRequest): Promise<RankedService[]> {
    const candidates = [...this.services.values()].filter(({ card }) =>
      card.kind === task.serviceKind && card.capabilities.includes(task.capability),
    );

    const ranked: RankedService[] = [];
    for (const candidate of candidates) {
      const probe = await candidate.adapter.probe(task);
      let execution: ServiceExecutionResult | undefined;
      let product: ProductBatchAssessment | undefined;
      if (probe.status !== "offline" && probe.capabilityMatch && probe.schemaValid) {
        const evidence = await candidate.adapter.execute(task);
        let signatureVerification: SignatureVerification = evidence.serviceId !== candidate.card.id
          ? "invalid"
          : candidate.evidenceMode === "demo/synthetic"
            ? evidence.signatureValid === true ? "demo" : "invalid"
            : "invalid";
        if (signatureVerification === "invalid" && candidate.evidenceMode === "external" && this.resolveTrustedKey && this.replayGuard && evidence.attestation && verifyExecutionEvidenceAttestation(evidence, this.resolveTrustedKey)) {
          try {
            signatureVerification = await this.replayGuard.reserve(attestationReplayKey(`service:${candidate.card.id}`, evidence.attestation)) ? "verified" : "invalid";
          } catch {
            signatureVerification = "invalid";
          }
        }
        execution = await verifyServiceExecution(task, evidence, signatureVerification);
        product = await assessProductBatch(task, evidence);
      }

      const liveScore = probe.status === "healthy" ? 100 : probe.status === "degraded" ? 55 : 0;
      const acceptanceScore = execution?.score ?? 0;
      const score = Math.round(
        candidate.card.historicalScore * 0.25 + liveScore * 0.2 + acceptanceScore * 0.55,
      );
      const eligible = execution?.status === "accepted" && product?.status === "accepted";
      ranked.push({ service: candidate.card, probe, execution, verification: execution, product, eligible, score });
    }

    return ranked.sort((a, b) => Number(b.eligible) - Number(a.eligible) || b.score - a.score);
  }

  async recordFeedback(
    serviceId: string,
    task: TaskRequest,
    result: ServiceExecutionResult,
    createdAt = new Date().toISOString(),
  ): Promise<FeedbackRecord> {
    const feedbackId = await sha256Hex(`${serviceId}:${task.taskId}:${result.evidenceHash}`);
    const record: FeedbackRecord = {
      feedbackId,
      serviceId,
      taskId: task.taskId,
      accepted: result.status === "accepted",
      score: result.score,
      evidenceHash: result.evidenceHash,
      createdAt,
      revoked: false,
    };
    this.feedback.set(feedbackId, record);
    return record;
  }

  listFeedback(serviceId?: string): FeedbackRecord[] {
    return [...this.feedback.values()].filter((item) => !serviceId || item.serviceId === serviceId);
  }
}
