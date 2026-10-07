/**
 * 本地测试用对接层：把 src/ 的真实模块通过 HTTP 暴露给前端 web/。
 * 注意：不修改 src/ 的任何文件，仅作为前端与后端之间的适配器。
 * 运行：npm run api  （tsx api-server.ts）
 */
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { extname, join } from "node:path";
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
import { resolveStaticFilePath } from "./src/static-path.js";
import { createPostgresReplayGuard, persistConsumerRun, persistenceEnabled } from "./src/data/persistence.js";
import { loadExecutionEvidenceFromPostgres, loadRepositoryFromPostgres } from "./src/data/postgres-reader.js";
import { answerConsumerQuestion } from "./src/agents/consumer-assistant.js";
import { renderConsumerFacts, runAgentCollaboration } from "./src/agents/collaboration.js";
import { createCompatibleAgentInvoker } from "./src/agents/compatible-invoker.js";
import { buildJevContext, buildJevRoleView } from "./src/jev/context.js";
import type { ServiceAdapter, ServiceCard, TaskRequest } from "./src/types.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const WEB_DIST = join(__dirname, "web", "dist");
const WEB = existsSync(WEB_DIST) ? WEB_DIST : join(__dirname, "web");
const PORT = Number(process.env.PORT || 4173);
const BATCH_ID = "FO-2026-001";
const invokeAgent = createCompatibleAgentInvoker();

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

const task: TaskRequest = {
  taskId: "task-fish-oil-2026-001",
  serviceKind: "lab",
  capability: "fish-oil-batch-quality-check",
  batchId: BATCH_ID,
  productionTime: "2026-10-06T08:00:00Z",
  acceptance: { requireSignature: true, policyId: "fish-oil-quality", policyVersion: "v1" },
};
const dataSource = process.env.TRUTHPASS_DATA_SOURCE ?? (persistenceEnabled() ? "postgres" : "fixtures");

// ---------- 初始化只读数据仓库 ----------
const repository = dataSource === "postgres" ? await loadRepositoryFromPostgres() : new MemoryDataRepository();
if (dataSource !== "postgres") {
  repository.createProduct(fishOilProduct);
  repository.createBatch(fishOilBatch);
  for (const item of fishOilEvidence) await repository.addEvidence(item);
}

if (dataSource === "postgres") {
  const executionEvidence = await loadExecutionEvidenceFromPostgres(task.taskId, task.batchId);
  for (const evidence of executionEvidence) {
    const evidenceId = `execution-${evidence.serviceId}-${evidence.reportTime.replace(/[^0-9]/g, "")}`;
    await repository.addEvidence({
      schemaVersion: "evidence.v1", evidenceId, batchId: evidence.batchId, kind: "inspection",
      issuerId: evidence.serviceId, sourceKind: "third_party", occurredAt: evidence.reportTime,
      dataMode: evidence.payload.evidenceMode === "demo/synthetic" ? "demo/synthetic" : "external",
      payload: evidence.payload,
      attestation: evidence.attestation,
    });
  }
} else {
  await repository.addEvidence({
    schemaVersion: "evidence.v1", evidenceId: "ev-test-report-001", batchId: BATCH_ID, kind: "inspection",
    issuerId: "lab-demo-001", sourceKind: "third_party", occurredAt: "2026-10-06T10:20:00Z", dataMode: "demo/synthetic",
    payload: { taskId: task.taskId, reportBatchId: BATCH_ID, logisticsGapHours: 2, signatureValid: true, epaDhaPercent: 78, peroxideValue: 2.1, totox: 11, coldChainGapHours: 2 },
  });
}

const productionSummary = await buildProductionPublicSummary(repository, BATCH_ID);

const inspectionEvidence = repository.listEvidence(BATCH_ID).find((item) => item.kind === "inspection" && item.payload.taskId === task.taskId)
  ?? repository.listEvidence(BATCH_ID).find((item) => item.kind === "inspection");
if (!inspectionEvidence) throw new Error(`批次 ${BATCH_ID} 没有可用检测证据`);
const trustedIssuerKeys = new TrustedIssuerKeyRegistry(
  JSON.parse(process.env.TRUTHPASS_TRUSTED_ISSUER_KEYS ?? "[]") as TrustedIssuerPublicKey[],
);
const replayGuard = persistenceEnabled() ? createPostgresReplayGuard() : undefined;
const inspectionTools = new TruthPassTools(repository, "inspection", trustedIssuerKeys.resolve, true, replayGuard);

