import { sha256Hex } from "./hash.js";
import { canonicalizeJson } from "./evidence.js";

export interface ConsumerConsent {
  consumerId: string;
  batchId: string;
  scopes: Array<"purchase" | "packaging" | "odor" | "storage" | "quality-feedback">;
  consentHash: string;
  grantedAt: string;
  expiresAt?: string;
  revokedAt?: string;
  version?: string;
}

export interface PurchaseRecord {
  purchaseId: string;
  consumerId: string;
  batchId: string;
  purchaseProofHash: string;
  createdAt: string;
  consentHash?: string;
}

export interface ConsumerFeedback {
  feedbackId: string;
  purchaseId: string;
  consumerId: string;
  batchId: string;
  rating: number;
  categories: string[];
  evidenceHash: string;
  createdAt: string;
  contributionPoints: number;
}

export class ConsumerParticipationRegistry {
  private readonly consents = new Map<string, ConsumerConsent>();
  private readonly purchases = new Map<string, PurchaseRecord>();
  private readonly feedback = new Map<string, ConsumerFeedback>();

  async grantConsent(input: Omit<ConsumerConsent, "consentHash">): Promise<ConsumerConsent> {
    if (input.scopes.length === 0) throw new Error("至少需要一个授权范围");
    if (!input.scopes.includes("purchase")) throw new Error("购买绑定必须包含 purchase 授权范围");
    const consentHash = await sha256Hex(canonicalizeJson(input));
    const consent = { ...input, consentHash };
    this.consents.set(`${input.consumerId}:${input.batchId}`, consent);
    return consent;
  }

  revokeConsent(consumerId: string, batchId: string, revokedAt = new Date().toISOString()): boolean {
    const key = `${consumerId}:${batchId}`;
    const consent = this.consents.get(key);
    if (!consent) return false;
    this.consents.set(key, { ...consent, revokedAt });
    return true;
  }

  async recordPurchase(input: Omit<PurchaseRecord, "purchaseId">): Promise<PurchaseRecord> {
    const consent = this.consents.get(`${input.consumerId}:${input.batchId}`);
    if (!consent) throw new Error("消费者尚未授权该批次的最小反馈范围");
    if (consent.revokedAt) throw new Error("消费者授权已撤销");
    if (consent.expiresAt && Date.parse(consent.expiresAt) <= Date.parse(input.createdAt)) throw new Error("消费者授权已过期");
    const purchaseId = await sha256Hex(`${input.consumerId}:${input.batchId}:${input.purchaseProofHash}`);
    const existing = this.purchases.get(purchaseId);
    if (existing) {
      if (existing.consumerId !== input.consumerId || existing.batchId !== input.batchId || existing.purchaseProofHash !== input.purchaseProofHash) {
        throw new Error("购买证明幂等键冲突");
      }
      return existing;
    }
    const purchase = { ...input, purchaseId, consentHash: consent.consentHash };
    this.purchases.set(purchaseId, purchase);
    return purchase;
  }

  async recordFeedback(input: {
    purchaseId: string;
    rating: number;
    categories: string[];
    evidence: Record<string, unknown>;
    createdAt?: string;
  }): Promise<ConsumerFeedback> {
    const purchase = this.purchases.get(input.purchaseId);
    if (!purchase) throw new Error("反馈必须绑定已登记的购买记录");
    if (input.rating < 1 || input.rating > 5) throw new Error("评分必须在 1 到 5 之间");
    const existing = [...this.feedback.values()].find((item) => item.purchaseId === input.purchaseId);
    if (existing) throw new Error("同一购买记录只能提交一次反馈");
    const createdAt = input.createdAt ?? new Date().toISOString();
    const evidenceHash = await sha256Hex(canonicalizeJson(input.evidence));
    const feedbackId = await sha256Hex(`${input.purchaseId}:${evidenceHash}`);
    const contributionPoints = Math.min(20, 5 + input.categories.length * 3);
    const feedback: ConsumerFeedback = {
      feedbackId,
      purchaseId: purchase.purchaseId,
      consumerId: purchase.consumerId,
      batchId: purchase.batchId,
      rating: input.rating,
      categories: input.categories,
      evidenceHash,
      createdAt,
      contributionPoints,
    };
    this.feedback.set(feedbackId, feedback);
    return feedback;
  }

  listFeedback(batchId?: string): ConsumerFeedback[] {
    return [...this.feedback.values()].filter((item) => !batchId || item.batchId === batchId);
  }
}
