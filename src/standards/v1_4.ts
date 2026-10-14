import type { DataMode, ProductCategory } from "../data/model.js";
import { canonicalizeJson, sha256Canonical } from "../evidence.js";

export const TRUTHPASS_V14_VERSION = "1.4.0" as const;
export const PRODUCT_POLICY_SCHEMA = "truthpass.product-policy.v1" as const;
export const CFI_MANIFEST_SCHEMA = "truthpass.cfi.manifest.v1" as const;
export const CONSUMER_CREDENTIAL_SCHEMA = "truthpass.consumer.credential.v1" as const;
export const CONSUMER_FEEDBACK_SCHEMA = "truthpass.consumer.feedback.v1" as const;

export interface ProductPolicy {
  schemaVersion: typeof PRODUCT_POLICY_SCHEMA;
  policyId: string;
  version: string;
  productCategory: ProductCategory;
  title: string;
  status: "active" | "draft" | "revoked";
  source: string;
  dataMode: DataMode;
  publicRules: Record<string, string | number | boolean>;
  requiredEvidence: string[];
  standardRefs: string[];
  registeredAt: string;
  policyHash: string;
}

export type ProductPolicyInput = Omit<ProductPolicy, "policyHash"> & { policyHash?: string };

function clone<T>(value: T): T {
  return structuredClone(value);
}

function requireTimestamp(value: string, field: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) {
    throw new Error(field + " 必须是 UTC ISO-8601 时间");
  }
  return value;
}

function policyHashInput(policy: ProductPolicyInput): Record<string, unknown> {
  const { policyHash: _policyHash, ...withoutHash } = policy;
  return withoutHash;
}

function validatePolicy(input: ProductPolicyInput): void {
  if (input.schemaVersion !== PRODUCT_POLICY_SCHEMA) throw new Error("不支持的 ProductPolicy schema");
  if (!/^[a-z0-9][a-z0-9-]{2,80}$/.test(input.policyId)) throw new Error("policyId 格式无效");
  if (!/^v\d+(?:\.\d+){0,2}$/.test(input.version)) throw new Error("policy version 格式无效");
  if (input.status === "active" && !input.standardRefs.length) throw new Error("active policy 必须引用公共标准");
  if (!input.requiredEvidence.length) throw new Error("policy 至少需要一个证据类型");
  if (!input.title.trim() || !input.source.trim()) throw new Error("policy title/source 不能为空");
  for (const [key, value] of Object.entries(input.publicRules)) {
    if (!key.trim() || !(typeof value === "string" || typeof value === "number" || typeof value === "boolean")) {
      throw new Error("publicRules 只允许标量值");
    }
  }
}

export class ProductPolicyRegistry {
  private readonly policies = new Map<string, ProductPolicy>();

  register(input: ProductPolicyInput): ProductPolicy {
    validatePolicy(input);
    const expectedHash = sha256Canonical(policyHashInput(input));
    if (input.policyHash && input.policyHash !== expectedHash) throw new Error("policyHash 与规范化内容不一致");
    const policy: ProductPolicy = clone({ ...input, policyHash: expectedHash });
    const key = `${policy.policyId}:${policy.version}`;
    const existing = this.policies.get(key);
    if (existing && existing.policyHash !== policy.policyHash) throw new Error("policy 已注册但内容不一致");
    this.policies.set(key, policy);
    return clone(policy);
  }

  get(policyId: string, version: string): ProductPolicy {
    const policy = this.policies.get(`${policyId}:${version}`);
    if (!policy) throw new Error(`未知或未注册的 ProductPolicy: ${policyId}@${version}`);
    return clone(policy);
  }

  list(options: { category?: ProductCategory; status?: ProductPolicy["status"] } = {}): ProductPolicy[] {
    return [...this.policies.values()]
      .filter((policy) => (!options.category || policy.productCategory === options.category) && (!options.status || policy.status === options.status))
      .sort((a, b) => `${a.policyId}:${a.version}`.localeCompare(`${b.policyId}:${b.version}`))
      .map(clone);
  }
}

