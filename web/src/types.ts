// 与后端 examples/*.json 及 src/types.ts 对齐的前端视图模型。

export interface KeyMetric {
  key: string;
  icon: string;
  label: string;
  value: string;
  unit: string;
  bar: number;
  status: "pass" | "missing" | "fail";
}

export type ProductionCoverageStatus = "observed" | "missing" | "restricted" | "not_covered";

export interface ProductionPublicSummary {
  schemaVersion: "production.public.v1";
  dataMode: "demo/synthetic" | "external";
  status: "conformant" | "nonconformant" | "incomplete" | "review";
  originRegion?: string;
  sourceKinds: Array<"manufacturer" | "third_party" | "platform_device" | "consumer">;
  observedStageCount: number;
  requiredStageCount: number;
  stages: Array<{ stage: string; label: string; status: ProductionCoverageStatus }>;
  missingStages: string[];
  facts: Array<{ label: string; value: string; stage: string; sourceKind: string }>;
}

export interface ProductBatch {
  batchId: string;
  name: string;
  category: string;
  origin: string;
  productionDate: string;
  dataSource?: "postgres" | "fixtures";
  dataMode?: "demo/synthetic" | "external";
  supplyChainTags: string[];
  imageUrl: string;
  verification: {
    status: "accepted" | "partial" | "rejected";
    summary: string;
    scope: string;
  };
  keyMetrics: KeyMetric[];
  productionProcess: ProductionPublicSummary;
}

export interface EvidenceStep {
  step: number;
  icon: string;
  title: string;
  source: string;
  description: string;
  hash: string;
  verifiedAt: string;
}

export interface JourneyStep {
  step: number;
  icon: string;
  title: string;
  desc: string;
}

export interface Journey {
  batchId: string;
  status: string;
  steps: JourneyStep[];
}

export interface MetricSource {
  name: string;
  method: string;
  reportNo: string;
  pdf: string;
  time: string;
  signature: string;
}

export interface HeavyMetalItem {
  name: string;
  value: number;
  limit: number;
  passed: boolean;
}

export interface MetricDetail {
  label: string;
  value: string;
  unit: string;
  threshold: string;
  sources: MetricSource[];
  heavyMetals?: HeavyMetalItem[];
}

export type ChatLineClass =
  | "cmd"
  | "plain"
  | "check"
  | "lead"
  | "conclusion"
  | "disclaimer";

/** Public stages emitted by the Agent SSE stream. Keep this vocabulary stable
 * so the UI can show progress without exposing provider internals. */
export type AgentStreamStage =
  | "begin"
  | "reading_batch"
  | "verifier_checked"
  | "jev_routed"
  | "model_started"
  | "model_completed"
  | "answer"
  | "done";

export interface ChatEvent {
  kind: "begin" | "meta" | "line" | "stage" | "answer" | "done" | AgentStreamStage;
  stage?: AgentStreamStage;
  stages?: AgentStreamStage[];
  validationStatus?: string;
  validationReasons?: string[];
  citationStatus?: string;
  citationReasons?: string[];
  citationValidation?: { status?: string; valid?: boolean; reasons?: string[] };
  validation?: { status?: string; reasons?: string[] };
  detail?: string;
  status?: "pending" | "active" | "completed" | "fallback" | "unavailable";
  cls?: ChatLineClass;
  text?: string;
  agentMode?: "model_assisted" | "deterministic_fallback";
  serviceStatus?: "model_assisted" | "deterministic_fallback" | "provider_unavailable" | "rate_limited" | "maintenance";
  dataMode?: "demo/synthetic" | "external";
  batchId?: string | null;
  traceId?: string;
  provider?: string;
  model?: string;
  modelAssisted?: boolean;
  fallbackApplied?: boolean;
  evidenceIds?: string[];
  pipeline?: string[];
  pipelineDetail?: {
    verifier: { status: string; reasons?: string[] };
    jev: { decision: string; confidence?: number };
    deepseek: { status: "completed" | "fallback" | "unavailable" };
  };
  contextMode?: "production_sync_simulation" | "external_production";
  contextSource?: string;
  contextRevision?: number;
  syncedAt?: string;
  sources?: string[];
  chainContext?: {
    queried: true;
    chainId: number;
    chainName: string;
    rpcReachable: boolean;
    latestBlockNumber?: number;
    anchorStatus: string;
    explorerUrl: string;
    batchId: string | null;
    transaction?: { txHash: string; event: string; explorerUrl: string; blockNumber?: number };
  };
}

export interface ChatLine {
  cls: ChatLineClass;
  text: string;
}

export interface RecommendItem {
  batchId: string;
  name: string;
  origin: string;
  productionDate: string;
  epaDha: number;
  peroxide: number;
  coldGap: number;
  reason: string;
  expertise?: string;
  imageUrl?: string;
  dataMode?: "demo/synthetic" | "external";
  evidence?: {
    dataMode?: "demo/synthetic" | "external";
    verificationStatus?: string;
    evidenceRefs?: string[];
    metrics?: { epaDhaPercent?: number; peroxideValue?: number; coldChainGapHours?: number };
    policy?: { id?: string; version?: string };
  };
  verification?: { status?: string; score?: number; summary?: string; reasons?: string[] };
  coldChain?: { gapHours?: number; status?: string; summary?: string };
  feedbackSample?: { count?: number; rating?: number; summary?: string; items?: string[] };
  gaps?: string[];
  nextStep?: string;
}

