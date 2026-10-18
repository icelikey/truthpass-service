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
        <a href={zh ? "/institution" : "/en/institution"}>{zh ? "机构入口" : "Institutions"}</a>
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
    title: "让 Agent 看得懂，也查得到",
    intro: "同一份公开资料，可以查批次，也可以查链上状态。",
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
    installTitle: "先装上，再开始查询",
    installBody: "没有开发环境也没关系。复制一行命令，或下载 CLI 压缩包。",
    installCommand: "npm install -g truthpass",
    runCommand: "npx truthpass inspect --remote https://truthpass-service.vercel.app --batch FO-2026-001",
    install: "下载 CLI 安装包",
    source: "查看源代码",
    copyCommand: "复制命令",
    copiedCommand: "已复制命令",
    mcpConfig: "复制 MCP 配置",
    runtimeTitle: "Agent 在哪里运行？",
    runtimeBody: "TruthPass 不替你保管一个黑箱 Agent。你可以直接用网站里的 Agent，也可以让自己的 Agent 读取同一份公开资料。",
    runtimeSteps: ["网站里的 Agent", "你的 Agent", "企业 Agent"],
    runtimeStepBody: ["帮你理解商品、批次和下一步。", "通过 MCP 或 CLI 读取公开证据，再由你自己的模型决定如何使用。", "在获得企业授权后提交资料、生成汇报，写入和交易仍需对应钱包确认。"],
    checkTitle: "检查服务是否在线",
    check: "检查连接",
    checking: "正在检查…",
    ready: "已连接",
    unavailable: "暂时无法连接",
    statusHint: "公开查询无需 Token；受保护操作会要求企业身份。",
  },
  en: {
    eyebrow: "DEVELOPER ACCESS · OPEN EVIDENCE",
    title: "Let agents read the record and check the chain.",
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
    installTitle: "Install first. Then inspect.",
    installBody: "Copy one command or download the CLI package and run it locally.",
    installCommand: "npm install -g truthpass",
    runCommand: "npx truthpass inspect --remote https://truthpass-service.vercel.app --batch FO-2026-001",
    install: "Download CLI package",
    source: "View source",
    copyCommand: "Copy command",
    copiedCommand: "Command copied",
    mcpConfig: "Copy MCP config",
    runtimeTitle: "Where does the agent run?",
    runtimeBody: "TruthPass does not keep a hidden agent on your behalf. Use the agent on this site, or let your own agent read the same public record.",
    runtimeSteps: ["The site agent", "Your agent", "An enterprise agent"],
    runtimeStepBody: ["Explains products, batches, and the next step.", "Reads public evidence through MCP or the CLI; your model decides how to use it.", "Submits evidence and drafts reports after enterprise authorization. Writes and trades still need the right wallet."],
    checkTitle: "Check the live service",
    check: "Check connection",
    checking: "Checking…",
    ready: "Connected",
    unavailable: "Unavailable",
    statusHint: "Public inspection is open. Protected actions require an enterprise identity.",
  },
};

type DeveloperCopy = (typeof developerCopy)["zh"];

function CopyButton({ value, label, copiedLabel }: { value: string; label: string; copiedLabel: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard?.writeText(value);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };
  return <button type="button" className="tp-copy-btn" onClick={copy}>{copied ? copiedLabel : label}</button>;
}

function AgentRuntime({ copy }: { copy: DeveloperCopy }) {
  return <section className="tp-agent-runtime" aria-labelledby="agent-runtime-title">
    <div className="tp-runtime-heading"><p className="tp-kicker">{copy.runtimeTitle}</p><p>{copy.runtimeBody}</p></div>
    <div className="tp-runtime-grid">{copy.runtimeSteps.map((step, index) => <article key={step}>
      <span>{String(index + 1).padStart(2, "0")}</span><div><strong>{step}</strong><p>{copy.runtimeStepBody[index]}</p></div>
    </article>)}</div>
  </section>;
}

