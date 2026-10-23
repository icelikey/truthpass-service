export type ConsumerAgentStage = "idle" | "searching" | "batch_selected" | "evidence_review" | "purchase_prepared" | "wallet_pending" | "receipt_verified" | "after_sales" | "feedback_submitted";

const stages: Array<{ id: ConsumerAgentStage; zh: string; en: string; includes: ConsumerAgentStage[] }> = [
  { id: "searching", zh: "了解商品", en: "Understand the product", includes: ["idle", "searching", "batch_selected"] },
  { id: "evidence_review", zh: "查看依据", en: "Review evidence", includes: ["evidence_review"] },
  { id: "purchase_prepared", zh: "准备购买", en: "Prepare purchase", includes: ["purchase_prepared", "wallet_pending", "receipt_verified"] },
  { id: "after_sales", zh: "售后反馈", en: "After-sales feedback", includes: ["after_sales", "feedback_submitted"] },
];

export function ConsumerFlowBar({ stage, batchId, locale = "zh" }: { stage: ConsumerAgentStage; batchId: string | null; locale?: "zh" | "en" }) {
  const zh = locale === "zh";
  const current = stages.findIndex((item) => item.includes.includes(stage));
  const nextCopy = !batchId
    ? (zh ? "先选择一个批次" : "Choose a batch first")
    : stage === "evidence_review"
      ? (zh ? "下一步：看来源和缺口" : "Next: review sources and gaps")
      : stage === "purchase_prepared" || stage === "wallet_pending"
        ? (zh ? "下一步：确认钱包操作" : "Next: confirm the wallet action")
        : stage === "receipt_verified"
          ? (zh ? "下一步：继续售后或反馈" : "Next: continue to after-sales or feedback")
          : (zh ? "下一步：问 Agent 看依据" : "Next: ask the Agent for the record");
  return (
    <section className="consumer-flow" aria-label={zh ? "消费者 Agent 旅程" : "Consumer Agent journey"}>
      <div className="consumer-flow-head">
        <div><span className="eyebrow">{zh ? "你的商品了解过程" : "YOUR PRODUCT JOURNEY"}</span><strong>{zh ? "消费者旅程" : "Consumer journey"}</strong></div>
        <span className="consumer-flow-data">{batchId ? (zh ? `正在了解 ${batchId}` : `Inspecting ${batchId}`) : (zh ? "还没有选择商品" : "No batch selected")} · {nextCopy}</span>
      </div>
      <ol>
        {stages.map((item, index) => (
          <li key={item.id} className={index <= current ? "active" : ""} aria-current={index === current ? "step" : undefined}>
            <span>{index + 1}</span><b>{zh ? item.zh : item.en}</b>
          </li>
        ))}
      </ol>
    </section>
  );
}
