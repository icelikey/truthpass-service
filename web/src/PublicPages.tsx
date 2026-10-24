import { useState, type FormEvent, type ReactNode } from "react";
import { DesignPreviewGallery } from "./components/DesignPreviewGallery";
import { RiceCasePage } from "./components/RiceCasePage";

type PublicRoute = "zh-home" | "zh-product" | "zh-developers" | "zh-institution" | "en-home" | "en-product" | "en-merchant" | "en-institution" | "en-developers";

const routeMap: Record<PublicRoute, { zh: boolean; home: string; product: string; developers: string; merchant: string; institution: string }> = {
  "zh-home": { zh: true, home: "/", product: "/product", developers: "/developers", merchant: "/merchant", institution: "/institution" },
  "zh-product": { zh: true, home: "/", product: "/product", developers: "/developers", merchant: "/merchant", institution: "/institution" },
  "zh-developers": { zh: true, home: "/", product: "/product", developers: "/developers", merchant: "/merchant", institution: "/institution" },
  "zh-institution": { zh: true, home: "/", product: "/product", developers: "/developers", merchant: "/merchant", institution: "/institution" },
  "en-home": { zh: false, home: "/en", product: "/en/product", developers: "/en/developers", merchant: "/en/merchant", institution: "/en/institution" },
  "en-product": { zh: false, home: "/en", product: "/en/product", developers: "/en/developers", merchant: "/en/merchant", institution: "/en/institution" },
  "en-merchant": { zh: false, home: "/en", product: "/en/product", developers: "/en/developers", merchant: "/en/merchant", institution: "/en/institution" },
  "en-institution": { zh: false, home: "/en", product: "/en/product", developers: "/en/developers", merchant: "/en/merchant", institution: "/en/institution" },
  "en-developers": { zh: false, home: "/en", product: "/en/product", developers: "/en/developers", merchant: "/en/merchant", institution: "/en/institution" },
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
function PublicHeader({ route, active }: { route: PublicRoute; active: "home" | "product" | "merchant" | "developers" }) {
  const links = routeMap[route];
  const zh = links.zh;
  return (
    <header className="tp-public-header">
      <Brand route={route} />
      <nav className="tp-public-nav" aria-label={zh ? "主导航" : "Primary navigation"}>
        <a className={active === "home" ? "active" : ""} href={links.home}>{zh ? "首页" : "Home"}</a>
        <a className={active === "product" ? "active" : ""} href={links.product}>{zh ? "产品介绍" : "What we build"}</a>
        <a href={zh ? "/?view=consumer#agent" : "/en?view=consumer#agent"}>{zh ? "商品查询" : "Products"}</a>
        <a href={zh ? "/sites/rice-demo" : "/en/sites/rice-demo"}>{zh ? "案例：大米" : "Case: rice"}</a>
        <a href={links.merchant} className={active === "merchant" ? "active" : ""}>{zh ? "解决方案" : "Solutions"}</a>
        <a className={route.includes("institution") ? "active" : ""} href={links.institution}>{zh ? "机构入口" : "Institutions"}</a>
        <a href={links.developers} className={active === "developers" ? "active" : ""}>{zh ? "开发者" : "Developers"}</a>
        <a href={links.home + "#about"}>{zh ? "关于我们" : "About"}</a>
      </nav>
      <div className="tp-header-actions">
        <span className="tp-search-mark" aria-hidden="true">⌕</span>
        <div className="tp-language-switch" aria-label={zh ? "语言" : "Language"}>
          <a className={zh ? "selected" : ""} href={active === "developers" ? "/developers" : active === "merchant" ? "/merchant" : active === "product" ? "/product" : route.includes("institution") ? "/institution" : "/"}>中文</a>
          <a className={!zh ? "selected" : ""} href={active === "developers" ? "/en/developers" : active === "merchant" ? "/en/merchant" : active === "product" ? "/en/product" : route.includes("institution") ? "/en/institution" : "/en"}>English</a>
        </div>
        <a className="tp-outline-btn" href={`${zh ? "/" : "/en"}?view=consumer&auth=1#agent`}>{zh ? "登录" : "Sign in"}</a>
      </div>
    </header>
  );
}

function PageFrame({ route, active, children, footer = true }: { route: PublicRoute; active: "home" | "product" | "merchant" | "developers"; children: ReactNode; footer?: boolean }) {
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
    capabilityTitle: "四种公开能力",
    capabilityBody: "先查清楚，再决定是否需要身份和签名。",
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
    capabilityTitle: "Four capabilities, one clear path",
    capabilityBody: "Inspect first. Ask for identity and a signature only when a write is needed.",
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

function CapabilityCard({ route, icon, title, body, action, href, protectedAction = false }: { route: PublicRoute; icon: string; title: string; body: string; action: string; href: string; protectedAction?: boolean }) {
  const zh = routeMap[route].zh;
  return (
    <article className="tp-capability-card">
      <span className="tp-capability-icon" aria-hidden="true">{icon}</span>
      <div>
        <h3>{title}</h3>
        <p>{body}</p>
        <span className={protectedAction ? "tp-capability-state protected" : "tp-capability-state"}>{protectedAction ? (zh ? "需要身份与签名" : "Identity + signature") : (zh ? "公开只读" : "Public read-only")}</span>
      </div>
      <a className="tp-text-link" href={href}>{action} →</a>
    </article>
  );
}

export function DeveloperPage({ route = "zh-developers" }: { route?: "zh-developers" | "en-developers" }) {
  const zh = routeMap[route].zh;
  const copy = zh ? developerCopy.zh : developerCopy.en;
  const [status, setStatus] = useState<"idle" | "checking" | "ready" | "error">("idle");
  const [statusText, setStatusText] = useState("");
  const capabilities = zh
    ? [
      { icon: "⌂", title: "查询商品", body: "按商品身份读取公开资料和来源。", action: "打开商品查询", href: "/?view=consumer#agent" },
      { icon: "▣", title: "查询批次", body: "查看生产、检测、运输和反馈是否对应。", action: "查询 FO-2026-001", href: "/?view=consumer&batch=FO-2026-001#agent" },
      { icon: "◇", title: "查询链状态", body: "区分历史回放、等待上链和真实回执。", action: "查看链状态", href: "/?view=consumer&batch=FO-2026-001#chain" },
      { icon: "⚿", title: "执行受保护操作", body: "需要企业或机构钱包确认，Agent 不代签。", action: "查看钱包规则", href: "/institution", protectedAction: true },
    ]
    : [
      { icon: "⌂", title: "Inspect a product", body: "Read public evidence by product identity.", action: "Open product query", href: "/en?view=consumer#agent" },
      { icon: "▣", title: "Inspect a batch", body: "Check production, testing, delivery, and feedback links.", action: "Inspect FO-2026-001", href: "/en?view=consumer&batch=FO-2026-001#agent" },
      { icon: "◇", title: "Check chain status", body: "Separate replay history, pending anchors, and real receipts.", action: "View chain status", href: "/en?view=consumer&batch=FO-2026-001#chain" },
      { icon: "⚿", title: "Run a protected action", body: "Enterprise or institution wallets must confirm. Agents never sign.", action: "See wallet rules", href: "/en/institution", protectedAction: true },
    ];

  const checkStatus = async () => {
    setStatus("checking");
    try {
      const response = await fetch("/api/agent/status", { headers: { Accept: "application/json" } });
      const data = await response.json() as { status?: string; agentMode?: string; dataMode?: string; model?: string };
      if (!response.ok || data.status !== "ready") throw new Error("unavailable");
      setStatus("ready");
      setStatusText(`${data.agentMode ?? "ready"} · ${data.model ?? data.dataMode ?? "demo/synthetic"}`);
    } catch {
      setStatus("error");
      setStatusText("");
    }
  };

  return <PageFrame route={route} active="developers"><main className="tp-developer-main">
    <section className="tp-developer-hero"><p className="tp-kicker">{copy.eyebrow}</p><h1>{copy.title}<span aria-hidden="true">{zh ? "。" : ""}</span></h1><p>{copy.intro}</p><div className="tp-hero-rule" /></section>
    <section className="tp-capability-section" aria-labelledby="capability-title"><div className="tp-section-head"><div><p className="tp-kicker" id="capability-title">{copy.capabilityTitle}</p><p className="tp-capability-intro">{copy.capabilityBody}</p></div><span>{zh ? "公开查 · 需要签名才写" : "Read open · sign to write"}</span></div><div className="tp-capability-grid">{capabilities.map((item) => <CapabilityCard key={item.title} route={route} {...item} />)}</div></section>
    <section className="tp-developer-grid" aria-label={zh ? "开发者工具" : "Developer tools"}><DeveloperCard route={route} kind="mcp" /><DeveloperCard route={route} kind="cli" /></section>
    <section className="tp-install-panel" aria-labelledby="install-title"><div><p className="tp-kicker" id="install-title">{copy.installTitle}</p><p>{copy.installBody}</p></div><div className="tp-install-panel-actions"><CopyButton value={copy.installCommand} label={copy.copyCommand} copiedLabel={copy.copiedCommand} /><a className="tp-text-link" href="/downloads/truthpass-cli.zip" download>{copy.install} ↓</a></div></section>
    <AgentRuntime copy={copy} />
    <section className="tp-agent-check"><div><p className="tp-kicker">{copy.checkTitle}</p><p>{copy.statusHint}</p></div><div className="tp-agent-check-action"><button type="button" className="tp-outline-btn tp-check-button" onClick={() => void checkStatus()} disabled={status === "checking"}>{status === "checking" ? copy.checking : copy.check}</button>{status === "ready" && <span className="tp-status-ok">● {copy.ready} · {statusText}</span>}{status === "error" && <span className="tp-status-error">● {copy.unavailable}</span>}</div></section>
    <section className="tp-developer-notes">{copy.note.map((note, index) => <article key={note}><span className="tp-note-icon" aria-hidden="true">{["▤", "♙", "♢"][index]}</span><div><strong>{note}</strong><p>{copy.noteBody[index]}</p></div></article>)}</section>
  </main></PageFrame>;
}

const platformBatchRoutes: Record<string, { zh: string; en: string }> = {
  "FO-2026-001": { zh: "/sites/fish-oil-demo/agent?batch=FO-2026-001", en: "/en/sites/fish-oil-demo/agent?batch=FO-2026-001" },
  "RC-2026-001": { zh: "/sites/rice-demo/agent?batch=RC-2026-001", en: "/en/sites/rice-demo/agent?batch=RC-2026-001" },
};

function PlatformBatchLookup({ zh }: { zh: boolean }) {
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const batch = query.trim().toUpperCase();
    const route = platformBatchRoutes[batch];
    if (!route) {
      setError(zh ? "没有找到这批记录，可以先看下面的演示案例" : "No record found. Start with one of the sample cases below.");
      return;
    }
    window.location.href = zh ? route.zh : route.en;
  };
  return (
    <form className="tp-platform-lookup" onSubmit={submit}>
      <label htmlFor={zh ? "platform-batch-zh" : "platform-batch-en"}>{zh ? "输入批次号，先看一份商品记录" : "Enter a batch ID and read the record first"}</label>
      <div className="tp-platform-lookup-row">
        <span className="tp-platform-search-icon" aria-hidden="true">⌕</span>
        <input
          id={zh ? "platform-batch-zh" : "platform-batch-en"}
          value={query}
          onChange={(event) => { setQuery(event.target.value.toUpperCase()); setError(""); }}
          placeholder={zh ? "例如 FO-2026-001 或 RC-2026-001" : "For example FO-2026-001 or RC-2026-001"}
          autoComplete="off"
        />
        <button className="tp-red-btn" type="submit">{zh ? "查看一份商品记录" : "View the product record"} <span aria-hidden="true">→</span></button>
      </div>
      <small className={error ? "has-error" : ""}>{error || (zh ? "先看清，再决定是否继续" : "Check the record before you decide")}</small>
    </form>
  );
}

function PlatformCaseCard({ image, eyebrow, title, batch, body, href, zh }: { image: string; eyebrow: string; title: string; batch: string; body: string; href: string; zh: boolean }) {
  return (
    <a className="tp-platform-case-card" href={href}>
      <div className="tp-platform-case-image" style={{ backgroundImage: `url(${image})` }} aria-hidden="true" />
      <div className="tp-platform-case-copy">
        <span className="tp-kicker">{eyebrow}</span>
        <h3>{title}<span aria-hidden="true"> ↗</span></h3>
        <code>{batch}</code>
        <p>{body}</p>
        <span className="tp-platform-case-action">{zh ? "查看一份商品记录" : "View the record"} →</span>
      </div>
    </a>
  );
}

function PlatformHome({ route }: { route: "zh-home" | "en-home" }) {
  const zh = route === "zh-home";
  return (
    <PageFrame route={route} active="home">
      <main className="tp-platform-home">
        <section className="tp-platform-hero">
          <div className="tp-platform-hero-copy">
            <p className="tp-kicker">{zh ? "商品记录和验证服务" : "PRODUCT RECORDS AND VERIFICATION"}</p>
            <span className="tp-demo-ribbon">{zh ? "演示资料 · 不能替代真实商品认证" : "DEMO / SYNTHETIC · NOT CERTIFICATION"}</span>
            <h1>{zh ? <>从生产到购买<br /><span>一条路看清</span></> : <>From production to purchase<br /><span>see the whole record</span></>}</h1>
            <p className="tp-platform-lead">{zh ? "把商品的来路 交到购买的人手里" : "Put the product record in the hands of the person who buys it"}</p>
            <p className="tp-platform-capability">{zh ? "建设信任能力" : "Build the trust capability"}</p>
            <PlatformBatchLookup zh={zh} />
            <div className="tp-platform-actions">
              <a className="tp-paper-btn" href={zh ? "/merchant" : "/en/merchant"}>{zh ? "为企业建设信任能力" : "Build trust capability for your business"} <span aria-hidden="true">→</span></a>
              <span>{zh ? "先看记录，再做决定" : "Read first, then decide"}</span>
            </div>
          </div>
          <div className="tp-platform-hero-visual" aria-label={zh ? "生产到购买的商品记录流程" : "Product record from production to purchase"}>
            <div className="tp-platform-production">
              <span>{zh ? "生产" : "PRODUCTION"}</span>
              <b>{zh ? "每一步都有记录" : "Every step is recorded"}</b>
            </div>
            <div className="tp-platform-product-still" />
            <div className="tp-platform-purchase">
              <span>{zh ? "购买" : "PURCHASE"}</span>
              <b>{zh ? "打开商品记录" : "Open the product record"}</b>
            </div>
          </div>
        </section>
        <section className="tp-platform-cases" id="cases" aria-labelledby="platform-cases-title">
          <div className="tp-platform-section-head"><div><p className="tp-kicker" id="platform-cases-title">{zh ? "先看一件商品" : "START WITH ONE PRODUCT"}</p><h2>{zh ? "生产、检测、运输和售后，按批次摆出来" : "Production, testing, delivery, and aftercare in one batch record"}</h2></div><span className="tp-demo-ribbon">{zh ? "公开演示" : "PUBLIC DEMO"}</span></div>
          <div className="tp-platform-case-grid">
            <PlatformCaseCard image="/assets/fish-oil-product.png" eyebrow={zh ? "鱼油案例" : "FISH OIL CASE"} title={zh ? "深海鱼油" : "Deep sea fish oil"} batch="FO-2026-001" body={zh ? "从原料到成品，查看一份鱼油的完整记录" : "Read the record from raw material to finished product"} href={zh ? "/sites/fish-oil-demo" : "/en/sites/fish-oil-demo"} zh={zh} />
            <PlatformCaseCard image="/design-reference/truthpass-ui-v4/01-platform-home.png" eyebrow={zh ? "大米案例" : "RICE CASE"} title={zh ? "北境稻作" : "Northern rice"} batch="RC-2026-001" body={zh ? "从种植到上架，查看一份大米的完整记录" : "Read the record from growing to delivery"} href={zh ? "/sites/rice-demo" : "/en/sites/rice-demo"} zh={zh} />
            <PlatformCaseCard image="/design-reference/truthpass-ui-v4/04-merchant-trust.png" eyebrow={zh ? "企业服务" : "FOR BUSINESS"} title={zh ? "建设信任能力" : "Build trust capability"} batch={zh ? "从一件商品开始" : "Start with one product"} body={zh ? "把生产、检测、运输和购买后的反馈连成一条路" : "Connect production, verification, delivery, and aftercare"} href={zh ? "/merchant" : "/en/merchant"} zh={zh} />
          </div>
        </section>
        <section className="tp-platform-flow" id="about" aria-labelledby="platform-flow-title">
          <div className="tp-platform-section-head"><div><p className="tp-kicker" id="platform-flow-title">{zh ? "这套服务怎么工作" : "HOW IT WORKS"}</p><h2>{zh ? "让生产和购买回到同一份记录" : "Bring production and purchase back to one record"}</h2></div></div>
          <div className="tp-platform-flow-track">
            {(zh ? [["01", "资料整理", "照片、视频、报告和口述资料"], ["02", "规则核对", "检查批次、时间、数量和来源"], ["03", "身份确认", "企业和机构钱包确认责任"], ["04", "购买后记录", "购买凭证、反馈和售后继续回到批次"]] : [["01", "Collect", "Photos, videos, reports, and spoken records"], ["02", "Check", "Batch, time, quantity, and source"], ["03", "Confirm", "Business and institution wallets confirm responsibility"], ["04", "Continue", "Purchase proof, feedback, and aftercare return to the batch"]]).map(([number, title, body]) => <article key={number}><span>{number}</span><strong>{title}</strong><p>{body}</p></article>)}
          </div>
        </section>
      </main>
    </PageFrame>
  );
}

function EnglishLandingPage() {
  return <PlatformHome route="en-home" />;
}

function ChineseLandingPage() {
  return <PlatformHome route="zh-home" />;
}

function EnglishMerchantPage() {
  const cards = [
    ["Production", "Recorded", "Supplier and batch origin"],
    ["Testing", "Awaiting confirmation", "Lab report and quality checks"],
    ["Cold chain", "Awaiting confirmation", "Temperature and handoff record"],
    ["Shipment", "Recorded", "Traceable dispatch and receipt"],
    ["Purchase", "Pending", "Customer proof is created at checkout"],
    ["Aftercare", "Awaiting confirmation", "Service, returns, and feedback"],
    ["Review", "Open", "A responsible institution can confirm or challenge"],
  ];
  return <PageFrame route="en-merchant" active="merchant"><main className="tp-merchant-main">
    <section className="tp-merchant-hero"><div><p className="tp-kicker">FOR BUSINESS · PRODUCT RECORDS</p><span className="tp-demo-ribbon">DEMO / SYNTHETIC · NOT CERTIFICATION</span><h1>One product.<br /><span>A complete record.</span></h1><p>Speak, scan, or upload. Your agent turns the material into a batch record you can review before anyone signs.</p><div className="tp-merchant-hero-actions"><a className="tp-red-btn" href="/en/merchant">Open merchant workspace&nbsp; →</a><a className="tp-paper-btn" href="/en?view=consumer&batch=FO-2026-001#agent">View the sample record</a></div></div><aside className="tp-merchant-promise"><span>WHO OWNS THE NEXT STEP?</span><strong>Every gap<br />has an owner.</strong><small>Agent organizes the record. Your team and the assigned institution confirm it.</small></aside></section>
    <section className="tp-merchant-lifecycle"><div className="tp-section-head"><div><p className="tp-kicker">LIFECYCLE · FO-2026-001</p><h2>Make the evidence legible.</h2><p className="tp-section-intro">One timeline from production to review. Missing items stay visible until someone handles them.</p></div><span>DEMO / SYNTHETIC</span></div><div className="tp-lifecycle-track">{cards.map(([title, status, detail], index) => <article key={title} className={status === "Recorded" ? "recorded" : status === "Open" ? "review" : "awaiting"}><span className="tp-lifecycle-node">{index + 1}</span><strong>{title}</strong><b>{status}</b><small>{detail}</small></article>)}</div></section>
    <section className="tp-merchant-summary"><article><span>Current product</span><h2>Deep Sea Fish Oil</h2><p>Production and shipment records are present. Testing and cold-chain evidence still need confirmation.</p></article><article><span>Evidence completeness</span><strong>78%</strong><p>2 open gaps are assigned to the next responsible party.</p></article><article><span>Agent report</span><strong>Review first</strong><p>Ask the institution to confirm the testing report before publishing a final claim.</p></article></section>
    <section className="tp-merchant-next"><div><p className="tp-kicker">NEXT STEP</p><h2>Start with one batch.</h2><p>Connect the business wallet only when you are ready to confirm a record. Read-only preparation stays available without a wallet.</p></div><a className="tp-red-btn" href="/en/merchant">Continue in workspace →</a></section>
  </main></PageFrame>;
}

type ProductIntroRoute = "zh-product" | "en-product";

function ProductIntroPage({ route }: { route: ProductIntroRoute }) {
  const zh = route === "zh-product";
  const flow = zh
    ? [
        ["01", "把资料放进来", "生产记录、检测报告、运输数据和购买后的反馈，都绑定到同一个批次。"],
        ["02", "让 Agent 查清楚", "Agent 读取当前批次，展示引用资料，并把缺口和冲突说出来。"],
        ["03", "让责任人确认", "Verifier 做规则核验，JEV 决定补证或复核；企业和机构钱包确认写入。"],
        ["04", "让购买继续留下记录", "消费者查询、钱包签名、receipt 和售后反馈，继续回到同一个商品记录。"],
      ]
    : [
        ["01", "Bring the record in", "Production, testing, delivery, and post-purchase feedback stay bound to one batch."],
        ["02", "Let the Agent inspect", "The Agent reads the current batch, cites its sources, and states gaps and conflicts."],
        ["03", "Put responsibility in the open", "Verifier runs rules, JEV routes the next step, and business or institution wallets confirm writes."],
        ["04", "Keep the purchase connected", "Consumer queries, wallet signatures, receipts, and aftercare return to the same product record."],
      ];
  const values = zh
    ? [["消费者", "先看清，再决定", "不再只看一句营销文案，而是看生产、检测、运输和当前缺口。"], ["企业", "把信任做成能力", "把资料、责任和反馈放在一个持续更新的商品官网里。"], ["机构", "每次确认都有边界", "样品、报告、钱包身份和争议记录可以按批次回看。"], ["开发者", "同一份公开记录", "网站、MCP 和 CLI 都读取同一套批次上下文。"]]
    : [["Consumers", "Check before deciding", "Read production, testing, delivery, and current gaps instead of relying on a single claim."], ["Businesses", "Build trust capability", "Turn records, responsibility, and feedback into a living product site."], ["Institutions", "Confirm within a clear boundary", "Review samples, reports, wallet identity, and disputes by batch."], ["Developers", "One public record", "The site, MCP, and CLI read the same batch context."]];
  return (
    <PageFrame route={route} active="product">
      <main className="tp-product-page">
        <section className="tp-product-hero">
          <div className="tp-product-hero-copy">
            <p className="tp-kicker">{zh ? "产品介绍 · TRUTHPASS" : "PRODUCT · TRUTHPASS"}</p>
            <span className="tp-demo-ribbon">{zh ? "演示资料 · 不能替代真实商品认证" : "DEMO / SYNTHETIC · NOT CERTIFICATION"}</span>
            <h1>{zh ? <>把一件商品的来路<br /><span>交到购买的人手里</span></> : <>Put the product record<br /><span>in the buyer’s hands</span></>}</h1>
            <p className="tp-product-hero-lead">{zh ? "TruthPass 为企业建设商品官网、Agent 和验证能力，让生产、购买与反馈回到同一条记录。" : "TruthPass builds the product site, Agent, and verification layer that connect production, purchase, and feedback."}</p>
            <div className="tp-product-hero-actions">
              <a className="tp-red-btn" href={zh ? "/sites/fish-oil-demo?batch=FO-2026-001" : "/en/sites/fish-oil-demo?batch=FO-2026-001"}>{zh ? "打开鱼油案例" : "Open the fish-oil case"} →</a>
              <a className="tp-paper-btn" href={zh ? "/merchant" : "/en/merchant"}>{zh ? "为企业建设信任能力" : "Build this for a business"} →</a>
            </div>
            <p className="tp-product-hero-note">{zh ? "你可以先只读查看；涉及身份、写入或购买时，才由外部钱包确认。" : "Read-only inspection is open. Identity, writes, and purchases require an external wallet confirmation."}</p>
          </div>
          <div className="tp-product-hero-board" aria-label={zh ? "TruthPass 商品记录示意" : "TruthPass product record overview"}>
            <div className="tp-product-board-head"><span>FO-2026-001</span><b>{zh ? "当前批次" : "CURRENT BATCH"}</b></div>
            <div className="tp-product-board-product"><img src="/assets/fish-oil-product.png" alt={zh ? "深海鱼油演示商品" : "Deep sea fish oil demo product"} /><div><span>{zh ? "深海鱼油" : "Deep sea fish oil"}</span><strong>{zh ? "生产 → 检测 → 冷链 → 购买" : "Production → Testing → Delivery → Purchase"}</strong><small>DEMO / SYNTHETIC</small></div></div>
            <div className="tp-product-board-rows"><div><span>{zh ? "证据记录" : "Evidence records"}</span><b>5</b></div><div><span>{zh ? "规则核验" : "Rule check"}</span><b>{zh ? "复核" : "Review"}</b></div><div><span>{zh ? "链状态" : "Chain state"}</span><b>anchor_pending</b></div></div>
            <div className="tp-product-board-agent"><span className="tp-product-board-dot" /><div><b>{zh ? "Agent 正在查当前批次" : "Agent is inspecting this batch"}</b><small>{zh ? "引用证据 → Verifier → JEV → 解释" : "Citations → Verifier → JEV → explanation"}</small></div></div>
          </div>
        </section>

        <section className="tp-product-section tp-product-flow" aria-labelledby="product-flow-title">
          <div className="tp-product-section-head"><div><p className="tp-kicker">{zh ? "实际怎么运作" : "HOW IT WORKS"}</p><h2 id="product-flow-title">{zh ? "从一份资料，到一次可核验的购买" : "From one record to a verifiable purchase"}</h2></div><span>{zh ? "一个批次 · 一条上下文" : "ONE BATCH · ONE CONTEXT"}</span></div>
          <div className="tp-product-flow-grid">{flow.map(([number, title, body]) => <article key={number}><span>{number}</span><h3>{title}</h3><p>{body}</p></article>)}</div>
        </section>

        <section className="tp-product-section tp-product-live" aria-labelledby="product-live-title">
          <div className="tp-product-section-head"><div><p className="tp-kicker">{zh ? "你在页面上会看到什么" : "WHAT YOU CAN SEE"}</p><h2 id="product-live-title">{zh ? "Agent 不是黑箱，它把查的过程放出来" : "The Agent is not a black box"}</h2></div><a className="tp-text-link" href={zh ? "/sites/fish-oil-demo/agent?batch=FO-2026-001" : "/en/sites/fish-oil-demo/agent?batch=FO-2026-001"}>{zh ? "打开 Agent 现场 →" : "Open the Agent trace →"}</a></div>
          <div className="tp-product-live-grid"><div className="tp-product-trace"><div><span className="tp-trace-live" />{zh ? "运行现场" : "LIVE TRACE"}<code>trace_fo_2026_001</code></div>{(zh ? [["读取当前批次", "5 条当前批次证据"], ["Verifier 完成核验", "规则结果：review"], ["JEV 完成分流", "下一步：补齐当前缺口"], ["回答已生成", "模型只解释已有结果"]] : [["Read this batch", "5 evidence records in this batch"], ["Verifier checked rules", "Result: review"], ["JEV routed next step", "Next: fill the current gaps"], ["Answer generated", "The model explains existing results"]]).map(([label, detail], index) => <div className="tp-product-trace-row" key={label}><b>{String(index + 1).padStart(2, "0")}</b><span><strong>{label}</strong><small>{detail}</small></span><i>✓</i></div>)}</div><div className="tp-product-proof-card"><span className="tp-kicker">{zh ? "回答依据" : "ANSWER BASIS"}</span><h3>{zh ? "每个结论都回到来源" : "Every conclusion returns to a source"}</h3><ul>{(zh ? ["批次：FO-2026-001", "证据：生产、检测、冷链", "数据模式：demo/synthetic", "链状态：没有当前交易 receipt"] : ["Batch: FO-2026-001", "Evidence: production, testing, delivery", "Data mode: demo/synthetic", "Chain: no current transaction receipt"]).map((item) => <li key={item}>{item}</li>)}</ul><a className="tp-paper-btn" href={zh ? "/sites/fish-oil-demo/agent?batch=FO-2026-001" : "/en/sites/fish-oil-demo/agent?batch=FO-2026-001"}>{zh ? "看完整回答依据" : "See the full answer basis"} →</a></div></div>
        </section>

        <section className="tp-product-section tp-product-cases" aria-labelledby="product-cases-title">
          <div className="tp-product-section-head"><div><p className="tp-kicker">{zh ? "已经做出的案例" : "CASES WE HAVE BUILT"}</p><h2 id="product-cases-title">{zh ? "不是一张宣传图，是可以走进去的商品站点" : "Not a poster. A product site you can walk through."}</h2></div></div>
          <div className="tp-product-case-grid"><a className="tp-product-case" href={zh ? "/sites/fish-oil-demo?batch=FO-2026-001" : "/en/sites/fish-oil-demo?batch=FO-2026-001"}><img src="/assets/fish-oil-product.png" alt="" /><div><span className="tp-kicker">{zh ? "鱼油案例" : "FISH OIL"}</span><h3>{zh ? "深海鱼油 · FO-2026-001" : "Deep sea fish oil · FO-2026-001"}</h3><p>{zh ? "从生产记录进入 Agent，再进入钱包、购买和反馈。" : "From the production record to Agent, wallet, purchase, and feedback."}</p><strong>{zh ? "打开商品站点 →" : "Open product site →"}</strong></div></a><a className="tp-product-case" href={zh ? "/sites/rice-demo?batch=RC-2026-001" : "/en/sites/rice-demo?batch=RC-2026-001"}><img src="/design-reference/truthpass-ui-v4/01-platform-home.png" alt="" /><div><span className="tp-kicker">{zh ? "大米案例" : "RICE"}</span><h3>{zh ? "北境稻作 · RC-2026-001" : "Northern rice · RC-2026-001"}</h3><p>{zh ? "产地、天气、土壤、检测和运输按同一个批次串起来。" : "Origin, weather, soil, testing, and delivery in one batch context."}</p><strong>{zh ? "打开商品站点 →" : "Open product site →"}</strong></div></a></div>
        </section>

        <section className="tp-product-section tp-product-values" aria-labelledby="product-values-title"><div className="tp-product-section-head"><div><p className="tp-kicker">{zh ? "价值怎么传递" : "WHY IT MATTERS"}</p><h2 id="product-values-title">{zh ? "减少信息差，把反馈送回生产" : "Reduce the information gap. Return feedback to production."}</h2></div></div><div className="tp-product-value-grid">{values.map(([title, headline, body]) => <article key={title}><span>{title}</span><h3>{headline}</h3><p>{body}</p></article>)}</div></section>

        <section className="tp-product-boundary"><div><p className="tp-kicker">{zh ? "边界清楚，才能持续使用" : "CLEAR BOUNDARIES"}</p><h2>{zh ? "链上证明记录，不替商品做质量承诺" : "The chain proves a record, not a product promise."}</h2><p>{zh ? "区块链保存摘要、签名、事件和 receipt；Verifier 判断规则，JEV 负责分流，Agent 只解释已登记资料。当前案例为演示资料，真实认证仍需要真实生产方、检测机构和有效链上回执。" : "The chain stores hashes, signatures, events, and receipts. Verifier checks rules, JEV routes the next step, and the Agent explains registered material. These cases are demos; real certification still requires real producers, institutions, and valid receipts."}</p></div><div className="tp-product-boundary-actions"><a className="tp-red-btn" href={zh ? "/sites/fish-oil-demo/agent?batch=FO-2026-001" : "/en/sites/fish-oil-demo/agent?batch=FO-2026-001"}>{zh ? "现在查看一次查询" : "Run one inspection"} →</a><a className="tp-paper-btn" href={zh ? "/developers" : "/en/developers"}>{zh ? "给自己的 Agent 接入" : "Connect your own Agent"} →</a></div></section>
      </main>
    </PageFrame>
  );
}

export function PublicPageRouter({ pathname }: { pathname: string }) {
  if (pathname === "/design-preview") return <DesignPreviewGallery />;
  if (pathname === "/cases/rice") return <RiceCasePage locale="zh" />;
  if (pathname === "/en/cases/rice") return <RiceCasePage locale="en" />;
  if (pathname === "/product") return <ProductIntroPage route="zh-product" />;
  if (pathname === "/en/product") return <ProductIntroPage route="en-product" />;
  if (pathname === "/") return <ChineseLandingPage />;
  if (pathname === "/developers") return <DeveloperPage />;
  if (pathname === "/en/developers") return <DeveloperPage route="en-developers" />;
  if (pathname === "/en/merchant") return <EnglishMerchantPage />;
  if (pathname === "/en") return <EnglishLandingPage />;
  return null;
}
