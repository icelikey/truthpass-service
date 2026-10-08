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

export interface ChatEvent {
  kind: "begin" | "line" | "done";
  cls?: ChatLineClass;
  text?: string;
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
}

export interface OrderCard {
  orderId: string;
  batchId: string;
  productName: string;
  quantity: number;
  createdAt: string;
  status: string;
  imageUrl?: string;
}

export type VerifyState = "idle" | "running" | "done";

export interface JevChoiceAnswer {
  type: "choice";
  choice: string;
  confidence: number;
  probabilities: Record<string, number>;
}

export interface JevDetection {
  source: "TypeSafe JEV";
  model: string;
  answers: {
    route: JevChoiceAnswer;
    evidence_scope: JevChoiceAnswer;
  };
  usage: { input_tokens: number; output_tokens: number };
  deterministicVerifier: { status: "accepted"; policy: string };
}
