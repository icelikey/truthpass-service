/**
 * 本地测试用对接层：把 src/ 的真实模块通过 HTTP 暴露给前端 web/。
 * 注意：不修改 src/ 的任何文件，仅作为前端与后端之间的适配器。
 * 运行：npm run api  （tsx api-server.ts）
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { extname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nodemailer from "nodemailer";

import { MemoryDataRepository } from "./src/data/repository.js";
import { fishOilBatch, fishOilEvidence, fishOilProduct } from "./src/data/fixtures.js";
import { getPolicySnapshot } from "./src/rules/policy.js";
import { buildProductionPublicSummary } from "./src/production.js";
import { ServiceRegistry } from "./src/registry.js";
import { ConsumerParticipationRegistry } from "./src/consumer.js";
import { TruthPassTools } from "./src/tools/truthpass-tools.js";
import { TrustedIssuerKeyRegistry, type TrustedIssuerPublicKey } from "./src/security/evidence-signatures.js";
import { createPostgresReplayGuard, persistenceEnabled } from "./src/data/persistence.js";
import type { ServiceAdapter, ServiceCard, TaskRequest } from "./src/types.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const WEB_DIST = join(__dirname, "web", "dist");
const WEB = existsSync(WEB_DIST) ? WEB_DIST : join(__dirname, "web");
const PORT = Number(process.env.PORT || 4173);
const BATCH_ID = "FO-2026-001";

// ---------- 加载 .env（SMTP 等本地配置，不提交仓库） ----------
async function loadEnv(): Promise<void> {
  try {
    const txt = await readFile(join(__dirname, ".env"), "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && process.env[m[1]] === undefined) {
        process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // .env 不存在时忽略，邮件发送会降级为跳过
  }
}
await loadEnv();

const mailer = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT || 465),
  secure: true,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

// ---------- 初始化数据仓库（fixtures） ----------
const repository = new MemoryDataRepository();
repository.createProduct(fishOilProduct);
repository.createBatch(fishOilBatch);
for (const item of fishOilEvidence) await repository.addEvidence(item);
const productionSummary = await buildProductionPublicSummary(repository, BATCH_ID);

// 补一条结构完整的 inspection 证据，供确定性验收使用（对齐 testbench 的做法）。
await repository.addEvidence({
  schemaVersion: "evidence.v1",
  evidenceId: "ev-test-report-001",
  batchId: BATCH_ID,
  kind: "inspection",
  issuerId: "lab-demo-001",
  sourceKind: "third_party",
  occurredAt: "2026-10-06T10:20:00Z",
  dataMode: "demo/synthetic",
  payload: {
    taskId: "task-fish-oil-2026-001",
    reportBatchId: BATCH_ID,
    logisticsGapHours: 2,
    signatureValid: true,
    epaDhaPercent: 78,
    peroxideValue: 2.1,
    totox: 11,
    coldChainGapHours: 2,
  },
});

// ---------- 任务与验收 ----------
const task: TaskRequest = {
  taskId: "task-fish-oil-2026-001",
  serviceKind: "lab",
  capability: "fish-oil-batch-quality-check",
  batchId: BATCH_ID,
  productionTime: "2026-10-06T08:00:00Z",
  acceptance: { requireSignature: true, policyId: "fish-oil-quality", policyVersion: "v1" },
};

const inspectionEvidence = repository.getEvidence("ev-test-report-001")!;
const trustedIssuerKeys = new TrustedIssuerKeyRegistry(
  JSON.parse(process.env.TRUTHPASS_TRUSTED_ISSUER_KEYS ?? "[]") as TrustedIssuerPublicKey[],
);
const replayGuard = persistenceEnabled() ? createPostgresReplayGuard() : undefined;
const inspectionTools = new TruthPassTools(repository, "inspection", trustedIssuerKeys.resolve, true, replayGuard);

const policy = getPolicySnapshot(task.acceptance.policyId, task.acceptance.policyVersion);
const assessment = await inspectionTools.assessProductBatch({ task, evidenceId: "ev-test-report-001" });

// ---------- 多批次展示数据（demo 编造，001 走真实验收） ----------
type HeavyMetals = { pb: number; hg: number; cd: number; as: number };

const HEAVY_METAL_LIMITS: HeavyMetals = { pb: 0.5, hg: 0.1, cd: 0.1, as: 1.0 };
const HEAVY_METAL_LABELS: Record<keyof HeavyMetals, string> = { pb: "铅 Pb", hg: "汞 Hg", cd: "镉 Cd", as: "砷 As" };

const FISH_OIL_BATCHES: Record<string, { name: string; image: string; epaDha: number; peroxide: number; totox: number; coldGap: number; productionDate: string; origin: string; passed: boolean; heavyMetals: HeavyMetals }> = {
  "FO-2026-001": { name: "深海鱼油软胶囊", image: "/assets/fish-oil-product.png", epaDha: 78, peroxide: 2.1, totox: 11, coldGap: 2, productionDate: "2026-01-12", origin: "北太平洋海域", passed: true, heavyMetals: { pb: 0.02, hg: 0.01, cd: 0.03, as: 0.1 } },
  "FO-2026-002": { name: "高纯度 Omega-3 鱼油", image: "/assets/fish-oil-002.png", epaDha: 82, peroxide: 1.8, totox: 9, coldGap: 1.5, productionDate: "2026-02-08", origin: "挪威海域", passed: true, heavyMetals: { pb: 0.01, hg: 0.02, cd: 0.02, as: 0.15 } },
  "FO-2026-003": { name: "儿童 DHA 鱼油滴剂", image: "/assets/fish-oil-003.png", epaDha: 90, peroxide: 1.2, totox: 6, coldGap: 3, productionDate: "2026-03-15", origin: "阿拉斯加海域", passed: true, heavyMetals: { pb: 0.03, hg: 0.01, cd: 0.01, as: 0.08 } },
  "FO-2026-004": { name: "三文鱼油胶囊", image: "/assets/fish-oil-004.png", epaDha: 75, peroxide: 6.8, totox: 14, coldGap: 2.5, productionDate: "2026-04-02", origin: "智利海域", passed: false, heavyMetals: { pb: 0.04, hg: 0.03, cd: 0.05, as: 0.2 } },
  "FO-2026-005": { name: "南极磷虾油", image: "/assets/fish-oil-005.png", epaDha: 85, peroxide: 1.5, totox: 8, coldGap: 7, productionDate: "2026-05-20", origin: "南极海域", passed: false, heavyMetals: { pb: 0.05, hg: 0.02, cd: 0.18, as: 0.3 } },
};

function heavyMetalStatus(metals: HeavyMetals): "pass" | "fail" {
  const keys = Object.keys(HEAVY_METAL_LIMITS) as Array<keyof HeavyMetals>;
  return keys.some((k) => metals[k] > HEAVY_METAL_LIMITS[k]) ? "fail" : "pass";
}

function heavyMetalValue(metals: HeavyMetals): string {
  const keys = Object.keys(HEAVY_METAL_LIMITS) as Array<keyof HeavyMetals>;
  const over = keys.filter((k) => metals[k] > HEAVY_METAL_LIMITS[k]).map((k) => HEAVY_METAL_LABELS[k]);
  return over.length ? `${over.join("、")}超标` : "4 项均达标";
}

function metricsFor(batchId: string) {
  const b = FISH_OIL_BATCHES[batchId] ?? FISH_OIL_BATCHES[BATCH_ID];
  const hm = heavyMetalStatus(b.heavyMetals);
  return [
    { key: "epa-dha", icon: "fish", label: "EPA+DHA", value: `${b.epaDha}%`, unit: "检测结果（占总脂肪酸）", bar: Math.min(100, b.epaDha), status: b.epaDha >= 70 ? "pass" : "fail" },
    { key: "peroxide", icon: "warning", label: "过氧化值", value: `${b.peroxide}`, unit: "meq/kg", bar: Math.min(100, Math.round((b.peroxide / 5) * 100)), status: b.peroxide <= 5 ? "pass" : "fail" },
    { key: "cold-chain", icon: "snowflake", label: "冷链", value: `${b.coldGap}小时`, unit: "全程温度异常时长", bar: Math.min(100, Math.round((b.coldGap / 6) * 100)), status: b.coldGap <= 6 ? "pass" : "fail" },
    { key: "heavy-metal", icon: "alert", label: "重金属报告", value: heavyMetalValue(b.heavyMetals), unit: "铅 / 汞 / 镉 / 砷", bar: hm === "pass" ? 15 : 85, status: hm },
  ];
}

function journeyFor(batchId: string) {
  const b = FISH_OIL_BATCHES[batchId] ?? FISH_OIL_BATCHES[BATCH_ID];
  return [
    { step: 1, icon: "fish", title: "产地捕捞", desc: `${b.origin} · 纯净深海` },
    { step: 2, icon: "sensor", title: "提炼生产", desc: `${b.productionDate} · 低温提炼灌装` },
    { step: 3, icon: "rule", title: "第三方检测", desc: `SGS 检测报告 · EPA+DHA ${b.epaDha}%` },
    { step: 4, icon: "snowflake", title: "全程冷链", desc: `全程低温运输 · 温度异常 ${b.coldGap} 小时` },
    { step: 5, icon: "chain", title: "跨境到货", desc: "海关清关 · 保税仓出库" },
  ];
}

function evidenceHash(seed: string): string {
  return "0x" + createHash("sha256").update(seed).digest("hex").slice(0, 32);
}

function evidenceFor(batchId: string) {
  const b = FISH_OIL_BATCHES[batchId] ?? FISH_OIL_BATCHES[BATCH_ID];
  const stamp = `${b.productionDate}T`;
  return [
    { step: 1, icon: "sensor", title: "设备采集", source: "船舱传感器 · 温度 / 湿度 / 定位", description: "船上与加工环节的传感器数据，记录捕捞、加工、温度等关键信息。", hash: evidenceHash(`${batchId}:sensor`), verifiedAt: `${stamp}08:30:00Z` },
    { step: 2, icon: "agent", title: "Agent 关联", source: "TruthPass Agent · 多源数据关联", description: "TruthPass Agent 将多源数据关联，形成可验证的证据包。", hash: evidenceHash(`${batchId}:agent`), verifiedAt: `${stamp}12:00:00Z` },
    { step: 3, icon: "jev", title: "JEV 判别", source: "JEV 决策门 · route_to_rule · 0.94", description: "用固定类型输出识别证据缺口、冲突和下一步路由。", hash: evidenceHash(`${batchId}:jev`), verifiedAt: `${stamp}13:40:00Z` },
    { step: 4, icon: "rule", title: "规则验收", source: `规则引擎 ${policy.policyId}@${policy.version}`, description: "按食品安全与质量规则进行自动化验收，生成结论与置信范围。", hash: evidenceHash(`${batchId}:rule`), verifiedAt: `${stamp}14:00:00Z` },
    { step: 5, icon: "chain", title: "链上锚定", source: "链上锚定 · 不可篡改", description: "关键证据哈希上链，确保记录不可篡改、可长期验证。", hash: evidenceHash(`${batchId}:chain`), verifiedAt: `${stamp}14:05:00Z` },
  ];
}

function productionProcessFor(batchId: string) {
  if (batchId === BATCH_ID) return productionSummary;
  const b = FISH_OIL_BATCHES[batchId];
  return { ...productionSummary, originRegion: b?.origin };
}

// ---------- 服务注册（评委观察台用，三个候选服务） ----------
function adapterFor(card: ServiceCard, mode: "valid" | "wrong-batch" | "offline"): ServiceAdapter {
  return {
    async probe() {
      if (mode === "offline") {
        return {
          serviceId: card.id,
          status: "offline" as const,
          latencyMs: 0,
          capabilityMatch: false,
          schemaValid: false,
          checkedAt: new Date().toISOString(),
          reason: "连接超时",
        };
      }
      return {
        serviceId: card.id,
        status: mode === "valid" ? ("healthy" as const) : ("degraded" as const),
        latencyMs: mode === "valid" ? 420 : 980,
        capabilityMatch: true,
        schemaValid: true,
        checkedAt: new Date().toISOString(),
      };
    },
    async execute() {
      return {
        serviceId: card.id,
        taskId: task.taskId,
        batchId: task.batchId,
        reportBatchId: mode === "wrong-batch" ? "FO-2026-000" : task.batchId,
        productionTime: task.productionTime,
        reportTime: "2026-10-06T10:20:00Z",
        logisticsGapHours: mode === "valid" ? 2 : 4,
        signatureValid: mode === "valid",
        epaDhaPercent: mode === "valid" ? 78 : 61,
        peroxideValue: mode === "valid" ? 2.1 : 7.2,
        totox: mode === "valid" ? 11 : 26,
        coldChainGapHours: mode === "valid" ? 2 : 11,
        payload: { product: fishOilProduct.name, dataMode: "demo/synthetic" },
      };
    },
  };
}

const services: Array<[ServiceCard, "valid" | "wrong-batch" | "offline"]> = [
  [
    { id: "lab-a", name: "山野检测服务", kind: "lab", endpoint: "https://example.test/lab-a", capabilities: ["fish-oil-batch-quality-check"], signer: "0x1111...aaaa", historicalScore: 92, feedbackCount: 14 },
    "wrong-batch",
  ],
  [
    { id: "lab-b", name: "快速检测服务", kind: "lab", endpoint: "https://example.test/lab-b", capabilities: ["fish-oil-batch-quality-check"], signer: "0x2222...bbbb", historicalScore: 96, feedbackCount: 9 },
    "offline",
  ],
  [
    { id: "lab-c", name: "可信实验室", kind: "lab", endpoint: "https://example.test/lab-c", capabilities: ["fish-oil-batch-quality-check"], signer: "0x3333...cccc", historicalScore: 88, feedbackCount: 21 },
    "valid",
  ],
];

const registry = new ServiceRegistry(trustedIssuerKeys.resolve, replayGuard);
for (const [card, mode] of services) registry.register(card, adapterFor(card, mode), "demo/synthetic");

// ---------- 消费者共建 ----------
const consumers = new ConsumerParticipationRegistry();
const consumerId = "consumer-demo-001";
for (const batchId of Object.keys(FISH_OIL_BATCHES)) {
  await consumers.grantConsent({
    consumerId,
    batchId,
    scopes: ["purchase", "packaging", "odor", "storage", "quality-feedback"],
    grantedAt: "2026-10-06T12:00:00Z",
  });
}

// ---------- HTTP 工具 ----------
function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) raw += chunk.toString();
  if (!raw) return {};
  return JSON.parse(raw);
}

// ---------- SSE 对话脚本 ----------
function buildVerifyScript(batchId: string): Array<{ cls: string; text: string }> {
  const b = FISH_OIL_BATCHES[batchId] ?? FISH_OIL_BATCHES[BATCH_ID];
  const verdict = b.passed ? "按当前规则通过。" : "未通过：部分指标超出验收标准。";
  return [
    { cls: "cmd", text: `$ zhenyan check --batch ${batchId}` },
    { cls: "check", text: "✓ 读取设备采集数据" },
    { cls: "check", text: "✓ 关联检测报告" },
    { cls: "check", text: "✓ 执行规则验收（9 项）" },
    { cls: "check", text: "✓ 验证链上记录" },
    { cls: "lead", text: `${b.name} ${batchId}` },
    { cls: "conclusion", text: verdict },
    { cls: "conclusion", text: `EPA+DHA ${b.epaDha}%（≥70%），过氧化值 ${b.peroxide} meq/kg（≤5），冷链中断 ${b.coldGap} 小时（≤6）。` },
    { cls: "disclaimer", text: "ⓘ 这是基于现有证据综合判断，并不代表对未来或其他批次的保证。" },
  ];
}

const chatScripts: Record<string, Array<{ cls: string; text: string }>> = {
  origin: [
    { cls: "cmd", text: "$ zhenyan origin --batch FO-2026-001" },
    { cls: "conclusion", text: `原料来自${fishOilProduct.name}，生产日期 ${fishOilBatch.productionAt.slice(0, 10)}。` },
    { cls: "disclaimer", text: "以上为厂商自报来源，演示数据 demo/synthetic。" },
  ],
  metrics: [
    { cls: "cmd", text: "$ zhenyan metrics --batch FO-2026-001" },
    { cls: "conclusion", text: `EPA+DHA ${assessment.checks.epaDhaWithinLimit ? "78%" : "不达标"}；过氧化值 ${assessment.checks.peroxideWithinLimit ? "2.1" : "超标"}；冷链 ${assessment.checks.coldChainWithinLimit ? "2h" : "超限"}。` },
  ],
  rules: [
    { cls: "cmd", text: "$ zhenyan rules --v1.0" },
    { cls: "conclusion", text: `当前 policy ${policy.policyId}@${policy.version}，验收得分 ${assessment.score}/100。` },
  ],
  cold: [
    { cls: "cmd", text: "$ zhenyan coldchain --batch FO-2026-001" },
    { cls: "conclusion", text: `冷链中断 ${inspectionEvidence.payload.coldChainGapHours}h ≤ ${policy.thresholds.maxLogisticsGapHours}h。` },
  ],
  fallback: [
    { cls: "plain", text: "抱歉，我目前只能回答该批次已公开的产地、检测项、规则与冷链证据。" },
  ],
};

function detectIntent(text: string): string {
  if (/燕窝|茶叶|swallow|bird.?nest|tea/i.test(text)) return "unsupported";
  if (/产地|来源|海域|在哪|哪里/.test(text)) return "origin";
  if (/检测|指标|含量|过氧化|epa|dha|totox/i.test(text)) return "metrics";
  if (/规则|怎么判定|为什么通过|标准/.test(text)) return "rules";
  if (/冷链|温度|物流|运输/.test(text)) return "cold";
  return "default";
}

function extractBatchId(text: string): string {
  const full = text.match(/([A-Z]{2,3}-\d{4}-\d{3})/i);
  if (full) return full[1].toUpperCase();
  const short = text.match(/\b0*0?([1-5])\b/);
  if (short && FISH_OIL_BATCHES[`FO-2026-00${short[1]}`]) return `FO-2026-00${short[1]}`;
  return "";
}

function streamChat(res: ServerResponse, intent: string, script: Array<{ cls: string; text: string }>): void {
  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write("data: " + JSON.stringify({ kind: "begin", intent }) + "\n\n");
  let i = 0;
  const next = () => {
    if (res.writableEnded || res.destroyed) return;
    if (i >= script.length) {
      res.write("data: " + JSON.stringify({ kind: "done" }) + "\n\n");
      res.end();
      return;
    }
    const line = script[i++];
    res.write("data: " + JSON.stringify({ kind: "line", cls: line.cls, text: line.text }) + "\n\n");
    setTimeout(next, line.cls === "conclusion" ? 260 : 210);
  };
  next();
}

async function streamAgent(res: ServerResponse, batchId: string, question: string): Promise<boolean> {
  const b = FISH_OIL_BATCHES[batchId];
  const systemPrompt = b
    ? [
        "你是 TruthPass 的溯源验证助手。请基于下面提供的批次验证数据，用简洁、友好的中文回答消费者的问题。",
        "只依据给定数据回答，不要编造检测值或效果承诺；数据里没有的就说明暂未覆盖。",
        "回答请使用纯文本，不要使用 Markdown 格式（不要加星号、井号、反引号等标记符号），用自然的分行即可。",
        "",
        `批次号：${batchId}`,
        `商品：${b.name}`,
        `产地：${b.origin}`,
        `生产日期：${b.productionDate}`,
        `验收结论：${b.passed ? "通过验收" : "未通过验收"}`,
        `EPA+DHA：${b.epaDha}%（门槛 ≥70%）`,
        `过氧化值：${b.peroxide} meq/kg（门槛 ≤5）`,
        `冷链中断：${b.coldGap} 小时（门槛 ≤6 小时）`,
        `重金属：${heavyMetalValue(b.heavyMetals)}（铅/汞/镉/砷）`,
        "以上均为 demo/synthetic 演示数据。",
      ].join("\n")
    : [
        "你是 TruthPass 的溯源验证助手。用户还没有指定要查询的商品或批次。",
        "请用简洁、友好的中文引导用户：告诉用户可以查询「鱼油」商品，并提供批次号（例如 FO-2026-001 到 FO-2026-005，也可以直接说 001 到 005）。",
        "不要假设用户要查询某一个具体批次，也不要输出具体的检测数据。",
        "回答请使用纯文本，不要使用 Markdown 格式，用自然的分行即可。",
      ].join("\n");

  const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
  const model = process.env.DEEPSEEK_MODEL || "deepseek-chat";
  const upstream = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: question },
      ],
      stream: true,
    }),
  });

  if (!upstream.ok || !upstream.body) return false;

  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive" });
  res.write("data: " + JSON.stringify({ kind: "begin", intent: "agent" }) + "\n\n");

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith("data:")) continue;
        const payload = t.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;
        try {
          const json = JSON.parse(payload);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            res.write("data: " + JSON.stringify({ kind: "line", cls: "conclusion", text: delta }) + "\n\n");
          }
        } catch {
          // 忽略无法解析的行
        }
      }
    }
  } catch {
    // 上游中断时直接结束
  }
  res.write("data: " + JSON.stringify({ kind: "done" }) + "\n\n");
  res.end();
  return true;
}

// ---------- 路由 ----------
async function handleApi(url: URL, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const p = url.pathname;

  if (p === "/api/agent/chat" && req.method === "POST") {
    const body = await readBody(req);
    const messages = (body.messages as Array<{ content: string }>) || [];
    const last = messages[messages.length - 1]?.content || "";
    const batchId = extractBatchId(last);
    const agentOk = await streamAgent(res, batchId, last);
    if (agentOk) return true;
    streamChat(res, "fallback", [
      { cls: "plain", text: "抱歉，Agent 对话服务暂不可用。" },
      { cls: "plain", text: "请检查服务端是否配置了 DEEPSEEK_API_KEY，以及能否连接 DeepSeek API。" },
    ]);
    return true;
  }

  const productMatch = p.match(/^\/api\/products\/([^/]+)\/?$/);
  if (productMatch && req.method === "GET") {
    const batchId = productMatch[1];
    const b = FISH_OIL_BATCHES[batchId];
    if (!b) return sendJson(res, 404, { error: "batch not found" });
    sendJson(res, 200, {
      batchId,
      name: b.name,
      category: "鱼油",
      origin: b.origin,
      productionDate: b.productionDate,
      supplyChainTags: ["来自纯净海域", "全程冷链", "多重检测", "区块链存证"],
      imageUrl: b.image,
      verification: {
        status: b.passed ? "accepted" : "rejected",
        summary: b.passed ? "基于多源证据的综合判断" : "部分指标未达验收标准",
        scope: `${batchId} 批次及当前公开的规则 ${policy.version}`,
      },
      productionProcess: productionProcessFor(batchId),
      keyMetrics: metricsFor(batchId),
    });
    return true;
  }

  const evidenceLinkMatch = p.match(/^\/api\/products\/([^/]+)\/evidence-link\/?$/);
  if (evidenceLinkMatch && req.method === "GET") {
    const batchId = evidenceLinkMatch[1];
    if (!FISH_OIL_BATCHES[batchId]) return sendJson(res, 404, { error: "batch not found" });
    sendJson(res, 200, evidenceFor(batchId));
    return true;
  }

  const productionMatch = p.match(/^\/api\/products\/([^/]+)\/production\/?$/);
  if (productionMatch && req.method === "GET") {
    const batchId = productionMatch[1];
    if (!FISH_OIL_BATCHES[batchId]) return sendJson(res, 404, { error: "batch not found" });
    sendJson(res, 200, productionProcessFor(batchId));
    return true;
  }

  const journeyMatch = p.match(/^\/api\/products\/([^/]+)\/journey\/?$/);
  if (journeyMatch && req.method === "GET") {
    const batchId = journeyMatch[1];
    const b = FISH_OIL_BATCHES[batchId];
    if (!b) return sendJson(res, 404, { error: "batch not found" });
    sendJson(res, 200, { batchId, status: b.passed ? "verified" : "review", steps: journeyFor(batchId) });
    return true;
  }

  const metricMatch = p.match(/^\/api\/products\/([^/]+)\/metrics\/([^/]+)\/?$/);
  if (metricMatch && req.method === "GET") {
    const batchId = metricMatch[1];
    const key = metricMatch[2];
    const b = FISH_OIL_BATCHES[batchId];
    if (!b) return sendJson(res, 404, { error: "batch not found" });
    const view = metricsFor(batchId).find((m) => m.key === key);
    if (!view) return sendJson(res, 404, { error: "metric not found" });
    const thresholds = policy.thresholds;
    sendJson(res, 200, {
      label: view.label,
      value: view.value,
      unit: view.unit,
      threshold:
        key === "epa-dha" ? `≥ ${thresholds.minEpaDhaPercent}%`
        : key === "peroxide" ? `≤ ${thresholds.maxPeroxideValue}`
        : key === "cold-chain" ? `≤ ${thresholds.maxLogisticsGapHours} 小时`
        : "铅/汞/镉/砷 均需达标",
      heavyMetals:
        key === "heavy-metal"
          ? (Object.keys(HEAVY_METAL_LIMITS) as Array<keyof HeavyMetals>).map((k) => ({
              name: HEAVY_METAL_LABELS[k],
              value: b.heavyMetals[k],
              limit: HEAVY_METAL_LIMITS[k],
              passed: b.heavyMetals[k] <= HEAVY_METAL_LIMITS[k],
            }))
          : undefined,
      sources: [
        {
          name: key === "cold-chain" ? "冷链温度传感器" : "SGS 检测报告",
          method: key === "cold-chain" ? "每 5 分钟采样" : "第三方检测",
          reportNo: key === "cold-chain" ? "IOT-FO-2026-001" : "SGS-2026-1015-042",
          pdf: "ipfs://QmDemo.../report.pdf",
          time: inspectionEvidence.occurredAt,
          signature: "0x...demo-signature",
        },
      ],
    });
    return true;
  }

  if (p === "/api/verification" && req.method === "GET") {
    const t = policy.thresholds;
    const batchId = url.searchParams.get("batchId") || BATCH_ID;
    const b = FISH_OIL_BATCHES[batchId] ?? FISH_OIL_BATCHES[BATCH_ID];
    const allPassed = b.passed;
    sendJson(res, 200, {
      batchId,
      productName: b.name,
      policy: { id: policy.policyId, version: policy.version, dataMode: policy.dataMode },
      status: allPassed ? "accepted" : "rejected",
      score: allPassed ? 100 : 89,
      evidenceHash: assessment.evidenceHash,
      serviceExecution: { status: allPassed ? "accepted" : "rejected", score: allPassed ? 100 : 75, evidenceHash: assessment.evidenceHash },
      rules: [
        { name: "任务匹配", desc: "证据 taskId 与任务一致", passed: true },
        { name: "批次匹配", desc: `报告批次与请求批次一致（${batchId}）`, passed: true },
        { name: "时间逻辑", desc: "报告时间 ≥ 生产时间", passed: true },
        { name: "签名有效", desc: "实验室签名验证通过", passed: true },
        { name: "物流连续", desc: `冷链 gap ${b.coldGap}h ≤ ${t.maxLogisticsGapHours}h`, passed: b.coldGap <= t.maxLogisticsGapHours },
        { name: "EPA+DHA", desc: `${b.epaDha}% ≥ ${t.minEpaDhaPercent}%`, passed: b.epaDha >= t.minEpaDhaPercent },
        { name: "过氧化值", desc: `${b.peroxide} ≤ ${t.maxPeroxideValue}`, passed: b.peroxide <= t.maxPeroxideValue },
        { name: "TOTOX", desc: `${b.totox} ≤ ${t.maxTotox}`, passed: b.totox <= t.maxTotox },
        { name: "冷链中断", desc: `${b.coldGap}h ≤ ${t.maxLogisticsGapHours}h`, passed: b.coldGap <= t.maxLogisticsGapHours },
      ],
      evidence: repository.listEvidence(BATCH_ID).map((e) => ({
        evidenceId: e.evidenceId,
        kind: e.kind,
        issuerId: e.issuerId,
        sourceKind: e.sourceKind,
        payloadHash: e.payloadHash,
        status: e.status,
        occurredAt: e.occurredAt,
      })),
    });
    return true;
  }

  if (p === "/api/observer" && req.method === "GET") {
    const batchId = url.searchParams.get("batchId") || BATCH_ID;
    const b = FISH_OIL_BATCHES[batchId] ?? FISH_OIL_BATCHES[BATCH_ID];
    const ranking = await registry.evaluate(task);
    sendJson(res, 200, {
      task: `task-${batchId.toLowerCase()}`,
      policy: `${policy.policyId}-${policy.version}`,
      jev: "route_to_rule · 0.94 · demo",
      evidenceRoot: evidenceHash(`${batchId}:root`).slice(0, 10) + "…",
      chainStatus: "待锚定 · 可重试",
      services: ranking.map((r) => {
        const live = r.probe.status === "healthy" ? "online" : r.probe.status === "degraded" ? "degraded" : "offline";
        let verdict: string;
        if (r.probe.status === "offline") verdict = "not-called";
        else if (r.service.id === "lab-c") verdict = b.passed ? "passed" : "rejected";
        else verdict = r.execution?.status === "accepted" ? "passed" : "rejected";
        return { id: r.service.id, history: r.service.historicalScore, live, verdict };
      }),
    });
    return true;
  }

  if (p === "/api/feedback" && req.method === "POST") {
    const body = await readBody(req);
    const batchId = typeof body.batchId === "string" ? body.batchId : BATCH_ID;
    const b = FISH_OIL_BATCHES[batchId] ?? FISH_OIL_BATCHES[BATCH_ID];
    const rating = Number(body.rating || 5);
    const categories = Array.isArray(body.categories) ? (body.categories as string[]) : [];
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";
    const freshPurchase = await consumers.recordPurchase({
      consumerId,
      batchId,
      purchaseProofHash: `demo-purchase-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
    });
    const feedback = await consumers.recordFeedback({
      purchaseId: freshPurchase.purchaseId,
      rating: Math.min(5, Math.max(1, rating)),
      categories,
      evidence: { source: "demo/synthetic", note: "消费者 Agent 授权后的体验反馈" },
    });
    try {
      await mailer.sendMail({
        from: `"TruthPass" <${process.env.SMTP_USER}>`,
        to: process.env.FEEDBACK_EMAIL,
        subject: `TruthPass 消费者质量反馈 · ${batchId}`,
        text: [
          `批次号：${batchId}`,
          `商品：${b.name}`,
          `验证结论：${b.passed ? "通过验收" : "未通过验收"}`,
          `产地：${b.origin}`,
          `生产日期：${b.productionDate}`,
          `EPA+DHA：${b.epaDha}%（≥70%）`,
          `过氧化值：${b.peroxide} meq/kg（≤5）`,
          `冷链中断：${b.coldGap} 小时（≤6）`,
          `评分：${Math.min(5, Math.max(1, rating))}`,
          `反馈标签：${categories.length ? categories.join("、") : "无"}`,
          `补充反馈：${comment || "无"}`,
          `共建积分：${feedback.contributionPoints}`,
          `证据哈希：${feedback.evidenceHash}`,
          `反馈编号：${feedback.feedbackId}`,
          "",
          "由消费者 Agent 授权后自动提交。",
        ].join("\n"),
      });
    } catch (error) {
      console.error("反馈邮件发送失败:", error instanceof Error ? error.message : String(error));
    }
    sendJson(res, 200, { ok: true, feedbackId: feedback.feedbackId, contributionPoints: feedback.contributionPoints, evidenceHash: feedback.evidenceHash });
    return true;
  }

  return false;
}

async function handleStatic(url: URL, res: ServerResponse): Promise<void> {
  const pathname = decodeURIComponent(url.pathname);
  const filePath = resolve(pathname === "/" ? join(WEB, "index.html") : join(WEB, normalize(pathname)));
  const rel = relative(WEB, filePath);
  if (rel.startsWith("..") || isAbsolute(rel)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }
  try {
    const data = await readFile(filePath);
    const ext = extname(filePath).toLowerCase();
    const mime: Record<string, string> = {
      ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8", ".svg": "image/svg+xml", ".png": "image/png",
      ".jpg": "image/jpeg", ".ico": "image/x-icon",
    };
    res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream" });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
  }
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    if (url.pathname.startsWith("/api/")) {
      const handled = await handleApi(url, req, res);
      if (!handled) sendJson(res, 404, { error: "not found" });
      return;
    }
    await handleStatic(url, res);
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
  }
});

server.listen(PORT, () => {
  console.log(`TruthPass API 对接层已启动: http://localhost:${PORT}`);
});
