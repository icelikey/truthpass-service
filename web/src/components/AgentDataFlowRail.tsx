import { useEffect, useRef, useState } from "react";

/**
 * Sources are rendered in the user's locale. Keep the well-known Chinese
 * labels for backwards compatibility, while allowing the equivalent English
 * labels emitted by the English consumer page.
 */
export type AgentFlowSource =
  | "Agent SSE"
  | "Agent stream"
  | "批次总览 API"
  | "Batch overview API"
  | "生命周期 API"
  | "Lifecycle API"
  | "链状态 API"
  | "Chain status API";
export type AgentFlowStatus = "pending" | "active" | "completed" | "fallback" | "unavailable" | "info";

export interface AgentFlowEvent {
  id: string;
  source: AgentFlowSource;
  label: string;
  detail: string;
  status: AgentFlowStatus;
  at: string;
  batchId?: string;
  traceId?: string;
  evidenceCount?: number;
  dataMode?: string;
}

function timeLabel(iso: string, locale: "zh" | "en") {
  const date = new Date(iso);
  if (Number.isNaN(date.valueOf())) return iso;
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(date);
}

const STATUS_LABELS: Record<AgentFlowStatus, { zh: string; en: string }> = {
  pending: { zh: "等待", en: "pending" },
  active: { zh: "进行中", en: "active" },
  completed: { zh: "已完成", en: "completed" },
  fallback: { zh: "基础回答", en: "fallback" },
  unavailable: { zh: "不可用", en: "unavailable" },
  info: { zh: "记录", en: "info" },
};

const FLOW_STAGES: Array<{ key: string; zh: string; en: string }> = [
  { key: "reading_batch", zh: "读取这批资料", en: "Read this batch" },
  { key: "verifier_checked", zh: "Verifier 规则核验", en: "Verifier rule check" },
  { key: "jev_routed", zh: "JEV 决定下一步", en: "JEV routes next step" },
  { key: "model_started", zh: "整理解释", en: "Organize explanation" },
  { key: "model_completed", zh: "返回回答", en: "Return the answer" },
];

function flowStageKey(event: AgentFlowEvent, locale: "zh" | "en"): string | undefined {
  const labels = locale === "zh"
    ? ["读取当前批次", "Verifier 完成规则核验", "JEV 完成分流", "模型开始整理解释", "模型解释完成"]
    : ["Reading this batch", "Verifier checked rules", "JEV routed next step", "Model started explanation", "Model explanation completed"];
  const index = labels.indexOf(event.label);
  return index >= 0 ? FLOW_STAGES[index]?.key : undefined;
}

