import { useCallback, useEffect, useRef, useState } from "react";
import { ChatPanel } from "./ChatPanel";
import { AgentDataFlowRail, type AgentFlowEvent, type AgentFlowStatus } from "./AgentDataFlowRail";
import { EvidencePanel } from "./EvidencePanel";
import { ProductPanel } from "./ProductPanel";
import { ConsumerFlowBar, type ConsumerAgentStage } from "./ConsumerFlowBar";
import { ConsumerActionDock } from "./ConsumerActionDock";
import { useWallet } from "./WalletContext";
import type { ChatEvent, RecommendItem, VerifyState } from "../types";
import { fetchAgentStatus, fetchBatchOverview, fetchLifecycle, fetchRecommend } from "../api";

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
    pipeline: ["读取批次资料", "规则核验", "JEV 分流", "模型解释"],
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
    pipeline: ["Read batch records", "Run rule checks", "Route with JEV", "Model explanation"],
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
  const [agentStatus, setAgentStatus] = useState<{ agentMode?: string; model?: string | null; provider?: string | null; providerIssue?: string; modelAssisted?: boolean; status?: string }>({});
  const [flowEvents, setFlowEvents] = useState<AgentFlowEvent[]>([]);
  const [flowDataMode, setFlowDataMode] = useState("demo/synthetic");
  const [recommendation, setRecommendation] = useState<RecommendItem | null>(null);
  const [recommendationState, setRecommendationState] = useState<"idle" | "loading" | "ready" | "unavailable">("idle");
  const [showEvidence, setShowEvidence] = useState(false);
  const flowSeqRef = useRef(0);
  const lifecycleRevisionRef = useRef<number | undefined>(undefined);

  const agentBadge = agentStatus.modelAssisted === true
    ? `${agentStatus.provider ?? (locale === "zh" ? "模型" : "Model")} · ${locale === "zh" ? "已参与解释" : "explanation active"}`
    : agentStatus.status === "provider_unavailable"
      ? (locale === "zh" ? "模型暂不可用 · 已安全回退" : "Model unavailable · safe fallback")
      : agentStatus.status === "rate_limited"
        ? (locale === "zh" ? "请求受限 · 已安全回退" : "Rate limited · safe fallback")
        : agentStatus.status === "deterministic_fallback" || agentStatus.status === "degraded"
          ? (locale === "zh" ? "基础回答 · 资料仍可查" : "Evidence fallback · records available")
          : agentStatus.status === "ready"
            ? (locale === "zh" ? "Agent 已就绪" : "Agent ready")
            : (locale === "zh" ? "Agent 连接中" : "Agent connecting");

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

  const appendFlowEvent = useCallback((event: ChatEvent) => {
    const stage = event.stage ?? (event.kind === "done" ? "done" : event.kind);
    const stageLabels: Record<string, string> = locale === "zh"
      ? {
          begin: "Agent 开始运行",
          reading_batch: "读取当前批次",
          verifier_checked: "Verifier 完成规则核验",
          jev_routed: "JEV 完成分流",
          model_started: "模型开始整理解释",
          model_completed: "模型解释完成",
          answer: "回答已生成",
          done: "Agent 运行结束",
          meta: "运行摘要已返回",
        }
      : {
          begin: "Agent run started",
          reading_batch: "Reading this batch",
          verifier_checked: "Verifier checked rules",
          jev_routed: "JEV routed next step",
          model_started: "Model started explanation",
          model_completed: "Model explanation completed",
          answer: "Answer generated",
          done: "Agent run finished",
          meta: "Run metadata returned",
        };
    const status: AgentFlowStatus = event.status === "active" || event.status === "completed" || event.status === "fallback" || event.status === "unavailable"
      ? event.status
      : "info";
    const item: AgentFlowEvent = {
      id: `consumer-flow-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      source: "Agent SSE",
      label: stageLabels[stage] ?? stage,
      detail: event.detail
        ?? (event.providerIssue === "unauthorized"
          ? (locale === "zh" ? "模型接口认证失败，已安全回退到当前批次的确定性资料回答。" : "Model authentication failed; safely fell back to the deterministic batch answer.")
          : event.providerIssue === "rate_limited"
            ? (locale === "zh" ? "模型接口请求受限，已安全回退到当前批次的确定性资料回答。" : "The model provider rate-limited this request; safely fell back to the deterministic batch answer.")
            : event.providerIssue === "invalid_response"
              ? (locale === "zh" ? "模型回答未通过格式或引用校验，原文未展示。" : "The model response failed format or citation checks and was not shown.")
              : undefined)
        ?? (event.pipelineDetail ? `Verifier ${event.pipelineDetail.verifier.status} · JEV ${event.pipelineDetail.jev.decision} · ${locale === "zh" ? "模型" : "model"} ${event.pipelineDetail.deepseek.status}` : event.text ?? ""),
      status,
      at: new Date().toISOString(),
      batchId: event.batchId ?? batchId ?? undefined,
      traceId: event.traceId,
      evidenceCount: event.evidenceIds?.length,
      dataMode: event.dataMode ?? flowDataMode,
    };
    flowSeqRef.current += 1;
    item.id = `consumer-flow-${Date.now()}-${flowSeqRef.current}`;
    setFlowEvents((previous) => [...previous.slice(-99), item]);
    if (event.traceId) setFlowTraceId(event.traceId);
    if (event.dataMode) setFlowDataMode(event.dataMode);
  }, [batchId, flowDataMode, locale]);

  const [flowTraceId, setFlowTraceId] = useState<string | undefined>();

  const appendSystemFlow = useCallback((event: Omit<AgentFlowEvent, "id" | "at">) => {
    flowSeqRef.current += 1;
    const item: AgentFlowEvent = { ...event, id: `consumer-flow-${Date.now()}-${flowSeqRef.current}`, at: new Date().toISOString() };
    setFlowEvents((previous) => [...previous.slice(-99), item]);
    if (event.traceId) setFlowTraceId(event.traceId);
    if (event.dataMode) setFlowDataMode(event.dataMode);
  }, []);

  useEffect(() => {
    if (!batchId) return;
    let active = true;
    setFlowEvents([]);
    setFlowTraceId(undefined);
    lifecycleRevisionRef.current = undefined;
    const lifecycleSource = locale === "zh" ? "生命周期 API" : "Lifecycle API";
    const readPublicContext = async () => {
      const overviewSource = locale === "zh" ? "批次总览 API" : "Batch overview API";
      const chainSource = locale === "zh" ? "链状态 API" : "Chain status API";
      appendSystemFlow({ source: overviewSource, label: locale === "zh" ? "读取批次总览" : "Reading batch overview", detail: `${locale === "zh" ? "正在读取 " : "Reading "}${batchId}${locale === "zh" ? " 的商品、证据和核验状态。" : " product, evidence, and verification state."}`, status: "active", batchId });
      try {
        const overview = await fetchBatchOverview(batchId);
        if (!active) return;
        const mode = overview.dataMode ?? overview.batch?.dataMode ?? "demo/synthetic";
        setFlowDataMode(mode);
        appendSystemFlow({ source: overviewSource, label: locale === "zh" ? "批次总览已读取" : "Batch overview loaded", detail: `${overview.product?.name ?? "Product"} · ${locale === "zh" ? "核验" : "verification"} ${overview.verification?.status ?? overview.batch?.status ?? "pending"} · ${overview.evidence?.length ?? 0} ${locale === "zh" ? "条证据" : "evidence records"}.`, status: "completed", batchId, evidenceCount: overview.evidence?.length, dataMode: mode });
        const chain = overview.chainContext;
        if (chain) {
          appendSystemFlow({
            source: chainSource,
            label: locale === "zh" ? "当前批次链状态已返回" : "Current batch chain state returned",
            detail: `${chain.chainName} (${chain.chainId}) · ${chain.anchorStatus} · ${chain.rpcReachable ? (locale === "zh" ? "RPC 可达" : "RPC reachable") : (locale === "zh" ? "RPC 不可达" : "RPC unavailable")}${chain.transaction ? ` · ${locale === "zh" ? "已有当前交易 receipt" : "current receipt available"}` : ` · ${locale === "zh" ? "没有当前交易 receipt" : "no current receipt"}`}.`,
            status: chain.rpcReachable ? "completed" : "unavailable",
            batchId: chain.batchId ?? batchId,
            traceId: undefined,
            dataMode: mode,
          });
        }
      } catch (error) {
        if (!active) return;
        appendSystemFlow({ source: overviewSource, label: locale === "zh" ? "批次总览读取失败" : "Batch overview failed", detail: error instanceof Error ? error.message : "overview unavailable", status: "unavailable", batchId });
      }
      await refreshLifecycle();
    };
    const refreshLifecycle = async () => {
      try {
        const lifecycle = await fetchLifecycle(batchId);
        if (!active) return;
        const firstRead = lifecycleRevisionRef.current === undefined;
        const changed = !firstRead && lifecycleRevisionRef.current !== lifecycle.contextRevision;
        lifecycleRevisionRef.current = lifecycle.contextRevision;
        if (firstRead || changed) {
          appendSystemFlow({ source: lifecycleSource, label: changed ? (locale === "zh" ? "生命周期资料刚刚更新" : "Lifecycle data updated") : (locale === "zh" ? "生命周期已读取" : "Lifecycle loaded"), detail: `${locale === "zh" ? "上下文版本" : "Context revision"} v${lifecycle.contextRevision} · ${lifecycle.events.length} ${locale === "zh" ? "个阶段" : "stages"}${changed ? (locale === "zh" ? " · 资料刚刚更新" : " · just updated") : ""}.`, status: "completed", batchId, dataMode: lifecycle.dataMode });
        }
      } catch (error) {
        if (!active) return;
        appendSystemFlow({ source: lifecycleSource, label: locale === "zh" ? "生命周期读取失败" : "Lifecycle read failed", detail: error instanceof Error ? error.message : "lifecycle unavailable", status: "unavailable", batchId });
      }
    };
    void readPublicContext();
    const timer = window.setInterval(() => { void refreshLifecycle(); }, 10_000);
    return () => { active = false; window.clearInterval(timer); };
  }, [appendSystemFlow, batchId, locale]);

  useEffect(() => {
    if (!batchId) {
      setRecommendation(null);
      setRecommendationState("idle");
      return;
    }
    let active = true;
    setRecommendation(null);
    setRecommendationState("loading");
    void fetchRecommend(batchId).then((items) => {
      if (!active) return;
      setRecommendation(items[0] ?? null);
      setRecommendationState(items[0] ? "ready" : "unavailable");
    }).catch(() => {
      if (!active) return;
      setRecommendation(null);
      setRecommendationState("unavailable");
    });
    return () => { active = false; };
  }, [batchId]);

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

        <ConsumerFlowBar stage={stage} batchId={batchId} locale={locale} />

        <section className="tp-consumer-workspace" id="agent">
          <div className="tp-consumer-agent-column">
            <div className="tp-consumer-section-heading"><div><span className="tp-kicker">{locale === "zh" ? "商品助手" : "PRODUCT AGENT"}</span><h2>{t.agentTitle}</h2><p>{t.agentBody}</p></div><span className="tp-consumer-ai-badge">{agentBadge}</span></div>
            <AgentDataFlowRail
              events={flowEvents}
              batchId={batchId ?? "—"}
              dataMode={flowDataMode}
              traceId={flowTraceId ?? flowEvents.at(-1)?.traceId}
              locale={locale}
              onClear={() => setFlowEvents([])}
            />
            <ChatPanel
              onStart={props.onStart}
              onDone={props.onDone}
              onBatch={(id) => {
                if (id !== batchId) setFlowEvents([]);
                props.onBatch(id);
              }}
              onFlowEvent={appendFlowEvent}
              onMeta={(meta) => setAgentStatus({
                agentMode: meta?.agentMode,
                model: meta?.model,
                provider: meta?.provider,
                providerIssue: meta?.providerIssue,
                modelAssisted: meta?.modelAssisted,
                status: meta?.serviceStatus,
              })}
              onPurchasePrepared={props.onPurchasePrepared}
              onWalletPending={props.onWalletPending}
              onReceiptVerified={props.onReceiptVerified}
              batchId={batchId}
              autoQueryBatch={autoQueryBatch}
              locale={locale}
              minimal
            />
            <section className="consumer-auto-recommendation" aria-label={locale === "zh" ? "Agent 推荐结果" : "Agent recommendation"}>
              <div className="consumer-auto-recommendation-head">
                <div>
                  <span className="tp-kicker">{locale === "zh" ? "Agent 建议" : "AGENT RECOMMENDATION"}</span>
                  <h3>{locale === "zh" ? "先核对，再决定" : "Check the record before deciding"}</h3>
                </div>
                {recommendation?.dataMode && <span className="consumer-auto-recommendation-mode">{recommendation.dataMode}</span>}
              </div>
              {recommendationState === "loading" && <p className="consumer-auto-recommendation-muted">{locale === "zh" ? "正在根据当前批次的生产、检测和冷链资料整理建议…" : "Reading production, inspection, and cold-chain evidence…"}</p>}
              {recommendationState === "unavailable" && <p className="consumer-auto-recommendation-muted">{locale === "zh" ? "当前没有可发布的推荐；请先查看证据卡和缺口。" : "No scoped recommendation is available yet. Review the evidence and gaps first."}</p>}
              {recommendation && <>
                <div className={`consumer-auto-recommendation-status ${recommendation.recommendationStatus ?? "review_before_recommendation"}`}>
                  {recommendation.recommendationStatus === "recommend_with_scope" ? (locale === "zh" ? "在当前资料范围内可继续评估" : "Recommend with scope") : recommendation.recommendationStatus === "do_not_recommend" ? (locale === "zh" ? "当前不建议继续购买准备" : "Do not recommend") : (locale === "zh" ? "先复核资料，再决定" : "Review before recommendation")}
                </div>
                <p className="consumer-auto-recommendation-reason">{recommendation.reason}</p>
                <div className="consumer-auto-recommendation-facts">
                  <span><b>{locale === "zh" ? "参数" : "Parameters"}</b>{recommendation.parameterDetails?.filter((item) => item.status === "within_range").length ?? 0}/{recommendation.parameterDetails?.length ?? 0} {locale === "zh" ? "项在当前规则范围内" : "within the current rule"}</span>
                  <span><b>{locale === "zh" ? "生产" : "Production"}</b>{recommendation.productionEvidence?.observedStageCount ?? 0}/{recommendation.productionEvidence?.requiredStageCount ?? 0} {locale === "zh" ? "道工序已登记" : "stages registered"}</span>
                  <span><b>{locale === "zh" ? "反馈" : "Feedback"}</b>{recommendation.feedbackSample?.count ?? 0} {locale === "zh" ? "条已核验购买反馈" : "verified-purchase samples"}</span>
                </div>
                <p className="consumer-auto-recommendation-next"><b>{locale === "zh" ? "下一步" : "Next"}</b>{recommendation.nextAction ?? recommendation.nextStep}</p>
              </>}
            </section>
          </div>
          <div className="tp-consumer-evidence-column" id="evidence">
            <button type="button" className="tp-consumer-record-toggle" onClick={() => setShowEvidence((value) => !value)} aria-expanded={showEvidence}>
              <span><span className="tp-kicker">{locale === "zh" ? "按需打开" : "OPEN WHEN NEEDED"}</span><strong>{showEvidence ? (locale === "zh" ? "收起这批资料" : "Hide this batch record") : (locale === "zh" ? "查看这批资料和依据" : "View this batch record and sources")}</strong></span><span aria-hidden="true">{showEvidence ? "⌃" : "⌄"}</span>
            </button>
            {showEvidence && <>
              <div className="tp-consumer-section-heading"><div><span className="tp-kicker">{locale === "zh" ? "证据卡" : "EVIDENCE CARD"}</span><h2>{t.evidenceTitle}</h2></div>{batchId && <code>{batchId}</code>}</div>
              <ProductPanel state={verifyState} batchId={batchId ?? "FO-2026-001"} locale={locale} />
              <EvidencePanel state={verifyState} batchId={batchId ?? "FO-2026-001"} locale={locale} />
            </>}
          </div>
        </section>

        <ConsumerActionDock stage={stage} batchId={batchId} locale={locale} />

        <section className="tp-consumer-how" aria-labelledby="consumer-how-title">
          <button type="button" className="tp-consumer-how-toggle" onClick={() => setShowHow((value) => !value)} aria-expanded={showHow}>
            <span><span className="tp-kicker">{locale === "zh" ? "透明说明" : "TRANSPARENT BY DESIGN"}</span><strong id="consumer-how-title">{t.techTitle}</strong></span><span aria-hidden="true">{showHow ? "⌃" : "⌄"}</span>
          </button>
          {showHow && <div className="tp-consumer-how-body"><p>{t.techBody}</p><div className="tp-consumer-how-grid"><span><b>{locale === "zh" ? "规则核验" : "Rule checks"}</b>{locale === "zh" ? "检查时间、批次、来源和缺口。" : "Check time, batch, source, and gaps."}</span><span><b>JEV</b>{locale === "zh" ? "决定补资料、复核或继续解释。" : "Routes to evidence, review, or explanation."}</span><span><b>{locale === "zh" ? "模型解释" : "Model"}</b>{locale === "zh" ? "把已有结果讲成人话，不能替代核验。" : "Explains registered results without replacing verification."}</span><span><b>{locale === "zh" ? "数据模式" : "Data mode"}</b>{locale === "zh" ? "当前页面标明演示或真实资料。" : "The page labels demo or external data."}</span></div></div>}
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
