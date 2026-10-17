export type ConsumerAgentStage = "idle" | "searching" | "batch_selected" | "evidence_review" | "purchase_prepared" | "wallet_pending" | "receipt_verified" | "after_sales" | "feedback_submitted";

const stages: Array<{ id: ConsumerAgentStage; label: string; includes: ConsumerAgentStage[] }> = [
  { id: "searching", label: "了解商品", includes: ["idle", "searching", "batch_selected"] },
  { id: "evidence_review", label: "查看依据", includes: ["evidence_review"] },
  { id: "purchase_prepared", label: "准备购买", includes: ["purchase_prepared", "wallet_pending", "receipt_verified"] },
  { id: "after_sales", label: "售后反馈", includes: ["after_sales", "feedback_submitted"] },
];

export function ConsumerFlowBar({ stage, batchId }: { stage: ConsumerAgentStage; batchId: string | null }) {
  const current = stages.findIndex((item) => item.includes.includes(stage));
  return (
    <section className="consumer-flow" aria-label="消费者 Agent 旅程">
      <div className="consumer-flow-head">
        <div><span className="eyebrow">你的商品了解过程</span><strong>消费者旅程</strong></div>
        <span className="consumer-flow-data">{batchId ? `正在了解 ${batchId}` : "还没有选择商品"}</span>
      </div>
      <ol>
        {stages.map((item, index) => (
          <li key={item.id} className={index <= current ? "active" : ""}>
            <span>{index + 1}</span><b>{item.label}</b>
          </li>
        ))}
      </ol>
    </section>
  );
}
