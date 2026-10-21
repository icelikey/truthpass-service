export const CONSUMER_PROMPT_POLICY_VERSION = "truthpass.consumer.v2";
export const CONSUMER_MODEL_CONTRACT_VERSION = "truthpass.consumer.v2";

export type ConsumerValidationStatus = "accepted" | "fallback" | "rejected";

export type ConsumerSafetyChainContext = {
  anchorStatus?: string;
  transaction?: { txHash?: string; event?: string; explorerUrl?: string; blockNumber?: number; receiptStatus?: string };
};

export type ConsumerSafetyContract = {
  batchId?: string;
  dataMode: "demo/synthetic" | "external";
  evidenceIds: string[];
  allowedCitations: string[];
  allowedNumbers?: string[];
  chainContext?: ConsumerSafetyChainContext;
  locale?: "zh" | "en";
};

export type ConsumerModelOutput = {
  conclusion: string;
  evidence: string;
  uncertainty: string;
  nextAction: string;
  citations: string[];
};

export type ConsumerSafetyResult = {
  status: ConsumerValidationStatus;
  text?: string;
  output?: ConsumerModelOutput;
  citations: string[];
  reasons: string[];
};

const FOUR_SECTION = /(结论|Conclusion)\s*[：:][\s\S]+?(依据|Evidence|Basis)\s*[：:][\s\S]+?(不确定|Uncertainty|Unknowns?)\s*[：:][\s\S]+?(下一步|Next\s*(?:step|action))\s*[：:][\s\S]+/i;
const BATCH_ID = /\b[A-Z]{2,12}-\d{4}-\d{2,6}\b/g;
const NUMBER = /(?<![A-Za-z])\d+(?:\.\d+)?(?:\s*%|\s*(?:小时|天|mg|g|kg|℃|°C|BOT|元|CNY|USD))?/gi;
const UNSUPPORTED_SUCCESS = /(已购买|已支付|交易成功|已上链|receipt\s*(?:已|已经)?确认|已签名|已广播|已退款|已经完成操作|purchase\s*(?:is\s*)?complete|payment\s*(?:is\s*)?successful|transaction\s*(?:is\s*)?confirmed)/i;
const MODEL_ASSERTION = /(型号(?:是|为|：|:)|具体型号|model\s*(?:is|:)|(?:灯号|指示灯|灯光|绿灯|红灯|黄灯|设备灯)(?:是|为|表示|代表)|设备(?:状态|结果)?\s*(?:是|为|表示|代表|已(?:经)?正常|正常|异常))/i;
const NEGATION = /(没有|未有|未登记|未知|无法|不能|不清楚|不确定|尚未|暂无|不代表|不可|no\s+record|unknown|cannot|can't|not\s+available|not\s+provided)/i;
const DEMO_CLAIM = /(真实认证|官方认证|已证明安全|安全无疑|officially\s+certified|proven\s+safe)/i;

export function consumerSafetyFewShot(locale: "zh" | "en" = "zh"): string {
  if (locale === "en") {
    return [
      "Few-shot safety examples (follow the evidence boundary, do not copy facts):",
      "Q: What is the exact model when no model field is registered? A: Conclusion: The exact model is not registered. Evidence: The current batch record has no model field. Uncertainty: I will not guess from a product name or image. Next step: Ask the producer for the label or model record. Citations: [product_policy]",
      "Q: What does an unexplained device light mean? A: Conclusion: I cannot determine the light meaning. Evidence: No device event or manual is registered. Uncertainty: I will not infer a status from common device behavior. Next step: Provide the device model and event record. Citations: [product_policy]",
      "Q: Is the purchase confirmed when chain status is anchor_pending? A: Conclusion: The purchase is not confirmed. Evidence: The chain status is anchor_pending and there is no current receipt. Uncertainty: A historical replay is not a current purchase. Next step: Wait for a real receipt after wallet confirmation. Citations: [chain_status]",
      "Q: Can you pay for me? A: Conclusion: I can prepare the operation but cannot sign or pay. Evidence: A write requires an external wallet and receipt verification. Uncertainty: There is no successful receipt yet. Next step: Confirm the transaction in your wallet. Citations: [product_policy]",
    ].join("\n");
  }
  return [
    "Few-shot 安全示例（只学习拒答边界，不复制其中事实）：",
    "问：没有登记型号时，具体型号是什么？答：结论：当前资料没有登记具体型号。依据：当前批次记录没有型号字段。不确定：我不能根据名称或图片猜测型号。下一步：请提供包装标签或生产方型号记录。引用：[product_policy]",
    "问：没有设备事件时，灯号代表什么？答：结论：当前不能判断灯号含义。依据：没有登记设备事件或说明书。不确定：我不会根据常见经验解释灯号。下一步：请提供设备型号和原始事件记录。引用：[product_policy]",
    "问：链状态是 anchor_pending，购买成功了吗？答：结论：当前不能确认购买成功。依据：链状态为 anchor_pending，尚无本次真实 receipt。不确定：历史回放不等于当前购买。下一步：等待钱包确认后回读真实 receipt。引用：[chain_status]",
    "问：你能替我付款吗？答：结论：我可以准备操作，但不能替代钱包签名或付款。依据：写操作需要外部钱包和 receipt 核验。不确定：当前没有成功 receipt。下一步：请在钱包中确认交易。引用：[product_policy]",
  ].join("\n");
}

function cleanModelText(raw: string): string {
  return raw.trim().replace(/^```(?:json|text)?\s*/i, "").replace(/\s*```$/i, "").trim();
}

function normalizeSectionLabels(value: string): string {
  return value
    .replace(/\*+/g, "")
    .replace(/(结论|依据|不确定|下一步)\s*:/g, "$1：")
    .replace(/\bConclusion\s*:/gi, "结论：")
    .replace(/\b(Evidence|Basis)\s*:/gi, "依据：")
    .replace(/\b(Uncertainty|Unknowns?)\s*:/gi, "不确定：")
    .replace(/\b(Next\s*step|Next\s*action)\s*:/gi, "下一步：")
    .replace(/\s*\n+\s*/g, " ")
    .trim();
}

function maxJsonDepth(value: unknown, depth = 0): number {
  if (value === null || typeof value !== "object") return depth;
  if (Array.isArray(value)) return Math.max(depth, ...value.map((item) => maxJsonDepth(item, depth + 1)));
  return Math.max(depth, ...Object.values(value as Record<string, unknown>).map((item) => maxJsonDepth(item, depth + 1)));
}

function asModelOutput(raw: string): { output?: ConsumerModelOutput; text?: string; reason?: string } {
  const value = cleanModelText(raw);
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return { reason: "invalid_json_object" };
    const keys = Object.keys(parsed).sort();
    if (keys.length !== 5 || keys.join("|") !== ["citations", "conclusion", "evidence", "nextAction", "uncertainty"].join("|")) {
      return { reason: "unexpected_contract_fields" };
    }
    if (maxJsonDepth(parsed) > 3) return { reason: "nested_contract_too_deep" };
    const fields = ["conclusion", "evidence", "uncertainty", "nextAction"] as const;
    if (fields.every((field) => typeof parsed[field] === "string" && String(parsed[field]).trim())) {
      const citations = Array.isArray(parsed.citations) ? parsed.citations.filter((item): item is string => typeof item === "string" && item.trim().length > 0).map((item) => item.trim()) : [];
      if (citations.length > 12 || citations.some((item) => item.length > 200)) return { reason: "citations_too_large" };
      const output: ConsumerModelOutput = {
        conclusion: String(parsed.conclusion).trim(),
        evidence: String(parsed.evidence).trim(),
        uncertainty: String(parsed.uncertainty).trim(),
        nextAction: String(parsed.nextAction).trim(),
        citations,
      };
      return { output, text: `结论：${output.conclusion} 依据：${output.evidence} 不确定：${output.uncertainty} 下一步：${output.nextAction}` };
    }
  } catch {
    // Plain text is retained as a compatibility path, but still requires
    // explicit citations below.
  }
  const text = normalizeSectionLabels(value);
  if (!FOUR_SECTION.test(text)) return { reason: "missing_required_sections" };
  const citationMatch = value.match(/(?:引用|citations?)\s*[:：]\s*\[([^\]]+)\]/i);
  const citations = citationMatch ? citationMatch[1].split(",").map((item) => item.trim()).filter(Boolean) : [];
  return {
    output: { conclusion: text, evidence: "", uncertainty: "", nextAction: "", citations },
    text,
    reason: citations.length ? undefined : "missing_citations",
  };
}

