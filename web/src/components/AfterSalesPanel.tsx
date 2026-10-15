export function AfterSalesPanel({ onPrompt }: { onPrompt: (question: string) => void }) {
  const actions = [
    ["怎么保存？", "这个商品应该怎么保存？"],
    ["包装破损", "我的包装有破损，应该怎么处理？"],
    ["物流异常", "物流记录显示异常，我想申请人工处理。"],
    ["查询批次", "我想再次查询当前商品批次。"],
  ] as const;
  return (
    <section className="after-sales-panel" aria-labelledby="after-sales-title">
      <div><span className="eyebrow">AFTER-SALES AGENT</span><h2 id="after-sales-title">交付后的商品助理</h2><p>只引用商品说明、公开政策、批次证据和售后规则回答。</p></div>
      <div className="after-sales-actions">{actions.map(([label, prompt]) => <button key={label} type="button" onClick={() => onPrompt(prompt)}>{label} <span aria-hidden="true">→</span></button>)}</div>
      <small>不提供健康诊断、疗效判断或疾病建议。</small>
    </section>
  );
}