export const PUBLIC_STANDARD = Object.freeze({
  schemaVersion: "truthpass.public-standard.v1" as const,
  standardId: "truthpass-public-standard",
  version: TRUTHPASS_V14_VERSION,
  title: "TruthPass 公共可验证标准",
  principles: [
    "Agent 只能引用证据、解释缺口和提出下一步，不能自行宣布质量通过。",
    "结论必须来自确定性 Verifier、第三方机构和人工或仲裁流程。",
    "原始报告、个人信息和私钥留在受控链下存储，公共层只公布必要哈希、状态和范围。",
    "模拟数据、历史回执和部署回执不得被描述为真实生产认证。",
  ],
  schemas: [PRODUCT_POLICY_SCHEMA, CFI_MANIFEST_SCHEMA, CONSUMER_CREDENTIAL_SCHEMA, CONSUMER_FEEDBACK_SCHEMA],
  conclusionStates: ["accepted", "accepted_with_scope", "review", "rejected", "not_assessed"],
  hashAlgorithm: "SHA-256",
  canonicalization: "RFC-8785-style sorted JSON",
});

export function publicStandardDocument(): Record<string, unknown> {
  return { ...clone(PUBLIC_STANDARD), standardHash: sha256Canonical(PUBLIC_STANDARD) };
}

export const FISH_OIL_PUBLIC_POLICY: ProductPolicyInput = {
  schemaVersion: PRODUCT_POLICY_SCHEMA,
  policyId: "fish-oil-quality",
  version: "v1",
  productCategory: "fish-oil",
  title: "鱼油批次质量公共规则",
  status: "active",
  source: "team-approved-demo-rule",
  dataMode: "demo/synthetic",
  publicRules: { minEpaDhaPercent: 70, maxPeroxideValue: 5, maxTotox: 20, maxLogisticsGapHours: 6 },
  requiredEvidence: ["inspection", "cold_chain"],
  standardRefs: ["truthpass-public-standard@1.4.0"],
  registeredAt: "2026-10-15T00:00:00.000Z",
};

export const HONEY_PUBLIC_POLICY: ProductPolicyInput = {
  schemaVersion: PRODUCT_POLICY_SCHEMA,
  policyId: "honey-quality",
  version: "v1",
  productCategory: "honey",
  title: "蜂蜜批次质量公共规则（样例）",
  status: "active",
  source: "team-approved-honey-sample-rule",
  dataMode: "demo/synthetic",
  publicRules: { maxMoisturePercent: 20, maxHmfMgPerKg: 40, minDiastaseSchade: 8 },
  requiredEvidence: ["inspection", "origin_trace", "storage"],
  standardRefs: ["truthpass-public-standard@1.4.0"],
  registeredAt: "2026-10-15T00:00:00.000Z",
};

export function createDefaultProductPolicyRegistry(): ProductPolicyRegistry {
  const registry = new ProductPolicyRegistry();
  registry.register(FISH_OIL_PUBLIC_POLICY);
  registry.register(HONEY_PUBLIC_POLICY);
  return registry;
}

export interface CfiManifest {
  schemaVersion: typeof CFI_MANIFEST_SCHEMA;
  manifestId: string;
  service: "truthpass";
  version: typeof TRUTHPASS_V14_VERSION;
  generatedAt: string;
  capabilities: string[];
  endpoints: Record<string, string>;
  schemas: Array<{ schemaVersion: string; hash: string }>;
  policies: Array<Pick<ProductPolicy, "policyId" | "version" | "productCategory" | "status" | "policyHash">>;
  publicDataBoundary: { rawReports: "off_chain"; personalData: "off_chain"; privateKeys: "off_chain" };
}

