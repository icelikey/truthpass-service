export function Hero() {
  const scrollTo = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <section id="hero" className="hero">
      <p className="eyebrow" style={{ marginBottom: 10 }}>商品依据公开服务</p>
      <h1>让每一件白牌商品，都有一份看得懂的依据</h1>
      <p className="hero-sub">
        TruthPass 帮助企业把生产、检测、运输和售后信息放在一起，
        让消费者看得懂，也让企业知道下一步该补什么。
      </p>
      <div className="hero-pills" aria-label="产品能力">
        <span className="hero-pill">看生产和检测记录</span>
        <span className="hero-pill">让 Agent 帮你解释</span>
        <span className="hero-pill">从了解走到售后</span>
      </div>
      <div className="hero-actions">
        <button
          type="button"
          className="hero-cta primary"
          aria-label="开始查询批次"
          onClick={() => scrollTo("agent")}
        >
          我是消费者 · 开始查询 <span aria-hidden="true">→</span>
        </button>
        <a
          className="hero-cta secondary"
          aria-label="打开企业工作台"
          href="/merchant"
        >
          我是企业或审核机构 <span aria-hidden="true">↗</span>
        </a>
        <button
          type="button"
          className="hero-cta text-link"
          aria-label="查看证据演示"
          onClick={() => scrollTo("cli-reference")}
        >
          先看看一份商品资料 <span aria-hidden="true">↓</span>
        </button>
      </div>
      <div className="hero-proof-row">
        <span className="demo-badge">DEMO / SYNTHETIC</span>
        <span>当前演示：白牌鱼油批次</span>
        <span>你可以查询、理解并决定下一步</span>
      </div>
      <p className="hero-note">
        当前展示的是演示资料，不能替代真实商品认证；Agent 会明确告诉你已知、未知和下一步。
      </p>
    </section>
  );
}
