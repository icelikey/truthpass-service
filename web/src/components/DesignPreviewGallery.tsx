const SCREENS = [
  ["01-consumer-home.png", "消费者首页", "/?view=consumer"],
  ["02-consumer-agent-evidence.png", "Agent 与证据卡", "/?view=consumer&batch=FO-2026-001#agent"],
  ["03-wallet-identity.png", "钱包身份", "/?view=consumer&batch=FO-2026-001#wallet"],
  ["04-merchant-lifecycle.png", "企业生命周期", "/merchant"],
  ["05-institution-review.png", "机构审核", "/institution"],
  ["06-developer-mcp-cli.png", "MCP 与 CLI", "/developers"],
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
            <img src={`/design-reference/truthpass-ui-v2/${file}`} alt={`${title}预览图`} />
            <div><span>{String(index + 1).padStart(2, "0")}</span><strong>{title}</strong><small>打开真实页面 →</small></div>
          </a>
        ))}
      </section>
    </main>
  );
}
