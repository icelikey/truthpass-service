import type {
  ChatEvent,
  EvidenceStep,
  Journey,
  MetricDetail,
  ProductBatch,
  JevDetection,
} from "./types";
import { FISH_OIL_BATCH_DATA } from "./data";

export const BATCH_ID = "FO-2026-001";

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as T;
}

export const fetchProduct = (batchId: string) => getJson<ProductBatch>(`/api/products/${batchId}`);
export const fetchEvidenceLink = (batchId: string) => getJson<EvidenceStep[]>(`/api/products/${batchId}/evidence-link`);
export const fetchJourney = (batchId: string) => getJson<Journey>(`/api/products/${batchId}/journey`);
export const fetchMetricDetail = (batchId: string, key: string) =>
  getJson<MetricDetail>(`/api/products/${batchId}/metrics/${key}`);
export const fetchJevDetection = () => getJson<JevDetection>("/api/jev/detection");

function buildSystemPrompt(batchId: string): string {
  const b = FISH_OIL_BATCH_DATA[batchId];
  if (!b) {
    return [
      "你是 TruthPass 的溯源验证助手。用户还没有指定要查询的商品或批次。",
      "请用简洁、友好的中文引导用户：告诉用户可以查询「鱼油」商品，并提供批次号（例如 FO-2026-001 到 FO-2026-005，也可以直接说 001 到 005）。",
      "不要假设用户要查询某一个具体批次，也不要输出具体的检测数据。",
      "回答请使用纯文本，不要使用 Markdown 格式，用自然的分行即可。",
    ].join("\n");
  }
  const hm = b.heavyMetals;
  const hmOver: string[] = [];
  if (hm.pb > 0.5) hmOver.push("铅");
  if (hm.hg > 0.1) hmOver.push("汞");
  if (hm.cd > 0.1) hmOver.push("镉");
  if (hm.as > 1.0) hmOver.push("砷");
  return [
    "你是 TruthPass 的溯源验证助手。请基于下面提供的批次验证数据，用简洁、友好的中文回答消费者的问题。",
    "只依据给定数据回答，不要编造检测值或效果承诺；数据里没有的就说明暂未覆盖。",
    "回答请使用纯文本，不要使用 Markdown 格式，用自然的分行即可。",
    "",
    `批次号：${batchId}`,
    `商品：${b.name}`,
    `产地：${b.origin}`,
    `生产日期：${b.productionDate}`,
    `验收结论：${b.passed ? "通过验收" : "未通过验收"}`,
    `EPA+DHA：${b.epaDha}%（门槛 ≥70%）`,
    `过氧化值：${b.peroxide} meq/kg（门槛 ≤5）`,
    `冷链中断：${b.coldGap} 小时（门槛 ≤6 小时）`,
    `重金属：${hmOver.length ? hmOver.join("、") + "超标" : "铅/汞/镉/砷均达标"}（铅 ${hm.pb}、汞 ${hm.hg}、镉 ${hm.cd}、砷 ${hm.as}）`,
    "以上均为 demo/synthetic 演示数据。",
  ].join("\n");
}

export async function postChat(
  question: string,
  batchId: string,
  onEvent: (event: ChatEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const baseUrl = (import.meta.env.VITE_DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
  const model = import.meta.env.VITE_DEEPSEEK_MODEL || "deepseek-chat";
  const key = import.meta.env.VITE_DEEPSEEK_API_KEY || "";
  if (!key) {
    onEvent({ kind: "line", cls: "plain", text: "未配置 DeepSeek API Key，无法使用对话功能。" });
    onEvent({ kind: "done" });
    return;
  }

  onEvent({ kind: "begin" });

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: buildSystemPrompt(batchId) },
        { role: "user", content: question },
      ],
      stream: true,
    }),
    signal,
  });
  if (!res.ok || !res.body) throw new Error("stream unavailable");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

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
        if (delta) onEvent({ kind: "line", cls: "conclusion", text: delta });
      } catch {
        // 忽略无法解析的行
      }
    }
  }
  onEvent({ kind: "done" });
}

export interface ObserverServiceView {
  id: string;
  history: number;
  live: "degraded" | "offline" | "online";
  verdict: "rejected" | "not-called" | "passed";
}

export interface ObserverData {
  task: string;
  policy: string;
  jev: string;
  evidenceRoot: string;
  chainStatus: string;
  services: ObserverServiceView[];
}

export const fetchObserver = (batchId: string) => getJson<ObserverData>(`/api/observer?batchId=${batchId}`);

export async function postFeedback(
  batchId: string,
  rating: number,
  categories: string[],
  comment?: string,
): Promise<{ ok: boolean; contributionPoints: number; evidenceHash: string }> {
  const res = await fetch("/api/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ batchId, rating, categories, comment }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return (await res.json()) as { ok: boolean; contributionPoints: number; evidenceHash: string };
}

export interface VerificationRule {
  name: string;
  desc: string;
  passed: boolean;
}

export interface VerificationEvidence {
  evidenceId: string;
  kind: string;
  issuerId: string;
  sourceKind: string;
  payloadHash: string;
  status: string;
  occurredAt: string;
}

export interface VerificationData {
  batchId: string;
  productName: string;
  policy: { id: string; version: string; dataMode: string };
  status: string;
  score: number;
  evidenceHash: string;
  serviceExecution: { status: string; score: number; evidenceHash: string };
  rules: VerificationRule[];
  evidence: VerificationEvidence[];
}

export const fetchVerification = (batchId: string) => getJson<VerificationData>(`/api/verification?batchId=${batchId}`);
