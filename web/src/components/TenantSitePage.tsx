import { useEffect, useState } from "react";
import { ChatPanel } from "./ChatPanel";
import { EvidencePanel } from "./EvidencePanel";
import { ProductPanel } from "./ProductPanel";
import { MerchantApp } from "./MerchantApp";
import { InstitutionReviewPanel } from "./InstitutionReviewPanel";
import { useWallet, WALLET_ROLE_LABELS, type WalletRole } from "./WalletContext";
import type { VerifyState } from "../types";
import type { ConsumerAgentStage } from "./ConsumerFlowBar";
import type { TenantSiteConfig } from "../siteConfig";

type TenantView = "home" | "agent" | "wallet" | "merchant" | "institution" | "developers" | "preview";

const routeFor = (site: TenantSiteConfig, view: TenantView, locale: "zh" | "en") => {
  const base = locale === "en" ? `/en/sites/${site.slug}` : `/sites/${site.slug}`;
  return view === "home" ? base : `${base}/${view}`;
};

function scopedBatch(site: TenantSiteConfig, candidate: string | null | undefined): string {
  const fallback = site.batch.defaultBatchId;
  const value = candidate?.trim().toUpperCase();
  if (!value) return fallback;
  // A tenant can have multiple batches, but a batch prefix is scoped to the
  // product in the site configuration. This prevents a fish-oil batch from
  // being silently displayed on the rice site (and vice versa).
  const prefix = fallback.split("-")[0];
  return value.startsWith(`${prefix}-`) ? value : fallback;
}

function currentBatch(site: TenantSiteConfig): string {
  if (typeof window === "undefined") return site.batch.defaultBatchId;
  return scopedBatch(site, new URLSearchParams(window.location.search).get("batch"));
}

function localizedSiteRoute(site: TenantSiteConfig, view: TenantView, locale: "zh" | "en", batchId?: string): string {
  const route = routeFor(site, view, locale);
  return batchId ? `${route}?batch=${encodeURIComponent(batchId)}` : route;
}

function SiteHeader({ site, view, locale }: { site: TenantSiteConfig; view: TenantView; locale: "zh" | "en" }) {
  const zh = locale === "zh";
  const batchId = currentBatch(site);
  const labels: Array<[TenantView, string, string]> = [
    ["home", zh ? "首页" : "Home", localizedSiteRoute(site, "home", locale, batchId)],
    ["agent", zh ? "商品助手" : "Agent", localizedSiteRoute(site, "agent", locale, batchId)],
    ["wallet", zh ? "钱包身份" : "Wallet", localizedSiteRoute(site, "wallet", locale, batchId)],
    ["merchant", zh ? "企业工作台" : "Merchant", localizedSiteRoute(site, "merchant", locale, batchId)],
    ["institution", zh ? "机构审核" : "Institution", localizedSiteRoute(site, "institution", locale, batchId)],
    ["developers", zh ? "开发者" : "Developers", routeFor(site, "developers", locale)],
  ];
  const alternateLocale = zh ? "en" : "zh";
  const localeHref = localizedSiteRoute(site, view, alternateLocale, view === "developers" ? undefined : batchId);
  return (
    <header className="tenant-site-header">
      <a className="tp-brand" href={routeFor(site, "home", locale)} aria-label={`${site.brand.name} TruthPass`}>
        <span className="tp-brand-word">TruthPass</span><span className="tenant-site-mark">{site.brand.mark}</span>
      </a>
      <div className="tenant-site-context"><strong>{site.brand.name}</strong><span>{site.product.name}</span></div>
      <nav aria-label={zh ? "企业站点导航" : "Site navigation"}>
        {labels.map(([key, label, href]) => <a key={key} className={view === key ? "active" : ""} href={href}>{label}</a>)}
      </nav>
      {site.locale.supported.includes(alternateLocale) && <a className="tenant-language-link" href={localeHref}>{zh ? "EN" : "中文"}</a>}
      <a className="tenant-back-link" href={zh ? "/" : "/en"}>{zh ? "回到 TruthPass" : "Back to TruthPass"}</a>
    </header>
  );
}

