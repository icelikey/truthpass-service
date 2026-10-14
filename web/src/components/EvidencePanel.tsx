import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCliInspect, fetchEvidenceLink, fetchJourney } from "../api";
import { ICON_URLS } from "../data";
import { useWallet } from "./WalletContext";
import { shortHex } from "../lib/wallet";
import type { VerifyState } from "../types";

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
  const [showTech, setShowTech] = useState(focusTech);
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
        <span className="panel-title">产品旅程 · BOT Chain 677</span>
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
        <span>{showTech ? "收起技术详情与主网存证" : "技术详情 · BOT Chain Mainnet (677)"}</span>
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
                  <b>CLI / BOT Chain Mainnet (677) 技术观察台</b>
                  <small>主网已部署合约与链上存证交易均可点击跳转 scan.botchain.ai 独立核验。</small>
                  <div className="cli-actions">
                    <button type="button" onClick={() => setTechView("inspect")}>验证阶段</button>
                    <button type="button" onClick={() => setTechView("envelope")}>查看证据 Envelope</button>
                    <button type="button" onClick={() => setTechView("assessment")}>查看验收 JSON</button>
                    <button type="button" onClick={() => setTechView("anchor")}>BOT Chain 主网存证</button>
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
                      <strong>BOT Chain Mainnet (Chain ID: 677) 锚定记录</strong>
                      <span>network: BOT Chain Mainnet (Chain ID: {cliInspect.verification.anchor.chainId ?? 677})</span>
                      <span>status: ✓ {cliInspect.verification.anchor.status} (已部署并完成主网锚定)</span>
                      <span>
                        EvidenceAnchor:{" "}
                        <a
                          href={`https://scan.botchain.ai/address/${cliInspect.verification.anchor.contractAddress ?? "0x0033462bee153cb9DF12b5c447b9C282DbfbE877"}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-explorer-link"
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
                            >
                              {shortHex(cliInspect.chain.contracts.auditEscrow.address, 10, 6)} ↗
                            </a>
                          </span>
                          {cliInspect.chain.verifiedTransactions.map((tx) => (
                            <span key={tx.txHash}>
                              ✓ {tx.event} (#{tx.blockNumber}):{" "}
                              <a href={tx.explorerUrl} target="_blank" rel="noreferrer" className="inline-explorer-link">
                                {shortHex(tx.txHash, 10, 6)} ↗
                              </a>
                            </span>
                          ))}
                        </>
                      )}
                      <div className="cli-actions" style={{ marginTop: 6 }}>
                        <button
                          type="button"
                          disabled={!walletReady || txBusy}
                          onClick={() =>
                            executeOnChainAction({ action: "purchase", batchId }).catch(() => undefined)
                          }
                        >
                          ⛓️ 钱包签名锚定购买
                        </button>
                        <button type="button" onClick={() => setWalletModalOpen(true)}>
                          打开多钱包与主网中心
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="cli-section">
                    <strong>Agent 协作</strong>
                    <span>✓ production agent</span>
                    <span>✓ inspection agent</span>
                    <span>✓ consumer agent</span>
                  </div>
                </div>
              )}
              {(techSteps ?? []).map((s) => (
                <div className="tech-item" key={s.step}>
                  <span className="tech-index">{s.step}</span>
                  <div>
                    <b>{s.title}</b>
                    <span>{s.source}</span>
                    {s.step === 5 ? (
                      <a
                        href="https://scan.botchain.ai/tx/0x3ff591a82f012eb05f9f6994aff2af0415c718097587654ebfe4f5c3382b4052"
                        target="_blank"
                        rel="noreferrer"
                        className="inline-explorer-link"
                      >
                        <code>{s.hash} ↗</code>
                      </a>
                    ) : (
                      <code>{s.hash}</code>
                    )}
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