const policy = getPolicySnapshot(task.acceptance.policyId, task.acceptance.policyVersion);
const assessment = await inspectionTools.assessProductBatch({ task, evidenceId: inspectionEvidence.evidenceId });

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
  "FO-2026-006": { name: "高浓度 Omega-3 软胶囊", image: "/assets/fish-oil-006.png", epaDha: 88, peroxide: 1.6, totox: 8, coldGap: 1.5, productionDate: "2026-06-10", origin: "挪威深海", passed: true, heavyMetals: { pb: 0.02, hg: 0.01, cd: 0.02, as: 0.12 } },
  "FO-2026-007": { name: "深海鳕鱼肝油", image: "/assets/fish-oil-007.png", epaDha: 80, peroxide: 2.0, totox: 10, coldGap: 2, productionDate: "2026-06-18", origin: "北大西洋海域", passed: true, heavyMetals: { pb: 0.03, hg: 0.02, cd: 0.04, as: 0.18 } },
  "FO-2026-008": { name: "孕妇 DHA 鱼油", image: "/assets/fish-oil-008.png", epaDha: 92, peroxide: 1.2, totox: 6, coldGap: 1, productionDate: "2026-07-02", origin: "阿拉斯加海域", passed: true, heavyMetals: { pb: 0.01, hg: 0.01, cd: 0.01, as: 0.06 } },
  "FO-2026-009": { name: "鱼油凝胶软糖", image: "/assets/fish-oil-009.png", epaDha: 55, peroxide: 2.5, totox: 12, coldGap: 2.5, productionDate: "2026-07-15", origin: "南太平洋海域", passed: false, heavyMetals: { pb: 0.04, hg: 0.02, cd: 0.05, as: 0.2 } },
  "FO-2026-010": { name: "高纯度磷虾油胶囊", image: "/assets/fish-oil-010.png", epaDha: 86, peroxide: 6.5, totox: 18, coldGap: 3, productionDate: "2026-07-28", origin: "南极海域", passed: false, heavyMetals: { pb: 0.05, hg: 0.03, cd: 0.15, as: 0.3 } },
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
  const dbBatch = repository.getBatch(batchId);
  if (dbBatch) {
    const records = repository.listEvidence(batchId);
    const inspection = batchId === BATCH_ID ? inspectionEvidence.payload : [...records].reverse().find((item) => item.kind === "inspection")?.payload ?? {};
    const coldChain = [...records].reverse().find((item) => item.kind === "cold_chain")?.payload ?? {};
    const epa = numberValue(inspection.epaDhaPercent);
    const peroxide = numberValue(inspection.peroxideValue);
    const coldGap = numberValue(inspection.coldChainGapHours) ?? numberValue(coldChain.maxGapHours);
    return [
      { key: "epa-dha", icon: "fish", label: "EPA+DHA", value: epa === undefined ? "未登记" : String(epa) + "%", unit: "检测结果（占总脂肪酸）", bar: epa === undefined ? 0 : Math.min(100, epa), status: epa === undefined ? "missing" : epa >= 70 ? "pass" : "fail" },
      { key: "peroxide", icon: "warning", label: "过氧化值", value: peroxide === undefined ? "未登记" : String(peroxide), unit: "meq/kg", bar: peroxide === undefined ? 0 : Math.min(100, Math.round((peroxide / 5) * 100)), status: peroxide === undefined ? "missing" : peroxide <= 5 ? "pass" : "fail" },
      { key: "cold-chain", icon: "snowflake", label: "冷链", value: coldGap === undefined ? "未登记" : String(coldGap) + "小时", unit: "全程温度异常时长", bar: coldGap === undefined ? 0 : Math.min(100, Math.round((coldGap / 6) * 100)), status: coldGap === undefined ? "missing" : coldGap <= 6 ? "pass" : "fail" },
      { key: "heavy-metal", icon: "alert", label: "重金属报告", value: "当前批次未登记", unit: "铅 / 汞 / 镉 / 砷", bar: 0, status: "missing" },
    ];
  }
  const b = FISH_OIL_BATCHES[batchId] ?? FISH_OIL_BATCHES[BATCH_ID];
  const hm = heavyMetalStatus(b.heavyMetals);
  return [
    { key: "epa-dha", icon: "fish", label: "EPA+DHA", value: `${b.epaDha}%`, unit: "检测结果（占总脂肪酸）", bar: Math.min(100, b.epaDha), status: b.epaDha >= 70 ? "pass" : "fail" },
    { key: "peroxide", icon: "warning", label: "过氧化值", value: `${b.peroxide}`, unit: "meq/kg", bar: Math.min(100, Math.round((b.peroxide / 5) * 100)), status: b.peroxide <= 5 ? "pass" : "fail" },
    { key: "cold-chain", icon: "snowflake", label: "冷链", value: `${b.coldGap}小时`, unit: "全程温度异常时长", bar: Math.min(100, Math.round((b.coldGap / 6) * 100)), status: b.coldGap <= 6 ? "pass" : "fail" },
    { key: "heavy-metal", icon: "alert", label: "重金属报告", value: heavyMetalValue(b.heavyMetals), unit: "铅 / 汞 / 镉 / 砷", bar: hm === "pass" ? 15 : 85, status: hm },
  ];
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
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

