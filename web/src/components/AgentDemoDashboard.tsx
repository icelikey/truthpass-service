import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChatPanel } from "./ChatPanel";
import { fetchBatchOverview, fetchChainStatus, fetchLifecycle, fetchProduct, fetchVerification, simulateLifecycleStage } from "../api";
import type { ChainStatusData, ChatEvent, LifecycleStage, LifecycleView, ProductBatch, PublicBatchOverview, VerifyState } from "../types";
import type { TenantSiteConfig } from "../siteConfig";

type DemoLocale = "zh" | "en";
type DemoStepStatus = "pending" | "active" | "completed" | "fallback" | "unavailable";

type DemoFlowStep = {
  key: string;
  zh: string;
  en: string;
  detailZh: string;
  detailEn: string;
  status: DemoStepStatus;
};

const lifecycleNodes: Array<{ stage: LifecycleStage | "consumer_query"; zh: string; en: string; icon: string }> = [
  { stage: "production", zh: "生产", en: "Production", icon: "▦" },
  { stage: "inspection", zh: "检测", en: "Testing", icon: "⌬" },
  { stage: "cold_chain", zh: "冷链", en: "Cold chain", icon: "✣" },
  { stage: "shipment", zh: "出货", en: "Shipment", icon: "▱" },
  { stage: "consumer_query", zh: "消费者查询", en: "Consumer query", icon: "◯" },
];

const searchSteps = [
  { key: "reading_batch", zh: "读取资料", en: "Read records", detailZh: "从当前批次登记资料中读取生产、检测、冷链和出货记录。", detailEn: "Read production, testing, cold-chain, and shipment records for this batch." },
  { key: "verifier_checked", zh: "核对检测", en: "Check testing", detailZh: "按登记规则核对关键指标和资料完整性。", detailEn: "Check key parameters and record completeness against registered rules." },
  { key: "jev_routed", zh: "检查缺口", en: "Check gaps", detailZh: "把缺失、冲突和需要补证的项目单独列出。", detailEn: "Separate missing, conflicting, and follow-up evidence." },
  { key: "model_started", zh: "整理说明", en: "Organize explanation", detailZh: "只把已核验资料整理成普通人看得懂的话。", detailEn: "Turn checked records into plain language without adding facts." },
  { key: "model_completed", zh: "返回结论", en: "Return result", detailZh: "返回结论、依据、不确定和下一步。", detailEn: "Return the conclusion, evidence, uncertainty, and next step." },
];

function currentBatch(site: TenantSiteConfig): string {
  if (typeof window === "undefined") return site.batch.defaultBatchId;
  const value = new URLSearchParams(window.location.search).get("batch")?.trim().toUpperCase();
  const prefix = site.batch.defaultBatchId.split("-")[0];
  return value?.startsWith(`${prefix}-`) ? value : site.batch.defaultBatchId;
}

function statusFromChat(event: ChatEvent): DemoStepStatus {
  if (event.providerIssue || event.runtimeStatus === "fallback") return "fallback";
  if (event.status === "unavailable") return "unavailable";
  if (event.status === "active") return "active";
  if (event.status === "completed" || event.kind === "answer" || event.kind === "done" || event.kind === "meta") return "completed";
  return "pending";
}

function statusLabel(status: DemoStepStatus, zh: boolean): string {
  if (status === "completed") return zh ? "完成" : "Done";
  if (status === "active") return zh ? "进行中" : "Running";
  if (status === "fallback") return zh ? "资料回退" : "Evidence fallback";
  if (status === "unavailable") return zh ? "暂不可用" : "Unavailable";
  return zh ? "等待" : "Waiting";
}

function safeText(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value : fallback;
}

