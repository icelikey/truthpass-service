import type {
  ChatEvent,
  EvidenceStep,
  Journey,
  MetricDetail,
  ProductBatch,
  JevDetection,
  RecommendItem,
  OrderCard,
  ChainStatusData,
  WalletActionKind,
  WalletPrepareResponse,
  VerifiedChainTx,
  SessionChainTx,
  ChainContractMeta,
  LifecycleStage,
  LifecycleView,
} from "./types";
import { merchantRequestHeaders } from "./merchant/merchantApi";

export const BATCH_ID = "FO-2026-001";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const fetchProduct = (batchId: string) => getJson<ProductBatch>(`/api/products/${batchId}`);
export const fetchEvidenceLink = (batchId: string) => getJson<EvidenceStep[]>(`/api/products/${batchId}/evidence-link`);
export const fetchJourney = (batchId: string) => getJson<Journey>(`/api/products/${batchId}/journey`);
export const fetchLifecycle = (batchId: string) => getJson<LifecycleView>(`/api/products/${batchId}/lifecycle`);
export async function simulateLifecycleStage(batchId: string, stage: LifecycleStage): Promise<LifecycleView> {
  const res = await fetch("/api/simulator/lifecycle", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ batchId, stage }),
  });
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
  return (await res.json()) as LifecycleView;
}
export const fetchMetricDetail = (batchId: string, key: string) =>
  getJson<MetricDetail>(`/api/products/${batchId}/metrics/${key}`);
export const fetchJevDetection = (batchId?: string) =>
  getJson<JevDetection>(batchId ? `/api/jev/detection?batchId=${encodeURIComponent(batchId)}` : "/api/jev/detection");

export const fetchChainStatus = () => getJson<ChainStatusData>("/api/chain/status");
export const fetchAgentStatus = () => getJson<{ status: string; agentMode: string; providerConfigured?: boolean; model?: string | null; dataMode?: string }>("/api/agent/status");
export async function requestAgentReport(batchId: string, question = "请汇总当前批次生产、检测和公开证据，并给出下一步上链动作。", tenantId = "demo-tenant") {
  const headers = await merchantRequestHeaders(tenantId, true);
  const res = await fetch("/api/agent/v1/collaborate", {
    method: "POST",
    headers,
    body: JSON.stringify({ batchId, question, tenantId }),
  });
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
  return (await res.json()) as {
    agentMode: string;
    dataMode: string;
    contextRevision?: number;
    syncedAt?: string;
    verification?: { status?: string; evidenceRoot?: string };
    writePlan?: { status: string; action: string; eventName: string; requiredRole: string; evidenceRoot?: string; reportHash?: string; nextAction: string };
    selectedFacts?: string[];
    agentAudit?: { runId?: string; records?: Array<{ role: string; inputEvidenceIds: string[]; citedEvidenceIds?: string[]; selectedFactIds?: string[]; outputStatus: string; writeBoundary: string }>; finalDecisionSource?: string };
    traceId?: string;
  };
}

export async function prepareWalletTx(params: {
  action: WalletActionKind;
  batchId: string;
  wallet?: string;
  purchaseId?: string;
  challengeId?: string;
  points?: number;
  reason?: string;
}): Promise<WalletPrepareResponse> {
  const res = await fetch("/api/wallet/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return (await res.json()) as WalletPrepareResponse;
}

export async function confirmChainTx(params: {
  action: string;
  event: string;
  batchId: string;
  wallet: string;
  providerName?: string;
  contractAddress: string;
  txHash: string;
  blockNumber?: number;
  calldata?: string;
  signature?: string;
  mode?: "wallet_broadcast";
  ids?: Record<string, string | number>;
}): Promise<{ ok: boolean; transaction: SessionChainTx }> {
  const res = await fetch("/api/chain/tx-confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { ok: boolean; transaction: SessionChainTx };
}

export const fetchRecommend = () => getJson<RecommendItem[]>("/api/recommend");

export async function createOrder(batchId: string, quantity = 1): Promise<OrderCard> {
  const res = await fetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ batchId, quantity }),
  });
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
  return (await res.json()) as OrderCard;
}

