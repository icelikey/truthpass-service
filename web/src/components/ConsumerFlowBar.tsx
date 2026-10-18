export type ConsumerAgentStage = "idle" | "searching" | "batch_selected" | "evidence_review" | "purchase_prepared" | "wallet_pending" | "receipt_verified" | "after_sales" | "feedback_submitted";

const stages: Array<{ id: ConsumerAgentStage; label: string; includes: ConsumerAgentStage[] }> = [
  { id: "searching", label: "了解商品", includes: ["idle", "searching", "batch_selected"] },
  { id: "evidence_review", label: "查看依据", includes: ["evidence_review"] },
  { id: "purchase_prepared", label: "准备购买", includes: ["purchase_prepared", "wallet_pending", "receipt_verified"] },
  { id: "after_sales", label: "售后反馈", includes: ["after_sales", "feedback_submitted"] },
];

export function ConsumerFlowBar({ stage, batchId }: { stage: ConsumerAgentStage; batchId: string | null }) {
  const current = stages.findIndex((item) => item.includes.includes(stage));
  const nextCopy = !batchId
    ? "先选择一个批次"
    : stage === "evidence_review"
      ? "下一步：看来源和缺口"
      : stage === "purchase_prepared" || stage === "wallet_pending"
        ? "下一步：确认钱包操作"
        : stage === "receipt_verified"
          ? "下一步：继续售后或反馈"
          : "下一步：问 Agent 看依据";
  return (
    <section className="consumer-flow" aria-label="消费者 Agent 旅程">
      <div className="consumer-flow-head">
        <div><span className="eyebrow">你的商品了解过程</span><strong>消费者旅程</strong></div>
        <span className="consumer-flow-data">{batchId ? `正在了解 ${batchId}` : "还没有选择商品"} · {nextCopy}</span>
      </div>
      <ol>
        {stages.map((item, index) => (
          <li key={item.id} className={index <= current ? "active" : ""} aria-current={index === current ? "step" : undefined}>
            <span>{index + 1}</span><b>{item.label}</b>
          </li>
        ))}
      </ol>
    </section>
  );
}
