// L1 确定性映射 + L3 表达层。
// L1: 验收检查项 → 概念标签 → 知识块，纯静态映射，主流程的拒因解释零 NLU、零检索；
// L3: 解释由确定性模板生成（自带 K 编号引用）。TypeSafe 实测为结构化问答 API
//     （noul/choice/score，不产出自由文本），故不用于措辞；numericGuard 保留为
//     未来接入任何自由文本 LLM 时的强制闸门：解释文本中的每个数字都必须能在
//     验收事实或所引知识块中找到，否则回退模板。
import type { ExecutionEvidence } from "../types.js";
import type { KnowledgeChunk } from "./wiki.js";

/** 验收检查项 → 知识概念标签（与 src/verifier.ts 的 checks 命名一一对应）。 */
export const CHECK_CONCEPT_MAP: Record<string, string[]> = {
  epaDhaWithinLimit: ["potency"],
  peroxideWithinLimit: ["oxidation"],
  totoxWithinLimit: ["oxidation"],
  coldChainWithinLimit: ["cold_chain"],
  logisticsWithinLimit: ["cold_chain"],
  batchMatches: ["regulation"],
  reportAfterProduction: ["regulation"],
  signatureValid: ["policy"],
  taskMatches: ["policy"],
};

export type EvidenceMetrics = Pick<ExecutionEvidence,
  "epaDhaPercent" | "peroxideValue" | "totox" | "coldChainGapHours" | "reportBatchId" | "signatureValid">;

export interface RejectionInput {
  checks: Record<string, boolean>;
  reasons: string[];
  evidence?: EvidenceMetrics;
}

export interface Explanation {
  /** deterministic = 纯模板；typesafe-guarded = LLM 润色且通过数字守卫 */
  mode: "deterministic" | "typesafe-guarded";
  text: string;
  citations: Array<{ ref: string; title: string; source: string }>;
}

function failedChecks(checks: Record<string, boolean>): string[] {
  return Object.keys(checks).filter((key) => checks[key] === false);
}

function collectCitations(failed: string[], chunks: KnowledgeChunk[]): KnowledgeChunk[] {
  // 全部通过时引用政策对照块；有未通过项时按检查项映射的概念标签取证
  const concepts = new Set(failed.length > 0
    ? failed.flatMap((check) => CHECK_CONCEPT_MAP[check] ?? [])
    : ["policy"]);
  return chunks.filter((chunk) => chunk.concepts.some((tag) => concepts.has(tag))).slice(0, 6);
}

function metricsLine(evidence: EvidenceMetrics | undefined): string | undefined {
  if (!evidence) return undefined;
  const parts: string[] = [];
  if (evidence.epaDhaPercent !== undefined) parts.push("EPA+DHA 实测 " + evidence.epaDhaPercent + "%");
  if (evidence.peroxideValue !== undefined) parts.push("过氧化值 " + evidence.peroxideValue);
  if (evidence.totox !== undefined) parts.push("TOTOX " + evidence.totox);
  if (evidence.coldChainGapHours !== undefined) parts.push("冷链中断 " + evidence.coldChainGapHours + "h");
  if (evidence.reportBatchId !== undefined) parts.push("报告批次 " + evidence.reportBatchId);
  return parts.length > 0 ? "服务返回实测值：" + parts.join("；") + "。" : undefined;
}

function renderDeterministic(input: RejectionInput, cited: KnowledgeChunk[]): string {
  const passed = failedChecks(input.checks).length === 0;
  const lines: string[] = [];
  if (passed) {
    lines.push("该批次全部确定性验收项通过（判定由代码执行，与本解释所引依据一致）。");
  } else {
    lines.push("该批次未通过确定性验收，事实与依据如下：");
    input.reasons.forEach((reason, index) => lines.push((index + 1) + ". " + reason));
    const metrics = metricsLine(input.evidence);
    if (metrics) lines.push(metrics);
  }
  if (cited.length > 0) {
    lines.push("验收依据（公共知识库，可回源核对）：");
    cited.forEach((chunk, index) => lines.push("【K" + (index + 1) + "】" + chunk.title + "（" + chunk.sourceTable + "#" + chunk.sourceId + "）"));
  }
  return lines.join("\n");
}

const NUMBER_PATTERN = /\d+(?:\.\d+)?/g;
const CITATION_MARKER = /【K\d+】/g;
const SOURCE_REF = /[A-Za-z_-]+#\d+(?:,\d+)*/g;
const LIST_MARKER = /^[ \t]*\d+[.、)）:：]\s*/gm;

/** 数字守卫：返回解释文本中不在允许集合内的数字及其上下文（空数组 = 通过）。
 *  剔除三类非数据数字：引用标记【K编号】、来源指针 standard_limits#4、行首列表编号。 */
export function numericGuard(text: string, allowedSources: string[]): Array<{ number: string; context: string }> {
  const allowed = new Set(allowedSources.flatMap((source) => source.match(NUMBER_PATTERN) ?? []));
  const cleaned = text.replace(CITATION_MARKER, "").replace(SOURCE_REF, "").replace(LIST_MARKER, "");
  const seen = new Set<string>();
  const violations: Array<{ number: string; context: string }> = [];
  for (const match of cleaned.matchAll(NUMBER_PATTERN)) {
    if (allowed.has(match[0]) || seen.has(match[0])) continue;
    seen.add(match[0]);
    const at = match.index ?? 0;
    const context = cleaned.slice(Math.max(0, at - 15), at + 18).replace(/\s+/g, " ");
    violations.push({ number: match[0], context });
  }
  return violations;
}

function citationsOf(cited: KnowledgeChunk[]): Explanation["citations"] {
  return cited.map((chunk, index) => ({ ref: "K" + (index + 1), title: chunk.title, source: chunk.sourceTable + "#" + chunk.sourceId }));
}

export async function explainRejection(input: RejectionInput, chunks: KnowledgeChunk[]): Promise<Explanation> {
  const failed = failedChecks(input.checks);
  const cited = collectCitations(failed, chunks);
  const citations = citationsOf(cited);
  const text = renderDeterministic(input, cited);
  return { mode: "deterministic", text, citations };
}
