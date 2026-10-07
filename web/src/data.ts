export const RULES = [
  { name: "任务匹配", desc: "证据 taskId 与任务 taskId 一致" },
  { name: "批次匹配", desc: "报告批次与请求批次一致" },
  { name: "时间逻辑", desc: "报告时间 ≥ 生产时间" },
  { name: "签名有效", desc: "实验室 ECDSA 签名验证通过" },
  { name: "物流连续", desc: "冷链 gap 2h ≤ 6h" },
  { name: "EPA+DHA", desc: "78% ≥ 70%" },
  { name: "过氧化值", desc: "2.1 ≤ 5" },
  { name: "TOTOX", desc: "11 ≤ 20" },
  { name: "冷链中断", desc: "2h ≤ 6h" },
];

// 数值条填充比例：EPA+DHA 以 100 为满刻度，其余以验收阈值归一化。
export const METRIC_BAR_PCT: Record<string, number> = {
  "epa-dha": 78,
  peroxide: 42,
  "cold-chain": 33,
};

export const ICON_URLS: Record<string, string> = {
  fish: "/assets/icon-fish.png",
  warning: "/assets/icon-warning.png",
  alert: "/assets/icon-warning.png",
  snowflake: "/assets/icon-snowflake.png",
  sensor: "/assets/icon-sensor.png",
  agent: "/assets/icon-agent.png",
  jev: "/assets/icon-jev.png",
  rule: "/assets/icon-rule.png",
  chain: "/assets/icon-chain.png",
};

// 数值条填充比例：EPA+DHA 以 100 为满刻度，其余以验收阈值归一化。
// （已在文件上方定义 METRIC_BAR_PCT，此处仅补充重金属缺口）
METRIC_BAR_PCT["heavy-metal"] = 12;

export const FEEDBACK_TAGS = ["包装完好", "无明显腥味", "批次可查", "口感不错", "日期新鲜", "物流快速"];

export interface FishOilBatchData {
  name: string;
  origin: string;
  productionDate: string;
  epaDha: number;
  peroxide: number;
  totox: number;
  coldGap: number;
  passed: boolean;
  heavyMetals: { pb: number; hg: number; cd: number; as: number };
}

export const FISH_OIL_BATCH_DATA: Record<string, FishOilBatchData> = {
  "FO-2026-001": { name: "深海鱼油软胶囊", origin: "北太平洋海域", productionDate: "2026-01-12", epaDha: 78, peroxide: 2.1, totox: 11, coldGap: 2, passed: true, heavyMetals: { pb: 0.02, hg: 0.01, cd: 0.03, as: 0.1 } },
  "FO-2026-002": { name: "高纯度 Omega-3 鱼油", origin: "挪威海域", productionDate: "2026-02-08", epaDha: 82, peroxide: 1.8, totox: 9, coldGap: 1.5, passed: true, heavyMetals: { pb: 0.01, hg: 0.02, cd: 0.02, as: 0.15 } },
  "FO-2026-003": { name: "儿童 DHA 鱼油滴剂", origin: "阿拉斯加海域", productionDate: "2026-03-15", epaDha: 90, peroxide: 1.2, totox: 6, coldGap: 3, passed: true, heavyMetals: { pb: 0.03, hg: 0.01, cd: 0.01, as: 0.08 } },
  "FO-2026-004": { name: "三文鱼油胶囊", origin: "智利海域", productionDate: "2026-04-02", epaDha: 75, peroxide: 6.8, totox: 14, coldGap: 2.5, passed: false, heavyMetals: { pb: 0.04, hg: 0.03, cd: 0.05, as: 0.2 } },
  "FO-2026-005": { name: "南极磷虾油", origin: "南极海域", productionDate: "2026-05-20", epaDha: 85, peroxide: 1.5, totox: 8, coldGap: 7, passed: false, heavyMetals: { pb: 0.05, hg: 0.02, cd: 0.18, as: 0.3 } },
};

export interface ObserverService {
  id: string;
  history: number;
  live: "degraded" | "offline" | "online";
  verdict: "rejected" | "not-called" | "passed";
}

export const OBSERVER = {
  task: "ver-FO-2026-001-001",
  policy: "fish-oil-freshness-v1",
  jev: "route_to_rule · 0.94 · demo",
  evidenceRoot: "0xb436…dca6",
  chainStatus: "待锚定 · 可重试",
  services: [
    { id: "lab-a", history: 92, live: "degraded", verdict: "rejected" },
    { id: "lab-b", history: 96, live: "offline", verdict: "not-called" },
    { id: "lab-c", history: 88, live: "online", verdict: "passed" },
  ] as ObserverService[],
};
