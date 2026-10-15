export type ConsumerAgentStage = "idle" | "searching" | "batch_selected" | "evidence_review" | "purchase_prepared" | "wallet_pending" | "receipt_verified" | "after_sales" | "feedback_submitted";

const stages: Array<{ id: ConsumerAgentStage; label: string }> = [
  { id: "searching", label: "查询" },
  { id: "batch_selected", label: "批次" },
  { id: "evidence_review", label: "证据" },
  { id: "purchase_prepared", label: "购买准备" },
  { id: "after_sales", label: "售后" },
  { id: "feedback_submitted", label: "反馈" },
];

export function ConsumerFlowBar({ stage, batchId }: { stage: ConsumerAgentStage; batchId: string | null }) {
  const current = stages.findIndex((item) => item.id === stage);
  return (
    <section className="consumer-flow" aria-label="消费者 Agent 旅程">
      <div className="consumer-flow-head">
        <div><span className="eyebrow">CONSUMER AGENT JOURNEY</span><strong>消费者 Agent 旅程</strong></div>
        <span className="consumer-flow-data">{batchId ? `当前批次 ${batchId}` : "尚未选择批次"}</span>
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
