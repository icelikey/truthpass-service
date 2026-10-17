import { useState, type ReactNode } from "react";

type PublicRoute = "zh-home" | "zh-developers" | "en-home" | "en-merchant" | "en-developers";

const routeMap: Record<PublicRoute, { zh: boolean; home: string; developers: string; merchant: string }> = {
  "zh-home": { zh: true, home: "/", developers: "/developers", merchant: "/merchant" },
  "zh-developers": { zh: true, home: "/", developers: "/developers", merchant: "/merchant" },
  "en-home": { zh: false, home: "/en", developers: "/en/developers", merchant: "/en/merchant" },
  "en-merchant": { zh: false, home: "/en", developers: "/en/developers", merchant: "/en/merchant" },
  "en-developers": { zh: false, home: "/en", developers: "/en/developers", merchant: "/en/merchant" },
};

function Brand({ route, compact = false }: { route: PublicRoute; compact?: boolean }) {
  const links = routeMap[route];
  const zh = links.zh;
  return (
    <a href={links.home} className={`tp-brand${compact ? " tp-brand-compact" : ""}`} aria-label="TruthPass">
      <span className="tp-brand-word">TruthPass</span>
      <img src="/assets/brand-mark.svg" alt="" aria-hidden="true" />
    </a>
  );
}
function PublicHeader({ route, active }: { route: PublicRoute; active: "home" | "merchant" | "developers" }) {
  const links = routeMap[route];
  const zh = links.zh;
  return (
    <header className="tp-public-header">
      <Brand route={route} />
      <nav className="tp-public-nav" aria-label={zh ? "主导航" : "Primary navigation"}>
        <a className={active === "home" ? "active" : ""} href={links.home}>{zh ? "首页" : "Home"}</a>
        <a href={links.home + "#evidence"}>{zh ? "商品查询" : "Products"}</a>
        <a href={links.merchant} className={active === "merchant" ? "active" : ""}>{zh ? "解决方案" : "Solutions"}</a>
        <a href={links.developers} className={active === "developers" ? "active" : ""}>{zh ? "开发者" : "Developers"}</a>
        <a href={links.home + "#about"}>{zh ? "关于我们" : "About"}</a>
      </nav>
      <div className="tp-header-actions">
        <span className="tp-search-mark" aria-hidden="true">⌕</span>
        <div className="tp-language-switch" aria-label={zh ? "语言" : "Language"}>
          <a className={zh ? "selected" : ""} href={active === "developers" ? "/developers" : active === "merchant" ? "/merchant" : "/"}>中文</a>
          <a className={!zh ? "selected" : ""} href={active === "developers" ? "/en/developers" : active === "merchant" ? "/en/merchant" : "/en"}>English</a>
        </div>
        <a className="tp-outline-btn" href={zh ? "/" : "/en"}>{zh ? "登录" : "Sign in"}</a>
      </div>
    </header>
  );
}

function PageFrame({ route, active, children, footer = true }: { route: PublicRoute; active: "home" | "merchant" | "developers"; children: ReactNode; footer?: boolean }) {
  const zh = routeMap[route].zh;
  return (
    <div className={`tp-public-page ${zh ? "tp-lang-zh" : "tp-lang-en"}`}>
      <div className="tp-ink-sky" aria-hidden="true" />
      <PublicHeader route={route} active={active} />
      {children}
      {footer && <footer className="tp-public-footer">
        <Brand route={route} compact />
        <span>{zh ? "公开透明的商品依据，让信任看得见。" : "Open evidence for a more trustworthy market."}</span>
        <span className="tp-footer-meta">© 2026 TruthPass · {zh ? "公开资料服务" : "Open evidence service"}</span>
      </footer>}
    </div>
  );
}