function DeveloperCard({ route, kind }: { route: PublicRoute; kind: "mcp" | "cli" }) {
  const zh = routeMap[route].zh;
  const copy = zh ? developerCopy.zh : developerCopy.en;
  const [copied, setCopied] = useState(false);
  const endpoint = "https://truthpass-service.vercel.app/mcp";
  const mcpConfig = JSON.stringify({ mcpServers: { truthpass: { url: endpoint } } }, null, 2);
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
        <div className="tp-dev-inline-actions"><CopyButton value={mcpConfig} label={copy.mcpConfig} copiedLabel={zh ? "已复制配置" : "Config copied"} /><a className="tp-text-link" href={endpoint} target="_blank" rel="noreferrer">{zh ? "打开 MCP 入口" : "Open MCP endpoint"} ↗</a></div>
        <small className="tp-card-note">{copy.use}</small>
      </article>
    );
  }
  return (
    <article id="cli" className="tp-dev-card tp-dev-card-cli">
      <div className="tp-dev-card-head"><span className="tp-dev-icon tp-dev-icon-cli" aria-hidden="true">›_</span><div><h2>{copy.cliTitle}</h2><p>{copy.cliBody}</p></div><span className="tp-side-seal">{zh ? "一行命令" : "ONE COMMAND"}<br />{zh ? "连接真实" : "CONNECT REAL"}</span></div>
      <pre className="tp-terminal" aria-label="TruthPass CLI example"><code><span># {zh ? "查询某个批次的公开资料" : "Inspect a public batch record"}</span>{"\n"}<em>$ truthpass inspect --remote https://truthpass-service.vercel.app</em>{"\n  --batch FO-2026-001"}{"\n\n"}<span># {zh ? "在你的应用中进行协作分析" : "Collaborate from your app"}</span>{"\n"}<em>$ truthpass collaborate --remote https://truthpass-service.vercel.app</em>{"\n  --tenant demo"}</code></pre>
      <div className="tp-install-command"><code>{copy.installCommand}</code><CopyButton value={copy.installCommand} label={copy.copyCommand} copiedLabel={copy.copiedCommand} /></div>
      <div className="tp-dev-inline-actions"><a className="tp-red-btn tp-btn-link" href="/downloads/truthpass-cli.zip" download>{copy.install} ↓</a><a className="tp-paper-btn tp-btn-link" href="https://github.com/icelikey/truthpass-service" target="_blank" rel="noreferrer">{copy.source} ↗</a></div>
      <div className="tp-install-command tp-install-command-secondary"><code>{copy.runCommand}</code><CopyButton value={copy.runCommand} label={copy.copyCommand} copiedLabel={copy.copiedCommand} /></div>
      <a className="tp-text-link" href={`${routeMap[route].developers}#cli`}>{copy.docs}  →</a>
      <small className="tp-card-note">{zh ? "安装简单，面向开发者设计，帮助你在自己的工具与工作流中使用 TruthPass。" : "A small, explicit interface for bringing TruthPass into your own tools and workflows."}</small>
    </article>
  );
}

