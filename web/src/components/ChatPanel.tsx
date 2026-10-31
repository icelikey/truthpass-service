import { useEffect, useRef, useState, type FormEvent } from "react";
import { useChatStream, type ChatMessage } from "../hooks/useChatStream";
import { createOrder, fetchPurchaseQuote, fetchRecommend, postIotSimulation, type IotSimulationMode } from "../api";
import { saveOrderRecord } from "../lib/supabase";
import { useWallet } from "./WalletContext";
import { shortHex } from "../lib/wallet";
import type { AgentStreamStage, ChatEvent, ChatLine, OrderCard, RecommendItem } from "../types";

const FISH_OIL_BATCHES = [
  { id: "FO-2026-001", name: "深海鱼油软胶囊" },
  { id: "FO-2026-002", name: "高纯度 Omega-3 鱼油" },
  { id: "FO-2026-003", name: "儿童 DHA 鱼油滴剂" },
  { id: "FO-2026-004", name: "三文鱼油胶囊" },
  { id: "FO-2026-005", name: "南极磷虾油" },
  { id: "FO-2026-006", name: "高浓度 Omega-3 软胶囊" },
  { id: "FO-2026-007", name: "深海鳕鱼肝油" },
  { id: "FO-2026-008", name: "孕妇 DHA 鱼油" },
  { id: "FO-2026-009", name: "鱼油凝胶软糖" },
  { id: "FO-2026-010", name: "高纯度磷虾油胶囊" },
];

const QUICK_PROMPTS = [
  { label: "这批是什么？", q: "这批是什么？" },
  { label: "检测结果怎么看？", q: "检测结果怎么看？" },
  { label: "运输有没有问题？", q: "运输有没有问题？" },
  { label: "还缺什么资料？", q: "还缺什么资料？" },
  { label: "现在能不能继续了解？", q: "现在能不能继续了解？" },
  { label: "链上有没有记录？", q: "查看这批商品的链上状态" },
];
const EN_QUICK_PROMPTS = [
  { label: "What is this batch?", q: "What is this batch?" },
  { label: "How do I read the test results?", q: "How do I read the test results?" },
  { label: "Any delivery issues?", q: "Are there any delivery issues?" },
  { label: "What evidence is missing?", q: "What evidence is still missing?" },
  { label: "Can I continue?", q: "Can I continue learning about this batch?" },
  { label: "Is there a chain record?", q: "Check the chain status for this batch" },
];
const RICE_BATCHES = [
  { id: "RC-2026-001", name: "北境稻作 · 五常米" },
  { id: "RC-2026-002", name: "北境稻作 · 复核批次" },
  { id: "RC-2026-003", name: "北境稻作 · 已通过范围批次" },
];

type AgentSection = { label: "结论" | "依据" | "不确定" | "下一步"; text: string };

function parseAgentSections(lines: ChatLine[], locale: "zh" | "en" = "zh"): AgentSection[] {
  const content = lines.map((line) => line.text.trim()).filter(Boolean).join(" ");
  if (!content) return [];
  const matches = [...content.matchAll(locale === "en" ? /(Conclusion|Evidence|Uncertainty|Uncertain|Next step)\s*:\s*/gi : /(结论|依据|不确定|下一步)\s*[:：]/g)];
  const canonical = (label: string): AgentSection["label"] => {
    if (locale === "en") {
      if (/^conclusion$/i.test(label)) return "结论";
      if (/^evidence$/i.test(label)) return "依据";
      if (/^uncertain(?:ty)?$/i.test(label)) return "不确定";
      return "下一步";
    }
    return label as AgentSection["label"];
  };
  if (matches.length >= 2) {
    return matches.map((match, index) => ({
      label: canonical(match[1]),
      text: content.slice(match.index! + match[0].length, matches[index + 1]?.index ?? content.length).trim(),
    })).filter((section) => section.text.length > 0);
  }
  return lines.map((line): AgentSection => {
    const label: AgentSection["label"] = line.cls === "conclusion" || line.cls === "lead"
      ? "结论"
      : line.cls === "disclaimer"
        ? "不确定"
        : line.cls === "cmd"
          ? "下一步"
          : "依据";
    return { label, text: line.text.trim() };
  }).filter((section) => section.text.length > 0);
}

function extractBatchId(text: string): string | null {
  const full = text.match(/([A-Z]{2,3}-\d{4}-\d{3})/i);
  if (full) return full[1].toUpperCase();
  const short = text.match(/\b0*(\d{1,2})\b/);
  if (short) {
    const n = parseInt(short[1], 10);
    if (n >= 1 && n <= 10) return `FO-2026-${String(n).padStart(3, "0")}`;
  }
  return null;
}

function LineView({ line }: { line: ChatLine }) {
  switch (line.cls) {
    case "lead":
      return <div className="conclusion lead">{line.text}</div>;
    case "conclusion":
      return <div className="conclusion">{line.text}</div>;
    case "disclaimer":
      return <div className="disclaimer">{line.text}</div>;
    case "cmd":
      return <div className="reason-line cmd">{line.text}</div>;
    default:
      return <div className="reason-line">{line.text}</div>;
  }
}

function serviceStatusMeta(status?: string): { pill: string; cls: string; sse: string } | null {
  switch (status) {
    case "model_assisted":
      return { pill: "智能回答", cls: "verified", sse: "loading" };
    case "deterministic_fallback":
      return { pill: "基础回答", cls: "fallback", sse: "fallback" };
    case "provider_unavailable":
      return { pill: "暂时无法连接", cls: "unavailable", sse: "unavailable" };
    case "rate_limited":
      return { pill: "请求较多", cls: "rate-limited", sse: "rate-limited" };
    case "maintenance":
      return { pill: "maintenance", cls: "unavailable", sse: "unavailable" };
    default:
      return null;
  }
}

function providerIssueLabel(issue: string | undefined, en: boolean): string | null {
  switch (issue) {
    case "billing_required":
      return en
        ? "The model account needs billing or available credits. The evidence fallback is still working."
        : "OpenCode 请求已发送，返回 HTTP 402（额度不足）；当前使用当前批次登记资料回退，未经校验的模型原文未展示。";
    case "unauthorized":
      return en
        ? "The model credential was rejected. The evidence fallback is still working."
        : "模型凭据未被接受；当前已安全回退到批次资料回答。";
    case "rate_limited":
      return en
        ? "The model provider rate limited this request. The evidence fallback is still working."
        : "模型服务限制了本次请求；当前已安全回退到批次资料回答。";
    case "invalid_response":
      return en
        ? "The model response failed the safety contract and was not shown."
        : "模型回答没有通过安全契约，原文未展示。";
    case "unavailable":
      return en
        ? "The model provider is unavailable. The evidence fallback is still working."
        : "模型服务暂不可用；当前已安全回退到批次资料回答。";
    default:
      return null;
  }
}

