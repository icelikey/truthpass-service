import { useEffect, useState } from "react";
import { ChatPanel } from "./ChatPanel";
import { EvidencePanel } from "./EvidencePanel";
import { ProductPanel } from "./ProductPanel";
import { ConsumerFlowBar, type ConsumerAgentStage } from "./ConsumerFlowBar";
import { ConsumerActionDock } from "./ConsumerActionDock";
import { useWallet } from "./WalletContext";
import type { VerifyState } from "../types";
import { fetchAgentStatus } from "../api";

type Locale = "zh" | "en";

interface ConsumerExperiencePageProps {
  locale: Locale;
  batchId: string | null;
  verifyState: VerifyState;
  stage: ConsumerAgentStage;
  userEmail?: string | null;
  onOpenAuth: () => void;
  onOpenHistory: () => void;
  onSignOut: () => void;
  onStart: () => void;
  onDone: () => void;
  onBatch: (batchId: string) => void;
  onPurchasePrepared: () => void;
  onWalletPending: () => void;
  onReceiptVerified: () => void;
}

const copy = {
  zh: {
    navHome: "首页",
    navEvidence: "商品依据",
    navBusiness: "企业入口",
    navDevelopers: "开发者",
    signIn: "登录",
    signOut: "退出",
    history: "我的记录",
    eyebrow: "公开证据 · TRUTHPASS",
    demo: "演示资料 · 不能替代真实商品认证",
    title: "先看清，\n再下单。",
    lead: "生产、检测、运输，一件件摆出来。",
    searchTitle: "查一批商品",
    searchBody: "输入批次号，Agent 会把能确认的事实和缺口讲清楚。",
    searchPlaceholder: "例如 FO-2026-001",
    search: "查看这批",
    sample: "示例批次：FO-2026-001",
    factsTitle: "先看三件事",
    facts: ["生产记录有没有", "检测结果能不能查", "运输记录缺不缺"],
    factHint: "没有依据的，我不会替你补。",
    agentTitle: "你问什么，我查什么。",
    agentBody: "Agent 先读已登记资料，再把结论、依据、不确定和下一步说清楚。",
    evidenceTitle: "这批的依据",
    techTitle: "查看回答依据",
    techBody: "这里可以看到 Agent 读了哪些资料、规则怎么判断，以及下一步由谁处理。",
    pipeline: ["读取批次资料", "规则核验", "JEV 分流", "DeepSeek 解释"],
    pipelineNote: "模型只负责把已有结果讲明白，不能替机构签字，也不能替你付款。",
    status: "演示环境在线",
    wallet: "连接钱包",
    walletConnected: "钱包已连接",
    readOnly: "只读查看不需要钱包；写入记录时再由你确认。",
  },
  en: {
    navHome: "Home",
    navEvidence: "Evidence",
    navBusiness: "For business",
    navDevelopers: "Developers",
    signIn: "Sign in",
    signOut: "Sign out",
    history: "My records",
    eyebrow: "OPEN EVIDENCE · TRUTHPASS",
    demo: "DEMO / SYNTHETIC · NOT CERTIFICATION",
    title: "Check first.\nBuy next.",
    lead: "Production, testing, delivery — show the record.",
    searchTitle: "Inspect a batch",
    searchBody: "Enter a batch ID and the agent will explain what is known and what is missing.",
    searchPlaceholder: "For example FO-2026-001",
    search: "Inspect this batch",
    sample: "Sample batch: FO-2026-001",
    factsTitle: "Start with three facts",
    facts: ["Is production recorded?", "Can testing be checked?", "Is delivery covered?"],
    factHint: "If there is no evidence, the agent will say so.",
    agentTitle: "Ask once. Get the evidence.",
    agentBody: "The agent reads registered records first, then explains the conclusion, sources, gaps, and next step.",
    evidenceTitle: "Evidence for this batch",
    techTitle: "See how the answer was made",
    techBody: "Review the records, deterministic checks, routing decision, and the person responsible for the next step.",
    pipeline: ["Read batch records", "Run rule checks", "Route with JEV", "Explain with DeepSeek"],
    pipelineNote: "The model explains existing results. It cannot sign for an institution or pay for you.",
    status: "Demo service online",
    wallet: "Connect wallet",
    walletConnected: "Wallet connected",
    readOnly: "Read-only inspection needs no wallet. Writes require your confirmation.",
  },
} as const;

