// 产品知识问答链路（L3 自由文本出口，带闸门）：
// 大模型只能基于整库注入的知识附录作答，数字守卫（numericGuard）校验答案中的
// 每个数字都必须出现在知识块或问题原文中，违规即回退确定性摘录，防止模型编造指标。
// 红线不变：验收判定永远由确定性代码执行，本链路只解释公开知识，不对批次作合格与否判断。
import { numericGuard } from "./explain.js";
import { buildWikiAppendix, type KnowledgeChunk } from "./wiki.js";

export interface KnowledgeQaOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

function completionsEndpoint(baseUrl: string): string {
  let base = baseUrl.trim();
  while (base.endsWith("/")) base = base.slice(0, -1);
  return base.endsWith("/chat/completions") ? base : base + "/chat/completions";
}

export interface KnowledgeQaResult {
  text: string;
  citations: Array<{ ref: string; title: string; source: string }>;
  /** true = 模型作答且通过数字守卫；false = 确定性回退（模型不可用或守卫拦截） */
  grounded: boolean;
  /** 回退原因：guard = 数字守卫拦截（可尝试扩大上下文重试）；unavailable = 服务不可用 */
  degradeReason?: "guard" | "unavailable";
}

const SYSTEM_PROMPT = [
  "你是真验的产品知识问答助手，只根据提供的知识摘录回答产品知识问题。",
  "规则：只能使用知识摘录中出现的事实，并在引用处标注【K编号】；",
  "不得引入摘录中不存在的数字、标准、结论或产品批次判断；",
  "摘录不足以回答时，明确说明当前知识库未覆盖该问题，并建议用户改用批次查询核实登记证据；",
  "不得替某个批次做验收判断；回答简洁，中文纯文本，不要 Markdown。",
  '只返回一个 JSON 对象：{"answer": string, "refs": number[]}，refs 是实际引用到的 K 编号。',
].join("");

export async function answerWithKnowledge(
  question: string,
  chunks: KnowledgeChunk[],
  options: KnowledgeQaOptions = {},
): Promise<KnowledgeQaResult> {
  if (chunks.length === 0) {
    return { text: "当前知识库没有登记任何知识块，无法回答。可提供批次号，我会检查系统是否登记了对应证据。", citations: [], grounded: false };
  }
  const apiKey = options.apiKey ?? process.env.AGENT_API_KEY;
  const model = options.model ?? process.env.AGENT_MODEL;
  const baseUrl = options.baseUrl ?? process.env.AGENT_BASE_URL ?? "https://api.stepfun.com/step_plan/v1";
  const fetchImpl = options.fetchImpl ?? fetch;
  if (!apiKey || !model) {
    return deterministicAnswer(chunks, "StepFun 未配置，以下为知识库登记摘录。");
  }

  let response: Awaited<ReturnType<typeof fetchImpl>>;
  try {
    response = await fetchImpl(completionsEndpoint(baseUrl), {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(45_000),
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: "问题：" + question + "\n\n知识附录：\n" + buildWikiAppendix(chunks) },
        ],
        response_format: { type: "json_object" },
      }),
    });
  } catch (error) {
    if (error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError")) {
      return deterministicAnswer(chunks, "知识检索服务超时，以下为知识库登记摘录。");
    }
    throw error;
  }
  if (!response.ok) {
    return deterministicAnswer(chunks, "知识检索服务暂不可用（HTTP " + response.status + "），以下为知识库登记摘录。");
  }

  const body = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> };
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== "string") {
    return deterministicAnswer(chunks, "知识检索服务未返回内容，以下为知识库登记摘录。");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return deterministicAnswer(chunks, "知识检索服务返回了无效内容，以下为知识库登记摘录。");
  }

  const answer = (parsed as { answer?: unknown }).answer;
  const rawRefs = (parsed as { refs?: unknown }).refs;
  if (typeof answer !== "string" || answer.trim() === "") {
    return deterministicAnswer(chunks, "知识检索服务未给出回答，以下为知识库登记摘录。");
  }

  const refs = Array.isArray(rawRefs)
    ? rawRefs.filter((ref): ref is number => typeof ref === "number" && Number.isInteger(ref) && ref >= 1 && ref <= chunks.length)
    : [];
  const citations = (refs.length > 0 ? refs : chunks.slice(0, 6).map((_, index) => index + 1)).map((ref) => ({
    ref: "K" + ref,
    title: chunks[ref - 1].title,
    source: chunks[ref - 1].sourceTable + "#" + chunks[ref - 1].sourceId,
  }));

  const violations = numericGuard(answer, [question, ...chunks.map((chunk) => chunk.chunkText)]);
  if (violations.length > 0) {
    console.warn("[knowledge-qa] 数字守卫拦截 " + violations.length + " 处编造数字：" + violations.map((v) => v.number).join("、"));
    return deterministicAnswer(chunks, "模型回答含知识库外的数字，已按摘录回退。", "guard");
  }
  return { text: answer.trim(), citations, grounded: true };
}

/** 确定性回退：按标题 + 来源列出知识摘录，供模型不可用或守卫拦截时使用。 */
export function deterministicAnswer(chunks: KnowledgeChunk[], reason: string, degradeReason: "guard" | "unavailable" = "unavailable"): KnowledgeQaResult {
  const picked = chunks.slice(0, 6);
  const lines = [
    reason,
    ...picked.map((chunk, index) => "【K" + (index + 1) + "】" + chunk.title + "（来源: " + chunk.sourceTable + "#" + chunk.sourceId + "）"),
  ];
  return {
    text: lines.join("\n"),
    citations: picked.map((chunk, index) => ({
      ref: "K" + (index + 1),
      title: chunk.title,
      source: chunk.sourceTable + "#" + chunk.sourceId,
    })),
    grounded: false,
    degradeReason,
  };
}