const developerCopy = {
  zh: {
    eyebrow: "开发者入口 · OPEN EVIDENCE",
    title: "让 Agent 直接读懂商品依据",
    intro: "同一份公开资料，可通过 MCP 或 CLI 使用。",
    mcpTitle: "MCP Server",
    mcpBody: "让你的 Agent 安全、稳定地访问 TruthPass 的公开资料。",
    cliTitle: "TruthPass CLI",
    cliBody: "在你的开发环境中，快速接入 TruthPass。",
    endpoint: "MCP 端点地址",
    copy: "复制连接地址",
    docs: "查看 CLI 文档",
    open: "开放能力",
    use: "只读公开资料，让 Agent 基于真实数据做出更好的判断。",
    steps: ["发现能力", "查询批次", "获得下一步"],
    stepsBody: ["让 Agent 了解可用的查询能力", "获取公开的商品依据", "基于结果继续分析与行动"],
    note: ["只读查询公开资料", "需要身份的操作必须签名", "不会把私钥交给 TruthPass"],
    noteBody: ["对所有人开放，支持 AI 与开发者获取可信信息。", "涉及写入或敏感操作时，必须经过身份验证与签名。", "你的私钥始终由自己保管，我们从不接触。"],
  },
  en: {
    eyebrow: "DEVELOPER ACCESS · OPEN EVIDENCE",
    title: "Let agents read product evidence directly.",
    intro: "One public record, available through MCP or the CLI.",
    mcpTitle: "MCP Server",
    mcpBody: "Give your agent a safe, stable way to read TruthPass public evidence.",
    cliTitle: "TruthPass CLI",
    cliBody: "Connect TruthPass to your own development environment in minutes.",
    endpoint: "MCP endpoint",
    copy: "Copy endpoint",
    docs: "View CLI docs",
    open: "OPEN CAPABILITY",
    use: "Read-only evidence helps agents make decisions grounded in real records.",
    steps: ["Discover", "Inspect a batch", "Take the next step"],
    stepsBody: ["Learn which public queries are available", "Read the product record and evidence", "Continue analysis with an explicit result"],
    note: ["Read public evidence", "Sign identity-bound actions", "Keep your private key"],
    noteBody: ["Open to everyone, for agents and builders who need reliable context.", "Writes and sensitive actions require identity verification and a signature.", "Your private key stays with you. TruthPass never touches it."],
  },
};

