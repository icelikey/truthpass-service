import type { ConsumerAgentStage } from "./ConsumerFlowBar";
import { useWallet } from "./WalletContext";

function jumpTo(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export function ConsumerActionDock({ stage, batchId }: { stage: ConsumerAgentStage; batchId: string | null }) {
  const { address, walletRole, setWalletModalOpen } = useWallet();
  const stateText = !batchId
    ? "先选一批商品，Agent 会帮你读资料"
    : stage === "evidence_review"
      ? "资料已展开，可以查看来源和缺口"
      : stage === "purchase_prepared" || stage === "wallet_pending"
        ? "购买准备已生成，下一步由你确认钱包"
        : stage === "receipt_verified"
          ? "交易记录已回读，可以继续售后"
          : "你正在查看一条商品资料链";

  return (
    <section className="consumer-action-dock" aria-label="当前任务和下一步">
      <div className="consumer-action-copy">
        <span className="eyebrow">当前任务</span>
        <strong>{batchId ? `批次 ${batchId}` : "还没有选择批次"}</strong>
        <small>{stateText}</small>
      </div>
      <div className="consumer-action-buttons">
        <button type="button" className="consumer-action-primary" onClick={() => jumpTo(batchId ? "evidence" : "agent")}>
          {batchId ? "查看当前依据" : "开始查询"} <span aria-hidden="true">→</span>
        </button>
        {batchId && <button type="button" className="consumer-action-secondary" onClick={() => jumpTo("agent")}>问 Agent</button>}
        {batchId && <button type="button" className="consumer-action-secondary" onClick={() => setWalletModalOpen(true)}>{address && walletRole ? "打开已绑定钱包" : "连接并绑定钱包"}</button>}
        {batchId && <button type="button" className="consumer-action-secondary" onClick={() => jumpTo("community")}>售后 / 反馈</button>}
      </div>
    </section>
  );
}