export function buildCfiManifest(origin: string, registry: ProductPolicyRegistry, generatedAt = new Date().toISOString()): CfiManifest {
  const normalizedOrigin = origin.replace(/\/+$/, "");
  const policies = registry.list({ status: "active" }).map(({ policyId, version, productCategory, status, policyHash }) => ({ policyId, version, productCategory, status, policyHash }));
  const schemas = [PRODUCT_POLICY_SCHEMA, CFI_MANIFEST_SCHEMA, CONSUMER_CREDENTIAL_SCHEMA, CONSUMER_FEEDBACK_SCHEMA].map((schemaVersion) => ({ schemaVersion, hash: sha256Canonical({ schemaVersion, standard: PUBLIC_STANDARD.standardId, version: TRUTHPASS_V14_VERSION }) }));
  const manifestBody = {
    schemaVersion: CFI_MANIFEST_SCHEMA,
    service: "truthpass" as const,
    version: TRUTHPASS_V14_VERSION,
    generatedAt,
    capabilities: ["public.policy.read", "public.standard.read", "consumer.credential.issue", "consumer.feedback.submit", "consumer.feedback.verify"],
    endpoints: {
      manifest: `${normalizedOrigin}/api/cfi/manifest`,
      standard: `${normalizedOrigin}/api/standards`,
      policies: `${normalizedOrigin}/api/standards/policies`,
      credential: `${normalizedOrigin}/api/consumer/credentials`,
      feedback: `${normalizedOrigin}/api/consumer/feedback`,
    },
    schemas,
    policies,
    publicDataBoundary: { rawReports: "off_chain" as const, personalData: "off_chain" as const, privateKeys: "off_chain" as const },
  };
  return { ...manifestBody, manifestId: sha256Canonical(manifestBody) };
}

export type ConsumerScope = "purchase" | "feedback" | "public-reputation";

export interface AnonymousConsumerCredential {
  schemaVersion: typeof CONSUMER_CREDENTIAL_SCHEMA;
  credentialId: string;
  subjectCommitment: string;
  scopes: ConsumerScope[];
  issuedAt: string;
  expiresAt?: string;
  status: "active" | "revoked" | "expired";
  credentialHash: string;
}

export interface AnonymousConsumerCredentialInput {
  nonce: string;
  scopes?: ConsumerScope[];
  issuedAt?: string;
  expiresAt?: string;
}

export interface AnonymousConsumerFeedbackInput {
  credentialId: string;
  batchId: string;
  rating: number;
  categories?: string[];
  evidenceRefs?: string[];
  commentHash?: string;
  createdAt?: string;
}

export interface AnonymousConsumerFeedback {
  schemaVersion: typeof CONSUMER_FEEDBACK_SCHEMA;
  feedbackId: string;
  credentialId: string;
  batchId: string;
  rating: number;
  categories: string[];
  evidenceRefs: string[];
  commentHash?: string;
  createdAt: string;
  feedbackHash: string;
}

function credentialHashInput(credential: Omit<AnonymousConsumerCredential, "credentialHash">): Record<string, unknown> {
  return credential;
}

export class AnonymousConsumerRegistry {
  private readonly credentials = new Map<string, AnonymousConsumerCredential>();
  private readonly feedback = new Map<string, AnonymousConsumerFeedback>();