function EvidenceMetricGrid({ product, overview, lifecycle, zh }: { product: ProductBatch | null; overview: PublicBatchOverview | null; lifecycle: LifecycleView | null; zh: boolean }) {
  const metrics = product?.keyMetrics ?? [];
  const epa = metrics.find((metric) => /epa|dha/i.test(metric.key + metric.label));
  const peroxide = metrics.find((metric) => /peroxide|过氧|anisidine|酸值/i.test(metric.key + metric.label));
  const coldChain = lifecycle?.events.find((event) => event.stage === "cold_chain");
  const missing = product?.parameterDetails?.find((detail) => detail.status === "missing")
    ?? (overview?.verification?.reasons?.[0] ? { label: zh ? "还需补证" : "Evidence gap", rule: overview.verification.reasons[0], status: "missing" as const } : null);
  const cards = [
    { icon: "◌", label: epa?.label ?? (zh ? "EPA+DHA（含量）" : "EPA+DHA"), value: epa ? `${epa.value}${epa.unit ? ` ${epa.unit}` : ""}` : (zh ? "未登记" : "Not registered"), rule: epa?.rule ?? (zh ? "缺少当前批次指标" : "No batch parameter"), status: epa?.status ?? "missing", source: epa ? (zh ? "产品指标记录" : "Product metric record") : (zh ? "未找到证据" : "No evidence") },
    { icon: "⌬", label: peroxide?.label ?? (zh ? "过氧化值（氧化稳定性）" : "Peroxide value"), value: peroxide ? `${peroxide.value}${peroxide.unit ? ` ${peroxide.unit}` : ""}` : (zh ? "未登记" : "Not registered"), rule: peroxide?.rule ?? (zh ? "缺少当前批次指标" : "No batch parameter"), status: peroxide?.status ?? "missing", source: peroxide ? (zh ? "检测指标记录" : "Testing metric record") : (zh ? "未找到证据" : "No evidence") },
    { icon: "✣", label: zh ? "冷链异常（运输与存储）" : "Cold-chain status", value: coldChain ? (coldChain.status === "verified" || coldChain.status === "synced" ? (zh ? "未发现异常" : "No anomaly found") : coldChain.status) : (zh ? "未登记" : "Not registered"), rule: coldChain?.detail ?? (zh ? "暂无冷链记录" : "No cold-chain record"), status: coldChain?.status === "verified" || coldChain?.status === "synced" ? "pass" : "missing", source: coldChain ? (zh ? "冷链生命周期记录" : "Cold-chain lifecycle") : (zh ? "未找到证据" : "No evidence") },
    { icon: "□", label: missing?.label ?? (zh ? "缺失资料" : "Missing evidence"), value: missing ? (zh ? "缺失" : "Missing") : (zh ? "暂无明确缺口" : "No explicit gap"), rule: safeText(missing?.rule, zh ? "查询后由 Verifier 返回" : "Returned by Verifier"), status: missing ? "missing" : "pass", source: missing ? (zh ? "Verifier 缺口" : "Verifier gap") : (zh ? "批次核验结果" : "Batch verification") },
  ];
  return <section className="agent-demo-evidence-grid" aria-label={zh ? "这批我找到的记录" : "Evidence overview"}>
    <div className="agent-demo-section-title"><div><span className="agent-demo-kicker">{zh ? "我找到的记录" : "RECORDS FOUND"}</span><h2>{zh ? "这批货查到了什么" : "What I found for this batch"}</h2></div><span>{zh ? "来自这批货的实时查询" : "Live batch lookup"}</span></div>
    <div className="agent-demo-metric-grid">{cards.map((card) => <article className={`agent-demo-metric-card ${card.status}`} key={card.label}><div className="agent-demo-metric-head"><span className="agent-demo-metric-icon">{card.icon}</span><strong>{card.label}</strong></div><b>{card.value}</b><small>{card.rule}</small><div className="agent-demo-metric-meta"><span>{card.source}</span><em>{card.status === "pass" ? (zh ? "已登记" : "Registered") : (zh ? "需补充" : "Needs evidence")}</em></div></article>)}</div>
  </section>;
}

