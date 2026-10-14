import { sha256Canonical } from "../evidence.js";

export const CLI_REFERENCE_MANIFEST_SCHEMA = "truthpass.cli.reference.manifest.v1" as const;
export const CLI_REFERENCE_PRODUCT_SCHEMA = "truthpass.cli.reference.product.v1" as const;
export const CLI_REFERENCE_BATCH_SCHEMA = "truthpass.cli.reference.batch.v1" as const;
export const CLI_REFERENCE_VERIFICATION_SCHEMA = "truthpass.cli.reference.verification.v1" as const;
export const CLI_REFERENCE_ORDER_SCHEMA = "truthpass.cli.reference.order.v1" as const;

export type CliReferenceDataMode = "demo/synthetic" | "external";
export type CliReferenceVerificationStatus = "accepted" | "accepted_with_scope" | "review" | "rejected" | "not_assessed";

export interface CliReferenceEvidenceRef {
  evidenceId: string;
  kind: "production" | "inspection" | "cold_chain" | "shipment";
  sourceKind: "manufacturer" | "third_party" | "platform_device" | "carrier";
  issuerId: string;
  status: "valid" | "partial" | "invalid" | "missing";
  payloadHash: string;
  dataMode: CliReferenceDataMode;
}

export interface CliReferenceProduct {
  schemaVersion: typeof CLI_REFERENCE_PRODUCT_SCHEMA;
  productId: string;
  brandId: string;
  name: string;
  category: string;
  policy: { id: string; version: string; hash: string };
  publicClaims: string[];
  batchIds: string[];
  order: { available: boolean; currency: string; unitPrice: number; checkoutMode: "demo_adapter" | "merchant_adapter" };
  assistant: { capabilities: string[]; sourceRefs: string[] };
  dataMode: CliReferenceDataMode;
}

export interface CliReferenceBatch {
  schemaVersion: typeof CLI_REFERENCE_BATCH_SCHEMA;
  batchId: string;
  productId: string;
  supplierId: string;
  productionAt: string;
  fillingBatchId: string;
  evidence: CliReferenceEvidenceRef[];
  disclosure: { public: string[]; restricted: string[] };
  dataMode: CliReferenceDataMode;
}

export interface CliReferenceVerification {
  schemaVersion: typeof CLI_REFERENCE_VERIFICATION_SCHEMA;
  batchId: string;
  policy: { id: string; version: string; hash: string };
  status: CliReferenceVerificationStatus;
  summary: string;
  checks: Array<{ code: string; label: string; status: "passed" | "failed" | "missing" | "review"; evidenceIds: string[] }>;
  evidenceRoot: string;
  anchor: { status: "anchor_pending" | "mainnet_receipt_verified"; submitted: boolean; dataMode: CliReferenceDataMode };
  reasons: string[];
  dataMode: CliReferenceDataMode;
}

export interface CliReferenceOrderPreparation {
  schemaVersion: typeof CLI_REFERENCE_ORDER_SCHEMA;
  orderId: string;
  batchId: string;
  productId: string;
  productName: string;
  quantity: number;
  unitPrice: number;
  currency: string;
  status: "prepared_pending_checkout";
  paymentStatus: "not_started";
  chainStatus: "anchor_pending";
  nextAction: "send_to_checkout_adapter";
  checkout: { mode: "demo_adapter" | "merchant_adapter"; endpoint: string; requiredFields: string[] };
  dataMode: CliReferenceDataMode;
}