  issue(input: AnonymousConsumerCredentialInput): AnonymousConsumerCredential {
    if (typeof input.nonce !== "string" || input.nonce.trim().length < 16) throw new Error("匿名凭证 nonce 至少需要 16 个字符");
    const scopes = [...new Set(input.scopes ?? ["feedback", "public-reputation"])] as ConsumerScope[];
    if (!scopes.length) throw new Error("匿名凭证至少需要一个 scope");
    if (scopes.some((scope) => !["purchase", "feedback", "public-reputation"].includes(scope))) throw new Error("凭证 scope 无效");
    const issuedAt = requireTimestamp(input.issuedAt ?? new Date().toISOString(), "issuedAt");
    const expiresAt = input.expiresAt;
    if (expiresAt) {
      requireTimestamp(expiresAt, "expiresAt");
      if (Date.parse(expiresAt) <= Date.parse(issuedAt)) throw new Error("凭证 expiresAt 必须晚于 issuedAt");
    }
    const subjectCommitment = sha256Canonical({ domain: "truthpass.anonymous-consumer", nonce: input.nonce.trim() });
    const credentialId = sha256Canonical({ schemaVersion: CONSUMER_CREDENTIAL_SCHEMA, subjectCommitment, issuedAt });
    if (this.credentials.has(credentialId)) throw new Error("匿名凭证已存在，请生成新的 nonce");
    const unsigned: Omit<AnonymousConsumerCredential, "credentialHash"> = { schemaVersion: CONSUMER_CREDENTIAL_SCHEMA, credentialId, subjectCommitment, scopes, issuedAt, expiresAt, status: "active" };
    const credential = { ...unsigned, credentialHash: sha256Canonical(credentialHashInput(unsigned)) };
    this.credentials.set(credentialId, credential);
    return clone(credential);
  }

  revoke(credentialId: string): boolean {
    const credential = this.credentials.get(credentialId);
    if (!credential || credential.status === "revoked") return false;
    credential.status = "revoked";
    this.credentials.set(credentialId, credential);
    return true;
  }

  get(credentialId: string): AnonymousConsumerCredential | undefined {
    const credential = this.credentials.get(credentialId);
    if (!credential) return undefined;
    if (credential.status === "active" && credential.expiresAt && Date.parse(credential.expiresAt) <= Date.now()) credential.status = "expired";
    return clone(credential);
  }

  submitFeedback(input: AnonymousConsumerFeedbackInput): AnonymousConsumerFeedback {
    const credential = this.get(input.credentialId);
    if (!credential || credential.status !== "active") throw new Error("匿名凭证不存在、已撤销或已过期");
    if (!credential.scopes.includes("feedback")) throw new Error("匿名凭证没有 feedback scope");
    if (!/^[-A-Za-z0-9_.]{2,120}$/.test(input.batchId)) throw new Error("batchId 格式无效");
    if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) throw new Error("rating 必须是 1 到 5 的整数");
    const evidenceRefs = [...new Set(input.evidenceRefs ?? [])];
    if (evidenceRefs.some((ref) => !/^(?:0x)?[0-9a-f]{64}$/i.test(ref))) throw new Error("evidenceRefs 必须是 SHA-256 哈希");
    if (input.commentHash && !/^(?:0x)?[0-9a-f]{64}$/i.test(input.commentHash)) throw new Error("commentHash 必须是 SHA-256 哈希");
    const createdAt = requireTimestamp(input.createdAt ?? new Date().toISOString(), "createdAt");
    const duplicate = [...this.feedback.values()].find((feedback) => feedback.credentialId === credential.credentialId && feedback.batchId === input.batchId);
    if (duplicate) throw new Error("同一匿名凭证对同一批次只能提交一次反馈");
    const unsigned = { schemaVersion: CONSUMER_FEEDBACK_SCHEMA as typeof CONSUMER_FEEDBACK_SCHEMA, credentialId: credential.credentialId, batchId: input.batchId, rating: input.rating, categories: [...new Set(input.categories ?? [])].slice(0, 20), evidenceRefs, commentHash: input.commentHash, createdAt };
    const feedbackHash = sha256Canonical(unsigned);
    const feedback: AnonymousConsumerFeedback = { ...unsigned, feedbackId: sha256Canonical({ type: "truthpass.consumer.feedback", feedbackHash }), feedbackHash };
    this.feedback.set(feedback.feedbackId, feedback);
    return clone(feedback);
  }

  listFeedback(batchId?: string): AnonymousConsumerFeedback[] {
    return [...this.feedback.values()].filter((feedback) => !batchId || feedback.batchId === batchId).map(clone);
  }
}

export { canonicalizeJson };