function OnChainRecordCard({ chain, batchId, zh }: { chain: ChainStatusData | null; batchId: string; zh: boolean }) {
  const history = (chain?.verifiedTransactions ?? []).filter((item) => item.batchId === batchId);
  const session = (chain?.sessionTransactions ?? []).filter((item) => item.batchId === batchId);
  const state = chain?.businessStatus ?? chain?.deploymentStatus ?? "anchor_pending";
  return <aside className="agent-demo-chain-card" aria-label={zh ? "记录如何留存" : "On-chain record"}>
    <div className="agent-demo-card-title"><span>↗</span><h2>{zh ? "记录如何留存" : "HOW THE RECORD IS KEPT"}</h2></div>
    <div className="agent-demo-chain-badge"><strong>Chain {chain?.chainId ?? 677}</strong><span>{state}</span></div>
    <div className="agent-demo-chain-summary"><div><span>{zh ? "网络" : "Network"}</span><b>{chain?.chainName ?? "BOT Chain"}</b></div><div><span>{zh ? "RPC" : "RPC"}</span><b className={chain?.liveRpc.reachable ? "ok" : "warn"}>{chain?.liveRpc.reachable ? (zh ? "可达" : "Reachable") : (zh ? "不可达" : "Unavailable")}</b></div><div><span>{zh ? "历史事件" : "History"}</span><b>{history.length}</b></div><div><span>{zh ? "当前会话 receipt" : "Current receipt"}</span><b>{session.length > 0 ? session.length : (zh ? "无" : "None")}</b></div></div>
    <div className="agent-demo-chain-events">{history.length ? history.slice(0, 4).map((item) => <a href={item.explorerUrl ?? chain?.explorerUrl} target="_blank" rel="noreferrer" key={`${item.event}-${item.txHash}`}><span><strong>{item.label ?? item.event}</strong><small>block {item.blockNumber} · {zh ? "历史回放" : "historical replay"}</small></span><code>{item.txHash.slice(0, 10)}…</code></a>) : <p>{zh ? "当前批次暂无历史事件。" : "No history for this batch."}</p>}</div>
    <p className="agent-demo-boundary">{session.length > 0 ? (zh ? "当前会话 receipt 已返回，仍需核对业务事件和 batchId。" : "A current receipt exists; validate the event and batchId.") : (zh ? "当前会话 receipt：无。历史回放不等于本次购买完成。" : "Current receipt: none. Historical replay does not confirm this purchase.")}</p>
  </aside>;
}

function BatchProcessMap({ lifecycle, busy, answered, zh }: { lifecycle: LifecycleView | null; busy: boolean; answered: boolean; zh: boolean }) {
  return <section className="agent-demo-process-card" aria-label={zh ? "这批货经过哪些环节" : "Batch inspection flow"}>
    <div className="agent-demo-card-title"><span>▱</span><div><h2>{zh ? "这批货经过哪些环节" : "BATCH JOURNEY"}</h2><small>{busy ? (zh ? "正在查这批货" : "Agent running") : (zh ? "按这批货的记录更新" : "Updated from this batch")}</small></div></div>
    <div className="agent-demo-process-track">{lifecycleNodes.map((node) => { const event = lifecycle?.events.find((item) => item.stage === node.stage); const isQuery = node.stage === "consumer_query"; const status = isQuery ? (busy ? "active" : answered ? "completed" : "pending") : event?.status ?? "pending"; return <div className={`agent-demo-process-node ${status}`} key={node.stage}><span>{node.icon}</span><strong>{zh ? node.zh : node.en}</strong><small>{isQuery ? (zh ? "扫描 / 批次查询" : "Scan / batch query") : (event?.detail ?? (zh ? "等待资料" : "Waiting for record"))}</small></div>; })}</div>
  </section>;
}