export interface CliReferenceManifest {
  schemaVersion: typeof CLI_REFERENCE_MANIFEST_SCHEMA;
  protocol: "CLI_REFERENCE";
  version: "1.0.0";
  service: "truthpass";
  manifestId: string;
  capabilities: string[];
  endpoints: Record<string, string>;
  publicDataBoundary: { product: "public"; batchSummary: "public"; rawReports: "off_chain"; personalData: "off_chain"; healthData: "excluded" };
  dataMode: CliReferenceDataMode;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

const DEMO_POLICY_HASH = sha256Canonical({
  policyId: "fish-oil-quality",
  version: "v1",
  thresholds: { minEpaDhaPercent: 70, maxPeroxideValue: 5, maxTotox: 20, maxLogisticsGapHours: 6 },
});

const DEMO_PRODUCT: CliReferenceProduct = {
  schemaVersion: CLI_REFERENCE_PRODUCT_SCHEMA,
  productId: "HLN-FISH-OIL-001",
  brandId: "hln-demo-brand",
  name: "海蓝营养深海鱼油软胶囊",
  category: "fish-oil",
  policy: { id: "fish-oil-quality", version: "v1", hash: DEMO_POLICY_HASH },
  publicClaims: ["EPA+DHA 高浓度", "第三方检测", "冷链交付"],
  batchIds: ["FO-2026-001", "FO-2026-002"],
  order: { available: true, currency: "CNY", unitPrice: 129, checkoutMode: "demo_adapter" },
  assistant: { capabilities: ["usage.guide", "storage.guide", "batch.explain", "feedback.request"], sourceRefs: ["product.instructions.v1", "policy.fish-oil-quality.v1"] },
  dataMode: "demo/synthetic",
};

const DEMO_EVIDENCE: CliReferenceEvidenceRef[] = [
  { evidenceId: "ev-hln-production-001", kind: "production", sourceKind: "manufacturer", issuerId: "hln-factory-a", status: "valid", payloadHash: sha256Canonical({ event: "production", batchId: "FO-2026-001" }), dataMode: "demo/synthetic" },
  { evidenceId: "ev-hln-inspection-001", kind: "inspection", sourceKind: "third_party", issuerId: "lab-c", status: "valid", payloadHash: sha256Canonical({ event: "inspection", batchId: "FO-2026-001", epaDhaPercent: 78, peroxideValue: 2.1, totox: 11 }), dataMode: "demo/synthetic" },
  { evidenceId: "ev-hln-cold-chain-001", kind: "cold_chain", sourceKind: "platform_device", issuerId: "cold-chain-d", status: "valid", payloadHash: sha256Canonical({ event: "cold_chain", batchId: "FO-2026-001", maxGapHours: 2 }), dataMode: "demo/synthetic" },
  { evidenceId: "ev-hln-shipment-001", kind: "shipment", sourceKind: "carrier", issuerId: "carrier-demo-d", status: "valid", payloadHash: sha256Canonical({ event: "shipment", batchId: "FO-2026-001" }), dataMode: "demo/synthetic" },
];

const DEMO_BATCH: CliReferenceBatch = {
  schemaVersion: CLI_REFERENCE_BATCH_SCHEMA,
  batchId: "FO-2026-001",
  productId: DEMO_PRODUCT.productId,
  supplierId: "hln-factory-a",
  productionAt: "2026-01-12T08:00:00Z",
  fillingBatchId: "HLN-FILL-001",
  evidence: DEMO_EVIDENCE,
  disclosure: { public: ["productId", "batchId", "policy", "verification", "evidenceSummary"], restricted: ["rawReport", "supplierInternalId", "consumerOrder", "consumerFeedbackRaw"] },
  dataMode: "demo/synthetic",
};

const REVIEW_BATCH: CliReferenceBatch = {
  ...clone(DEMO_BATCH),
  batchId: "FO-2026-002",
  fillingBatchId: "HLN-FILL-002",
  evidence: DEMO_EVIDENCE.map((item) => ({ ...item, evidenceId: item.evidenceId.replace("001", "002"), payloadHash: sha256Canonical({ ...item, batchId: "FO-2026-002" }) }))
    .map((item) => item.kind === "inspection" ? { ...item, status: "invalid" as const } : item),
};

export class CliReferenceRegistry {
  private readonly products = new Map<string, CliReferenceProduct>([[DEMO_PRODUCT.productId, DEMO_PRODUCT]]);
  private readonly batches = new Map<string, CliReferenceBatch>([[DEMO_BATCH.batchId, DEMO_BATCH], [REVIEW_BATCH.batchId, REVIEW_BATCH]]);

  manifest(origin: string): CliReferenceManifest {
    const base = origin.replace(/\/+$/, "");
    const body = {
      schemaVersion: CLI_REFERENCE_MANIFEST_SCHEMA,
      protocol: "CLI_REFERENCE" as const,
      version: "1.0.0" as const,
      service: "truthpass" as const,
      capabilities: ["product.read", "batch.read", "batch.verify", "order.prepare", "assistant.read", "feedback.request"],
      endpoints: {
        manifest: base + "/api/cli/reference/manifest",
        products: base + "/api/cli/reference/products",
        product: base + "/api/cli/reference/products/{productId}",
        batch: base + "/api/cli/reference/batches/{batchId}",
        verification: base + "/api/cli/reference/batches/{batchId}/verification",
        order: base + "/api/cli/reference/orders/prepare",
        assistant: base + "/api/cli/reference/products/{productId}/assistant",
        feedback: base + "/api/consumer/feedback",
      },
      publicDataBoundary: { product: "public" as const, batchSummary: "public" as const, rawReports: "off_chain" as const, personalData: "off_chain" as const, healthData: "excluded" as const },
      dataMode: "demo/synthetic" as const,
    };
    return { ...body, manifestId: sha256Canonical(body) };
  }

  listProducts(): CliReferenceProduct[] {
    return [...this.products.values()].map(clone);
  }

  getProduct(productId: string): CliReferenceProduct {
    const product = this.products.get(productId);
    if (!product) throw new Error("CLI_REFERENCE product not found: " + productId);
    return clone(product);
  }