function SiteStateBar({ site, locale, view }: { site: TenantSiteConfig; locale: "zh" | "en"; view: TenantView }) {
  const zh = locale === "zh";
  return (
    <div className="tenant-site-statebar">
      <span className="tp-demo-ribbon">{site.product.demoMode === "demo/synthetic" ? (zh ? "演示资料 · 不能替代真实商品认证" : "DEMO / SYNTHETIC · NOT CERTIFICATION") : (zh ? "正式资料" : "PRODUCTION DATA")}</span>
      <span>{zh ? `当前页面：${view === "home" ? "消费者首页" : view}` : `Current page: ${view}`}</span>
      <span>{zh ? `默认批次 ${site.batch.defaultBatchId}` : `Default batch ${site.batch.defaultBatchId}`}</span>
    </div>
  );
}

function TenantHome({ site, locale }: { site: TenantSiteConfig; locale: "zh" | "en" }) {
  const zh = locale === "zh";
  const [batch, setBatch] = useState(() => currentBatch(site));
  const base = routeFor(site, "home", locale);
  return (
    <main className="tenant-site-main">
      <section className="tenant-hero">
        <div>
          <p className="tp-kicker">{zh ? "企业商品官网 · 公开证据" : "PRODUCT SITE · OPEN EVIDENCE"}</p>
          <span className="tp-demo-ribbon">{zh ? "每一件资料，都回到一个批次" : "Every record returns to one batch"}</span>
          <h1>{site.brand.slogans[locale]}</h1>
          <p className="tenant-lead">{site.product.description}</p>
          <div className="tenant-hero-actions">
            <a className="tp-red-btn" href={`${base}/agent?batch=${encodeURIComponent(batch)}`}>{zh ? "查看这批依据" : "View this batch"} →</a>
            <a className="tp-paper-btn" href={localizedSiteRoute(site, "wallet", locale, batch)}>{zh ? "钱包身份" : "Wallet identity"} →</a>
          </div>
        </div>
        <form className="tenant-batch-card" onSubmit={(event) => { event.preventDefault(); window.location.href = `${base}/agent?batch=${encodeURIComponent(batch)}`; }}>
          <span className="tp-kicker">{zh ? "查一批商品" : "INSPECT A BATCH"}</span>
          <h2>{zh ? "先看清，再下单。" : "Check first. Buy next."}</h2>
          <label htmlFor="tenant-batch">{zh ? "批次号" : "Batch ID"}</label>
          <div><input id="tenant-batch" value={batch} onChange={(event) => setBatch(event.target.value.toUpperCase())} /><button className="tp-red-btn" type="submit">{zh ? "查询" : "Inspect"}</button></div>
          <small>{zh ? "Agent 会把能确认的事实、缺口和下一步讲清楚。" : "The Agent explains what is known, missing, and next."}</small>
        </form>
      </section>
      <section className="tenant-fact-grid">
        {site.batch.evidenceCategories.slice(0, 3).map((item, index) => <article key={item}><b>0{index + 1}</b><strong>{item}</strong><span>{zh ? "已绑定当前批次" : "Linked to this batch"}</span></article>)}
      </section>
      <section className="tenant-route-grid">
        <a href={localizedSiteRoute(site, "agent", locale, batch)}><span className="tp-kicker">{zh ? "消费者" : "CONSUMER"}</span><h2>{zh ? "问商品助手" : "Ask the product Agent"}</h2><p>{zh ? "结论、依据、不确定、下一步。" : "Conclusion, sources, uncertainty, next step."}</p></a>
        <a href={localizedSiteRoute(site, "merchant", locale, batch)}><span className="tp-kicker">{zh ? "企业" : "BUSINESS"}</span><h2>{zh ? "把资料整理清楚" : "Make the record legible"}</h2><p>{zh ? "上传、核验、确认、发布。" : "Collect, verify, confirm, publish."}</p></a>
        <a href={localizedSiteRoute(site, "institution", locale, batch)}><span className="tp-kicker">{zh ? "机构" : "INSTITUTION"}</span><h2>{zh ? "一批一查" : "Review one batch at a time"}</h2><p>{zh ? "检测、签名、争议都有记录。" : "Testing, signatures, and disputes stay recorded."}</p></a>
      </section>
    </main>
  );
}