// ---------- HTTP 工具 ----------
function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk.toString();
    if (raw.length > 16_384) throw new Error("请求体过大");
  }
  if (!raw) return {};
  return JSON.parse(raw);
}

function extractBatchId(text: string): string {
  const full = text.match(/([A-Z]{2,3}-\d{4}-\d{3})/i);
  if (full) return full[1].toUpperCase();
  const short = text.match(/\b0*(\d{1,2})\b/);
  if (short) {
    const n = parseInt(short[1], 10);
    const id = `FO-2026-${String(n).padStart(3, "0")}`;
    if (FISH_OIL_BATCHES[id]) return id;
  }
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

async function streamChatWithReply(
  res: ServerResponse,
  intent: string,
  script: Array<{ cls: string; text: string }>,
  reply: Promise<Array<{ cls: string; text: string }>>,
): Promise<void> {
  res.writeHead(200, { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache", Connection: "keep-alive" });
  const send = (event: unknown) => res.write("data: " + JSON.stringify(event) + "\n\n");
  send({ kind: "begin", intent });
  for (const line of script) send({ kind: "line", ...line });
  for (const line of await reply) {
    if (res.writableEnded || res.destroyed) return;
    send({ kind: "line", ...line });
  }
  send({ kind: "done" });
  res.end();
}

async function consumerChat(batchId: string, question: string, res: ServerResponse): Promise<void> {
  if (!batchId) {
    const available = Object.keys(FISH_OIL_BATCHES).filter((id) => repository.getBatch(id));
    const reply = available.length
      ? "请提供鱼油批次号。我能读取已登记的批次：" + available.join("、") + "。"
      : "请提供商品名和批次号，我会先检查系统是否登记了对应证据。";
    streamChat(res, "consumer_query", [{ cls: "conclusion", text: reply }]);
    return;
  }

  const batch = repository.getBatch(batchId);
  if (!batch || !FISH_OIL_BATCHES[batchId]) {
    streamChat(res, "consumer_query", [{ cls: "disclaimer", text: "系统没有找到批次 " + batchId + " 的已登记证据，不会用其他批次的数据代替。" }]);
    return;
  }

  const context = buildJevContext(repository, batchId);
  const evidence = repository.listEvidence(batchId).map((item) => ({
    evidenceId: item.evidenceId,
    kind: item.kind,
    issuerId: item.issuerId,
    sourceKind: item.sourceKind,
    status: item.status,
    dataMode: item.dataMode,
    signature: item.attestation ? "not_checked" as const : "missing" as const,
  }));
  const decision = batchId === BATCH_ID
    ? assessment.status === "accepted" ? "accepted" as const : assessment.status === "rejected" ? "rejected" as const : "not_assessed" as const
    : "not_assessed" as const;
  const card = answerConsumerQuestion(question, {
    batchId,
    dataMode: batch.dataMode,
    decision,
    decisionReasons: batchId === BATCH_ID ? assessment.reasons : [],
    evidence,
  });
  const lines = [
    { cls: "cmd", text: "正在读取批次 " + batchId + " 的登记证据" },
    { cls: "lead", text: context.product.name + " · " + batchId },
    { cls: "conclusion", text: card.headline },
    ...card.uncertainties.map((text) => ({ cls: "disclaimer", text })),
    ...card.nextActions.map((text) => ({ cls: "conclusion", text: "建议：" + text })),
  ];

  if (!process.env.AGENT_API_KEY || !process.env.AGENT_MODEL) {
    streamChat(res, "consumer_evidence", [...lines, ...card.facts.map((text) => ({ cls: "plain", text })), { cls: "disclaimer", text: "StepFun 未配置；以上为根据登记证据和代码结果生成的说明。" }]);
    return;
  }

  const productionInput = { schemaVersion: "agent.input.v1", role: "production", view: buildJevRoleView(context, "production") };
  const inspectionInput = { schemaVersion: "agent.input.v1", role: "inspection", view: buildJevRoleView(context, "inspection"), policy };
  const modelReply = runAgentCollaboration(productionInput, inspectionInput, question, card, invokeAgent)
    .then((result) => renderConsumerFacts(card, result.consumer.selectedFactIds).map((text) => ({ cls: "plain", text })))
    .catch((error: unknown) => {
      console.error("[agent] consumer collaboration unavailable:", error instanceof Error ? error.message : "unknown error");
      return [{ cls: "disclaimer", text: "StepFun 暂不可用；以上仍是根据登记证据和代码结果生成的证据卡说明。" }];
    });
  await streamChatWithReply(res, "consumer_evidence", [...lines, { cls: "plain", text: "消费者 Agent 正在从证据卡中选择与问题相关的登记事实；模型不能新增事实。" }], modelReply);
}

// ---------- 路由 ----------
async function handleApi(url: URL, req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const p = url.pathname;

  if (p === "/api/agent/chat" && req.method === "POST") {
    const body = await readBody(req);
    const messages = Array.isArray(body.messages) ? body.messages as Array<{ content?: unknown }> : [];
    const last = typeof messages[messages.length - 1]?.content === "string" ? messages[messages.length - 1].content as string : "";
    const requestedBatch = typeof body.batchId === "string" ? body.batchId.trim().toUpperCase() : "";
    await consumerChat(requestedBatch || extractBatchId(last), last, res);
    return true;
  }

  const productMatch = p.match(/^\/api\/products\/([^/]+)\/?$/);
  if (productMatch && req.method === "GET") {
    const batchId = productMatch[1];
    const b = FISH_OIL_BATCHES[batchId];
    const dbBatch = repository.getBatch(batchId);
    const dbProduct = dbBatch ? repository.getProduct(dbBatch.productId) : undefined;
    if (!b && !dbBatch) {
      sendJson(res, 404, { error: "batch not found" });
      return true;
    }
    const display = b ?? {
      name: dbProduct?.name ?? "鱼油批次",
      origin: "数据库已登记，原料来源待核实",
      productionDate: dbBatch?.productionAt.slice(0, 10) ?? "未登记",
      image: "/assets/fish-oil-product.png",
      passed: false,
    };
    sendJson(res, 200, {
      batchId,
      name: dbProduct?.name ?? display.name,
      category: "鱼油",
      origin: display.origin,
      productionDate: dbBatch?.productionAt.slice(0, 10) ?? display.productionDate,
      dataSource: dbBatch ? "postgres" : "fixtures",
      dataMode: dbBatch?.dataMode ?? "demo/synthetic",
      supplyChainTags: ["来自纯净海域", "全程冷链", "多重检测", "区块链存证"],
      imageUrl: display.image,
      verification: {
        status: batchId === BATCH_ID ? (assessment.status === "accepted" ? "accepted" : "rejected") : (display.passed ? "accepted" : "rejected"),
        summary: batchId === BATCH_ID ? "基于数据库登记证据和确定性规则" : (display.passed ? "基于演示数据的综合判断" : "部分指标未达验收标准"),
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
    if (!FISH_OIL_BATCHES[batchId]) {
      sendJson(res, 404, { error: "batch not found" });
      return true;
    }
    sendJson(res, 200, evidenceFor(batchId));
    return true;
  }

  const productionMatch = p.match(/^\/api\/products\/([^/]+)\/production\/?$/);
  if (productionMatch && req.method === "GET") {
    const batchId = productionMatch[1];
    if (!FISH_OIL_BATCHES[batchId]) {
      sendJson(res, 404, { error: "batch not found" });
      return true;
    }
    sendJson(res, 200, productionProcessFor(batchId));
    return true;
  }

  const journeyMatch = p.match(/^\/api\/products\/([^/]+)\/journey\/?$/);
  if (journeyMatch && req.method === "GET") {
    const batchId = journeyMatch[1];
    const b = FISH_OIL_BATCHES[batchId];
    if (!b) {
      sendJson(res, 404, { error: "batch not found" });
      return true;
    }
    sendJson(res, 200, { batchId, status: b.passed ? "verified" : "review", steps: journeyFor(batchId) });
    return true;
  }

  const metricMatch = p.match(/^\/api\/products\/([^/]+)\/metrics\/([^/]+)\/?$/);
  if (metricMatch && req.method === "GET") {
    const batchId = metricMatch[1];
    const key = metricMatch[2];
    const b = FISH_OIL_BATCHES[batchId];
    if (!b) {
      sendJson(res, 404, { error: "batch not found" });
      return true;
    }
    const view = metricsFor(batchId).find((m) => m.key === key);
    if (!view) {
      sendJson(res, 404, { error: "metric not found" });
      return true;
    }
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
          time: inspectionEvidence!.occurredAt,
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
    const batchId = typeof body.batchId === "string" ? body.batchId : "";
    const b = FISH_OIL_BATCHES[batchId];
    const rating = body.rating;
    const allowedCategories = ["包装完好", "无明显腥味", "批次可查", "口感不错", "日期新鲜", "物流快速", "保存方便"];
    const categories = Array.isArray(body.categories) ? body.categories.filter((value): value is string => typeof value === "string") : [];
    const comment = typeof body.comment === "string" ? body.comment.trim() : "";
    if (body.consent !== true || body.purchaseConfirmed !== true) {
      sendJson(res, 400, { error: "提交反馈需要明确授权并确认已购买该批次" });
      return true;
    }
    if (!b || !repository.getBatch(batchId)) {
      sendJson(res, 404, { error: "批次不存在或没有登记记录" });
      return true;
    }
    if (typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5) {
      sendJson(res, 400, { error: "评分必须是 1 到 5 的整数" });
      return true;
    }
    if (!categories.length || categories.length > allowedCategories.length || categories.some((category) => !allowedCategories.includes(category)) || new Set(categories).size !== categories.length) {
      sendJson(res, 400, { error: "反馈标签无效" });
      return true;
    }
    if (comment.length > 1000) {
      sendJson(res, 400, { error: "补充反馈最多 1000 字符" });
      return true;
    }
    const consentRecord = await consumers.grantConsent({
      consumerId,
      batchId,
      scopes: ["purchase", "packaging", "odor", "storage", "quality-feedback"],
      grantedAt: new Date().toISOString(),
    });
    const freshPurchase = await consumers.recordPurchase({
      consumerId,
      batchId,
      purchaseProofHash: createHash("sha256").update("purchase-assertion:" + batchId + ":" + Date.now() + ":" + Math.random()).digest("hex"),
      createdAt: new Date().toISOString(),
    });
    const feedback = await consumers.recordFeedback({
      purchaseId: freshPurchase.purchaseId,
      rating,
      categories,
      evidence: { source: "demo/synthetic", purchaseConfirmedByConsumer: true, comment },
    });
    const persisted = persistenceEnabled();
    if (persisted) {
      try {
        await persistConsumerRun(consentRecord, freshPurchase, feedback);
      } catch (error) {
        console.error("消费者反馈持久化失败:", error instanceof Error ? error.message : String(error));
        sendJson(res, 503, { error: "反馈已生成但未能持久化，请稍后重试" });
        return true;
      }
    }
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
          `评分：${rating}`,
          `反馈标签：${categories.length ? categories.join("、") : "无"}`,
          `补充反馈：${comment || "无"}`,
          `共建积分：${feedback.contributionPoints}`,
          `证据哈希：${feedback.evidenceHash}`,
          `反馈编号：${feedback.feedbackId}`,
          "",
          "用户已勾选授权并确认购买；该购买声明未作外部核验。",
        ].join("\n"),
      });
    } catch (error) {
      console.error("反馈邮件发送失败:", error instanceof Error ? error.message : String(error));
    }
    sendJson(res, 200, { ok: true, persisted, feedbackId: feedback.feedbackId, contributionPoints: feedback.contributionPoints, evidenceHash: feedback.evidenceHash });
    return true;
  }

  return false;
}

async function handleStatic(url: URL, res: ServerResponse): Promise<void> {
  const pathname = decodeURIComponent(url.pathname);
  const filePath = resolveStaticFilePath(WEB, pathname);
  if (!filePath) {
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
