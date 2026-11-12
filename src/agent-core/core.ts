import { randomUUID } from "node:crypto";

import { sha256Canonical } from "../evidence.js";
import { getDatabasePool, persistenceEnabled } from "../data/persistence.js";

export type KnowledgeScope = "public" | "tenant_private";
export type ConsentScope = "none" | "personal_use" | "anonymous_research" | "industry_insight";

export interface KnowledgeDocument {
  id: string;
  title: string;
  text: string;
  tags: string[];
  sourceRefs: string[];
}

export interface KnowledgePack {
  id: string;
  tenantId?: string;
  scope: KnowledgeScope;
  domain: string;
  version: string;
  documents: KnowledgeDocument[];
  sourceRefs: string[];
  definitions: Record<string, string>;
  interpretationRules: string[];
  forbiddenClaims: string[];
  effectiveAt: string;
  supersedes?: string;
}

export interface KnowledgeHit {
  hitId: string;
  packId: string;
  documentId: string;
  title: string;
  snippet: string;
  sourceRefs: string[];
  domain: string;
  scope: KnowledgeScope;
  score: number;
}

export interface ExpertProfile {
  id: string;
  tenantId?: string;
  domain: string;
  role: "consumer" | "merchant" | "public_industry";
  scope: KnowledgeScope;
  knowledgePackIds: string[];
  policyPackIds: string[];
  allowedActions: string[];
  version: string;
}

export interface ConsumerNeed {
  id: string;
  anonymousConsumerId: string;
  tenantId?: string;
  productId?: string;
  batchId?: string;
  useCase: string;
  concern: string;
  preferredParameters: Record<string, string | number | boolean>;
  budgetRange?: { min?: number; max?: number; currency?: string };
  storageContext?: string;
  consentScope: ConsentScope;
  createdAt: string;
}

export interface InteractionEvent {
  id: string;
  traceId: string;
  actorType: "consumer" | "merchant" | "institution" | "system";
  tenantId?: string;
  productId?: string;
  batchId?: string;
  intent: string;
  evidenceIds: string[];
  verifierResult?: string;
  responseStatus: "completed" | "fallback" | "rejected";
  consentScope: ConsentScope;
  createdAt: string;
}

export interface ProductSpec {
  id: string;
  tenantId: string;
  sourceNeedClusterId: string;
  domain: string;
  targetUseCase: string;
  parameterRequirements: Record<string, string | number | boolean>;
  packagingRequirements: string[];
  logisticsRequirements: string[];
  evidenceRequirements: string[];
  policyVersion: string;
  status: "draft" | "merchant_review" | "approved" | "archived";
  createdAt: string;
}

export interface BrandProposal {
  id: string;
  tenantId: string;
  productSpecId: string;
  targetNeed: string;
  positioning: string;
  productDefinition: string[];
  evidencePlan: string[];
  supplyPlan: string[];
  proposedBy: "merchant_agent";
  approvedBy?: string;
  status: "draft" | "merchant_review" | "approved" | "rejected";
  createdAt: string;
}

export interface EvidenceRefResolver {
  (evidenceId: string, context: { tenantId: string; productId: string; batchId: string }): Promise<boolean> | boolean;
}

export interface SagScopedQuery {
  tenantId: string;
  productId: string;
  batchId: string;
  query: string;
}

const now = (): string => new Date().toISOString();
const normalize = (value: string): string => value.trim().toLowerCase();
const tokensOf = (value: string): string[] => [...new Set([
  ...(normalize(value).match(/[a-z0-9_+-]+/g) ?? []),
  ...(normalize(value).match(/[\u4e00-\u9fff]{2}/g) ?? []),
])];