function TenantAgent({ site, locale }: { site: TenantSiteConfig; locale: "zh" | "en" }) {
  const initialBatch = currentBatch(site);
  const [batchId, setBatchId] = useState(initialBatch);
  const [verifyState, setVerifyState] = useState<VerifyState>("idle");
  const [stage, setStage] = useState<ConsumerAgentStage>("idle");
  // A deep link to /agent already identifies the batch. Run one scoped,
  // read-only explanation automatically so the evidence card is useful on
  // first paint instead of appearing empty until the visitor finds a button.
  const [query, setQuery] = useState<string | null>(initialBatch);
  const [quickPrompt, setQuickPrompt] = useState<string | null>(null);
  const [agentMeta, setAgentMeta] = useState<{
    agentMode?: string;
    serviceStatus?: string;
    model?: string;
    provider?: string;
    modelAssisted?: boolean;
  }>();
  const zh = locale === "zh";
  useEffect(() => {
    const nextBatch = currentBatch(site);
    setBatchId(nextBatch);
  }, [site]);
  const requestStatus = agentMeta?.serviceStatus ?? agentMeta?.agentMode;
  const modelActuallyUsed = agentMeta?.modelAssisted === true && requestStatus === "model_assisted";
  const agentRibbon = modelActuallyUsed
    ? (zh ? `${agentMeta?.provider ?? "DeepSeek"} · 已参与解释` : `${agentMeta?.provider ?? "DeepSeek"} · explanation active`)
    : requestStatus === "provider_unavailable"
      ? (zh ? "模型暂不可用 · 基础资料仍可查" : "Model unavailable · evidence remains available")
      : requestStatus === "rate_limited"
        ? (zh ? "请求受限 · 使用基础回答" : "Rate limited · fallback answer")
        : requestStatus === "maintenance"
          ? (zh ? "服务维护中 · 使用基础回答" : "Maintenance · fallback answer")
          : agentMeta
            ? (zh ? "基础回答 · DeepSeek 未参与" : "Evidence fallback · DeepSeek not used")
            : (zh ? "等待真实 Agent 查询" : "Waiting for an Agent query");
  return (
    <main className="tenant-site-main tenant-agent-main">
      <section className="tenant-section-heading"><div><p className="tp-kicker">{zh ? "商品 Agent · 证据卡" : "PRODUCT AGENT · EVIDENCE"}</p><h1>{zh ? "你问什么，我查什么。" : "Ask once. Get the record."}</h1><p>{zh ? "Verifier 先核验，JEV 再分流，模型只解释已经登记的资料。" : "The Verifier checks first, JEV routes next, and the model explains registered evidence."}</p></div><span className="tp-demo-ribbon">{agentRibbon}</span></section>
      <div className="tenant-agent-grid">
        <section className="tenant-panel tenant-chat-panel">
          <div className="tenant-panel-head"><strong>{zh ? "对话" : "Conversation"}</strong><span>{batchId}</span></div>
          <ChatPanel
            onStart={() => { setVerifyState("running"); setStage("searching"); }}
            onDone={() => { setVerifyState("done"); setStage("evidence_review"); }}
            onMeta={setAgentMeta}
            onBatch={(id) => setBatchId(id)}
            onPurchasePrepared={() => setStage("purchase_prepared")}
            onWalletPending={() => setStage("wallet_pending")}
            onReceiptVerified={() => setStage("receipt_verified")}
            batchId={batchId}
            autoQueryBatch={query}
            autoQueryPrompt={quickPrompt}
            locale={locale}
            productLabel={site.product.name}
          />
          <div className="tenant-quick-actions">
            {[zh ? "这批是什么？" : "What is this batch?", zh ? "还缺什么资料？" : "What is missing?", zh ? "链上有记录吗？" : "Is there a chain record?"].map((prompt) => <button type="button" key={prompt} onClick={() => { setQuery(batchId); setQuickPrompt(prompt); }}>{prompt}</button>)}
          </div>
        </section>
        <aside className="tenant-panel tenant-evidence-panel">
          <div className="tenant-panel-head"><strong>{zh ? "证据卡" : "Evidence card"}</strong><span>{site.product.demoMode}</span></div>
          <ProductPanel state={verifyState} batchId={batchId} locale={locale} />
          <EvidencePanel state={verifyState} batchId={batchId} locale={locale} />
          <div className="tenant-next-step"><b>{zh ? "下一步" : "Next step"}</b><span>{stage === "receipt_verified" ? (zh ? "购买回执已核验" : "Receipt verified") : (zh ? "先查看依据，再决定是否继续" : "Review the evidence before continuing")}</span></div>
        </aside>
      </div>
    </main>
  );
}

