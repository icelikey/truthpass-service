import { sha256Hex } from "./hash.js";

export interface PollTarget {
  targetId: string;
  kind: "device" | "lab" | "manufacturer" | "logistics";
  intervalMs: number;
  lastObservedAt?: string;
  riskWeight: number;
}

export interface PollPlan {
  targetId: string;
  kind: PollTarget["kind"];
  due: boolean;
  dueAt: string;
  reason: "interval" | "never_observed" | "risk_escalation";
}

export function planPolls(targets: PollTarget[], now = new Date()): PollPlan[] {
  return targets.map((target) => {
    const last = target.lastObservedAt === undefined ? undefined : Date.parse(target.lastObservedAt);
    const due = last === undefined || !Number.isFinite(last)
      ? true
      : now.getTime() - last >= target.intervalMs;
    return {
      targetId: target.targetId,
      kind: target.kind,
      due,
      dueAt: new Date(
        last === undefined || !Number.isFinite(last)
          ? now.getTime()
          : last + target.intervalMs,
      ).toISOString(),
      reason: last === undefined || !Number.isFinite(last) ? "never_observed" : "interval",
    };
  });
}

export interface AuditCandidate {
  candidateId: string;
  batchId: string;
  riskWeight: number;
  strata: string;
}

export interface RandomAuditSelection {
  seedCommitment: string;
  selected: AuditCandidate[];
  candidateOrder: string[];
}

export async function selectRandomAudits(
  candidates: AuditCandidate[],
  count: number,
  seed: string,
): Promise<RandomAuditSelection> {
  if (!Number.isInteger(count) || count < 0) throw new Error("count must be a non-negative integer");
  if (count > candidates.length) throw new Error("count exceeds candidate count");
  if (candidates.some((candidate) => candidate.riskWeight <= 0)) {
    throw new Error("riskWeight must be greater than zero");
  }
  const scored = await Promise.all(candidates.map(async (candidate) => {
    const digest = await sha256Hex(seed + ":" + candidate.candidateId);
    const randomScore = Number.parseInt(digest.slice(0, 12), 16) / 0xffffffffffff;
    return {
      candidate,
      score: randomScore / candidate.riskWeight,
      digest,
    };
  }));
  scored.sort((left, right) =>
    left.score - right.score ||
    left.candidate.candidateId.localeCompare(right.candidate.candidateId),
  );
  return {
    seedCommitment: await sha256Hex(seed),
    selected: scored.slice(0, count).map((item) => item.candidate),
    candidateOrder: scored.map((item) => item.candidate.candidateId),
  };
}

