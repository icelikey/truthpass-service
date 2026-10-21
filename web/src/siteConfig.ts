export type SiteStatus = "draft" | "preview" | "published" | "archived";

export interface TenantSiteConfig {
  tenantId: string;
  slug: string;
  siteStatus: SiteStatus;
  templateVersion: string;
  brand: {
    name: string;
    mark: string;
    colors: { ink: string; paper: string; vermilion: string; gold: string; cyan: string };
    slogans: { zh: string; en: string };
  };
  product: {
    productId: string;
    name: string;
    category: string;
    description: string;
    demoMode: "demo/synthetic" | "production";
    usageGuide: Array<{ title: string; body: string; source: string }>;
    usageTips: Array<{ title: string; body: string; source: string }>;
  };
  batch: {
    defaultBatchId: string;
    evidenceCategories: string[];
    lifecycleStages: string[];
  };
  agent: {
    enabled: boolean;
    allowedTools: string[];
    responsePolicy: string;
  };
  wallet: {
    chainId: number;
    allowedRoles: string[];
  };
  modules: { consumer: boolean; merchant: boolean; institution: boolean; developer: boolean };
  locale: { default: "zh" | "en"; supported: Array<"zh" | "en"> };
}

const lifecycleStages = ["生产", "检测", "冷链", "出货", "购买", "售后", "复核"];

export const TENANT_SITES: Record<string, TenantSiteConfig> = {
  "rice-demo": {
    tenantId: "tenant-rice-demo",
    slug: "rice-demo",
    siteStatus: "published",
    templateVersion: "truthpass-site-v1",
    brand: {
      name: "北境稻作",
      mark: "稻",
      colors: { ink: "#151513", paper: "#f4efe4", vermilion: "#b83a2d", gold: "#b18a45", cyan: "#79b8bd" },
      slogans: { zh: "一粒米，先看证据。", en: "One grain. See the record first." },
    },
    product: { productId: "rice-wuchang", name: "北境稻作 · 五常米", category: "粮食", description: "产地、天气、土壤、检测和运输，按同一个批次串起来。", demoMode: "demo/synthetic", usageGuide: [{ title: "查看批次", body: "从包装上的批次号开始，先看产地、检测和运输记录。", source: "企业演示资料" }, { title: "保存记录", body: "把批次号和购买凭证留在你的记录中，售后时可以直接回到同一批次。", source: "TruthPass 使用说明" }], usageTips: [{ title: "先看缺口", body: "资料不完整时，先看清缺什么，再决定是否继续了解。", source: "TruthPass 使用说明" }] },
    batch: { defaultBatchId: "RC-2026-001", evidenceCategories: ["产地", "天气", "土壤", "农残检测", "仓储运输"], lifecycleStages },
    agent: { enabled: true, allowedTools: ["inspect_batch", "explain_batch", "lifecycle", "chain_status"], responsePolicy: "只解释当前企业、商品和批次已登记资料。" },
    wallet: { chainId: 677, allowedRoles: ["consumer", "producer", "inspection", "review", "logistics", "arbitration"] },
    modules: { consumer: true, merchant: true, institution: true, developer: true },
    locale: { default: "zh", supported: ["zh", "en"] },
  },
  "fish-oil-demo": {
    tenantId: "tenant-fish-oil-demo",
    slug: "fish-oil-demo",
    siteStatus: "published",
    templateVersion: "truthpass-site-v1",
    brand: {
      name: "深海营养",
      mark: "海",
      colors: { ink: "#151513", paper: "#f4efe4", vermilion: "#b83a2d", gold: "#b18a45", cyan: "#79b8bd" },
      slogans: { zh: "每一粒，都有依据。", en: "Every capsule has a record." },
    },
    product: { productId: "fish-oil", name: "深海鱼油", category: "营养食品", description: "生产、检测、冷链和售后记录，围绕一个批次公开。", demoMode: "demo/synthetic", usageGuide: [{ title: "如何保存", body: "置于阴凉干燥处，避免高温、阳光直射和包装长期受潮。", source: "企业演示资料 · 使用说明" }, { title: "如何查看批次", body: "打开包装上的批次入口，先查看原料、检测、冷链和出货记录。", source: "TruthPass 使用说明" }, { title: "如何提交反馈", body: "完成购买确认后，在同一批次下提交包装、到货和保存体验。", source: "TruthPass 反馈规则" }], usageTips: [{ title: "随餐使用", body: "产品页面仅展示企业登记的使用说明；个体化用量或医疗问题请咨询专业人士。", source: "企业演示资料" }, { title: "发现异常", body: "如果包装破损、气味异常或运输记录存在缺口，先保留凭证并联系售后。", source: "TruthPass 售后规则" }] },
    batch: { defaultBatchId: "FO-2026-001", evidenceCategories: ["原料来源", "检测报告", "冷链", "出货记录"], lifecycleStages },
    agent: { enabled: true, allowedTools: ["inspect_batch", "explain_batch", "lifecycle", "chain_status"], responsePolicy: "没有证据就明确说缺什么。" },
    wallet: { chainId: 677, allowedRoles: ["consumer", "producer", "inspection", "review", "logistics", "arbitration"] },
    modules: { consumer: true, merchant: true, institution: true, developer: true },
    locale: { default: "zh", supported: ["zh", "en"] },
  },
};

export function getTenantSite(slug: string): TenantSiteConfig | null {
  return TENANT_SITES[slug] ?? null;
}
