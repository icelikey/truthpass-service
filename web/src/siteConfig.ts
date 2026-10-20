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
    product: { productId: "rice-wuchang", name: "北境稻作 · 五常米", category: "粮食", description: "产地、天气、土壤、检测和运输，按同一个批次串起来。", demoMode: "demo/synthetic" },
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
    product: { productId: "fish-oil", name: "深海鱼油", category: "营养食品", description: "生产、检测、冷链和售后记录，围绕一个批次公开。", demoMode: "demo/synthetic" },
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