function SearchSteps({ events, zh }: { events: ChatEvent[]; zh: boolean }) {
  const latest = new Map<string, ChatEvent>();
  for (const event of events) if (event.stage) latest.set(event.stage, event);
  const answerEvent = [...events].reverse().find((event) => event.kind === "answer" || event.kind === "done");
  const hasAnswer = Boolean(answerEvent);
  const hasFallback = events.some((event) => Boolean(event.providerIssue) || event.runtimeStatus === "fallback" || event.runtimeStatus === "billing_required" || event.runtimeStatus === "unauthorized" || event.runtimeStatus === "rate_limited" || event.runtimeStatus === "invalid_response");
  const latestIndex = searchSteps.reduce((index, step, stepIndex) => latest.has(step.key) ? stepIndex : index, -1);
  return <section className="agent-demo-search-card"><div className="agent-demo-card-title"><span>⌁</span><div><h2>{zh ? "我正在查什么" : "WHAT I AM CHECKING"}</h2><small>{zh ? "先找记录，再把结果讲明白" : "Every step has a source"}</small></div></div><div className="agent-demo-search-list">{searchSteps.map((step, index) => {
    const event = latest.get(step.key);
    const finalStep = step.key === "model_completed";
    const raw = finalStep && hasAnswer ? (hasFallback ? "fallback" : "completed") : event ? statusFromChat(event) : "pending";
    const status = raw === "active" && index < latestIndex ? "completed" : raw;
    const detail = finalStep && hasAnswer
      ? (hasFallback ? (zh ? "模型请求未通过，已使用当前批次资料安全回退。" : "The model request did not pass; the current batch records were used safely.") : (zh ? "回答已生成，并通过引用与格式校验。" : "The answer is ready and passed citation and format checks."))
      : event?.detail ?? (zh ? step.detailZh : step.detailEn);
    return <article className={`agent-demo-search-step ${status}`} key={step.key}><span>{status === "completed" ? "✓" : index + 1}</span><div><strong>{zh ? step.zh : step.en}</strong><p>{detail}</p></div><em>{statusLabel(status, zh)}</em></article>;
  })}</div></section>;
}

