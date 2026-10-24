import { useEffect, useState } from "react";
import { fetchAgentStatus, fetchChainStatus, fetchJevDetection, postChat } from "../api";
import type { ChainStatusData, ChatEvent, JevDetection } from "../types";

type RiceLocale = "zh" | "en";

const RICE_BATCH = "RC-2026-001";

const evidence = {
  zh: [
    ["产地", "黑龙江五常 · 生产方口述与批次标签"],
    ["天气", "生长期累计降雨 412 mm · 记录已关联"],
    ["土壤", "pH 6.4 · 有机质 3.1% · 样品 S-RC-001"],
    ["农残检测", "48 项筛查 · 送检报告 LAB-RC-001"],
    ["仓储运输", "温度 4–12°C · 2 次设备回传"],
  ],
  en: [
    ["Origin", "Wuchang, Heilongjiang · producer statement and batch label"],
    ["Weather", "412 mm rainfall during growth · linked record"],
    ["Soil", "pH 6.4 · organic matter 3.1% · sample S-RC-001"],
    ["Residue test", "48-screen panel · report LAB-RC-001"],
    ["Storage & delivery", "4–12°C · two device readings"],
  ],
} as const;

const timeline = {
  zh: [
    ["种植", "已记录", "产地、天气、土壤资料"],
    ["采收", "已记录", "批次 RC-2026-001"],
    ["检测", "已核验", "48 项农残筛查"],
    ["仓储", "已同步", "温控设备回传"],
    ["购买反馈", "待积累", "真实购买后再统计"],
  ],
  en: [
    ["Growing", "Recorded", "Origin, weather, soil"],
    ["Harvest", "Recorded", "Batch RC-2026-001"],
    ["Testing", "Checked", "48-screen residue panel"],
    ["Storage", "Synced", "Temperature device readings"],
    ["Buyer feedback", "Waiting", "Aggregated after purchase"],
  ],
} as const;

const prompts = {
  zh: ["这批米的产地有依据吗？", "农残检测怎么看？", "现在能查到链上记录吗？"],
  en: ["Is the origin supported?", "How should I read the residue test?", "Is there a chain record yet?"],
} as const;

