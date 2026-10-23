import { useState } from "react";
import type { ConsumerAgentStage } from "./ConsumerFlowBar";
import { useWallet } from "./WalletContext";

function jumpTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function ConsumerActionDock({ stage, batchId, locale = "zh" }: { stage: ConsumerAgentStage; batchId: string | null; locale?: "zh" | "en" }) {
  const en = locale === "en";
  const { address, walletRole, setWalletModalOpen } = useWallet();
  const [moreOpen, setMoreOpen] = useState(false);
  const stateText = !batchId
    ? (en ? "Choose a batch and the Agent will read the record" : "先选一批商品，Agent 会帮你读资料")
    : stage === "evidence_review"
      ? (en ? "The record is open; review sources and gaps" : "资料已展开，可以查看来源和缺口")
      : stage === "purchase_prepared" || stage === "wallet_pending"
        ? (en ? "Checkout is prepared; confirm the wallet action next" : "购买准备已生成，下一步由你确认钱包")
        : stage === "receipt_verified"
          ? (en ? "The receipt was read back; you can continue to after-sales" : "交易记录已回读，可以继续售后")
          : (en ? "You are following one product record" : "你正在查看一条商品资料链");

  return (
    <section className="consumer-action-dock" aria-label={en ? "Current task and next step" : "当前任务和下一步"}>
      <div className="consumer-action-copy">
        <span className="eyebrow">{en ? "CURRENT TASK" : "当前任务"}</span>
        <strong>{batchId ? (en ? `Batch ${batchId}` : `批次 ${batchId}`) : (en ? "No batch selected" : "还没有选择批次")}</strong>
        <small>{stateText}</small>
      </div>
      <div className="consumer-action-buttons">
        <button type="button" className="consumer-action-primary" onClick={() => jumpTo(batchId ? "evidence" : "agent")}>
          {batchId ? (en ? "Review this record" : "查看当前依据") : (en ? "Start inspection" : "开始查询")} <span aria-hidden="true">→</span>
        </button>
        {batchId && <button type="button" className="consumer-action-secondary" onClick={() => setMoreOpen((open) => !open)} aria-expanded={moreOpen} aria-controls="consumer-action-more">{en ? "More actions" : "更多操作"} <span aria-hidden="true">{moreOpen ? "↑" : "↓"}</span></button>}
      </div>
      {batchId && moreOpen && <div className="consumer-action-more" id="consumer-action-more">
        <button type="button" className="consumer-action-secondary" onClick={() => jumpTo("agent")}>{en ? "Ask the Agent" : "问 Agent"}</button>
        <button type="button" className="consumer-action-secondary" onClick={() => setWalletModalOpen(true)}>{address && walletRole ? (en ? "Open bound wallet" : "打开已绑定钱包") : (en ? "Connect and bind wallet" : "连接并绑定钱包")}</button>
        <button type="button" className="consumer-action-secondary" onClick={() => jumpTo("community")}>{en ? "After-sales / feedback" : "售后 / 反馈"}</button>
      </div>}
    </section>
  );
}
