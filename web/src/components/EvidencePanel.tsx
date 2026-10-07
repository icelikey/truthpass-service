import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCliInspect, fetchEvidenceLink, fetchJourney } from "../api";
import { ICON_URLS } from "../data";
import type { VerifyState } from "../types";

function formatTime(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}

export function EvidencePanel({ state, batchId }: { state: VerifyState; batchId: string }) {
  const { data: journey } = useQuery({
    queryKey: ["journey", batchId],
    queryFn: () => fetchJourney(batchId),
    enabled: state === "done",
  });
  const { data: techSteps, isLoading } = useQuery({
    queryKey: ["evidence", batchId],
    queryFn: () => fetchEvidenceLink(batchId),
    enabled: state === "done",
  });
  const { data: cliInspect } = useQuery({
    queryKey: ["cli-inspect", batchId],
    queryFn: () => fetchCliInspect(batchId),
    enabled: state === "done",
  });
  const [showTech, setShowTech] = useState(false);

  if (state !== "done") {
    return (
      <aside id="evidence" className="panel evidence-panel">
        <div className="panel-head">
          <span className="panel-title">产品旅程</span>
        </div>
        <div className="pending-state small">
          <div className="pending-icon" aria-hidden="true">◇</div>
          <p>{state === "running" ? "正在梳理产品旅程…" : "验证完成后，这里会展示产品从产地到交付的旅程。"}</p>
        </div>
      </aside>
    );
  }

  return (
    <aside id="evidence" className="panel evidence-panel">
      <div className="panel-head">
        <span className="panel-title">产品旅程</span>
      </div>

      <ol className="evidence-steps">
        {(journey?.steps ?? []).map((s) => (
          <li className="evidence-step" key={s.step}>
            <span className="evidence-dot">
              <img src={ICON_URLS[s.icon]} alt="" />
              <em>{s.step}</em>
            </span>
            <h3>{s.title}</h3>
            <p>{s.desc}</p>
          </li>
        ))}
      </ol>

      <button className="tech-toggle" type="button" onClick={() => setShowTech((v) => !v)}>
        <span>{showTech ? "收起技术详情" : "技术详情"}</span>
        <span className="tech-chev" aria-hidden="true">{showTech ? "⌃" : "›"}</span>
      </button>

      {showTech && (
        <div className="tech-details">
          {isLoading ? (
            <p style={{ color: "var(--muted)" }}>加载中…</p>
          ) : (
            <>
            {cliInspect && <div className="cli-observer">
              <b>CLI 验证链</b>
              {cliInspect.stages.map((stage) => <div className="cli-stage" key={stage.name}><span>{stage.status === "completed" ? "✓" : "○"} {stage.name}</span><code>{stage.detail}</code></div>)}
              <small>证据根：{cliInspect.verification.evidenceRoot} · 链上：未请求（dry-run）</small>
            </div>}
            {(techSteps ?? []).map((s) => (
              <div className="tech-item" key={s.step}>
                <span className="tech-index">{s.step}</span>
                <div>
                  <b>{s.title}</b>
                  <span>{s.source}</span>
                  <code>{s.hash}</code>
                </div>
              </div>
            ))}
            </>
          )}
        </div>
      )}
    </aside>
  );
}