function sentencePrefix(value: string, index: number): string {
  const prefix = value.slice(0, index);
  const match = prefix.match(/[^。！？;；\n]*$/);
  return match?.[0] ?? prefix;
}

function hasAffirmativeMatch(value: string, pattern: RegExp): boolean {
  for (const match of value.matchAll(new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`))) {
    if (!NEGATION.test(sentencePrefix(value, match.index ?? 0))) return true;
  }
  return false;
}

function numericTokens(value: string): string[] {
  const withoutIds = value.replace(BATCH_ID, "");
  return [...withoutIds.matchAll(NUMBER)].map((match) => match[0].replace(/\s+/g, "").toLowerCase());
}

function isModelEvidenceCitation(value: string): boolean {
  // A policy citation only explains the safety rule; it does not establish a
  // product/model/device fact. Require an explicitly scoped product/model
  // record or a batch evidence item instead.
  if (/^product[_:/-]?policy$/i.test(value)) return false;
  return /(?:^|[:/])(?:model|label|product|batch)(?:$|[:/_-])/i.test(value);
}

function hasVerifiedReceipt(chainContext?: ConsumerSafetyChainContext): boolean {
  return chainContext?.anchorStatus === "mainnet_receipt_verified"
    && Boolean(chainContext.transaction?.txHash);
}

export function validateConsumerModelOutput(raw: string, contract: ConsumerSafetyContract): ConsumerSafetyResult {
  const parsed = asModelOutput(raw);
  const reasons: string[] = [];
  const citations = parsed.output?.citations ?? [];
  const allowedCitations = new Set(contract.allowedCitations);
  const text = parsed.text ?? "";
  if (!parsed.text || !parsed.output) reasons.push(parsed.reason ?? "invalid_output");
  if (text.length > 2_000) reasons.push("output_too_long");
  if (!FOUR_SECTION.test(text)) reasons.push("missing_required_sections");
  if (!citations.length) reasons.push("missing_citations");
  if (citations.some((item) => !allowedCitations.has(item))) reasons.push("citation_not_allowlisted");
  if (contract.batchId && [...text.matchAll(BATCH_ID)].some((match) => match[0] !== contract.batchId)) reasons.push("cross_batch_reference");
  if (contract.dataMode === "demo/synthetic" && hasAffirmativeMatch(text, DEMO_CLAIM)) reasons.push("unsupported_demo_claim");
  if (hasAffirmativeMatch(text, MODEL_ASSERTION) && !citations.some(isModelEvidenceCitation)) reasons.push("unsupported_model_or_device_claim");
  if (hasAffirmativeMatch(text, UNSUPPORTED_SUCCESS) && !hasVerifiedReceipt(contract.chainContext)) reasons.push("unsupported_action_result");
  const allowedNumbers = new Set((contract.allowedNumbers ?? []).map((item) => item.replace(/\s+/g, "").toLowerCase()));
  if (numericTokens(text).some((item) => !allowedNumbers.has(item))) reasons.push("unsupported_numeric_claim");
  if (reasons.length) return { status: "rejected", citations, reasons: [...new Set(reasons)] };
  return { status: "accepted", text, output: parsed.output, citations, reasons: [] };
}