const STREAM_STAGE_LABELS: Record<AgentStreamStage, string> = {
  begin: "开始",
  reading_batch: "读取批次",
  retrieval_completed: "检索完成",
  verifier_checked: "规则核验",
  jev_routed: "JEV 分流",
  model_started: "模型解释",
  model_completed: "解释完成",
  answer: "组织回答",
  done: "完成",
};

function streamStageMeta(message: ChatMessage): { current?: AgentStreamStage; history: AgentStreamStage[] } {
  const raw = message.meta as (ChatMessage["meta"] & { stage?: AgentStreamStage; stages?: AgentStreamStage[] }) | undefined;
  const history = Array.isArray(raw?.stages) ? raw.stages : raw?.stage ? [raw.stage] : [];
  return { current: raw?.stage, history };
}

function stageStatusLabel(status: string | undefined, en: boolean): string {
  if (en) return status === "active" ? "working" : status === "fallback" ? "fallback" : status === "unavailable" ? "unavailable" : "done";
  return status === "active" ? "处理中" : status === "fallback" ? "回退" : status === "unavailable" ? "不可用" : "已完成";
}

function answerValidationMeta(message: ChatMessage): {
  validationStatus?: string;
  validationReasons: string[];
  citationStatus?: string;
  citationReasons: string[];
} {
  const raw = message.meta as (ChatMessage["meta"] & {
    validationStatus?: string;
    validationReasons?: string[];
    validation?: { status?: string; reasons?: string[] };
    citationStatus?: string;
    citationReasons?: string[];
    citationValidation?: { status?: string; valid?: boolean; reasons?: string[] };
  }) | undefined;
  return {
    validationStatus: raw?.validationStatus ?? raw?.validation?.status,
    validationReasons: raw?.validationReasons ?? raw?.validation?.reasons ?? [],
    citationStatus: raw?.citationStatus ?? (raw?.citationValidation?.valid === true ? "passed" : raw?.citationValidation?.status),
    citationReasons: raw?.citationReasons ?? raw?.citationValidation?.reasons ?? [],
  };
}

function RecommendationEvidence({ item, en }: { item: RecommendItem; en: boolean }) {
  const evidenceRefs = item.evidence?.evidenceRefs ?? [];
  const verification = item.verification?.status ?? item.evidence?.verificationStatus ?? "待核验";
  const coldGap = item.coldChain?.gapHours ?? item.evidence?.metrics?.coldChainGapHours ?? item.coldGap;
  const coldStatus = item.coldChain?.status ?? (coldGap > 0 ? "有记录" : "未见中断");
  const gaps = item.gaps ?? [];
  const feedback = item.feedbackSample;
  const recommendationStatus = item.recommendationStatus ?? "review_before_recommendation";
  const recommendationLabel = recommendationStatus === "recommend_with_scope" ? (en ? "Recommend with scope" : "在范围内，可继续评估") : recommendationStatus === "do_not_recommend" ? (en ? "Do not recommend" : "暂不推荐") : (en ? "Review before recommendation" : "先复核再决定");
  const parameterSummary = (item.parameterDetails ?? []).slice(0, 4).map((detail) => `${detail.label} ${detail.observed === undefined ? (en ? "not registered" : "未登记") : `${detail.observed}${detail.unit}`} · ${detail.rule}`).join(en ? "; " : "；");
  return (
    <div className="recommend-evidence-grid" aria-label={en ? "Recommendation evidence" : "推荐依据详情"}>
      <span><b>{en ? "Evidence" : "证据"}</b>{evidenceRefs.length ? evidenceRefs.join(" · ") : (en ? "Registered batch records" : "当前批次登记资料")}</span>
      <span><b>{en ? "Verification" : "核验"}</b>{verification}{item.verification?.score !== undefined ? ` · ${item.verification.score} 分` : ""}</span>
      <span><b>{en ? "Recommendation" : "推荐状态"}</b>{recommendationLabel}</span>
      {parameterSummary && <span><b>{en ? "Parameters" : "参数"}</b>{parameterSummary}</span>}
      <span><b>{en ? "Cold chain" : "冷链"}</b>{coldStatus} · {coldGap}h gap</span>
      <span><b>{en ? "Feedback sample" : "反馈样本"}</b>{feedback?.summary ?? (feedback?.count ? `${feedback.count} 条` : (en ? "No sample" : "暂无样本"))}</span>
      <span><b>{en ? "Gaps" : "缺口"}</b>{gaps.length ? gaps.join(en ? "; " : "；") : (en ? "None listed" : "当前未列出")}</span>
      <span><b>{en ? "Next" : "下一步"}</b>{item.nextAction ?? item.nextStep ?? (en ? "Open the evidence card before checkout" : "购买前打开证据卡核对来源")}</span>
      <span className="recommend-data-mode"><b>dataMode</b>{item.dataMode ?? item.evidence?.dataMode ?? "demo/synthetic"}</span>
    </div>
  );
}