export function ConsumerExperiencePage(props: ConsumerExperiencePageProps) {
  const { locale, batchId, verifyState, stage } = props;
  const t = copy[locale];
  const { address, chainId, setWalletModalOpen } = useWallet();
  const [query, setQuery] = useState(batchId ?? "");
  const [autoQueryBatch, setAutoQueryBatch] = useState<string | null>(batchId);
  const [showHow, setShowHow] = useState(false);
  const [agentStatus, setAgentStatus] = useState<{ agentMode?: string; model?: string | null; status?: string }>({});

  useEffect(() => {
    if (batchId) setQuery(batchId);
  }, [batchId]);

  useEffect(() => {
    let active = true;
    void fetchAgentStatus().then((next) => { if (active) setAgentStatus(next); }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const submitQuery = (value: string) => {
    const next = value.trim().toUpperCase();
    if (!next) return;
    setQuery(next);
    setAutoQueryBatch(next);
    window.setTimeout(() => document.getElementById("agent")?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  };

  return (
    <div className={`tp-consumer-page ${locale === "zh" ? "tp-lang-zh" : "tp-lang-en"}`}>
      <header className="tp-consumer-header">
        <a className="tp-brand" href={locale === "zh" ? "/" : "/en"} aria-label="TruthPass">
          <span className="tp-brand-word">TruthPass</span>
          <img src="/assets/brand-mark.svg" alt="" aria-hidden="true" />
        </a>
        <nav aria-label={locale === "zh" ? "主导航" : "Primary navigation"}>
          <a className="active" href="#agent">{t.navEvidence}</a>
          <a href={locale === "zh" ? "/merchant" : "/en/merchant"}>{t.navBusiness}</a>
          <a href={locale === "zh" ? "/developers" : "/en/developers"}>{t.navDevelopers}</a>
        </nav>
        <div className="tp-consumer-actions">
          <div className="tp-language-switch" aria-label={locale === "zh" ? "语言" : "Language"}>
            <a className={locale === "zh" ? "selected" : ""} href={`/?view=consumer${batchId ? `&batch=${encodeURIComponent(batchId)}` : ""}`}>中文</a>
            <a className={locale === "en" ? "selected" : ""} href={`/en?view=consumer${batchId ? `&batch=${encodeURIComponent(batchId)}` : ""}`}>English</a>
          </div>
          {props.userEmail ? (
            <button type="button" className="tp-consumer-auth" onClick={props.onSignOut}>{t.signOut}</button>
          ) : (
            <button type="button" className="tp-consumer-auth" onClick={props.onOpenAuth}>{t.signIn}</button>
          )}
        </div>
      </header>

      <main>
        <section className="tp-consumer-hero">
          <div className="tp-consumer-hero-copy">
            <p className="tp-kicker">{t.eyebrow}</p>
            <span className="tp-demo-ribbon">{t.demo}</span>
            <h1>{t.title.split("\n").map((line, index) => <span key={line}>{index > 0 && <br />}{line}</span>)}</h1>
            <p className="tp-consumer-lead">{t.lead}</p>
            <div className="tp-consumer-facts">
              <div><b>01</b><span>{t.facts[0]}</span></div>
              <div><b>02</b><span>{t.facts[1]}</span></div>
              <div><b>03</b><span>{t.facts[2]}</span></div>
            </div>
            <small className="tp-consumer-fact-hint">{t.factHint}</small>
          </div>
          <form className="tp-consumer-search" onSubmit={(event) => { event.preventDefault(); submitQuery(query); }}>
            <span className="tp-kicker">{t.searchTitle}</span>
            <h2>{t.searchTitle}</h2>
            <p>{t.searchBody}</p>
            <label htmlFor="consumer-batch-query">{locale === "zh" ? "批次号" : "Batch ID"}</label>
            <div className="tp-consumer-search-row">
              <input id="consumer-batch-query" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t.searchPlaceholder} autoComplete="off" />
              <button type="submit" className="tp-red-btn">{t.search} <span aria-hidden="true">→</span></button>
            </div>
            <button type="button" className="tp-consumer-sample" onClick={() => submitQuery("FO-2026-001")}>{t.sample}</button>
            <div className="tp-consumer-status"><span className="tp-status-dot" />{t.status}</div>
          </form>
        </section>

        <section className="tp-consumer-pipeline" aria-label={locale === "zh" ? "Agent 工作过程" : "Agent pipeline"}>
          <div><span className="tp-kicker">{locale === "zh" ? "回答怎么来的" : "HOW THE ANSWER IS MADE"}</span><strong>{t.agentTitle}</strong></div>
          <div className="tp-consumer-pipeline-steps">{t.pipeline.map((step, index) => <span key={step}><b>{index + 1}</b>{step}{index < t.pipeline.length - 1 && <i aria-hidden="true">→</i>}</span>)}</div>
          <small>{t.pipelineNote}</small>
        </section>

        <ConsumerFlowBar stage={stage} batchId={batchId} />

        <section className="tp-consumer-workspace" id="agent">
          <div className="tp-consumer-agent-column">
            <div className="tp-consumer-section-heading"><div><span className="tp-kicker">{locale === "zh" ? "商品助手" : "PRODUCT AGENT"}</span><h2>{t.agentTitle}</h2><p>{t.agentBody}</p></div><span className="tp-consumer-ai-badge">{agentStatus.agentMode === "model_assisted" ? (locale === "zh" ? "DeepSeek · 已参与解释" : "DeepSeek · explanation active") : agentStatus.status === "ready" ? (locale === "zh" ? "基础回答 · 资料仍可查" : "Fallback · evidence available") : (locale === "zh" ? "Agent 连接中" : "Agent connecting")}</span></div>
            <ChatPanel
              onStart={props.onStart}
              onDone={props.onDone}
              onBatch={props.onBatch}
              onPurchasePrepared={props.onPurchasePrepared}
              onWalletPending={props.onWalletPending}
              onReceiptVerified={props.onReceiptVerified}
              batchId={batchId}
              autoQueryBatch={autoQueryBatch}
              locale={locale}
            />
          </div>
          <div className="tp-consumer-evidence-column" id="evidence">
            <div className="tp-consumer-section-heading"><div><span className="tp-kicker">{locale === "zh" ? "证据卡" : "EVIDENCE CARD"}</span><h2>{t.evidenceTitle}</h2></div>{batchId && <code>{batchId}</code>}</div>
            <ProductPanel state={verifyState} batchId={batchId ?? "FO-2026-001"} locale={locale} />
            <EvidencePanel state={verifyState} batchId={batchId ?? "FO-2026-001"} locale={locale} />
          </div>
        </section>

        <ConsumerActionDock stage={stage} batchId={batchId} />

        <section className="tp-consumer-how" aria-labelledby="consumer-how-title">
          <button type="button" className="tp-consumer-how-toggle" onClick={() => setShowHow((value) => !value)} aria-expanded={showHow}>
            <span><span className="tp-kicker">{locale === "zh" ? "透明说明" : "TRANSPARENT BY DESIGN"}</span><strong id="consumer-how-title">{t.techTitle}</strong></span><span aria-hidden="true">{showHow ? "⌃" : "⌄"}</span>
          </button>
          {showHow && <div className="tp-consumer-how-body"><p>{t.techBody}</p><div className="tp-consumer-how-grid"><span><b>{locale === "zh" ? "规则核验" : "Rule checks"}</b>{locale === "zh" ? "检查时间、批次、来源和缺口。" : "Check time, batch, source, and gaps."}</span><span><b>JEV</b>{locale === "zh" ? "决定补资料、复核或继续解释。" : "Routes to evidence, review, or explanation."}</span><span><b>DeepSeek</b>{locale === "zh" ? "把已有结果讲成人话。" : "Explains the registered result in plain language."}</span><span><b>{locale === "zh" ? "数据模式" : "Data mode"}</b>{locale === "zh" ? "当前页面标明演示或真实资料。" : "The page labels demo or external data."}</span></div></div>}
        </section>

        <section className="tp-consumer-wallet-strip">
          <div><span className="tp-kicker">{locale === "zh" ? "钱包确认" : "WALLET CONFIRMATION"}</span><h2>{address ? t.walletConnected : t.wallet}</h2><p>{address ? `${address.slice(0, 6)}…${address.slice(-4)} · ${chainId === 677 ? "Chain 677" : (locale === "zh" ? "请切换网络" : "Switch network")}` : t.readOnly}</p></div>
          <button type="button" className="tp-paper-btn" onClick={() => setWalletModalOpen(true)}>{address ? (locale === "zh" ? "查看钱包状态" : "View wallet status") : t.wallet} →</button>
        </section>
      </main>
      <footer className="tp-consumer-footer"><span>TruthPass</span><span>{locale === "zh" ? "看依据，做选择，留记录。" : "See the record. Make the choice. Keep the record."}</span><button type="button" onClick={props.onOpenHistory}>{t.history}</button></footer>
    </div>
  );
}