function id(prefix: string, seed: unknown): string {
  return `${prefix}-${sha256Canonical([seed, randomUUID()]).slice(2, 26)}`;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export class ExpertAgentCore {
  #knowledge = new Map<string, KnowledgePack>();
  #needs = new Map<string, ConsumerNeed>();
  #interactions = new Map<string, InteractionEvent>();
  #specs = new Map<string, ProductSpec>();
  #proposals = new Map<string, BrandProposal>();
  #schemaReady: Promise<void> | undefined;

  constructor() {
    this.registerKnowledgePack(createFishOilPublicKnowledgePack());
  }

  async ready(): Promise<void> {
    await this.ensureSchema();
  }

  registerKnowledgePack(pack: KnowledgePack): KnowledgePack {
    if (!pack.id.trim() || !pack.domain.trim() || !pack.version.trim()) throw new Error("KNOWLEDGE_PACK_ID_DOMAIN_VERSION_REQUIRED");
    if (pack.scope === "tenant_private" && !pack.tenantId) throw new Error("TENANT_PRIVATE_PACK_REQUIRES_TENANT");
    if (!pack.documents.length) throw new Error("KNOWLEDGE_PACK_DOCUMENTS_REQUIRED");
    const normalizedPack: KnowledgePack = {
      ...structuredClone(pack),
      sourceRefs: [...new Set(pack.sourceRefs)],
      documents: pack.documents.map((document) => ({ ...document, tags: [...new Set(document.tags)], sourceRefs: [...new Set(document.sourceRefs)] })),
    };
    this.#knowledge.set(normalizedPack.id, normalizedPack);
    void this.persistKnowledgePack(normalizedPack).catch(() => undefined);
    return structuredClone(normalizedPack);
  }

  listKnowledgePacks(tenantId?: string, domain?: string): KnowledgePack[] {
    return [...this.#knowledge.values()]
      .filter((pack) => (!domain || pack.domain === domain) && (pack.scope === "public" || pack.tenantId === tenantId))
      .map((pack) => structuredClone(pack));
  }

  expertProfile(input: { tenantId?: string; domain?: string; role?: ExpertProfile["role"] }): ExpertProfile {
    const domain = input.domain?.trim() || "fish-oil";
    const role = input.role ?? (input.tenantId ? "merchant" : "consumer");
    const packs = this.listKnowledgePacks(input.tenantId, domain);
    return {
      id: `${role}:${input.tenantId ?? "public"}:${domain}`,
      tenantId: input.tenantId,
      domain,
      role,
      scope: input.tenantId ? "tenant_private" : "public",
      knowledgePackIds: packs.map((pack) => pack.id),
      policyPackIds: [`${domain}-policy-v1`],
      allowedActions: role === "merchant"
        ? ["read_evidence", "import_evidence", "request_review", "create_product_spec", "create_brand_proposal"]
        : ["read_public_evidence", "ask_agent", "submit_need", "prepare_purchase", "submit_feedback"],
      version: "expert-agent-profile.v1",
    };
  }

  async searchScopedKnowledge(input: SagScopedQuery): Promise<KnowledgeHit[]> {
    await this.ensureSchema();
    const tokens = tokensOf(input.query);
    const domain = input.productId === "fish-oil" ? "fish-oil" : input.productId === "rice-wuchang" ? "rice" : input.productId;
    const packs = this.listKnowledgePacks(input.tenantId, domain);
    const hits = packs.flatMap((pack) => pack.documents.map((document) => {
      const haystack = normalize(`${document.title} ${document.text} ${document.tags.join(" ")}`);
      const score = tokens.length === 0 ? 0 : tokens.reduce((sum, token) => sum + (haystack.includes(token) ? 1 : 0), 0);
      return {
        hitId: `${pack.id}:${document.id}`,
        packId: pack.id,
        documentId: document.id,
        title: document.title,
        snippet: document.text.slice(0, 360),
        sourceRefs: [...new Set([...pack.sourceRefs, ...document.sourceRefs])],
        domain: pack.domain,
        scope: pack.scope,
        score,
      } satisfies KnowledgeHit;
    })).sort((a, b) => b.score - a.score || a.hitId.localeCompare(b.hitId));
    const selected = tokens.length && hits.some((hit) => hit.score > 0)
      ? hits.filter((hit) => hit.score > 0).slice(0, 8)
      : hits.slice(0, 8);
    return structuredClone(selected);
  }

  async recordConsumerNeed(input: Omit<ConsumerNeed, "id" | "createdAt"> & { id?: string }): Promise<ConsumerNeed> {
    await this.ensureSchema();
    if (!input.anonymousConsumerId.trim()) throw new Error("ANONYMOUS_CONSUMER_ID_REQUIRED");
    if (!input.useCase.trim() || !input.concern.trim()) throw new Error("CONSUMER_NEED_USE_CASE_AND_CONCERN_REQUIRED");
    const need: ConsumerNeed = {
      ...structuredClone(input),
      id: input.id?.trim() || id("need", input),
      createdAt: now(),
    };
    this.#needs.set(need.id, need);
    await this.persistNeed(need);
    return structuredClone(need);
  }

  listConsumerNeeds(filter: { tenantId?: string; productId?: string; batchId?: string; consentScope?: ConsentScope } = {}): ConsumerNeed[] {
    return [...this.#needs.values()]
      .filter((need) => (!filter.tenantId || need.tenantId === filter.tenantId)
        && (!filter.productId || need.productId === filter.productId)
        && (!filter.batchId || need.batchId === filter.batchId)
        && (!filter.consentScope || need.consentScope === filter.consentScope))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((need) => structuredClone(need));
  }

  async recordInteraction(input: Omit<InteractionEvent, "id" | "createdAt"> & { id?: string }): Promise<InteractionEvent> {
    await this.ensureSchema();
    const event: InteractionEvent = { ...structuredClone(input), id: input.id?.trim() || id("interaction", input), createdAt: now() };
    this.#interactions.set(event.id, event);
    await this.persistInteraction(event);
    return structuredClone(event);
  }

  async createProductSpec(input: { tenantId: string; domain: string; needIds: string[]; policyVersion?: string }): Promise<ProductSpec> {
    await this.ensureSchema();
    const needs = input.needIds.map((needId) => this.#needs.get(needId)).filter((need): need is ConsumerNeed => Boolean(need));
    if (!needs.length) throw new Error("CONSUMER_NEEDS_NOT_FOUND");
    const useCase = needs[0]!.useCase;
    const parameterRequirements: Record<string, string | number | boolean> = {};
    for (const need of needs) Object.assign(parameterRequirements, need.preferredParameters);
    const spec: ProductSpec = {
      id: id("spec", input),
      tenantId: input.tenantId,
      sourceNeedClusterId: sha256Canonical(needs.map((need) => need.id)),
      domain: input.domain,
      targetUseCase: useCase,
      parameterRequirements,
      packagingRequirements: ["清晰标注批次和保存方式", "提供可扫码的证据入口"],
      logisticsRequirements: ["记录运输时间窗", "异常时段必须可追溯"],
      evidenceRequirements: ["生产批次资料", "第三方检测报告", "物流/冷链记录"],
      policyVersion: input.policyVersion ?? "fish-oil-policy-v1",
      status: "merchant_review",
      createdAt: now(),
    };
    this.#specs.set(spec.id, spec);
    await this.persistSpec(spec);
    return structuredClone(spec);
  }

  async createBrandProposal(input: { tenantId: string; productSpecId: string; proposedBy?: "merchant_agent" }): Promise<BrandProposal> {
    await this.ensureSchema();
    const spec = this.#specs.get(input.productSpecId);
    if (!spec || spec.tenantId !== input.tenantId) throw new Error("PRODUCT_SPEC_NOT_FOUND");
    const proposal: BrandProposal = {
      id: id("brand", input),
      tenantId: input.tenantId,
      productSpecId: spec.id,
      targetNeed: spec.targetUseCase,
      positioning: `围绕“${spec.targetUseCase}”提供可解释、可核验的产品体验。`,
      productDefinition: Object.entries(spec.parameterRequirements).map(([key, value]) => `${key}: ${String(value)}`),
      evidencePlan: spec.evidenceRequirements,
      supplyPlan: [...spec.logisticsRequirements, "由商家确认生产与检测责任方"],
      proposedBy: input.proposedBy ?? "merchant_agent",
      status: "merchant_review",
      createdAt: now(),
    };
    this.#proposals.set(proposal.id, proposal);
    await this.persistProposal(proposal);
    return structuredClone(proposal);
  }

  listProductSpecs(tenantId: string): ProductSpec[] {
    return [...this.#specs.values()].filter((spec) => spec.tenantId === tenantId).map((spec) => structuredClone(spec));
  }

  listBrandProposals(tenantId: string): BrandProposal[] {
    return [...this.#proposals.values()].filter((proposal) => proposal.tenantId === tenantId).map((proposal) => structuredClone(proposal));
  }

  improvementReport(tenantId: string, batchId?: string): {
    tenantId: string;
    batchId?: string;
    sampleCount: number;
    concerns: Array<{ concern: string; count: number; needIds: string[] }>;
    nextAction: string;
    dataMode: "external" | "demo/synthetic";
  } {
    const needs = this.listConsumerNeeds({ tenantId, batchId, consentScope: "anonymous_research" });
    const grouped = new Map<string, { count: number; needIds: string[] }>();
    for (const need of needs) {
      const current = grouped.get(need.concern) ?? { count: 0, needIds: [] };
      current.count += 1;
      current.needIds.push(need.id);
      grouped.set(need.concern, current);
    }
    return {
      tenantId,
      batchId,
      sampleCount: needs.length,
      concerns: [...grouped.entries()].sort((a, b) => b[1].count - a[1].count).map(([concern, value]) => ({ concern, ...value })),
      nextAction: needs.length ? "由商家确认是否创建 ProductSpec；Agent 只能提出建议。" : "继续收集已授权的匿名消费者体验。",
      dataMode: needs.some((need) => need.batchId?.startsWith("FO-REAL")) ? "external" : "demo/synthetic",
    };
  }

  private async ensureSchema(): Promise<void> {
    if (!persistenceEnabled()) return;
    this.#schemaReady ??= getDatabasePool().query(`
      create table if not exists truthpass_knowledge_packs (
        pack_id text primary key,
        tenant_id text,
        scope text not null,
        domain text not null,
        version text not null,
        payload jsonb not null,
        created_at timestamptz not null default now()
      );
      create table if not exists truthpass_consumer_needs (
        need_id text primary key,
        tenant_id text,
        product_id text,
        batch_id text,
        anonymous_consumer_id text not null,
        consent_scope text not null,
        payload jsonb not null,
        created_at timestamptz not null
      );
      create table if not exists truthpass_interaction_events (
        event_id text primary key,
        tenant_id text,
        trace_id text not null,
        payload jsonb not null,
        created_at timestamptz not null
      );
      create table if not exists truthpass_product_specs (
        spec_id text primary key,
        tenant_id text not null,
        payload jsonb not null,
        created_at timestamptz not null
      );
      create table if not exists truthpass_brand_proposals (
        proposal_id text primary key,
        tenant_id text not null,
        payload jsonb not null,
        created_at timestamptz not null
      );
    `).then(async () => {
      const [packs, needs, interactions, specs, proposals] = await Promise.all([
        getDatabasePool().query("select payload from truthpass_knowledge_packs"),
        getDatabasePool().query("select payload from truthpass_consumer_needs"),
        getDatabasePool().query("select payload from truthpass_interaction_events"),
        getDatabasePool().query("select payload from truthpass_product_specs"),
        getDatabasePool().query("select payload from truthpass_brand_proposals"),
      ]);
      for (const row of packs.rows) {
        if (row.payload && typeof row.payload === "object") {
          const pack = row.payload as KnowledgePack;
          this.#knowledge.set(pack.id, pack);
        }
      }
      for (const row of needs.rows) {
        if (row.payload && typeof row.payload === "object") {
          const need = row.payload as ConsumerNeed;
          this.#needs.set(need.id, need);
        }
      }
      for (const row of interactions.rows) {
        if (row.payload && typeof row.payload === "object") {
          const event = row.payload as InteractionEvent;
          this.#interactions.set(event.id, event);
        }
      }
      for (const row of specs.rows) {
        if (row.payload && typeof row.payload === "object") {
          const spec = row.payload as ProductSpec;
          this.#specs.set(spec.id, spec);
        }
      }
      for (const row of proposals.rows) {
        if (row.payload && typeof row.payload === "object") {
          const proposal = row.payload as BrandProposal;
          this.#proposals.set(proposal.id, proposal);
        }
      }
    }).catch((error) => {
      this.#schemaReady = undefined;
      throw error;
    });
    await this.#schemaReady;
  }

  private async persistKnowledgePack(pack: KnowledgePack): Promise<void> {
    if (!persistenceEnabled()) return;
    await this.ensureSchema();
    await getDatabasePool().query(
      `insert into truthpass_knowledge_packs (pack_id, tenant_id, scope, domain, version, payload)
       values ($1,$2,$3,$4,$5,$6::jsonb)
       on conflict (pack_id) do update set payload = excluded.payload, version = excluded.version`,
      [pack.id, pack.tenantId ?? null, pack.scope, pack.domain, pack.version, safeJson(pack)],
    );
  }

  private async persistNeed(need: ConsumerNeed): Promise<void> {
    if (!persistenceEnabled()) return;
    await getDatabasePool().query(
      `insert into truthpass_consumer_needs (need_id, tenant_id, product_id, batch_id, anonymous_consumer_id, consent_scope, payload, created_at)
       values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) on conflict (need_id) do nothing`,
      [need.id, need.tenantId ?? null, need.productId ?? null, need.batchId ?? null, need.anonymousConsumerId, need.consentScope, safeJson(need), need.createdAt],
    );
  }

  private async persistInteraction(event: InteractionEvent): Promise<void> {
    if (!persistenceEnabled()) return;
    await getDatabasePool().query(
      `insert into truthpass_interaction_events (event_id, tenant_id, trace_id, payload, created_at)
       values ($1,$2,$3,$4::jsonb,$5) on conflict (event_id) do nothing`,
      [event.id, event.tenantId ?? null, event.traceId, safeJson(event), event.createdAt],
    );
  }

  private async persistSpec(spec: ProductSpec): Promise<void> {
    if (!persistenceEnabled()) return;
    await getDatabasePool().query(
      `insert into truthpass_product_specs (spec_id, tenant_id, payload, created_at)
       values ($1,$2,$3::jsonb,$4) on conflict (spec_id) do nothing`,
      [spec.id, spec.tenantId, safeJson(spec), spec.createdAt],
    );
  }

  private async persistProposal(proposal: BrandProposal): Promise<void> {
    if (!persistenceEnabled()) return;
    await getDatabasePool().query(
      `insert into truthpass_brand_proposals (proposal_id, tenant_id, payload, created_at)
       values ($1,$2,$3::jsonb,$4) on conflict (proposal_id) do nothing`,
      [proposal.id, proposal.tenantId, safeJson(proposal), proposal.createdAt],
    );
  }
}

export function createFishOilPublicKnowledgePack(): KnowledgePack {
  return {
    id: "fish-oil-public-knowledge",
    scope: "public",
    domain: "fish-oil",
    version: "1.0.0",
    sourceRefs: ["product_policy:fish-oil:1.4.0", "truthpass:fish-oil:public-knowledge"],
    definitions: {
      epa_dha: "EPA+DHA 是登记检测报告中的含量字段，必须结合单位、样品和报告来源解释。",
      peroxide: "过氧化值用于描述当前检测样品的氧化状态；不能单独推导整个产品的健康或疗效结论。",
      totox: "TOTOX 是登记规则中的综合氧化参数，解释时必须引用当前 policy 版本。",
      cold_chain: "冷链覆盖只表示登记的时间窗口和设备记录，不能替代抽检或完整运输责任。",
    },
    interpretationRules: [
      "实测值、规则范围、差值和缺口必须分开表达。",
      "missing 不能被改写成 passed 或 outside_range。",
      "demo/synthetic 只能用于演示软件行为，不能描述为真实认证。",
      "链上摘要只能证明摘要和事件被记录，不能证明商品质量或疗效。",
    ],
    forbiddenClaims: ["真实认证", "已证明安全", "治疗", "保证疗效", "替代医生建议"],
    effectiveAt: "2026-11-09T00:00:00.000Z",
    documents: [
      {
        id: "fish-oil-parameter-reading",
        title: "如何看鱼油参数",
        text: "先看报告中的实测值、单位、样品编号和检测机构，再与当前 policy 的规则范围比较。Agent 只能解释已登记参数，不能补猜缺失数值。",
        tags: ["EPA+DHA", "过氧化值", "TOTOX", "检测"],
        sourceRefs: ["product_policy:fish-oil:1.4.0"],
      },
      {
        id: "fish-oil-cold-chain",
        title: "如何看冷链记录",
        text: "冷链结论来自设备 ID、采样窗口、温度湿度记录和交接事件。记录中断时，回答应说明覆盖缺口和下一步补证责任方。",
        tags: ["冷链", "温度", "物流", "缺口"],
        sourceRefs: ["truthpass:fish-oil:cold-chain"],
      },
      {
        id: "fish-oil-purchase-boundary",
        title: "购买和链上状态边界",
        text: "只有当前交易 receipt、发送者、目标合约、Chain ID、金额和业务事件均通过服务端校验，才能说明当前购买已核验。历史回放和 anchor_pending 不能写成当前购买成功。",
        tags: ["购买", "receipt", "Chain 677", "历史回放"],
        sourceRefs: ["truthpass:chain:purchase-boundary"],
      },
      {
        id: "fish-oil-consumer-feedback",
        title: "消费者反馈如何进入改进",
        text: "反馈必须先绑定已核验购买，再按匿名授权聚合为使用场景、包装、保存、物流和体验问题。Agent 只能生成 ProductSpec 建议，生产改进需要商家确认。",
        tags: ["反馈", "需求", "产品改进", "匿名聚合"],
        sourceRefs: ["truthpass:consumer:feedback-loop"],
      },
    ],
  };
}

export const expertAgentCore = new ExpertAgentCore();

export class SagScopedAdapter {
  constructor(private readonly core: ExpertAgentCore = expertAgentCore, private readonly resolveEvidence?: EvidenceRefResolver) {}

  searchScopedKnowledge(input: SagScopedQuery): Promise<KnowledgeHit[]> {
    return this.core.searchScopedKnowledge(input);
  }

  async resolveEvidenceRef(ref: string, context: { tenantId: string; productId: string; batchId: string }): Promise<{ evidenceId: string; accepted: boolean }> {
    const evidenceId = ref.trim();
    if (!evidenceId) return { evidenceId, accepted: false };
    const accepted = this.resolveEvidence ? await this.resolveEvidence(evidenceId, context) : false;
    return { evidenceId, accepted };
  }
}

export const sagScopedAdapter = new SagScopedAdapter();