function DeveloperCard({ route, kind }: { route: PublicRoute; kind: "mcp" | "cli" }) {
  const zh = routeMap[route].zh;
  const copy = zh ? developerCopy.zh : developerCopy.en;
  const [copied, setCopied] = useState(false);
  const endpoint = "https://truthpass-service.vercel.app/mcp";
  const copyEndpoint = async () => {
    try {
      await navigator.clipboard?.writeText(endpoint);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  if (kind === "mcp") {
    return (
      <article className="tp-dev-card tp-dev-card-mcp">
        <div className="tp-dev-card-head">
          <span className="tp-dev-icon tp-dev-icon-mcp" aria-hidden="true">⌘</span>
          <div><h2>{copy.mcpTitle}</h2><p>{copy.mcpBody}</p></div>
          <span className="tp-side-seal">{copy.open}<br />{zh ? "服务真实" : "REAL RECORDS"}</span>
        </div>
        <div className="tp-dev-steps">
          {copy.steps.map((step, index) => <div key={step} className="tp-dev-step"><b>{index + 1}</b><strong>{step}</strong><small>{copy.stepsBody[index]}</small></div>)}
        </div>
        <div className="tp-endpoint-row"><span><small>{copy.endpoint}</small><code>{endpoint}</code></span><button type="button" onClick={copyEndpoint} aria-label={copy.copy}>{copied ? (zh ? "已复制" : "Copied") : "⧉"}</button></div>
        <button className="tp-red-btn" type="button" onClick={copyEndpoint}>{copied ? (zh ? "已复制连接地址" : "Endpoint copied") : `${copy.copy}  →`}</button>
        <small className="tp-card-note">{copy.use}</small>
      </article>
    );
  }
  return (
    <article id="cli" className="tp-dev-card tp-dev-card-cli">
      <div className="tp-dev-card-head"><span className="tp-dev-icon tp-dev-icon-cli" aria-hidden="true">›_</span><div><h2>{copy.cliTitle}</h2><p>{copy.cliBody}</p></div><span className="tp-side-seal">{zh ? "一行命令" : "ONE COMMAND"}<br />{zh ? "连接真实" : "CONNECT REAL"}</span></div>
      <pre className="tp-terminal" aria-label="TruthPass CLI example"><code><span># {zh ? "查询某个批次的公开资料" : "Inspect a public batch record"}</span>{"\n"}<em>$ truthpass inspect --remote https://truthpass-service.vercel.app</em>{"\n  --batch FO-2026-001"}{"\n\n"}<span># {zh ? "在你的应用中进行协作分析" : "Collaborate from your app"}</span>{"\n"}<em>$ truthpass collaborate --remote https://truthpass-service.vercel.app</em>{"\n  --tenant demo"}</code></pre>
      <a className="tp-red-btn tp-btn-link" href={`${routeMap[route].developers}#cli`}>{copy.docs}  →</a>
      <small className="tp-card-note">{zh ? "安装简单，面向开发者设计，帮助你在自己的工具与工作流中使用 TruthPass。" : "A small, explicit interface for bringing TruthPass into your own tools and workflows."}</small>
    </article>
  );
}

export function DeveloperPage({ route = "zh-developers" }: { route?: "zh-developers" | "en-developers" }) {
  const zh = routeMap[route].zh;
  const copy = zh ? developerCopy.zh : developerCopy.en;
  return <PageFrame route={route} active="developers"><main className="tp-developer-main">
    <section className="tp-developer-hero"><p className="tp-kicker">{copy.eyebrow}</p><h1>{copy.title}<span aria-hidden="true">{zh ? "。" : ""}</span></h1><p>{copy.intro}</p><div className="tp-hero-rule" /></section>
    <section className="tp-developer-grid" aria-label={zh ? "开发者工具" : "Developer tools"}><DeveloperCard route={route} kind="mcp" /><DeveloperCard route={route} kind="cli" /></section>
    <section className="tp-developer-notes">{copy.note.map((note, index) => <article key={note}><span className="tp-note-icon" aria-hidden="true">{["▤", "♙", "♢"][index]}</span><div><strong>{note}</strong><p>{copy.noteBody[index]}</p></div></article>)}</section>
  </main></PageFrame>;
}

function EnglishLandingPage() {
  return <PageFrame route="en-home" active="home"><main className="tp-landing-main">
    <section className="tp-landing-hero"><div><p className="tp-kicker">OPEN EVIDENCE · TRUSTPASS</p><h1>Evidence you can see.<br /><span>Choices you can make.</span></h1><p className="tp-landing-lead">Production, testing, delivery — clearly recorded for people and agents.</p><div className="tp-landing-actions"><a className="tp-red-btn" href="/en#evidence">I’m a consumer&nbsp; →</a><a className="tp-paper-btn" href="/en/merchant">I’m a business&nbsp; ↗</a></div></div><aside className="tp-landing-seal"><span>FROM EVERY ACTION</span><b>TO A MORE VALUABLE TOMORROW</b></aside></section>
    <section id="evidence" className="tp-landing-panels"><article><span className="tp-panel-symbol">◈</span><h2>Evidence from production to aftercare.</h2><p>Understand a product record before you choose, buy, or ask what happens next.</p><a href="/#cli-reference">Explore a sample record →</a></article><article><span className="tp-panel-symbol">⌘</span><h2>Built for people and agents.</h2><p>Use a clear public record in the consumer console, your workflow, or an MCP client.</p><a href="/en/developers">Open developer access →</a></article><article><span className="tp-panel-symbol">◉</span><h2>One product. A complete record.</h2><p>From production to testing, delivery, and aftercare, each step stays visible.</p><a href="/en/merchant">For business →</a></article></section>
    <section id="about" className="tp-landing-strip"><span>01</span><b>EXPLORE</b><small>Search products. See the bigger picture.</small><span>02</span><b>CHOOSE</b><small>Check the evidence. Make an informed decision.</small><span>03</span><b>PARTICIPATE</b><small>Keep the record useful after purchase.</small></section>
  </main></PageFrame>;
}

function ChineseLandingPage() {
  return <PageFrame route="zh-home" active="home"><main className="tp-landing-main">
    <section className="tp-landing-hero"><div><p className="tp-kicker">公开证据 · TRUTHPASS</p><h1>看得见依据。<br /><span>做得出选择。</span></h1><p className="tp-landing-lead">生产、检测、运输，一件件说清楚。</p><div className="tp-landing-actions"><a className="tp-red-btn" href="/?view=consumer#agent">我是消费者&nbsp; →</a><a className="tp-paper-btn" href="/merchant">我是企业&nbsp; ↗</a></div></div><aside className="tp-landing-seal"><span>从每一条记录</span><b>到更值得信任的市场</b></aside></section>
    <section id="evidence" className="tp-landing-panels"><article><span className="tp-panel-symbol">◈</span><h2>从生产到售后，依据一直在。</h2><p>先看清楚，再决定要不要继续了解、购买和反馈。</p><a href="/?view=consumer#cli-reference">看一份演示资料 →</a></article><article><span className="tp-panel-symbol">⌘</span><h2>给人看，也给 Agent 用。</h2><p>同一份公开资料，可以在消费者页面、企业流程或 MCP 中使用。</p><a href="/developers">进入开发者入口 →</a></article><article><span className="tp-panel-symbol">◉</span><h2>一件商品，一条完整记录。</h2><p>生产、检测、运输和售后，每一步都有来源，每一步都能继续追问。</p><a href="/merchant">查看企业入口 →</a></article></section>
    <section id="about" className="tp-landing-strip"><span>01</span><b>看依据</b><small>查询商品，先把事实看清楚。</small><span>02</span><b>做选择</b><small>查看缺口，再决定下一步。</small><span>03</span><b>留记录</b><small>购买之后，继续反馈和复核。</small></section>
  </main></PageFrame>;
}

function EnglishMerchantPage() {
  const cards = [
    ["Production", "Recorded", "Supplier and batch origin"],
    ["Testing", "Awaiting confirmation", "Lab report and quality checks"],
    ["Delivery", "Recorded", "Traceable handoff"],
    ["Aftercare", "Awaiting confirmation", "Service and feedback"],
  ];
  return <PageFrame route="en-merchant" active="merchant"><main className="tp-merchant-main"><section className="tp-merchant-hero"><div><p className="tp-kicker">FOR BUSINESS · PRODUCT RECORDS</p><h1>One product.<br /><span>A complete record.</span></h1><p>From production to aftercare, keep each handoff visible and useful.</p></div><a className="tp-red-btn" href="/merchant">Open merchant workspace&nbsp; →</a></section><section className="tp-merchant-lifecycle"><div className="tp-section-head"><div><p className="tp-kicker">LIFECYCLE</p><h2>Make the evidence legible.</h2></div><span>FO-2026-001 · DEMO</span></div><div className="tp-lifecycle-track">{cards.map(([title, status, detail], index) => <article key={title} className={status === "Recorded" ? "recorded" : "awaiting"}><span className="tp-lifecycle-node">{index + 1}</span><strong>{title}</strong><b>{status}</b><small>{detail}</small></article>)}</div></section><section className="tp-merchant-summary"><article><span>Current product</span><h2>Oat Cereal (Original)</h2><p>Production, testing, delivery — clearly recorded.</p></article><article><span>Evidence completeness</span><strong>78%</strong><p>2 items still need confirmation.</p></article><article><span>Next action</span><strong>Review testing report</strong><p>Give the record a clear, dated update.</p></article></section></main></PageFrame>;
}

export function PublicPageRouter({ pathname }: { pathname: string }) {
  if (pathname === "/") return <ChineseLandingPage />;
  if (pathname === "/developers") return <DeveloperPage />;
  if (pathname === "/en/developers") return <DeveloperPage route="en-developers" />;
  if (pathname === "/en/merchant") return <EnglishMerchantPage />;
  if (pathname === "/en") return <EnglishLandingPage />;
  return null;
}
