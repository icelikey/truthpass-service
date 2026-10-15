import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCliInspect, fetchEvidenceLink, fetchJourney } from "../api";
import { ICON_URLS } from "../data";
import { useWallet } from "./WalletContext";
import { shortHex } from "../lib/wallet";
import type { VerifyState } from "../types";

function anchorStatusClass(status?: string): string {
  if (!status) return "pending";
  if (status === "anchored" || status === "confirmed") return "verified";
  if (status === "anchor_pending" || status === "pending") return "anchor-pending";
  return "review";
}

function anchorStatusText(status?: string): string {
  if (!status) return "未知";
  if (status === "anchored" || status === "confirmed") return `${status} · 已有锚定记录`;
  if (status === "anchor_pending" || status === "pending") return "anchor_pending · 尚未完成锚定";
  if (status === "replay_verified") return "replay_verified · 仅表示历史回放核验，不等于当前用户交易完成";
  return status;
}

export function EvidencePanel({ state, batchId, focusTech = false }: { state: VerifyState; batchId: string; focusTech?: boolean }) {
  const { address, chainId, executeOnChainAction, setWalletModalOpen, txBusy } = useWallet();
  const walletReady = Boolean(address && chainId === 677);
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
  const [techView, setTechView] = useState<"inspect" | "envelope" | "assessment" | "anchor">("inspect");

  useEffect(() => {
    if (focusTech) {
      setShowTech(true);
      setTechView("anchor");
    }
  }, [focusTech]);

  if (state !== "done") {
    return (
      <aside id="evidence" className="panel evidence-panel">
        <div className="panel-head">
          <span className="panel-title">证据与旅程</span>
        </div>
        <div className="pending-state small">
          <div className="pending-icon" aria-hidden="true">◇</div>
          <p>{state === "running" ? "正在梳理证据来源与缺口…" : "验证完成后，这里会展示证据来源、缺口与（默认折叠的）技术详情。"}</p>
        </div>
      </aside>
    );
  }

  const stages = cliInspect?.stages ?? [];
  const incomplete = stages.filter((s) => s.status !== "completed");
  const evidenceItems = cliInspect?.verification.evidence ?? [];
  const anchorStatus = cliInspect?.verification.anchor.status;
  const modeFromEvidence = evidenceItems.find((item) => item.dataMode)?.dataMode;
  const modeLabel = modeFromEvidence ?? "demo/synthetic";

  return (
    <aside id="evidence" className="panel evidence-panel">
      <div className="panel-head">
        <span className="panel-title">证据工作区</span>
        <span className="batch-id-chip"><code>{batchId}</code></span>
      </div>

      <div className="evidence-summary" aria-label="证据完整度与状态">
        <div className="evidence-summary-row">
          <span>验收状态</span>
          <span className={`status-pill ${cliInspect?.verification.status === "accepted" ? "verified" : cliInspect?.verification.status === "rejected" ? "rejected" : "review"}`}>
            {cliInspect?.verification.status ?? "loading"}
          </span>
        </div>
        <div className="evidence-summary-row">
          <span>锚定状态</span>
          <span className={`status-pill ${anchorStatusClass(anchorStatus)}`}>
            {anchorStatus ?? "—"}
          </span>
        </div>
        <div className="evidence-summary-row">
          <span>数据模式</span>
          <span className={`mode-badge ${modeLabel === "external" ? "external" : ""}`}>{modeLabel}</span>
        </div>
        <p style={{ margin: 0, color: "var(--muted)", fontSize: 12, lineHeight: 1.5 }}>
          {anchorStatusText(anchorStatus)}。replay_verified 不等于当前用户交易完成；anchor_pending 不等于已上链完成。
        </p>
        {incomplete.length > 0 && (
          <div className="evidence-gaps" aria-label="阶段缺口">
            {incomplete.map((s) => (
              <span className="gap-chip" key={s.name}>缺口 · {s.name}</span>
            ))}
          </div>
        )}
      </div>

      <div className="panel-head" style={{ marginTop: 4 }}>
        <span className="panel-title" style={{ fontSize: 13 }}>来源与旅程</span>
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

      {evidenceItems.length > 0 && (
        <div className="cli-section" style={{ marginTop: 12 }}>
          <strong>证据来源</strong>
          {evidenceItems.map((item) => (
            <span key={item.evidenceId}>
              {item.kind} · {item.sourceKind} · {item.status}
            </span>
          ))}
        </div>
      )}

      <button
        className="tech-toggle"
        type="button"
        aria-expanded={showTech}
        aria-label={showTech ? "收起技术详情" : "展开技术详情：Verifier、Evidence Envelope、链状态与 receipt 语义"}
        onClick={() => setShowTech((v) => !v)}
      >
        <span>{showTech ? "收起技术详情" : "技术详情（默认折叠）· Verifier / Envelope / 链状态"}</span>
        <span className="tech-chev" aria-hidden="true">{showTech ? "⌃" : "›"}</span>
      </button>

      {showTech && (
        <div className="tech-details">
          {isLoading ? (
            <p style={{ color: "var(--muted)" }}>加载中…</p>
          ) : (
            <>
              {cliInspect && (
                <div className="cli-observer">
                  <b>技术观察台</b>
                  <small>仅展示已登记字段与可核验链接；不暗示未发生的主网完成状态。</small>
                  <div className="cli-actions">
                    <button type="button" aria-label="查看验证阶段" onClick={() => setTechView("inspect")}>验证阶段</button>
                    <button type="button" aria-label="查看 Evidence Envelope" onClick={() => setTechView("envelope")}>Evidence Envelope</button>
                    <button type="button" aria-label="查看验收 JSON" onClick={() => setTechView("assessment")}>验收 JSON</button>
                    <button type="button" aria-label="查看链上锚定状态" onClick={() => setTechView("anchor")}>链状态 / receipt</button>
                  </div>
                  <code className="cli-command">$ truthpass inspect --batch {cliInspect.batchId} --network bot-mainnet</code>
                  {techView === "inspect" &&
                    cliInspect.stages.map((stage, index) => (
                      <div className="cli-stage cli-stage-detail" key={stage.name}>
                        <span>
                          <strong>
                            [{index + 1}/{cliInspect.stages.length}]
                          </strong>{" "}
                          {stage.status === "completed" ? "✓" : "○"} {stage.name}
                        </span>
                        <code>{stage.detail}</code>
                      </div>
                    ))}
                  {techView === "envelope" && (
                    <div className="cli-section">
                      <strong>Evidence Envelope</strong>
                      <span>root: {cliInspect.verification.evidenceRoot}</span>
                      <span>events: {cliInspect.verification.evidence.length}</span>
                      <span>status: {cliInspect.verification.status}</span>
                      {cliInspect.verification.evidence.map((item) => (
                        <span key={item.evidenceId}>
                          {item.kind} · {item.sourceKind} · {item.status}
                        </span>
                      ))}
                    </div>
                  )}
                  {techView === "assessment" && (
                    <div className="cli-section">
                      <strong>确定性验收 JSON</strong>
                      <code>
                        {JSON.stringify(
                          {
                            status: cliInspect.verification.status,
                            policy: cliInspect.verification.policy,
                            assessment: cliInspect.verification.assessment ?? null,
                            reasons: cliInspect.verification.reasons,
                          },
                          null,
                          2,
                        )}
                      </code>
                    </div>
                  )}
                  {techView === "anchor" && (
                    <div className="cli-section">
                      <strong>链状态与 receipt 语义</strong>
                      <span>network: BOT Chain Mainnet (Chain ID: {cliInspect.verification.anchor.chainId ?? 677})</span>
                      <span>status: {anchorStatusText(cliInspect.verification.anchor.status)}</span>
                      <span>
                        EvidenceAnchor:{" "}
                        <a
                          href={`https://scan.botchain.ai/address/${cliInspect.verification.anchor.contractAddress ?? "0x0033462bee153cb9DF12b5c447b9C282DbfbE877"}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-explorer-link"
                          aria-label="在区块浏览器打开 EvidenceAnchor 合约"
                        >
                          {shortHex(cliInspect.verification.anchor.contractAddress ?? "0x0033462bee153cb9DF12b5c447b9C282DbfbE877", 10, 6)} ↗
                        </a>
                      </span>
                      {cliInspect.chain && (
                        <>
                          <span>
                            ConsumerGateway:{" "}
                            <a
                              href={cliInspect.chain.contracts.consumerGateway.explorerUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-explorer-link"
                              aria-label="在区块浏览器打开 ConsumerGateway"
                            >
                              {shortHex(cliInspect.chain.contracts.consumerGateway.address, 10, 6)} ↗
                            </a>
                          </span>
                          <span>
                            AuditEscrow:{" "}
                            <a
                              href={cliInspect.chain.contracts.auditEscrow.explorerUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-explorer-link"
                              aria-label="在区块浏览器打开 AuditEscrow"
                            >
                              {shortHex(cliInspect.chain.contracts.auditEscrow.address, 10, 6)} ↗
                            </a>
                          </span>
                          {cliInspect.chain.verifiedTransactions.length === 0 && (
                            <span className="mode-badge">暂无已核验交易 receipt 可展示</span>
                          )}
                          {cliInspect.chain.verifiedTransactions.map((tx) => (
                            <span key={tx.txHash}>
                              ✓ {tx.event} (#{tx.blockNumber}):{" "}
                              <a href={tx.explorerUrl} target="_blank" rel="noreferrer" className="inline-explorer-link" aria-label={`查看交易 ${shortHex(tx.txHash)}`}>
                                {shortHex(tx.txHash, 10, 6)} ↗
                              </a>
                            </span>
                          ))}
                        </>
                      )}
                      <div className="cli-actions" style={{ marginTop: 6 }}>
                        <button
                          type="button"
                          aria-label="使用钱包签名锚定购买凭证"
                          disabled={!walletReady || txBusy}
                          onClick={() =>
                            executeOnChainAction({ action: "purchase", batchId }).catch(() => undefined)
                          }
                        >
                          钱包签名锚定购买
                        </button>
                        <button type="button" aria-label="打开钱包与主网中心" onClick={() => setWalletModalOpen(true)}>
                          打开钱包中心
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
              {(techSteps ?? []).map((s) => (
                <div className="tech-item" key={s.step}>
                  <span className="tech-index">{s.step}</span>
                  <div>
                    <b>{s.title}</b>
                    <span>{s.source}</span>
                    {s.hash ? <code>{s.hash}</code> : <span className="mode-badge">无 hash 字段</span>}
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
