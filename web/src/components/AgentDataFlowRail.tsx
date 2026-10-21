import { useEffect, useRef, useState } from "react";

export type AgentFlowSource = "Agent SSE" | "批次总览 API" | "生命周期 API" | "链状态 API";
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

  useEffect(() => {
    if (!follow || !logRef.current) return;
    logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [events, follow]);

  return (
    <section className="agent-data-flow-rail" aria-label={zh ? "Agent 数据流" : "Agent data flow"}>
      <div className="agent-data-flow-head">
        <div>
          <span className="tp-kicker">{zh ? "运行现场 · API 数据流" : "RUN TRACE · API DATA FLOW"}</span>
          <h2>{zh ? "正在查这批资料" : "Following this batch"}</h2>
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
        <span>{zh ? "事件" : "Events"} <b>{events.length}</b></span>
        <span>{zh ? "最新来源" : "Latest source"} <b>{events.at(-1)?.source ?? "—"}</b></span>
        <span>{zh ? "Trace ID" : "Trace ID"} <code>{traceId ?? events.at(-1)?.traceId ?? "—"}</code></span>
      </div>
      <div className="agent-data-flow-log" ref={logRef} aria-live="polite" aria-relevant="additions text">
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
      </div>
      <div className="agent-data-flow-foot">
        <span>{zh ? "数据模式" : "Data mode"}：{dataMode ?? "demo/synthetic"}</span>
        <span>{zh ? "模型不能替代 Verifier、JEV 或钱包确认" : "The model does not replace Verifier, JEV, or wallet confirmation."}</span>
      </div>
    </section>
  );
}