export function DeveloperPage({ route = "zh-developers" }: { route?: "zh-developers" | "en-developers" }) {
  const zh = routeMap[route].zh;
  const copy = zh ? developerCopy.zh : developerCopy.en;
  const [status, setStatus] = useState<"idle" | "checking" | "ready" | "error">("idle");
  const [statusText, setStatusText] = useState("");
  const checkStatus = async () => {
    setStatus("checking");
    try {
      const response = await fetch("/api/agent/status", { headers: { Accept: "application/json" } });
      const data = await response.json() as { status?: string; agentMode?: string; dataMode?: string };
      if (!response.ok || data.status !== "ready") throw new Error("unavailable");
      setStatus("ready");
      setStatusText(`${data.agentMode ?? "ready"} · ${data.dataMode ?? "demo/synthetic"}`);
    } catch {
      setStatus("error");
      setStatusText("");
    }
  };
  return <PageFrame route={route} active="developers"><main className="tp-developer-main">
    <section className="tp-developer-hero"><p className="tp-kicker">{copy.eyebrow}</p><h1>{copy.title}<span aria-hidden="true">{zh ? "。" : ""}</span></h1><p>{copy.intro}</p><div className="tp-hero-rule" /></section>
    <section className="tp-developer-grid" aria-label={zh ? "开发者工具" : "Developer tools"}><DeveloperCard route={route} kind="mcp" /><DeveloperCard route={route} kind="cli" /></section>
    <section className="tp-install-panel" aria-labelledby="install-title"><div><p className="tp-kicker" id="install-title">{copy.installTitle}</p><p>{copy.installBody}</p></div><div className="tp-install-panel-actions"><CopyButton value={copy.installCommand} label={copy.copyCommand} copiedLabel={copy.copiedCommand} /><a className="tp-text-link" href="/downloads/truthpass-cli.zip" download>{copy.install} ↓</a></div></section>
    <AgentRuntime copy={copy} />
    <section className="tp-agent-check"><div><p className="tp-kicker">{copy.checkTitle}</p><p>{copy.statusHint}</p></div><div className="tp-agent-check-action"><button type="button" className="tp-outline-btn tp-check-button" onClick={() => void checkStatus()} disabled={status === "checking"}>{status === "checking" ? copy.checking : copy.check}</button>{status === "ready" && <span className="tp-status-ok">● {copy.ready} · {statusText}</span>}{status === "error" && <span className="tp-status-error">● {copy.unavailable}</span>}</div></section>
    <section className="tp-developer-notes">{copy.note.map((note, index) => <article key={note}><span className="tp-note-icon" aria-hidden="true">{["▤", "♙", "♢"][index]}</span><div><strong>{note}</strong><p>{copy.noteBody[index]}</p></div></article>)}</section>
  </main></PageFrame>;
}

function EnglishLandingPage() {
  return <PageFrame route="en-home" active="home"><main className="tp-landing-main">
    <section className="tp-landing-hero"><div><p className="tp-kicker">OPEN EVIDENCE · TRUSTPASS</p><span className="tp-demo-ribbon">DEMO / SYNTHETIC · NOT CERTIFICATION</span><h1>Check first.<br /><span>Buy next.</span></h1><p className="tp-landing-lead">Production, testing, delivery — show the record.</p><div className="tp-landing-actions"><a className="tp-red-btn" href="/en#evidence">View the record&nbsp; →</a><a className="tp-paper-btn" href="/en/merchant">For business&nbsp; ↗</a></div></div><aside className="tp-landing-seal"><span>SHOW THE RECORD</span><b>MAKE THE CHOICE</b></aside></section>
    <section id="evidence" className="tp-landing-panels"><article><span className="tp-panel-symbol">◈</span><h2>Show the record.</h2><p>Production, testing, delivery — each step has a source.</p><a href="/en#cli-reference">View a sample record →</a></article><article><span className="tp-panel-symbol">⌘</span><h2>Ask once. Get the evidence.</h2><p>Your agent can read the same public record through MCP or CLI.</p><a href="/en/developers">Open developer access →</a></article><article><span className="tp-panel-symbol">◉</span><h2>Make one product explainable.</h2><p>Keep the record clear from production to aftercare.</p><a href="/en/merchant">For business →</a></article></section>
    <section id="about" className="tp-landing-strip"><span>01</span><b>CHECK</b><small>See the record.</small><span>02</span><b>CHOOSE</b><small>Make the call.</small><span>03</span><b>CONTINUE</b><small>Keep help after purchase.</small></section>
  </main></PageFrame>;
}

