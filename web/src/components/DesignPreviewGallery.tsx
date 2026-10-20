const SCREENS = [
  ["01-platform-home.png", "平台首页", "/"],
  ["02-fish-oil-agent.png", "鱼油 Agent 与证据卡", "/sites/fish-oil-demo/agent?batch=FO-2026-001"],
  ["03-wallet-purchase.png", "钱包与购买", "/sites/fish-oil-demo/wallet?batch=FO-2026-001"],
  ["04-merchant-trust.png", "企业信任工作台", "/sites/fish-oil-demo/merchant?batch=FO-2026-001"],
  ["05-institution-review.png", "机构审核", "/sites/fish-oil-demo/institution?batch=FO-2026-001"],
  ["06-developer-access.png", "MCP 与 CLI", "/sites/fish-oil-demo/developers"],
] as const;

export function DesignPreviewGallery() {
  return (
    <main className="tp-design-gallery">
      <header>
        <span className="tp-kicker">INTERNAL DESIGN REVIEW</span>
        <h1>6 张预览图，6 个真实入口</h1>
        <p>预览图只作视觉基准；点击卡片进入实际页面和交互流程。</p>
      </header>
      <section className="tp-design-gallery-grid" aria-label="预览图与真实页面映射">
        {SCREENS.map(([file, title, href], index) => (
          <a className="tp-design-gallery-card" href={href} key={file}>
            <img src={`/design-reference/truthpass-ui-v4/${file}`} alt={`${title}预览图`} />
            <div><span>{String(index + 1).padStart(2, "0")}</span><strong>{title}</strong><small>打开真实页面 →</small></div>
          </a>
        ))}
      </section>
    </main>
  );
}