function MessageView({
  message,
  onOrder,
  onAnchorOrder,
  onHandoff,
  txBusy,
  walletReady,
  locale = "zh",
  minimal = false,
}: {
  message: ChatMessage;
  onOrder: (item: RecommendItem) => void;
  onAnchorOrder: (order: OrderCard) => void;
  onHandoff: () => void;
  txBusy: boolean;
  walletReady: boolean;
  locale?: "zh" | "en";
  minimal?: boolean;
}) {
  if (message.role === "user") {
    return (
      <div className="msg user">
        <div className="msg-bubble">{message.lines.map((l) => l.text).join("")}</div>
      </div>
    );
  }

  const agentMode = message.meta?.agentMode;
  const en = locale === "en";
  const serviceStatus = message.meta?.serviceStatus ?? agentMode;
  const dataMode = message.meta?.dataMode ?? "demo/synthetic";
  const statusMeta = serviceStatusMeta(serviceStatus);
  const agentLabel = en
    ? (agentMode === "model_assisted" ? "Model-assisted" : agentMode === "deterministic_fallback" ? "Evidence fallback" : "Product Agent")
    : (agentMode === "model_assisted" ? "模型参与解释" : agentMode === "deterministic_fallback" ? "依据回答" : "商品助手");
  const isLoading = !message.done && message.lines.length === 0;
  const showHandoff = !minimal && (
    serviceStatus === "provider_unavailable" ||
    serviceStatus === "rate_limited" ||
    serviceStatus === "deterministic_fallback" ||
    Boolean(message.error)
  );
  const structuredSections = message.done ? parseAgentSections(message.lines, locale) : [];
  const stream = streamStageMeta(message);
  const answerValidation = answerValidationMeta(message);
  const validationPassed = /^(passed|pass|valid|checked|accepted)$/i.test(answerValidation.validationStatus ?? "");
  const citationPassed = /^(passed|pass|valid|checked|accepted)$/i.test(answerValidation.citationStatus ?? "");
  const hasValidationMeta = Boolean(answerValidation.validationStatus || answerValidation.citationStatus || answerValidation.validationReasons.length || answerValidation.citationReasons.length);
  const deterministicFallback = (serviceStatus === "deterministic_fallback" || message.meta?.fallbackApplied === true) && message.done && !message.error;

  return (
    <div className="msg agent">
      {!minimal && <div className="chat-meta" aria-label={en ? "Answer metadata" : "回答元信息"}>
        <span className={`status-pill ${agentMode === "model_assisted" ? "verified" : "fallback"}`}>
          {agentLabel}
        </span>
        <span className={`mode-badge ${dataMode === "external" ? "external" : ""}`}>{dataMode === "external" ? (en ? "External data" : "真实资料") : (en ? "Demo data" : "演示资料")}</span>
        {statusMeta && serviceStatus !== agentMode && (
          <span className={`status-pill ${statusMeta.cls}`}>{statusMeta.pill}</span>
        )}
        {message.meta?.batchId && (
          <span className="batch-id-chip"><code>{message.meta.batchId}</code></span>
        )}
        {message.meta?.contextRevision !== undefined && (
          <span className="batch-id-chip">{en ? "Context" : "资料更新"} v{message.meta.contextRevision}</span>
        )}
        {message.meta?.chainContext && (
          <span className={`batch-id-chip chain-chat-chip ${message.meta.chainContext.rpcReachable ? "live" : "offline"}`}>
            {message.meta.chainContext.rpcReachable ? (en ? "Chain online" : "链在线") : (en ? "Chain unavailable" : "链暂不可读")} · {message.meta.chainContext.anchorStatus}
          </span>
        )}
      </div>}
      {!minimal && (message.meta?.model || message.meta?.provider || message.meta?.pipeline?.length) && (
        <details className="agent-trace-details">
          <summary>{en ? "Answer basis" : "回答依据"} · {message.meta.modelAssisted ? `${message.meta.provider ?? (en ? "Model" : "模型")} ${en ? "helped explain" : "已参与解释"}` : (en ? "Current-record fallback" : "当前批次资料回退")} </summary>
          <div className="agent-trace-grid">
            <span><b>{en ? "Model" : "模型"}</b>{message.meta.modelAssisted ? `${message.meta.provider ?? (en ? "Compatible API" : "兼容接口")} · ${message.meta.model ?? (en ? "configured model" : "已配置模型")}` : "deterministic fallback"}</span>
            <span><b>{en ? "Runtime" : "运行结果"}</b>{message.meta.runtimeStatus ?? (message.meta.modelAssisted ? "completed" : "fallback")}{message.meta.providerResponseStatus ? ` · HTTP ${message.meta.providerResponseStatus}` : ""}{message.meta.providerIssue ? ` · ${message.meta.providerIssue}` : ""}</span>
            <span><b>{en ? "Pipeline" : "流程"}</b>{(message.meta.pipeline ?? []).map((stage) => stage === "verifier" ? (en ? "Rule checks" : "规则核验") : stage === "jev" ? "JEV" + (en ? " routing" : " 分流") : stage === "deepseek" ? (en ? `${message.meta?.provider ?? "Model"} explanation` : `${message.meta?.provider ?? "模型"} 解释`) : stage).join(" → ")}</span>
            {message.meta.pipelineDetail && <span><b>{en ? "Result" : "结果"}</b>Verifier: {message.meta.pipelineDetail.verifier.status} · JEV: {message.meta.pipelineDetail.jev.decision} · Model: {message.meta.pipelineDetail.deepseek.status}</span>}
            <span><b>{en ? "Citations" : "引用"}</b>{message.meta.evidenceIds?.length ? message.meta.evidenceIds.join(" · ") : (en ? "No additional evidence IDs" : "当前回答没有额外证据 ID")}</span>
            {message.meta.retrieval && <span><b>{en ? "Retrieval" : "检索"}</b>{message.meta.retrieval.hitCount ?? message.meta.retrieval.hits?.length ?? 0} {en ? "hits" : "条"} · {(message.meta.retrieval.hitIds ?? message.meta.retrieval.hits?.map((hit) => hit.hitId).filter((id): id is string => Boolean(id)) ?? []).join(" · ")}</span>}
            <span><b>Trace ID</b><code>{message.meta.traceId ?? "—"}</code></span>
          </div>
        </details>
      )}

      {isLoading && (
        <div className="chat-sse-state loading" role="status">{en ? "Generating an answer…" : "正在生成回答…"}</div>
      )}
      {!message.done && message.lines.length > 0 && (
        <div className="chat-sse-state loading" role="status">{en ? "Streaming…" : "流式输出中…"}</div>
      )}
      {!minimal && stream.history.length > 0 && (
        <details className={`chat-stage-details${message.done ? " is-complete" : ""}`} open>
          <summary>{en ? "Live data flow" : "数据流过程"} · {message.done ? (en ? "completed" : "已完成") : (en ? "running" : "运行中")}</summary>
          <div className="chat-stage-rail" role="status" aria-live="polite">
            {stream.history.map((stage, index) => {
              const rawMeta = message.meta as (ChatMessage["meta"] & { stageStatuses?: Record<string, string>; stageDetails?: Record<string, string> }) | undefined;
              const status = rawMeta?.stageStatuses?.[stage];
              const detail = rawMeta?.stageDetails?.[stage];
              return (
                <span key={`${stage}-${index}`} className={stage === stream.current && !message.done ? "active" : status === "fallback" || status === "unavailable" ? "fallback" : "completed"}>
                  <i>{status === "completed" && message.done ? "✓" : index + 1}</i>
                  <b>{en ? stage.replaceAll("_", " ") : STREAM_STAGE_LABELS[stage]}</b>
                  <small>{stageStatusLabel(status, en)}{detail ? ` · ${detail}` : ""}</small>
                </span>
              );
            })}
          </div>
        </details>
      )}
      {!minimal && message.done && hasValidationMeta && (
        <div className={`answer-validation-summary ${deterministicFallback || (validationPassed && citationPassed) ? "passed" : "review"}`} role="status">
          <strong>{deterministicFallback ? (en ? "Safely fell back to an evidence answer" : "已安全回退到基础回答") : validationPassed && citationPassed ? (en ? "Answer passed format and citation checks" : "回答通过格式与引用校验") : (en ? "Answer needs review" : "回答需要复核")}</strong>
          <span>{deterministicFallback ? (en ? "Unvalidated model text was not published" : "未发布未经校验的模型原文") : validationPassed ? (en ? "Format check passed" : "格式校验通过") : `${en ? "Format check: " : "格式校验："}${answerValidation.validationStatus ?? (en ? "not provided" : "未提供")}`}</span>
          <span>{deterministicFallback ? (en ? "Content comes from the current registered records" : "内容来自当前批次登记资料") : citationPassed ? (en ? "Citation check passed" : "引用校验通过") : `${en ? "Citation check: " : "引用校验："}${answerValidation.citationStatus ?? (en ? "not provided" : "未提供")}`}</span>
          {(answerValidation.validationReasons.length > 0 || answerValidation.citationReasons.length > 0) && (
            <small>{[...answerValidation.validationReasons, ...answerValidation.citationReasons].join(en ? "; " : "；")}</small>
          )}
        </div>
      )}
      {!minimal && message.done && statusMeta?.sse === "fallback" && (
        <div className="chat-sse-state fallback" role="status">{en ? "Using an evidence fallback. The content still comes from registered records." : "当前使用基础回答，内容仍来自已登记资料。"}</div>
      )}
      {!minimal && message.done && statusMeta?.sse === "unavailable" && (
        <div className="chat-sse-state unavailable" role="status">{en ? "The model service is unavailable. Try again or request human support." : "模型服务暂不可用，请稍后重试或转人工。"}</div>
      )}
      {!minimal && message.done && statusMeta?.sse === "rate-limited" && (
        <div className="chat-sse-state rate-limited" role="status">{en ? "Too many requests (rate limited). Please try again shortly." : "请求过于频繁（rate limited），请稍后再问。"}</div>
      )}
      {!minimal && message.done && message.meta?.providerIssue && (
        <div className="chat-sse-state provider-diagnostic" role="status">
          {providerIssueLabel(message.meta.providerIssue, en)}
        </div>
      )}

      {!minimal && message.done && message.meta?.modelAssisted && (
        <div className="chat-provider-run success" role="status">
          {en ? `${message.meta.provider ?? "Model"} completed the explanation` : `${message.meta.provider ?? "模型"} 已完成解释`} · {en ? "model-assisted" : "模型参与"} · {en ? "validation" : "校验"}: {message.meta.validationStatus ?? "accepted"}
        </div>
      )}
      {!minimal && message.done && message.meta?.providerIssue === "billing_required" && (
        <div className="chat-provider-run billing" role="status">
          {en ? `${message.meta.provider ?? "Model provider"} request sent · HTTP 402 billing required · safe evidence fallback applied; unvalidated model text was not shown.` : `${message.meta.provider ?? "模型服务"} 请求已发送 · HTTP 402 额度或计费未满足 · 已安全回退到当前批次资料，未经校验的模型原文未展示。`}
        </div>
      )}
      <div className="msg-bubble">
        {structuredSections.length > 0 ? (
          <div className="agent-structured-answer" aria-label={en ? "Agent answer structure" : "Agent 回答结构"}>
            {structuredSections.map((section, index) => (
              <section key={`${section.label}-${index}`} className={`agent-answer-section agent-answer-${section.label}`}>
                <strong>{en ? ({ "结论": "Conclusion", "依据": "Evidence", "不确定": "Uncertain", "下一步": "Next step" }[section.label]) : section.label}</strong>
                <p>{section.text}</p>
              </section>
            ))}
          </div>
        ) : message.lines.map((line, i) => (
          <LineView key={i} line={line} />
        ))}
        {!message.done && message.lines.length === 0 && (
          <div className="thinking">{en ? "TruthPass is organizing the evidence and sources…" : "TruthPass 正在整理证据与来源…"}</div>
        )}
        {message.recommendations && (
          <div className="recommend-list">
            {message.recommendations.map((item, index) => (
              <div className="recommend-card" key={item.batchId}>
                {item.imageUrl && <img src={item.imageUrl} alt="" />}
                <div className="recommend-info">
                  <b>{index + 1}. {item.name}</b>
                  <span>{item.batchId} · {item.origin} · {item.productionDate}</span>
                  <p>{item.reason}</p>
                  {item.expertise && <p className="recommend-expertise">{en ? "Expert note: " : "专业提示："}{item.expertise}</p>}
                  <RecommendationEvidence item={item} en={en} />
                </div>
                {item.recommendationStatus !== "recommend_with_scope" ? (
                  <span className="recommend-order" aria-label={en ? `Batch ${item.batchId} requires review` : `批次 ${item.batchId} 需要先复核`}>
                    {item.recommendationStatus === "do_not_recommend" ? (en ? "Do not recommend" : "暂不推荐") : (en ? "Review first" : "先复核")}
                  </span>
                ) : (
                  <button type="button" className="recommend-order" aria-label={en ? `Prepare checkout for ${item.batchId}` : `为 ${item.batchId} 生成购买准备`} onClick={() => onOrder(item)}>
                    {en ? "Prepare checkout" : "购买准备"}
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
        {message.order && (
          <div className="order-card">
            {message.order.imageUrl && <img src={message.order.imageUrl} alt="" />}
            <div className="order-info">
              <b>{message.order.status === "prepared_pending_checkout" ? (en ? "Checkout prepared (pending settlement)" : "购买准备已生成（待结算）") : (en ? "Purchase record" : "购买记录")} · {message.order.orderId}</b>
              <span>{message.order.productName} · {message.order.batchId} · {en ? "Quantity " : "数量 "}{message.order.quantity}</span>
              <div className="order-flow-steps" aria-label={en ? "Purchase progress" : "购买进度"}>
                <span className="active">1 {en ? "Prepare" : "购买准备"}</span>
                <span className={message.order.txHash ? "active" : "current"}>2 {en ? "Merchant" : "商家确认"}</span>
                <span className={message.order.txHash ? "active" : ""}>3 {en ? "Wallet" : "钱包确认"}</span>
              </div>
              <span className="order-status">
                {en ? "Status: " : "状态："}{message.order.txHash ? (en ? "Real receipt verified" : "真实 receipt 已确认") : message.order.purchaseQuote?.chainPayment?.enabled ? (en ? `Quote ready: ${message.order.purchaseQuote.chainPayment.amountBot ?? "0.001"} BOT, waiting for wallet signature` : `报价已准备：${message.order.purchaseQuote.chainPayment.amountBot ?? "0.001"} BOT，等待钱包签名`) : (en ? "Checkout prepared; payment method not confirmed" : "购买准备中，等待支付方式确认")}
              </span>
              {!message.order.txHash && message.order.purchaseQuote && (
                <div className="order-quote-summary" role="status">
                  <span>{en ? "Payment status: " : "支付状态："}{message.order.purchaseQuote.chainPayment?.enabled ? (en ? "BOT Chain 677 available" : "BOT Chain 677 可用") : (en ? "On-chain payment is not configured" : "链上支付未配置")}</span>
                  <small>{message.order.purchaseQuote.chainPayment?.enabled ? (en ? `Amount ${message.order.purchaseQuote.chainPayment.amountBot ?? "0.001"} BOT · broadcast only after external wallet confirmation` : `金额 ${message.order.purchaseQuote.chainPayment.amountBot ?? "0.001"} BOT · 外部钱包确认后才会广播`) : (en ? "Only a checkout preparation record is available; success is not shown." : "当前只能生成购买准备单，不会显示购买成功。")}</small>
                </div>
              )}
              {message.order.txHash ? (
                <a
                  href={message.order.explorerUrl ?? `https://scan.botchain.ai/tx/${message.order.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="order-chain-link"
                  aria-label={en ? `Verify transaction ${shortHex(message.order.txHash, 10, 6)} in block explorer` : `在区块浏览器核验交易 ${shortHex(message.order.txHash, 10, 6)}`}
                >
                  {en ? "BOT Chain transaction " : "BOT Chain 交易 "}{shortHex(message.order.txHash, 10, 6)} · {en ? "Verify" : "核验"} ↗
                </a>
              ) : (
                <>
                  <button
                    type="button"
                    className="order-anchor-btn"
                    aria-label={en ? "Use wallet signature to record the purchase credential" : "使用钱包签名上链存证购买凭证"}
                    disabled={!walletReady || txBusy}
                    onClick={() => onAnchorOrder(message.order!)}
                  >
                    {txBusy ? (en ? "Waiting for wallet confirmation…" : "正在等待钱包确认…") : (en ? "Confirm wallet action" : "确认钱包操作")}
                  </button>
                  {!walletReady && <small className="order-wallet-hint">{en ? "Connect your own wallet before confirming the purchase record." : "连接自己的钱包后，才可以确认购买记录。"}</small>}
                </>
              )}
            </div>
          </div>
        )}
        {message.meta?.sources && message.meta.sources.length > 0 && (
          <div className="chat-sources">
            <b>{en ? "Sources" : "来源"}</b> · {message.meta.sources.join(" · ")}
          </div>
        )}
        {message.meta?.chainContext && (
          <div className="chat-chain-context">
            <span>Chain {message.meta.chainContext.chainId} · {message.meta.chainContext.chainName}</span>
            <span>{message.meta.chainContext.latestBlockNumber ? `最新区块 #${message.meta.chainContext.latestBlockNumber}` : "最新区块未读取"}</span>
            {message.meta.chainContext.transaction ? <a href={message.meta.chainContext.transaction.explorerUrl} target="_blank" rel="noreferrer">{en ? "View receipt" : "查看 receipt"} ↗</a> : <span>{en ? "No receipt for this session" : "当前没有本次会话 receipt"}</span>}
          </div>
        )}
        {showHandoff && (
          <div className="chat-handoff">
            <button type="button" aria-label={en ? "Request human support" : "请求人工客服接手"} onClick={onHandoff}>
              {en ? "Request human support" : "转人工客服"}
            </button>
          </div>
        )}
        {message.error && <div className="disclaimer">{message.error}</div>}
      </div>
    </div>
  );
}

export function ChatPanel({
  onStart,
  onDone,
  onMeta,
  onFlowEvent,
  onBatch,
  onPurchasePrepared,
  onWalletPending,
  onReceiptVerified,
  afterSalesPrompt,
  onPromptConsumed,
  batchId,
  autoQueryBatch,
  autoQueryPrompt,
  locale = "zh",
  productLabel,
  minimal = false,
}: {
  onStart: () => void;
  onDone: () => void;
  onMeta?: (meta: ChatMessage["meta"]) => void;
  onFlowEvent?: (event: ChatEvent) => void;
  onBatch: (id: string) => void;
  onPurchasePrepared?: () => void;
  onWalletPending?: () => void;
  onReceiptVerified?: () => void;
  afterSalesPrompt?: string;
  onPromptConsumed?: () => void;
  batchId: string | null;
  /** Run the same real Agent query as the batch selector when a consumer searches above the chat. */
  autoQueryBatch?: string | null;
  /** Optional prompt for a quick action while keeping the same batch scope. */
  autoQueryPrompt?: string | null;
  locale?: "zh" | "en";
  productLabel?: string;
  /** Agent-first mode keeps operational controls folded away. */
  minimal?: boolean;
}) {
  const { messages, ask, pushUser, pushAgent } = useChatStream();
  const en = locale === "en";
  const { address, chainId, executeOnChainAction, txBusy } = useWallet();
  const walletReady = Boolean(address && chainId === 677);
  const [input, setInput] = useState("");
  const [batchOpen, setBatchOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [iotBusy, setIotBusy] = useState(false);
  const [sensorRun, setSensorRun] = useState<{
    mode: IotSimulationMode;
    evidenceId: string;
    payloadHash: string;
    message: string;
    pipeline: string[];
    verification?: { status?: string; reasons?: string[] };
  } | null>(null);
  const chatLogRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const busy = messages.length > 0 && !messages[messages.length - 1].done;
  const latestAgentMeta = [...messages].reverse().find((message) => message.role === "agent" && message.meta)?.meta;
  const runtimeStatus = latestAgentMeta?.serviceStatus ?? latestAgentMeta?.agentMode;
  const runtimeLabel = runtimeStatus === "model_assisted"
    ? (en ? "Agent explanation verified" : "Agent 解释已校验")
    : runtimeStatus === "provider_unavailable"
      ? (en ? "Provider unavailable · evidence still readable" : "模型服务暂不可用 · 资料仍可查")
      : runtimeStatus === "rate_limited"
        ? (en ? "Request limited · evidence fallback" : "请求受限 · 资料仍可查")
        : runtimeStatus === "deterministic_fallback"
          ? (en ? "Evidence answer · records still readable" : "依据回答 · 登记资料仍可查")
          : (en ? "Ask the Agent · see the record" : "直接问 Agent · 看清依据");
  const displayRuntimeLabel = minimal
    ? (en ? "Ask about this batch" : "直接问这批资料")
    : runtimeLabel;
  const batchOptions = productLabel?.includes("米") || productLabel?.toLowerCase().includes("rice") ? RICE_BATCHES : FISH_OIL_BATCHES;
  const lastAutoQueryRef = useRef<string | null>(null);

  useEffect(() => {
    if (!afterSalesPrompt) return;
    setInput(afterSalesPrompt);
    onPromptConsumed?.();
  }, [afterSalesPrompt, onPromptConsumed]);

  useEffect(() => {
    const el = chatLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  useEffect(() => {
    if (!onMeta) return;
    const latestAgent = [...messages].reverse().find((message) => message.role === "agent" && message.meta);
    onMeta(latestAgent?.meta);
  }, [messages, onMeta]);

  const runVerify = async (question: string, batch?: string, showUserMessage = true) => {
    if (!question.trim() || busy) return;
    setInput("");
    const bid = batch ?? extractBatchId(question) ?? batchId;
    if (bid) {
      onStart();
      onBatch(bid);
      await ask(question, bid, onFlowEvent, locale, { showUserMessage });
      onDone();
    } else {
      await ask(question, "", onFlowEvent, locale, { showUserMessage });
    }
  };

  useEffect(() => {
    if ((!autoQueryBatch && !autoQueryPrompt) || busy) return;
    const requestKey = `${autoQueryBatch ?? batchId ?? ""}:${autoQueryPrompt ?? "batch"}`;
    if (lastAutoQueryRef.current === requestKey) return;
    lastAutoQueryRef.current = requestKey;
    // Deep links should immediately demonstrate the complete read-only
    // workflow. A bare batch id is valid, but this scoped question makes the
    // first response useful to a visitor: production, inspection, cold chain,
    // gaps, and the next owner are all requested in one Agent run.
    const initialQuestion = autoQueryPrompt
      ?? (en
        ? `Inspect batch ${autoQueryBatch}: production, testing, cold chain, gaps, and next owner.`
        : `请检查批次 ${autoQueryBatch} 的生产、检测、冷链、缺口和下一步责任方。`);
    // This is a page entry action, not something the visitor typed. Keep the
    // internal retrieval prompt out of the visible conversation.
    void runVerify(initialQuestion, autoQueryBatch ?? batchId ?? undefined, false);
  }, [autoQueryBatch, autoQueryPrompt, batchId, busy, en]);

  const recommend = async (text: string) => {
    setInput("");
    pushUser(text);
    pushAgent([{ cls: "plain", text: en ? "I will compare the registered batches and show a scoped reference (demo data)." : "好的，我来根据已登记批次给出补货参考（演示数据）。" }]);
    try {
      const items = await fetchRecommend(batchId ?? undefined);
      if (!items.length) {
        pushAgent([{ cls: "plain", text: en ? "There are no batches available to show right now." : "当前暂无可展示的补货批次。" }]);
      } else {
        pushAgent(
          [{ cls: "plain", text: en ? "These are demo batch references, not purchase advice or efficacy claims:" : "以下为演示批次参考，不构成购买建议或疗效承诺：" }],
          { recommendations: items },
        );
      }
    } catch {
      pushAgent([{ cls: "disclaimer", text: en ? "The recommendation service is temporarily unavailable." : "推荐服务暂不可用。" }]);
    }
  };

  const handleOrder = async (item: RecommendItem) => {
    if (busy) return;
    try {
      // A recommendation can move the conversation to another batch. Update
      // the parent first so evidence, wallet, feedback, and the URL all keep
      // the same scope while the order is prepared.
      onBatch(item.batchId);
      const order = await createOrder(item.batchId, 1);
      const purchaseQuote = await fetchPurchaseQuote(order.batchId).catch(() => undefined);
      const orderWithQuote = purchaseQuote ? { ...order, purchaseQuote } : order;
      void saveOrderRecord({
        orderId: order.orderId,
        batchId: order.batchId,
        productName: order.productName,
        imageUrl: order.imageUrl,
        quantity: order.quantity,
        status: order.status,
      });
      onPurchasePrepared?.();
      pushAgent(
        [
          { cls: "conclusion", text: en ? `Checkout preparation created: ${order.orderId}` : `已生成购买准备单：${order.orderId}` },
          { cls: "plain", text: en ? "The merchant Checkout Adapter handles price, address, and payment. The wallet must confirm before a purchase credential is written. Without a txHash, the state remains anchor_pending." : "下一步由商家 Checkout Adapter 完成价格、地址与支付；确认后再由钱包写入购买凭证。当前若无 txHash，状态为 anchor_pending。" },
          { cls: "disclaimer", text: en ? "Demo mode does not invent price, inventory, or efficacy claims." : "演示环境不展示虚构价格、库存或疗效。" },
        ],
        { order: orderWithQuote },
      );
    } catch {
      pushAgent([{ cls: "disclaimer", text: en ? "Checkout preparation failed. Please try again." : "购买准备失败，请稍后重试。" }]);
    }
  };

  const preparePurchaseFromAgent = async (text: string) => {
    if (busy) return;
    pushUser(text);
    if (!batchId) {
      pushAgent([{ cls: "disclaimer", text: en ? "Choose a batch first. I will not prepare a purchase without a batch context." : "请先确定批次。我不会在没有批次上下文时准备购买。" }]);
      return;
    }
    pushAgent([{ cls: "cmd", text: en ? `I am checking whether ${batchId} is eligible before preparing checkout.` : `我先核对 ${batchId} 是否满足当前规则，再准备购买。` }]);
    try {
      const items = await fetchRecommend(batchId);
      // Never fall back to another batch: checkout is scoped to the active tenant/product/batch context.
      const current = items.find((item) => item.batchId === batchId);
      if (!current) {
        pushAgent([{ cls: "disclaimer", text: en ? "No scoped recommendation is available, so checkout was not prepared." : "当前没有带证据范围的推荐，因此没有准备购买。" }]);
        return;
      }
      if (current.recommendationStatus !== "recommend_with_scope") {
        pushAgent([
          { cls: "conclusion", text: en ? `I will not prepare checkout for ${current.batchId} yet.` : `当前不会为 ${current.batchId} 准备购买。` },
          { cls: "plain", text: en ? (current.reason ?? "The batch needs review before recommendation.") : (current.reason ?? "这批资料需要先复核，再决定是否推荐。") },
          { cls: "cmd", text: en ? "Next: open the evidence and resolve the listed gaps." : "下一步：打开证据并补齐当前列出的缺口。" },
        ]);
        return;
      }
      await handleOrder(current);
    } catch {
      pushAgent([{ cls: "disclaimer", text: en ? "The recommendation check failed, so no purchase was prepared." : "推荐核验失败，因此没有准备购买。" }]);
    }
  };

  const runAgentOperation = async (text: string): Promise<boolean> => {
    const lower = text.toLowerCase();
    const operation = /钱包|签名|wallet|sign/.test(lower) ? "wallet"
      : /企业|生产方|上传资料|merchant|producer/.test(lower) ? "merchant"
        : /检测机构|审核|复核|institution|review/.test(lower) ? "institution"
          : /开发者|mcp|cli|developers?/.test(lower) ? "developers"
            : null;
    if (!operation) return false;

    setInput("");
    pushUser(text);
    if (!batchId) {
      pushAgent([{ cls: "disclaimer", text: en ? "Choose a batch first. I will read the scoped record in this conversation." : "请先确定批次，我才能在当前对话里读取对应资料。" }]);
      return true;
    }

    const operationQuestion = operation === "wallet"
      ? (en
        ? `Read batch ${batchId}'s purchase quote, wallet and Chain 677 state, signing boundary, and next step. Do not sign or pay.`
        : `请读取批次 ${batchId} 的购买报价、钱包和 Chain 677 状态、签名边界和下一步。不要代替用户签名或付款。`)
      : operation === "merchant"
        ? (en
          ? `Read batch ${batchId}'s production records, missing items, conflicts, and the producer's next responsibility.`
          : `请读取批次 ${batchId} 的生产资料、缺口、冲突和生产方下一步责任。`)
        : operation === "institution"
          ? (en
            ? `Read batch ${batchId}'s inspection report, deterministic checks, institution review status, and pending signing actions.`
            : `请读取批次 ${batchId} 的检测报告、确定性检查、机构审核状态和待签名操作。`)
          : (en
            ? `Read what an external Agent, MCP, or CLI can query for batch ${batchId}, plus the protected-operation boundary.`
            : `请读取批次 ${batchId} 可以通过外部 Agent、MCP 或 CLI 查询的资料，以及受保护操作边界。`);

    pushAgent([{ cls: "cmd", text: en ? "I am reading the current record here and will explain the result in this chat." : "我直接在当前对话读取这批资料，再把结果讲清楚。" }]);
    onStart();
    onBatch(batchId);
    try {
      await ask(operationQuestion, batchId, onFlowEvent, locale);
    } finally {
      onDone();
    }
    return true;
  };

  const handleAnchorOrder = async (order: OrderCard) => {
    try {
      onWalletPending?.();
      const tx = await executeOnChainAction({
        action: "purchase",
        batchId: order.batchId,
        purchaseId: order.orderId,
      });
      onReceiptVerified?.();
      pushAgent(
        [
          { cls: "conclusion", text: en ? `Order ${order.orderId} was submitted for on-chain recording.` : `订单 ${order.orderId} 已提交链上存证交易。` },
          { cls: "cmd", text: `TxHash: ${tx.txHash}` },
          { cls: "disclaimer", text: en ? "Use the block explorer receipt as the source of truth; the UI alone does not complete settlement." : "请以区块浏览器 receipt 为准；界面展示不等于业务结算完成。" },
        ],
        { order: { ...order, txHash: tx.txHash, explorerUrl: tx.explorerUrl } },
      );
    } catch {
      // Error handled by WalletProvider toast
    }
  };

  const handleHandoff = () => {
    pushAgent([
      { cls: "conclusion", text: en ? "Your request for human support has been recorded." : "已记录人工转接意向。" },
      { cls: "plain", text: en ? "Continue through the merchant after-sales channel. The Agent will not turn model text into a quality verdict." : "请通过商家售后渠道继续；Agent 不会把模型回答包装成质量判定。" },
      { cls: "disclaimer", text: en ? "This handoff is a demo placeholder and does not create a real ticket." : "转接入口为产品流程占位，当前演示不创建真实工单。" },
    ]);
  };

  const simulateIot = async (mode: IotSimulationMode) => {
    const target = batchId ?? "FO-2026-001";
    if (busy || iotBusy) return;
    setIotBusy(true);
    try {
      const result = await postIotSimulation(target, mode);
      setSensorRun({ mode, evidenceId: result.evidenceId, payloadHash: result.payloadHash, message: result.message, pipeline: result.pipeline ?? ["设备发送", "服务端接收", "批次关联", "确定性校验"], verification: result.verification });
      await ask(`已上传 IoT 模拟数据：${mode}`, target, onFlowEvent, locale);
    } catch (error) {
      console.error("IoT 模拟上传失败", error);
    } finally {
      setIotBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    if (/(购买|下单|支付|结账|checkout|buy|purchase)/i.test(text)) {
      void preparePurchaseFromAgent(text);
      return;
    }
    if (/(钱包|签名|wallet|sign|企业|生产方|上传资料|merchant|producer|检测机构|审核|复核|institution|review|开发者|mcp|cli|developers?)/i.test(text)) {
      void runAgentOperation(text);
      return;
    }
    if (/(推荐|补货|快吃完|复购|再买|帮我选)/.test(text)) {
      recommend(text);
    } else {
      runVerify(text);
    }
  };

  const toggleVoice = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const recognition = new SR();
    recognition.lang = "zh-CN";
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event: any) => {
      let text = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        text += event.results[i][0].transcript;
      }
      setInput(text);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  };

  return (
    <aside id="agent" className={`panel chat-panel${minimal ? " chat-panel-minimal" : ""}`}>
      <div className="chat-head">
        <div className="chat-head-icon" aria-hidden="true">
          <img src="/assets/brand-mark.png" alt="" />
        </div>
        <div className="chat-head-text">
          <strong>{en ? "TruthPass Product Agent" : "TruthPass Agent 客服"}</strong>
          <small>
            <span className={`status-dot ${!minimal && (runtimeStatus === "provider_unavailable" || runtimeStatus === "rate_limited") ? "offline" : ""}`} title={minimal ? displayRuntimeLabel : runtimeLabel} />
            {displayRuntimeLabel} · {en ? "shows sources and uncertainty" : "会说明依据和不确定性"}
          </small>
        </div>
      </div>

      <div className="chat-log" ref={chatLogRef} aria-live="polite">
        <div className="msg agent chat-welcome">
          {!minimal && <div className="chat-meta" aria-label={en ? "Welcome message metadata" : "欢迎语元信息"}>
            <span className="status-pill demo">{en ? "Demo data" : "演示资料"}</span>
            <span className="status-pill pending">{en ? "Product Agent" : "商品助手"}</span>
          </div>}
          <div className="msg-bubble">
            {minimal ? <>
              <p className="chat-welcome-copy">{en ? `Ask me about ${productLabel ?? "this product"}: testing, cold chain, production records, or missing evidence.` : `直接问我${productLabel ?? "这件商品"}：检测、冷链、生产记录，或者还缺什么资料。`}</p>
              <p className="chat-welcome-note">{en ? "This demo uses synthetic records and is not product certification." : "当前使用演示资料，不能替代真实商品认证。"}</p>
            </> : <div className="agent-structured-answer" aria-label={en ? "Agent answer structure" : "Agent 回答结构"}>
              <section className="agent-answer-section agent-answer-结论"><strong>{en ? "Conclusion" : "结论"}</strong><p>{en ? "I will show the product evidence without making a quality promise for anyone." : "我帮你看商品依据，不替任何一方做质量承诺。"}</p></section>
              <section className="agent-answer-section agent-answer-依据"><strong>{en ? "Evidence" : "依据"}</strong><p>{en ? "Production, testing, delivery, and aftercare records are grouped by batch." : "生产、检测、运输和售后资料都按批次整理。"}</p></section>
              <section className="agent-answer-section agent-answer-不确定"><strong>{en ? "Uncertain" : "不确定"}</strong><p>{en ? `This ${productLabel ?? "product"} record is synthetic demo data and is not certification.` : `当前${productLabel ?? "商品"}资料是演示资料，不能替代真实认证。`}</p></section>
              <section className="agent-answer-section agent-answer-下一步"><strong>{en ? "Next step" : "下一步"}</strong><p>{en ? "Choose a batch or ask me what evidence is still missing." : "先选择批次，或者直接问我“还缺什么资料”。"}</p></section>
            </div>}
          </div>
        </div>
        {messages.map((message) => (
          <MessageView
            key={message.id}
            message={message}
            onOrder={handleOrder}
            onAnchorOrder={handleAnchorOrder}
            onHandoff={handleHandoff}
            txBusy={txBusy}
            walletReady={walletReady}
            locale={locale}
            minimal={minimal}
          />
        ))}
      </div>

      <div className={`chat-quick ${minimal ? "chat-quick-minimal" : ""}`}>
        {!minimal && <div className="quick-group">
          <span className="chat-quick-label">{en ? "Batch:" : "批次查询："}</span>
          <div className="batch-select">
            <button
              className="batch-trigger"
              type="button"
              aria-label={en ? "Choose demo batch" : "选择演示批次"}
              aria-expanded={batchOpen}
              onClick={() => setBatchOpen((v) => !v)}
              disabled={busy}
            >
              {en ? "Choose batch" : "选择批次"} <span aria-hidden="true">▾</span>
            </button>
            {batchOpen && (
              <div className="batch-menu">
                {batchOptions.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    aria-label={`${en ? "Inspect batch" : "查询批次"} ${b.id} ${b.name}`}
                    onClick={() => {
                      setBatchOpen(false);
                      runVerify(`${en ? "Inspect batch" : "查询批次"} ${b.id}`, b.id);
                    }}
                  >
                    <b>{b.id}</b>
                    <span>{b.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>}
        {batchId && (
          <div className="quick-group">
            <span className="chat-quick-label">{en ? "Ask about:" : "你想了解："}</span>
            {(en ? EN_QUICK_PROMPTS : QUICK_PROMPTS).slice(0, minimal ? 4 : undefined).map((prompt) => (
              <button
                key={prompt.label}
                type="button"
                aria-label={prompt.q}
                onClick={() => runVerify(prompt.q, batchId ?? "FO-2026-001")}
                disabled={busy}
              >
                {prompt.label}
              </button>
            ))}
            {!minimal && <button type="button" aria-label={en ? "Request human support" : "请求人工客服接手"} onClick={handleHandoff} disabled={busy}>
              {en ? "Human support" : "转人工"}
            </button>}
          </div>
        )}
        {batchId && !minimal && (
          <div className="quick-group">
            <span className="chat-quick-label">{en ? "Sensor simulation:" : "IoT 模拟："}</span>
            <button type="button" aria-label={en ? "Simulate normal temperature" : "模拟正常温度"} onClick={() => simulateIot("normal")} disabled={busy || iotBusy}>{en ? "Normal" : "正常温度"}</button>
            <button type="button" aria-label={en ? "Simulate cold-chain gap" : "模拟冷链异常"} onClick={() => simulateIot("cold_chain_gap")} disabled={busy || iotBusy}>{en ? "Cold-chain gap" : "冷链异常"}</button>
            <button type="button" aria-label={en ? "Simulate offline device" : "模拟设备离线"} onClick={() => simulateIot("device_offline")} disabled={busy || iotBusy}>{en ? "Offline" : "设备离线"}</button>
          </div>
        )}
        {sensorRun && !minimal && (
          <div className="sensor-transfer-card" aria-live="polite">
            <div className="sensor-transfer-head"><div><span className="chat-quick-label">{en ? "Server sensor replay" : "服务器模拟传感"}</span><strong>{sensorRun.mode === "normal" ? (en ? "Temperature normal" : "温控正常") : sensorRun.mode === "cold_chain_gap" ? (en ? "Cold-chain gap" : "冷链异常") : (en ? "Device offline" : "设备离线")}</strong></div><span className={`sensor-check-pill ${sensorRun.verification?.status === "accepted" ? "pass" : "review"}`}>{sensorRun.verification?.status === "accepted" ? (en ? "Verified" : "校验通过") : (en ? "Needs review" : "进入复核")}</span></div>
            <div className="sensor-transfer-steps">{sensorRun.pipeline.map((step, index) => <span key={step} className={index === sensorRun.pipeline.length - 1 ? "done" : ""}><b>{index + 1}</b>{step}{index < sensorRun.pipeline.length - 1 && <i>→</i>}</span>)}</div>
            <p>{sensorRun.message}</p>
            <small>{en ? "Evidence" : "证据编号"} {sensorRun.evidenceId} · {en ? "payload digest generated" : "payload 已生成摘要"} · {sensorRun.verification?.status ?? (en ? "pending" : "待校验")}</small>
          </div>
        )}
      </div>

      <form className="chat-input" onSubmit={submit}>
        <button
          type="button"
          className={listening ? "voice-btn listening" : "voice-btn"}
          onClick={toggleVoice}
          aria-label={listening ? (en ? "Stop voice input" : "停止语音输入") : (en ? "Start voice input" : "开始语音输入")}
          disabled={busy}
        >
          {listening ? "⏺" : "🎤"}
        </button>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={listening ? (en ? "Listening…" : "正在聆听，请说话…") : (en ? `Ask: did ${productLabel ?? "this product"} pass testing?` : `例如：这批${productLabel ?? "商品"}检测通过了吗？`)}
          autoComplete="off"
          disabled={busy}
          aria-label={en ? "Agent question" : "Agent 问题输入框"}
        />
        <button type="submit" aria-label={en ? "Send question" : "发送问题"} disabled={busy}>
          ➤
        </button>
      </form>
    </aside>
  );
}