  getBatch(batchId: string): CliReferenceBatch {
    const batch = this.batches.get(batchId);
    if (!batch) throw new Error("CLI_REFERENCE batch not found: " + batchId);
    return clone(batch);
  }

  verifyBatch(batchId: string): CliReferenceVerification {
    const batch = this.getBatch(batchId);
    const product = this.getProduct(batch.productId);
    const inspection = batch.evidence.find((item) => item.kind === "inspection");
    const requiredKinds = ["inspection", "cold_chain"];
    const missing = requiredKinds.filter((kind) => !batch.evidence.some((item) => item.kind === kind && item.status === "valid"));
    const invalid = batch.evidence.filter((item) => item.status === "invalid");
    const checks = [
      { code: "batch_identity", label: "商品与批次关联", status: "passed" as const, evidenceIds: batch.evidence.map((item) => item.evidenceId) },
      { code: "inspection_report", label: "第三方检测报告", status: invalid.some((item) => item.kind === "inspection") ? "failed" as const : inspection ? "passed" as const : "missing" as const, evidenceIds: inspection ? [inspection.evidenceId] : [] },
      { code: "cold_chain", label: "冷链记录", status: missing.includes("cold_chain") ? "missing" as const : "passed" as const, evidenceIds: batch.evidence.filter((item) => item.kind === "cold_chain").map((item) => item.evidenceId) },
      { code: "issuer_attestation", label: "来源声明", status: batch.dataMode === "external" ? "passed" as const : "review" as const, evidenceIds: batch.evidence.map((item) => item.evidenceId) },
    ];
    const status: CliReferenceVerificationStatus = invalid.length ? "rejected" : missing.length ? "review" : batch.dataMode === "demo/synthetic" ? "accepted_with_scope" : "accepted";
    const summary = status === "rejected" ? "当前批次存在无效或错配证据，不能进入购买推荐。" : status === "review" ? "证据尚不完整，需要补充材料或人工复核。" : status === "accepted_with_scope" ? "演示数据按当前公开规则通过，真实生产签名仍需接入。" : "证据和规则均已通过当前公开政策。";
    const root = sha256Canonical({ batch, product: product.productId, policy: product.policy });
    return {
      schemaVersion: CLI_REFERENCE_VERIFICATION_SCHEMA,
      batchId,
      policy: product.policy,
      status,
      summary,
      checks,
      evidenceRoot: root,
      anchor: { status: "anchor_pending", submitted: false, dataMode: batch.dataMode },
      reasons: invalid.length ? ["检测报告无效或批次不匹配"] : missing.length ? ["缺少证据：" + missing.join("、")] : ["demo/synthetic 数据仅用于协议演示"],
      dataMode: batch.dataMode,
    };
  }

  assistant(productId: string): Record<string, unknown> {
    const product = this.getProduct(productId);
    return {
      schemaVersion: "truthpass.cli.reference.assistant.v1",
      productId,
      capabilities: product.assistant.capabilities,
      sourceRefs: product.assistant.sourceRefs,
      allowedTopics: ["usage", "storage", "batch", "feedback"],
      excludedTopics: ["diagnosis", "disease", "medication", "health_outcome"],
      dataMode: product.dataMode,
    };
  }

  prepareOrder(input: { batchId: string; quantity?: number; clientRequestId?: string; checkoutBaseUrl?: string }): CliReferenceOrderPreparation {
    const batch = this.getBatch(input.batchId);
    const product = this.getProduct(batch.productId);
    const verification = this.verifyBatch(input.batchId);
    if (verification.status === "rejected" || verification.status === "review") throw new Error("批次 " + input.batchId + " 当前不能进入购买准备：" + verification.status);
    const quantity = Number.isInteger(input.quantity) ? Number(input.quantity) : 1;
    if (quantity < 1 || quantity > 20) throw new Error("购买数量必须在 1 到 20 之间");
    const requestId = input.clientRequestId?.trim() || "cli-reference:" + input.batchId + ":" + quantity;
    return {
      schemaVersion: CLI_REFERENCE_ORDER_SCHEMA,
      orderId: "CLI-" + sha256Canonical({ requestId, batchId: input.batchId }).slice(2, 14).toUpperCase(),
      batchId: input.batchId,
      productId: product.productId,
      productName: product.name,
      quantity,
      unitPrice: product.order.unitPrice,
      currency: product.order.currency,
      status: "prepared_pending_checkout",
      paymentStatus: "not_started",
      chainStatus: "anchor_pending",
      nextAction: "send_to_checkout_adapter",
      checkout: { mode: product.order.checkoutMode, endpoint: (input.checkoutBaseUrl ?? "/api").replace(/\/+$/, "") + "/cli/reference/checkout", requiredFields: ["orderId", "batchId", "quantity", "shippingAddress", "paymentMethod"] },
      dataMode: product.dataMode,
    };
  }
}

export const DEFAULT_CLI_REFERENCE_REGISTRY = new CliReferenceRegistry();