export interface OrderCard {
  orderId: string;
  batchId: string;
  productName: string;
  quantity: number;
  createdAt: string;
  status: string;
  imageUrl?: string;
  txHash?: string;
  explorerUrl?: string;
}

export type VerifyState = "idle" | "running" | "done";

export interface JevChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface JevDetection {
  source?: "TypeSafe JEV";
  model?: string;
  batchId?: string;
  routeDecision?: string;
  confidence?: number;
  mode?: string;
  passed?: boolean;
  evidenceRoot?: string;
  contractAddress?: string;
  txHash?: string;
  explorerUrl?: string;
  status?: "replay_verified" | "anchor_pending" | "mainnet_receipt_verified";
  chainStatus?: "replay_verified" | "anchor_pending" | "mainnet_receipt_verified";
  anchorStatus?: "replay_verified" | "anchor_pending" | "mainnet_receipt_verified";
  answers?: {
    route: JevChoiceAnswer;
    evidence_scope: JevChoiceAnswer;
  };
  usage?: { input_tokens: number; output_tokens: number };
  deterministicVerifier?: { status: "accepted"; policy: string };
}

export interface VerifiedChainTx {
  event: string;
  label: string;
  batchId: string;
  txHash: string;
  blockNumber: number;
  contractAddress: string;
  explorerUrl: string;
}

export interface SessionChainTx {
  id?: string;
  action: string;
  event: string;
  batchId: string;
  wallet: string;
  providerName?: string;
  contractAddress: string;
  txHash: string;
  blockNumber?: number;
  explorerUrl: string;
  calldata?: string;
  signature?: string;
  mode?: "wallet_broadcast";
  receiptStatus?: string;
  eventVerified?: boolean;
  createdAt: string;
}

export interface ChainContractMeta {
  name: string;
  role: string;
  address: string;
  deployTxHash: string;
  blockNumber: number;
  explorerUrl: string;
  deployTxUrl: string;
}

export interface ChainStatusData {
  network: string;
  chainId: number;
  chainIdHex: string;
  chainName: string;
  nativeCurrency: { name: string; symbol: string; decimals: number };
  rpcUrl: string;
  explorerUrl: string;
  contractAddress: string;
  contracts: {
    evidenceAnchor: ChainContractMeta;
    consumerGateway: ChainContractMeta;
    auditEscrow: ChainContractMeta;
  };
  verifiedTransactions: VerifiedChainTx[];
  liveRpc: {
    reachable: boolean;
    rpcChainId?: number;
    latestBlockNumber?: number;
    contractsDeployed?: {
      evidenceAnchor: boolean;
      consumerGateway: boolean;
      auditEscrow: boolean;
    };
    checkedAt: string;
    error?: string;
  };
  sessionTransactions: SessionChainTx[];
}

export type WalletActionKind = "purchase" | "contribution" | "dispute" | "evidence" | "verification" | "audit_finding" | "audit_approval" | "resolve_challenge";

export type LifecycleStage = "production" | "inspection" | "cold_chain" | "shipment" | "purchase" | "after_sales" | "regulatory_review";
export type LifecycleStatus = "synced" | "verified" | "pending" | "awaiting_user";
export interface LifecycleEvent {
  stage: LifecycleStage;
  label: string;
  role: string;
  status: LifecycleStatus;
  detail: string;
  updatedAt: string;
  walletAction?: WalletActionKind;
  requiredRole?: string;
}
export interface LifecycleView {
  schemaVersion: "truthpass.lifecycle.v1";
  batchId: string;
  contextMode: "production_sync_simulation" | "external_production";
  contextSource: string;
  contextRevision: number;
  syncedAt: string;
  dataMode: "demo/synthetic" | "external";
  events: LifecycleEvent[];
  nextAction: LifecycleStage | "complete";
  walletRoles: Array<{ stage: LifecycleStage; label: string; role: string; action: WalletActionKind; requiredRole?: string }>;
}

/** Public, read-only overview used to keep the consumer UI on one batch scope. */
export interface PublicBatchOverview {
  schemaVersion?: string;
  tenant?: { tenantId?: string; slug?: string; brand?: { name?: string } | null };
  product?: { productId?: string; name?: string; category?: string; dataMode?: "demo/synthetic" | "external" };
  batch?: { batchId?: string; dataMode?: "demo/synthetic" | "external"; status?: string };
  lifecycle?: LifecycleView;
  evidence?: Array<{ evidenceId?: string; kind?: string; sourceKind?: string; dataMode?: string }>;
  verification?: { status?: string; reasons?: string[] };
  chainContext?: ChatEvent["chainContext"];
  purchaseQuote?: { status?: string; amount?: string; currency?: string; chainId?: number };
  tenantId?: string;
  productId?: string;
  feedbackSummary?: { count?: number; averageRating?: number; sampleMode?: string };
  dataMode?: "demo/synthetic" | "external";
}

export interface WalletPrepareResponse {
  ok: boolean;
  action: WalletActionKind;
  description: string;
  event: string;
  batchId: string;
  contractName: string;
  contractAddress: string;
  ids?: Record<string, string | number>;
  stake?: string;
  auditEscrow?: boolean;
  txRequest: {
    to: string;
    data: string;
    value: string;
    chainId: number;
    chainIdHex: string;
  };
  meta: Record<string, unknown>;
  network: {
    chainId: number;
    chainIdHex: string;
    chainName: string;
    nativeCurrency: { name: string; symbol: string; decimals: number };
    rpcUrls: string[];
    blockExplorerUrls: string[];
  };
}
