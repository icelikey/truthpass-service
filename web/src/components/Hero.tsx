export function Hero() {
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section id="hero" className="hero">
      <p className="eyebrow" style={{ marginBottom: 10 }}>WHITE-LABEL EVIDENCE · AGENT CS</p>
      <h1>为白牌品牌提供批次证据、Agent 客服与售后基础设施</h1>
      <p className="hero-sub">
        TruthPass 把生产、检测、物流到购买和售后，统一成可复核的批次证据层。
        Agent 负责解释来源与不确定项，不代替质量判定。
      </p>
      <div className="hero-pills" aria-label="产品能力">
        <span className="hero-pill">批次证据可复核</span>
        <span className="hero-pill">Agent 客服可溯源回答</span>
        <span className="hero-pill">售后与购买准备接口</span>
      </div>
      <div className="hero-actions">
        <button
          type="button"
          className="hero-cta primary"
          aria-label="查看 CLI 参考实现中的批次证据"
          onClick={() => scrollTo("cli-reference")}
        >
          查看批次证据
        </button>
        <button
          type="button"
          className="hero-cta secondary"
          aria-label="体验 Agent 客服对话"
          onClick={() => scrollTo("agent")}
        >
          体验 Agent 客服
        </button>
      </div>
      <p className="hero-note">
        当前页面中的鱼油批次仅为 <span className="mode-badge">demo / synthetic</span> 演示数据，
        不代表真实商品认证或已完成主网交易。
      </p>
    </section>
  );
}