function TenantWallet({ site, locale }: { site: TenantSiteConfig; locale: "zh" | "en" }) {
  const zh = locale === "zh";
  const { address, chainId, walletName, walletRole, bindingStatus, setWalletModalOpen } = useWallet();
  const [role, setRole] = useState<WalletRole>("consumer");
  const roleLabel = walletRole ? WALLET_ROLE_LABELS[walletRole] : WALLET_ROLE_LABELS[role];
  return (
    <main className="tenant-site-main">
      <section className="tenant-section-heading"><div><p className="tp-kicker">{zh ? "钱包身份 · 交易确认" : "WALLET IDENTITY · CONFIRMATION"}</p><h1>{zh ? "先认身份，再做事情。" : "Bind identity. Confirm the action."}</h1><p>{zh ? "只读查看不需要钱包，写入和上链必须由外部钱包签名。" : "Read-only inspection needs no wallet. Writes and anchors require an external signature."}</p></div><span className="tp-demo-ribbon">{zh ? `Chain ${site.wallet.chainId}` : `Chain ${site.wallet.chainId}`}</span></section>
      <div className="tenant-wallet-grid">
        <section className="tenant-panel"><span className="tp-kicker">{zh ? "当前连接" : "CURRENT CONNECTION"}</span><h2>{address ? (walletName ?? (zh ? "外部钱包" : "External wallet")) : (zh ? "尚未连接钱包" : "No wallet connected")}</h2><p>{address ? `${address.slice(0, 8)}…${address.slice(-6)}` : (zh ? "你仍然可以先查看公开资料。" : "You can still inspect public evidence.")}</p><div className="tenant-wallet-status"><span>{zh ? "网络" : "Network"}</span><b>{chainId === site.wallet.chainId ? `Chain ${site.wallet.chainId}` : (chainId ? (zh ? "请切换网络" : "Switch network") : "—")}</b><span>{zh ? "绑定状态" : "Binding"}</span><b>{bindingStatus}</b></div><button className="tp-red-btn" type="button" onClick={() => setWalletModalOpen(true)}>{address ? (zh ? "查看钱包操作" : "View wallet actions") : (zh ? "连接钱包" : "Connect wallet")} →</button></section>
        <section className="tenant-panel"><span className="tp-kicker">{zh ? "选择身份" : "SELECT ROLE"}</span><h2>{roleLabel}</h2><div className="tenant-role-grid">{site.wallet.allowedRoles.map((candidate) => <button type="button" key={candidate} className={role === candidate ? "selected" : ""} onClick={() => setRole(candidate as WalletRole)}>{WALLET_ROLE_LABELS[candidate as WalletRole] ?? candidate}</button>)}</div><p>{zh ? "机构身份还需要管理员授权和钱包绑定。" : "Institution roles also require administrator authorization and wallet binding."}</p></section>
      </div>
      <section className="tenant-plugin-panel"><div><span className="tp-kicker">{zh ? "插件未检测到？" : "Wallet extension missing?"}</span><h2>{zh ? "直接安装，再回来检测。" : "Install it here, then check again."}</h2></div><div className="tenant-plugin-actions"><a href="https://metamask.io/download/" target="_blank" rel="noreferrer">MetaMask ↗</a><a href="https://www.okx.com/web3" target="_blank" rel="noreferrer">OKX Wallet ↗</a><a href="https://www.binance.com/en/web3wallet" target="_blank" rel="noreferrer">Binance Wallet ↗</a><button type="button" onClick={() => window.location.reload()}>{zh ? "重新检测插件" : "Detect again"}</button></div></section>
    </main>
  );
}