export function AgentDataFlowRail({
  events,
  batchId,
  dataMode,
  traceId,
  locale = "zh",
  onClear,
}: {
  events: AgentFlowEvent[];
  batchId: string;
  dataMode?: string;
  traceId?: string;
  locale?: "zh" | "en";
  onClear?: () => void;
}) {
  const zh = locale === "zh";
  const logRef = useRef<HTMLDivElement | null>(null);
  const [follow, setFollow] = useState(true);
  const [showAll, setShowAll] = useState(false);

  // Lifecycle polling can append an event after the SSE stream has finished.
  // Derive completion from the current run history instead of only looking at
  // the latest row, otherwise the heading regresses to "following" on the
  // next poll even though the Agent already returned an answer. Conversely,
  // scope the check to the latest start event so a second question for the
  // same batch does not inherit the previous run's completed state.
  const startMarkers = events.map((event) => event.label === (zh ? "Agent 开始运行" : "Agent run started"));
  const latestStartIndex = startMarkers.lastIndexOf(true);
  const currentRunEvents = latestStartIndex >= 0 ? events.slice(latestStartIndex) : events;
  const runComplete = currentRunEvents.some((event) =>
    event.label === (zh ? "Agent 运行结束" : "Agent run finished")
      || event.label === (zh ? "生命周期读取失败" : "Lifecycle read failed")
      || event.label === (zh ? "批次总览读取失败" : "Batch overview failed"),
  );
  const runHeading = runComplete
    ? (zh ? "本次查询已返回" : "This run has returned")
    : (zh ? "正在查这批资料" : "Following this batch");
  const latestByStage = new Map<string, AgentFlowEvent>();
  for (const event of events) {
    const key = flowStageKey(event, locale);
    if (key) latestByStage.set(key, event);
  }
  // Background lifecycle and chain polling can append rows after the Agent
  // stream has finished. Keep the primary status line scoped to the latest
  // Agent SSE row so the user sees the actual run stage instead of a later
  // telemetry refresh.
  const latestEvent = [...events].reverse().find((event) => event.source === "Agent SSE" || event.source === "Agent stream") ?? events.at(-1);
  const latestEventIsTerminal = latestEvent?.status === "completed" || latestEvent?.status === "fallback" || latestEvent?.status === "unavailable";

  useEffect(() => {
    if (!follow || !logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events, follow]);

  return (
    <section className="agent-data-flow-rail" aria-label={zh ? "Agent 数据流" : "Agent data flow"}>
      <div className="agent-data-flow-head">
        <div>
          <span className="tp-kicker">{zh ? "运行现场 · API 数据流" : "RUN TRACE · API DATA FLOW"}</span>
          <h2>{runHeading}</h2>
          <p>{zh ? "每一条记录都来自 SSE 或公开 API；没有事件就不会显示结果。" : "Every row comes from SSE or a public API; no event is shown without a source."}</p>
        </div>
        <div className="agent-data-flow-actions">
          <span className="agent-flow-chip"><code>{batchId}</code></span>
          {dataMode && <span className="agent-flow-chip">{dataMode}</span>}
          <button type="button" onClick={() => setFollow((value) => !value)}>{follow ? (zh ? "暂停跟随" : "Pause follow") : (zh ? "继续跟随" : "Follow latest")}</button>
          {onClear && <button type="button" onClick={onClear}>{zh ? "清空本次" : "Clear run"}</button>}
        </div>
      </div>
      <div className="agent-data-flow-summary" aria-live="polite">
        <span>{zh ? "已完成阶段" : "Stages returned"} <b>{latestByStage.size}/5</b></span>
        <span>{zh ? "最新来源" : "Latest source"} <b>{events.at(-1)?.source ?? "—"}</b></span>
        <span>{zh ? "Trace ID" : "Trace ID"} <code>{traceId ?? events.at(-1)?.traceId ?? "—"}</code></span>
      </div>
      <div className={`agent-data-flow-live ${latestEvent?.status ?? "pending"}`} aria-live="polite">
        <span className="agent-data-flow-live-dot" aria-hidden="true" />
        <div>
          <strong>{latestEventIsTerminal ? (zh ? "最近发生" : "Latest event") : (zh ? "当前正在发生" : "Happening now")}</strong>
          <b>{latestEvent?.label ?? (zh ? "等待 Agent 查询" : "Waiting for the Agent query")}</b>
          <small>{latestEvent?.detail ?? (zh ? "发送一个问题后，这里会按真实 SSE/API 事件更新。" : "Ask a question and this line will update from the live SSE/API events.")}</small>
        </div>
      </div>
      <div className="agent-data-flow-steps" aria-live="polite">
        {FLOW_STAGES.map((stage, index) => {
          const event = latestByStage.get(stage.key);
          const status = event?.status ?? "pending";
          return <article className={`agent-flow-step ${status}`} key={stage.key}>
            <span className="agent-flow-step-number">{status === "completed" ? "✓" : index + 1}</span>
            <div><strong>{zh ? stage.zh : stage.en}</strong><span>{event ? (event.detail || STATUS_LABELS[status][locale]) : (zh ? "等待前一步" : "Waiting")}</span></div>
            <em>{STATUS_LABELS[status][locale]}</em>
          </article>;
        })}
      </div>
      <button type="button" className="agent-flow-details-toggle" onClick={() => setShowAll((value) => !value)} aria-expanded={showAll}>
        {showAll ? (zh ? "收起完整运行记录" : "Hide full run log") : (zh ? `展开完整运行记录（${events.length} 条）` : `Open full run log (${events.length} events)`)}
      </button>
      {showAll && <div className="agent-data-flow-log" ref={logRef} aria-live="polite" aria-relevant="additions text">
        {events.length === 0 ? (
          <div className="agent-data-flow-empty">{zh ? "等待查询。发送一个问题后，这里会滚动显示真实运行阶段。" : "Waiting for a query. Send a question to see the live stages here."}</div>
        ) : events.map((event) => (
          <article className={`agent-flow-event ${event.status}`} key={event.id}>
            <div className="agent-flow-dot" aria-hidden="true" />
            <div className="agent-flow-event-body">
              <div className="agent-flow-event-topline">
                <strong>{event.label}</strong>
                <span className="agent-flow-source">{event.source}</span>
                <span className={`agent-flow-status ${event.status}`}>{STATUS_LABELS[event.status][locale]}</span>
                <time dateTime={event.at}>{timeLabel(event.at, locale)}</time>
              </div>
              <p>{event.detail}</p>
              <div className="agent-flow-event-meta">
                {event.batchId && <span>batch <code>{event.batchId}</code></span>}
                {event.evidenceCount !== undefined && <span>{zh ? "证据" : "evidence"} <b>{event.evidenceCount}</b></span>}
                {event.dataMode && <span>{event.dataMode}</span>}
                {event.traceId && <span>trace <code>{event.traceId}</code></span>}
              </div>
            </div>
          </article>
        ))}
      </div>}
      <div className="agent-data-flow-foot">
        <span>{zh ? "数据模式" : "Data mode"}：{dataMode ?? "demo/synthetic"}</span>
        <span>{zh ? "模型不能替代 Verifier、JEV 或钱包确认" : "The model does not replace Verifier, JEV, or wallet confirmation."}</span>
      </div>
    </section>
  );
}