export interface CliInspectData {
  schemaVersion: "truthpass.cli.inspect.v1";
  command: "inspect";
  batchId: string;
  stages: Array<{ name: string; status: "completed" | "pending"; detail: string }>;
  verification: {
    status: string;
    dataClass: string;
    policy: { id: string; version: string };
    evidenceRoot: string;
    evidence: Array<{ evidenceId: string; kind: string; sourceKind: string; status: string; dataMode: string }>;
    assessment?: { score: number; checks: Record<string, boolean>; reasons: string[] };
    anchor: {
      status: string;
      submitted: boolean;
      network?: string;
      chainId?: number;
      contractAddress?: string;
      txHash?: string;
      verificationTxHash?: string;
      explorerUrl?: string;
    };
    reasons: string[];
  };
  chain?: {
    chainId: number;
    chainName: string;
    explorerUrl: string;
    contracts: {
      evidenceAnchor: ChainContractMeta;
      consumerGateway: ChainContractMeta;
      auditEscrow: ChainContractMeta;
    };
    verifiedTransactions: VerifiedChainTx[];
  };
}

export const fetchCliInspect = (batchId: string) => getJson<CliInspectData>(`/api/cli/inspect?batchId=${encodeURIComponent(batchId)}`);

export type IotSimulationMode = "normal" | "cold_chain_gap" | "device_offline";
export async function postIotSimulation(batchId: string, mode: IotSimulationMode): Promise<{
  ok: boolean;
  evidenceId: string;
  payloadHash: string;
  message: string;
  pipeline?: string[];
  verification?: { status?: string; dataMode?: string; evidenceRoot?: string; reasons?: string[] };
}> {
  const res = await fetch("/api/simulator/iot", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ batchId, mode }),
  });
  if (!res.ok) throw new Error(await res.text() || `HTTP ${res.status}`);
  return (await res.json()) as { ok: boolean; evidenceId: string; payloadHash: string; message: string; pipeline?: string[]; verification?: { status?: string; dataMode?: string; evidenceRoot?: string; reasons?: string[] } };
}

export async function postChat(
  question: string,
  batchId: string | null,
  onEvent: (event: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch("/api/agent/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ batchId, messages: [{ role: "user", content: question }] }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error("stream unavailable");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() ?? "";
    for (const part of parts) {
      const line = part.trim();
      if (!line.startsWith("data:")) continue;
      onEvent(JSON.parse(line.slice(5).trim()) as ChatEvent);
    }
  }
}

export interface ObserverServiceView {
  id: string;
  history: number;
  live: "degraded" | "offline" | "online";
  verdict: "rejected" | "not-called" | "passed";
}

export interface ObserverData {
  task: string;
  policy: string;
  jev: string;
  evidenceRoot: string;
  chainStatus: string;
  chainId?: number;
  contractAddress?: string;
  consumerGatewayAddress?: string;
  auditEscrowAddress?: string;
  explorerUrl?: string;
  verifiedTransactions?: VerifiedChainTx[];
  sessionTransactions?: SessionChainTx[];
  services: ObserverServiceView[];
}

export const fetchObserver = (batchId: string) => getJson<ObserverData>(`/api/observer?batchId=${batchId}`);

export async function postFeedback(
  batchId: string,
  rating: number,
  categories: string[],
  consent: boolean,
  purchaseConfirmed: boolean,
  comment?: string,
): Promise<{
  ok: boolean;
  persisted: boolean;
  feedbackId?: string;
  purchaseId?: string;
  contributionPoints: number;
  evidenceHash: string;
}> {
  const res = await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ batchId, rating, categories, consent, purchaseConfirmed, comment }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as {
    ok: boolean;
    persisted: boolean;
    feedbackId?: string;
    purchaseId?: string;
    contributionPoints: number;
    evidenceHash: string;
  };
}

export interface VerificationRule {
  name: string;
  desc: string;
  passed: boolean;
}

export interface VerificationEvidence {
  evidenceId: string;
  kind: string;
  issuerId: string;
  sourceKind: string;
  payloadHash: string;
  status: string;
  occurredAt: string;
}

export interface VerificationData {
  batchId: string;
  productName: string;
  policy: { id: string; version: string; dataMode: string };
  status: string;
  score: number;
  evidenceHash: string;
  serviceExecution: { status: string; score: number; evidenceHash: string };
  rules: VerificationRule[];
  evidence: VerificationEvidence[];
}

export const fetchVerification = (batchId: string) => getJson<VerificationData>(`/api/verification?batchId=${batchId}`);