function TenantDevelopers({ site, locale }: { site: TenantSiteConfig; locale: "zh" | "en" }) {
  const zh = locale === "zh";
  return <main className="tenant-site-main"><section className="tenant-section-heading"><div><p className="tp-kicker">MCP · CLI · AGENT</p><h1>{zh ? "让 Agent 看得懂，也查得到。" : "Let agents read the record and check the chain."}</h1><p>{zh ? "技术字段收进抽屉，先给你能直接使用的连接方式。" : "Technical fields stay folded away; the useful connection comes first."}</p></div><span className="tp-demo-ribbon">{site.agent.enabled ? (zh ? "Agent 已启用" : "Agent enabled") : (zh ? "Agent 未启用" : "Agent disabled")}</span></section><div className="tenant-dev-grid"><article className="tenant-panel"><span className="tp-kicker">MCP</span><h2>https://truthpass-service.vercel.app/mcp</h2><p>{zh ? "只读查询商品、批次和链状态。" : "Read-only product, batch, and chain queries."}</p><button className="tp-paper-btn" type="button" onClick={() => void navigator.clipboard?.writeText("https://truthpass-service.vercel.app/mcp")}>{zh ? "复制连接地址" : "Copy endpoint"}</button></article><article className="tenant-panel"><span className="tp-kicker">CLI</span><h2>npx truthpass inspect</h2><p>{zh ? "通过 CLI 使用同一份公开证据。" : "Use the same public evidence through the CLI."}</p><a className="tp-red-btn" href="/downloads/truthpass-cli.zip" download>{zh ? "下载 CLI" : "Download CLI"} ↓</a></article></div><div className="tenant-capability-grid">{(zh ? ["查询商品", "查询批次", "查询链状态", "执行受保护操作"] : ["Inspect product", "Inspect batch", "Check chain status", "Run protected action"]).map((item) => <div key={item}><b>↗</b><strong>{item}</strong><small>{zh ? "涉及写入时必须由对应钱包确认。" : "Writes require the corresponding wallet confirmation."}</small></div>)}</div></main>;
}

export function TenantSitePage({ site, view = "home", locale = site.locale.default }: { site: TenantSiteConfig; view?: TenantView; locale?: "zh" | "en" }) {
  return (
    <div className={`tenant-site-page ${locale === "zh" ? "tp-lang-zh" : "tp-lang-en"}`}>
      <SiteHeader site={site} view={view} locale={locale} />
      <SiteStateBar site={site} locale={locale} view={view} />
      {view === "home" && <TenantHome site={site} locale={locale} />}
      {view === "agent" && <TenantAgent site={site} locale={locale} />}
      {view === "wallet" && <TenantWallet site={site} locale={locale} />}
      {view === "merchant" && <MerchantApp tenant={site} locale={locale} />}
      {view === "institution" && <InstitutionReviewPanel locale={locale} tenant={site} />}
      {view === "developers" && <TenantDevelopers site={site} locale={locale} />}
      {view === "preview" && <TenantHome site={site} locale={locale} />}
      <footer className="tenant-site-footer"><span>{site.brand.name} · TruthPass</span><span>{site.product.demoMode === "demo/synthetic" ? (locale === "zh" ? "演示资料 · 不能替代真实商品认证" : "DEMO / SYNTHETIC · NOT CERTIFICATION") : "Production data"}</span></footer>
    </div>
  );
}