export function RiceCasePage({ locale }: { locale: RiceLocale }) {
  const zh = locale === "zh";
  const [agentStatus, setAgentStatus] = useState<{ agentMode?: string; model?: string | null; status?: string }>({});
  const [jev, setJev] = useState<JevDetection | null>(null);
  const [chain, setChain] = useState<ChainStatusData | null>(null);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [meta, setMeta] = useState<ChatEvent | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([fetchAgentStatus(), fetchJevDetection(RICE_BATCH), fetchChainStatus()]).then((results) => {
      if (cancelled) return;
      const [agent, detection, chainStatus] = results;
      if (agent.status === "fulfilled") setAgentStatus(agent.value);
      if (detection.status === "fulfilled" && detection.value?.batchId === RICE_BATCH) setJev(detection.value);
      if (chainStatus.status === "fulfilled") setChain(chainStatus.value);
    });
    return () => { cancelled = true; };
  }, []);

  const askAgent = async (value: string) => {
    const prompt = value.trim();
    if (!prompt || busy) return;
    setQuestion(prompt);
    setBusy(true);
    setError("");
    setAnswer("");
    setMeta(null);
    try {
      await postChat(`${prompt}\n请只使用批次 ${RICE_BATCH} 的登记资料回答，并明确说明演示资料和缺口。`, RICE_BATCH, (event) => {
        if (event.kind === "meta") {
          if (event.batchId && event.batchId !== RICE_BATCH) {
            setError(zh ? "Agent 返回了不匹配的批次，已停止展示。" : "The Agent returned a different batch, so it was hidden.");
            return;
          }
          setMeta(event);
        }
        if (event.kind === "line" && event.text) setAnswer((current) => current + event.text);
      });
    } catch {
      setError(zh ? "当前无法连接商品 Agent。页面仍只展示已登记的演示资料。" : "The product Agent is unavailable. Registered demo evidence is still shown.");
      setAnswer(zh ? "这批资料目前可以看到产地、检测和仓储记录。链上状态还没有真实回执，不能说已经完成上链。" : "This record includes origin, testing, and storage details. There is no live receipt yet, so it cannot be described as anchored.");
    } finally {
      setBusy(false);
    }
  };

  const dataLabel = zh ? "演示资料 · 不能替代真实商品认证" : "DEMO / SYNTHETIC · NOT CERTIFICATION";
  const chainLabel = jev?.status ?? jev?.chainStatus ?? "anchor_pending";
  // The per-request SSE meta is authoritative for this answer. The initial
  // /api/agent/status only describes configured capability and may be stale if
  // the provider failed, rate-limited, or fell back for this request.
  const requestStatus = meta?.serviceStatus ?? meta?.agentMode ?? agentStatus.agentMode;
  const modelActuallyUsed = meta?.modelAssisted === true && requestStatus === "model_assisted";
  const agentLabel = modelActuallyUsed
    ? (zh ? `${meta?.provider ?? "DeepSeek"} · 已参与解释` : `${meta?.provider ?? "DeepSeek"} · explanation active`)
    : requestStatus === "provider_unavailable"
      ? (zh ? "模型暂不可用 · 基础资料仍可查" : "Model unavailable · evidence remains available")
      : requestStatus === "rate_limited"
        ? (zh ? "请求受限 · 使用基础回答" : "Rate limited · fallback answer")
        : requestStatus === "maintenance"
          ? (zh ? "服务维护中 · 使用基础回答" : "Maintenance · fallback answer")
      : (zh ? "基础回答 · 模型未参与" : "Fallback answer · model not used");
  const evidenceCount = meta ? (meta.evidenceIds?.length ?? 0) : null;

  return (
    <div className={`tp-rice-case ${zh ? "tp-lang-zh" : "tp-lang-en"}`}>
      <header className="tp-rice-header">
        <a href={zh ? "/" : "/en"} className="tp-brand" aria-label="TruthPass"><span className="tp-brand-word">TruthPass</span><img src="/assets/brand-mark.svg" alt="" aria-hidden="true" /></a>
        <nav aria-label={zh ? "案例导航" : "Case navigation"}><a href={zh ? "/" : "/en"}>{zh ? "首页" : "Home"}</a><a className="active" href={zh ? "/cases/rice" : "/en/cases/rice"}>{zh ? "大米案例" : "Rice case"}</a><a href={zh ? "/?view=consumer&batch=RC-2026-001" : "/en?view=consumer&batch=RC-2026-001"}>{zh ? "商品查询" : "Product check"}</a></nav>
        <span className="tp-rice-status">{zh ? "公开案例" : "OPEN CASE"}</span>
      </header>

      <main>
        <section className="tp-rice-hero">
          <div><span className="tp-kicker">{zh ? "案例集 · 一粒米" : "CASE FILE · ONE GRAIN OF RICE"}</span><span className="tp-demo-ribbon">{dataLabel}</span><h1>{zh ? <>一粒米，<br /><span>先看证据。</span></> : <>One grain.<br /><span>See the record first.</span></>}</h1><p>{zh ? "产地、天气、土壤、检测和运输，按同一个批次串起来。" : "Origin, weather, soil, testing, and delivery linked to one batch."}</p><div className="tp-rice-hero-actions"><a className="tp-red-btn" href="#evidence">{zh ? "看证据" : "View evidence"} →</a><a className="tp-paper-btn" href="#agent">{zh ? "问商品助手" : "Ask the Agent"} →</a></div></div>
          <aside className="tp-rice-batch-card"><span>{zh ? "当前演示批次" : "DEMO BATCH"}</span><strong>{RICE_BATCH}</strong><small>{zh ? "东北稻米 · 合成演示资料" : "Northeast rice · synthetic record"}</small><div><b>{zh ? "证据完整度" : "Evidence"}</b><strong>82%</strong></div></aside>
        </section>

        <section className="tp-rice-facts" id="evidence"><div className="tp-rice-section-head"><span className="tp-kicker">{zh ? "证据卡" : "EVIDENCE CARD"}</span><h2>{zh ? "每件资料，都回到这一个批次。" : "Every record returns to this batch."}</h2><p>{zh ? "原始文件链下保存，公开层展示来源、状态和缺口。" : "Raw files stay off-chain; the public view shows source, status, and gaps."}</p></div><div className="tp-rice-evidence-grid">{evidence[locale].map(([label, detail], index) => <article key={label}><span>{label}</span><strong>{detail}</strong><b className="tp-rice-verified">{index === evidence[locale].length - 1 ? (zh ? "待积累" : "WAITING") : (zh ? "已登记" : "RECORDED")}</b></article>)}</div></section>

        <section className="tp-rice-timeline"><div className="tp-rice-section-head"><span className="tp-kicker">{zh ? "生命周期" : "LIFECYCLE"}</span><h2>{zh ? "先把事实排好，再谈结论。" : "Order the facts before drawing a conclusion."}</h2></div><div className="tp-rice-timeline-track">{timeline[locale].map(([title, status, detail], index) => <article key={title}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{title}</strong><b>{status}</b><small>{detail}</small></div>{index < timeline[locale].length - 1 && <i aria-hidden="true">→</i>}</article>)}</div></section>

        <section className="tp-rice-agent" id="agent"><div className="tp-rice-agent-head"><div><span className="tp-kicker">{zh ? "商品助手" : "PRODUCT AGENT"}</span><h2>{zh ? "你问什么，我查什么。" : "Ask once. Get the record."}</h2><p>{zh ? "Verifier 先查规则，JEV 决定分流，模型只把已登记事实讲清楚。" : "The Verifier checks rules, JEV routes the case, and the model explains registered facts."}</p></div><div className="tp-rice-agent-badges"><span>{agentLabel}</span><span>{zh ? "JEV · 已分流" : "JEV · routed"}</span></div></div><div className="tp-rice-agent-grid"><div className="tp-rice-chat"><div className="tp-rice-chat-log" aria-live="polite">{answer ? <p><b>{zh ? "Agent" : "Agent"}</b>{answer}</p> : <p className="muted">{zh ? "点一个问题，看看 Agent 如何引用这批资料。" : "Choose a question to see how the Agent cites this batch."}</p>}{busy && <p className="muted">{zh ? "正在读取批次证据…" : "Reading batch evidence…"}</p>}{error && <p className="error">{error}</p>}</div><div className="tp-rice-prompts">{prompts[locale].map((prompt) => <button type="button" key={prompt} onClick={() => void askAgent(prompt)} disabled={busy}>{prompt}</button>)}</div><form onSubmit={(event) => { event.preventDefault(); void askAgent(question); }}><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder={zh ? "例如：农残检测怎么看？" : "For example: how do I read the test?"} /><button type="submit" className="tp-red-btn" disabled={busy}>{busy ? "…" : (zh ? "问" : "Ask")}</button></form></div><aside className="tp-rice-run-card"><span className="tp-kicker">{zh ? "回答依据" : "ANSWER TRACE"}</span><div><b>{zh ? "规则核验" : "Verifier"}</b><strong>{meta?.pipelineDetail?.verifier?.status ?? "review"}</strong></div><div><b>JEV</b><strong>{meta?.pipelineDetail?.jev?.decision ?? jev?.routeDecision ?? "request_more_evidence"}</strong></div><div><b>DeepSeek</b><strong>{modelActuallyUsed ? (zh ? "已参与" : "active") : requestStatus === "provider_unavailable" ? (zh ? "暂不可用" : "unavailable") : (zh ? "未参与 · fallback" : "not used · fallback")}</strong></div><div><b>{zh ? "引用资料" : "Evidence"}</b><strong>{evidenceCount === null ? "—" : `${evidenceCount} ${zh ? "条" : "items"}`}</strong></div><div><b>{zh ? "链状态" : "Chain"}</b><strong>{chainLabel}</strong></div>{meta?.traceId && <small>Trace ID · {meta.traceId}</small>}{chain?.liveRpc && <small>{zh ? `BOT Chain ${chain.chainId} RPC：${chain.liveRpc.reachable ? "可达" : "不可达"}` : `BOT Chain ${chain.chainId} RPC: ${chain.liveRpc.reachable ? "reachable" : "unreachable"}`}</small>}<p>{zh ? "没有真实 receipt 时，不显示已上链。" : "No live receipt means no anchored claim."}</p></aside></div></section>

        <section className="tp-rice-feedback"><div><span className="tp-kicker">{zh ? "购买后口碑" : "BUYER FEEDBACK"}</span><h2>{zh ? "先有购买，再有评价。" : "Purchase first. Feedback follows."}</h2><p>{zh ? "当前为合成演示，真实口碑要绑定购买凭证后才进入统计。" : "This is synthetic demo data. Real feedback enters only with a purchase receipt."}</p></div><div className="tp-rice-feedback-stat"><strong>0</strong><span>{zh ? "真实购买反馈" : "verified buyer reports"}</span></div><div className="tp-rice-feedback-stat"><strong>—</strong><span>{zh ? "当前口碑结论" : "current reputation"}</span></div></section>
      </main>

      <footer className="tp-rice-footer"><span>TruthPass</span><span>{dataLabel}</span><a href={zh ? "/merchant" : "/en/merchant"}>{zh ? "企业如何接入 →" : "How businesses join →"}</a></footer>
    </div>
  );
}