function ChineseLandingPage() {
  return <PageFrame route="zh-home" active="home"><main className="tp-landing-main">
    <section className="tp-landing-hero"><div><p className="tp-kicker">公开证据 · TRUTHPASS</p><span className="tp-demo-ribbon">演示资料 · 不能替代真实商品认证</span><h1>先看清。<br /><span>再下单。</span></h1><p className="tp-landing-lead">生产、检测、运输，一件件摆出来。</p><div className="tp-landing-actions"><a className="tp-red-btn" href="/?view=consumer#agent">查看依据&nbsp; →</a><a className="tp-paper-btn" href="/merchant">我是企业&nbsp; ↗</a></div></div><aside className="tp-landing-seal"><span>有凭有据</span><b>大家看得见</b></aside></section>
    <section id="evidence" className="tp-landing-panels"><article><span className="tp-panel-symbol">◈</span><h2>有凭有据，大家看得见。</h2><p>生产、检测、运输，一件件摆出来。</p><a href="/?view=consumer#cli-reference">看一份演示资料 →</a></article><article><span className="tp-panel-symbol">⌘</span><h2>你问什么，我查什么。</h2><p>同一份公开资料，人和 Agent 都能看。</p><a href="/developers">进入开发者入口 →</a></article><article><span className="tp-panel-symbol">◉</span><h2>把一件商品，说清楚。</h2><p>每一步有来源，每个缺口有人处理。</p><a href="/merchant">查看企业入口 →</a></article></section>
    <section id="about" className="tp-landing-strip"><span>01</span><b>看依据</b><small>先把事实看清楚。</small><span>02</span><b>做选择</b><small>缺什么，明白补上。</small><span>03</span><b>留记录</b><small>买完还有事，照样找得到人。</small></section>
  </main></PageFrame>;
}

function EnglishMerchantPage() {
  const cards = [
    ["Production", "Recorded", "Supplier and batch origin"],
    ["Testing", "Awaiting confirmation", "Lab report and quality checks"],
    ["Delivery", "Recorded", "Traceable handoff"],
    ["Aftercare", "Awaiting confirmation", "Service and feedback"],
  ];
  return <PageFrame route="en-merchant" active="merchant"><main className="tp-merchant-main"><section className="tp-merchant-hero"><div><p className="tp-kicker">FOR BUSINESS · PRODUCT RECORDS</p><span className="tp-demo-ribbon">DEMO / SYNTHETIC · NOT CERTIFICATION</span><h1>One product.<br /><span>A complete record.</span></h1><p>From production to aftercare, keep each handoff visible and useful.</p></div><a className="tp-red-btn" href="/merchant">Open merchant workspace&nbsp; →</a></section><section className="tp-merchant-lifecycle"><div className="tp-section-head"><div><p className="tp-kicker">LIFECYCLE</p><h2>Make the evidence legible.</h2></div><span>FO-2026-001 · DEMO</span></div><div className="tp-lifecycle-track">{cards.map(([title, status, detail], index) => <article key={title} className={status === "Recorded" ? "recorded" : "awaiting"}><span className="tp-lifecycle-node">{index + 1}</span><strong>{title}</strong><b>{status}</b><small>{detail}</small></article>)}</div></section><section className="tp-merchant-summary"><article><span>Current product</span><h2>Deep Sea Fish Oil</h2><p>Production, testing, delivery — clearly recorded.</p></article><article><span>Evidence completeness</span><strong>78%</strong><p>2 items still need confirmation.</p></article><article><span>Next action</span><strong>Review testing report</strong><p>Give the record a clear, dated update.</p></article></section></main></PageFrame>;
}

export function PublicPageRouter({ pathname }: { pathname: string }) {
  if (pathname === "/") return <ChineseLandingPage />;
  if (pathname === "/developers") return <DeveloperPage />;
  if (pathname === "/en/developers") return <DeveloperPage route="en-developers" />;
  if (pathname === "/en/merchant") return <EnglishMerchantPage />;
  if (pathname === "/en") return <EnglishLandingPage />;
  return null;
}
