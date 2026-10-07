import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCliInspect, fetchEvidenceLink, fetchJourney } from "../api";
import { ICON_URLS } from "../data";
import type { VerifyState } from "../types";

function formatTime(iso: string): string {
  return iso.replace("T", " ").slice(0, 16);
}

export function EvidencePanel({ state, batchId, focusTech = false }: { state: VerifyState; batchId: string; focusTech?: boolean }) {
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
  const [showTech, setShowTech] = useState(focusTech);
  const [techView, setTechView] = useState<"inspect" | "envelope" | "assessment" | "anchor">("inspect");

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
              <b>CLI 技术观察台</b>
              <small>以下为后端生成的结构化命令视图，不执行浏览器本机 shell。</small>
              <div className="cli-actions">
                <button type="button" onClick={() => setTechView("envelope")}>查看证据 Envelope</button>
                <button type="button" onClick={() => setTechView("assessment")}>查看验收 JSON</button>
                <button type="button" onClick={() => setTechView("anchor")}>生成链上锚定计划</button>
              </div>
              <code className="cli-command">$ truthpass inspect --batch {cliInspect.batchId}</code>
              {techView === "inspect" && cliInspect.stages.map((stage, index) => <div className="cli-stage cli-stage-detail" key={stage.name}>
                <span><strong>[{index + 1}/{cliInspect.stages.length}]</strong> {stage.status === "completed" ? "✓" : "○"} {stage.name}</span>
                <code>{stage.detail}</code>
              </div>)}
              {techView === "envelope" && <div className="cli-section"><strong>Evidence Envelope</strong><span>root: {cliInspect.verification.evidenceRoot}</span><span>events: {cliInspect.verification.evidence.length}</span><span>status: {cliInspect.verification.status}</span>{cliInspect.verification.evidence.map((item) => <span key={item.evidenceId}>{item.kind} · {item.sourceKind} · {item.status}</span>)}</div>}
              {techView === "assessment" && <div className="cli-section"><strong>确定性验收 JSON</strong><code>{JSON.stringify({ status: cliInspect.verification.status, policy: cliInspect.verification.policy, assessment: cliInspect.verification.assessment ?? null, reasons: cliInspect.verification.reasons }, null, 2)}</code></div>}
              {techView === "anchor" && <div className="cli-section"><strong>BOT Chain 锚定计划</strong><span>mode: dry-run</span><span>network: {cliInspect.verification.anchor.network ?? "bot-mainnet"}</span><span>status: {cliInspect.verification.anchor.status}</span><span>chainId: {cliInspect.verification.anchor.chainId ?? "-"}</span><span>submitted: false · 未广播交易，需外部签名</span></div>}
              <div className="cli-section"><strong>Agent 协作</strong><span>✓ production agent</span><span>✓ inspection agent</span><span>✓ consumer agent</span></div>
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