export function AgentDemoDashboard({ site, locale = "zh" }: { site: TenantSiteConfig; locale?: DemoLocale }) {
  const zh = locale === "zh";
  const [batchId] = useState(() => currentBatch(site));
  const [overview, setOverview] = useState<PublicBatchOverview | null>(null);
  const [product, setProduct] = useState<ProductBatch | null>(null);
  const [lifecycle, setLifecycle] = useState<LifecycleView | null>(null);
  const [chain, setChain] = useState<ChainStatusData | null>(null);
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [meta, setMeta] = useState<ChatEvent | undefined>();
  const [verifyState, setVerifyState] = useState<VerifyState>("idle");
  const [busy, setBusy] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [runningDemo, setRunningDemo] = useState(false);
  const autoRun = useRef(true);

  const refreshData = useCallback(async () => {
    const [nextOverview, nextProduct, nextLifecycle, nextChain] = await Promise.all([
      fetchBatchOverview(batchId),
      fetchProduct(batchId),
      fetchLifecycle(batchId),
      fetchChainStatus(),
    ]);
    setOverview(nextOverview);
    setProduct(nextProduct);
    setLifecycle(nextLifecycle);
    setChain(nextChain);
  }, [batchId]);

  useEffect(() => { void refreshData().catch(() => undefined); const timer = window.setInterval(() => { void refreshData().catch(() => undefined); }, 10000); return () => window.clearInterval(timer); }, [refreshData]);

  const handleFlowEvent = useCallback((event: ChatEvent) => { setEvents((previous) => [...previous.slice(-60), event]); if (event.kind === "meta") setMeta(event); if (event.kind === "answer" || event.kind === "done") setAnswered(true); }, []);
  const runDemo = useCallback(async () => {
    if (runningDemo || site.product.demoMode !== "demo/synthetic") return;
    setRunningDemo(true);
    try {
      for (const stage of ["production", "inspection", "cold_chain", "shipment"] as LifecycleStage[]) {
        const next = await simulateLifecycleStage(batchId, stage);
        setLifecycle(next);
      }
      await refreshData();
    } finally { setRunningDemo(false); }
  }, [batchId, refreshData, runningDemo, site.product.demoMode]);

  const agentStatus = meta?.modelAssisted ? (zh ? "已经按记录回答" : "Answered from records") : meta?.providerIssue ? (zh ? "记录可以查，先按登记资料回答" : "Records available; using registered data") : (zh ? "只按登记资料回答" : "Registered data only");
  const headerBatch = overview?.batchId ?? batchId;
  const contextSummary = useMemo(() => `${site.product.name} · ${headerBatch}`, [headerBatch, site.product.name]);

  return <div className="agent-demo-dashboard">
    <header className="agent-demo-header"><a className="agent-demo-brand" href="/"><span>◆</span><strong>TruthPass</strong><small>· 查货助手</small></a><span className="agent-demo-ribbon">{site.product.demoMode === "demo/synthetic" ? (zh ? "公开体验" : "PUBLIC DEMO") : (zh ? "正式资料" : "PRODUCTION")}</span><nav><a href={zh ? "/product" : "/en/product"}>{zh ? "使用说明" : "Guide"}</a><a href={zh ? "/" : "/en"}>{zh ? "关于 TruthPass" : "About"}</a></nav></header>
    <section className="agent-demo-hero"><div><span className="agent-demo-kicker">{zh ? "先看记录，再决定。" : "READ THE RECORD FIRST."}</span><h1>{zh ? "买之前，先看这批货。" : "See the batch before you buy."}</h1><p>{contextSummary} · {zh ? "你不用学怎么问。把包装上的批次号给我，或者直接问一句；我去找生产、检测、运输和保存记录，查到什么就告诉你。" : "Give me the batch number or ask a question. I will find the production, testing, delivery, and storage records and tell you what is there."}</p><div className="agent-demo-hero-actions"><button type="button" className="agent-demo-primary-action" onClick={() => document.getElementById("agent")?.scrollIntoView({ behavior: "smooth", block: "center" })}>{zh ? "直接问我" : "Ask me"} <span aria-hidden="true">→</span></button><button type="button" className="agent-demo-secondary-action" onClick={() => void runDemo()} disabled={runningDemo}>{runningDemo ? (zh ? "记录更新中…" : "Updating…") : (zh ? "看一遍完整流程" : "See the full flow")}</button></div><small className="agent-demo-hero-note">{zh ? "不用记命令，问一句就行。" : "No command to learn. Just ask."}</small></div></section>
    <main className="agent-demo-main">
      <section className="agent-demo-conversation-card"><div className="agent-demo-card-title"><span>◌</span><div><h2>{zh ? "这批货的 Agent" : "YOUR PRODUCT AGENT"}</h2><small>{agentStatus} · {zh ? "只根据查到的记录说话" : "Registered records only"}</small></div></div><ChatPanel onStart={() => { setBusy(true); setVerifyState("running"); setEvents([]); setAnswered(false); autoRun.current = false; }} onDone={() => { setBusy(false); setVerifyState("done"); setAnswered(true); void refreshData(); }} onMeta={(value) => setMeta(value as ChatEvent | undefined)} onFlowEvent={handleFlowEvent} onBatch={() => undefined} batchId={batchId} autoQueryBatch={autoRun.current ? batchId : null} locale={locale} productLabel={site.product.name} minimal /></section>
      <div className="agent-demo-center"><BatchProcessMap lifecycle={lifecycle} busy={busy} answered={answered} zh={zh} /><SearchSteps events={events} zh={zh} /></div>
      <OnChainRecordCard chain={chain} batchId={batchId} zh={zh} />
    </main>
    <EvidenceMetricGrid product={product} overview={overview} lifecycle={lifecycle} zh={zh} />
    <footer className="agent-demo-footer"><span>{zh ? "资料来源" : "Source"}：{overview?.dataMode ?? site.product.demoMode}</span><span>{zh ? "区块链保存摘要和责任事件；它不替商品做质量承诺。" : "The chain stores summaries and responsibility events; it does not promise product quality."}</span><span>{verifyState === "done" ? (zh ? "本次查询已返回" : "Query returned") : (zh ? "等待查询" : "Waiting")}</span></footer>
  </div>;
}
