import { useCallback, useEffect, useRef, useState } from "react";
import { ChatPanel } from "./ChatPanel";
import { AgentDataFlowRail, type AgentFlowEvent, type AgentFlowStatus } from "./AgentDataFlowRail";
import { EvidencePanel } from "./EvidencePanel";
import { ProductPanel } from "./ProductPanel";
import { MerchantApp } from "./MerchantApp";
import { InstitutionReviewPanel } from "./InstitutionReviewPanel";
import { useWallet, WALLET_ROLE_LABELS, type WalletRole } from "./WalletContext";
import type { ChatEvent, VerifyState, LifecycleView, PublicBatchOverview } from "../types";
import type { ConsumerAgentStage } from "./ConsumerFlowBar";
import type { TenantSiteConfig } from "../siteConfig";
import { fetchAgentStatus, fetchBatchOverview, fetchLifecycle } from "../api";

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
  const consumerLabels: Array<[TenantView, string, string]> = [
    ["home", zh ? "首页" : "Home", localizedSiteRoute(site, "home", locale, batchId)],
    ["agent", zh ? "商品助手" : "Agent", localizedSiteRoute(site, "agent", locale, batchId)],
    ["wallet", zh ? "钱包身份" : "Wallet", localizedSiteRoute(site, "wallet", locale, batchId)],
  ];
  const workspaceLabels: Array<[TenantView, string, string]> = [
    ["merchant", zh ? "企业工作台" : "Merchant", localizedSiteRoute(site, "merchant", locale, batchId)],
    ["institution", zh ? "机构审核" : "Institution", localizedSiteRoute(site, "institution", locale, batchId)],
    ["developers", zh ? "开发者" : "Developers", routeFor(site, "developers", locale)],
  ];
  const isConsumerView = view === "home" || view === "agent" || view === "wallet";
  const alternateLocale = zh ? "en" : "zh";
  const localeHref = localizedSiteRoute(site, view, alternateLocale, view === "developers" ? undefined : batchId);
  return (
    <header className="tenant-site-header">
      <a className="tp-brand" href={localizedSiteRoute(site, "home", locale, batchId)} aria-label={`${site.brand.name} TruthPass`}>
        <span className="tp-brand-word">TruthPass</span><span className="tenant-site-mark">{site.brand.mark}</span>
      </a>
      <div className="tenant-site-context"><strong>{site.brand.name}</strong><span>{site.product.name}</span></div>
      <nav aria-label={zh ? "企业站点导航" : "Site navigation"}>
        {(isConsumerView ? consumerLabels : [...consumerLabels, ...workspaceLabels]).map(([key, label, href]) => <a key={key} className={view === key ? "active" : ""} href={href}>{label}</a>)}
      </nav>
      {isConsumerView && (
        <details className="tenant-nav-more">
          <summary>{zh ? "更多" : "More"}</summary>
          <div className="tenant-nav-more-menu">
            {workspaceLabels.map(([key, label, href]) => <a key={key} className={view === key ? "active" : ""} href={href}>{label}</a>)}
          </div>
        </details>
      )}
      {site.locale.supported.includes(alternateLocale) && <a className="tenant-language-link" href={localeHref}>{zh ? "EN" : "中文"}</a>}
      <a className="tenant-back-link" href={`${zh ? "/" : "/en"}?view=consumer&batch=${encodeURIComponent(batchId)}`}>{zh ? "回到 TruthPass" : "Back to TruthPass"}</a>
    </header>
  );
}

function SiteStateBar({ site, locale, view, batchId }: { site: TenantSiteConfig; locale: "zh" | "en"; view: TenantView; batchId: string }) {
  const zh = locale === "zh";
  return (
    <div className="tenant-site-statebar">
      <span className="tp-demo-ribbon">{site.product.demoMode === "demo/synthetic" ? (zh ? "演示资料 · 不能替代真实商品认证" : "DEMO / SYNTHETIC · NOT CERTIFICATION") : (zh ? "正式资料" : "PRODUCTION DATA")}</span>
      <span>{zh ? `当前页面：${view === "home" ? "消费者首页" : view}` : `Current page: ${view}`}</span>
      <span>{zh ? `当前批次 ${batchId}` : `Current batch ${batchId}`}</span>
    </div>
  );
}

function TenantHome({ site, locale }: { site: TenantSiteConfig; locale: "zh" | "en" }) {
  const zh = locale === "zh";
  const [batch, setBatch] = useState(() => currentBatch(site));
  const base = routeFor(site, "home", locale);
  const [scanMessage, setScanMessage] = useState("");
  const [cameraOpen, setCameraOpen] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const openBatch = (candidate: string) => {
    const normalized = candidate.trim().toUpperCase();
    const scoped = scopedBatch(site, normalized);
    if (!normalized || scoped !== normalized) {
      setScanMessage(zh ? `这不是${site.brand.name}站点的批次号，请检查包装或切换企业站点。` : `That batch is not registered for ${site.brand.name}. Check the package or switch sites.`);
      return;
    }
    window.location.href = `${routeFor(site, "agent", locale)}?batch=${encodeURIComponent(scoped)}`;
  };
  const scanQr = async (file: File) => {
    try {
      const Detector = (window as unknown as { BarcodeDetector?: new (options?: { formats?: string[] }) => { detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>> } }).BarcodeDetector;
      if (!Detector) throw new Error("当前浏览器不支持二维码识别");
      const bitmap = await createImageBitmap(file);
      const results = await new Detector({ formats: ["qr_code"] }).detect(bitmap);
      const value = results[0]?.rawValue;
      if (!value) throw new Error("没有识别到二维码");
      const url = new URL(value, window.location.origin);
      const scannedBatch = url.searchParams.get("batch")?.trim().toUpperCase();
      if (!scannedBatch) throw new Error("二维码没有绑定批次号");
      openBatch(scannedBatch);
    } catch (error) {
      setScanMessage(error instanceof Error ? error.message : (zh ? "二维码识别失败" : "Could not read the QR code"));
    }
  };
  useEffect(() => {
    if (!cameraOpen) return;
    let active = true;
    let stream: MediaStream | undefined;
    let frame = 0;
    const scanCamera = async () => {
      try {
        const Detector = (window as unknown as { BarcodeDetector?: new (options?: { formats?: string[] }) => { detect: (source: ImageBitmapSource) => Promise<Array<{ rawValue?: string }>> } }).BarcodeDetector;
        if (!Detector || !navigator.mediaDevices?.getUserMedia) throw new Error(zh ? "当前浏览器不支持相机扫码，请上传二维码图片。" : "Camera scanning is unavailable; upload a QR image instead.");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        if (!active || !videoRef.current) return;
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        const detector = new Detector({ formats: ["qr_code"] });
        const tick = async () => {
          if (!active || !videoRef.current) return;
          try {
            const result = await detector.detect(videoRef.current);
            const value = result[0]?.rawValue;
            if (value) {
              const url = new URL(value, window.location.origin);
              const scannedBatch = url.searchParams.get("batch")?.trim().toUpperCase();
              if (scannedBatch) openBatch(scannedBatch);
            }
          } catch { /* camera frames can be unavailable while the video initializes */ }
          frame = window.requestAnimationFrame(() => void tick());
        };
        frame = window.requestAnimationFrame(() => void tick());
      } catch (error) {
        setScanMessage(error instanceof Error ? error.message : (zh ? "相机扫码失败" : "Camera scan failed"));
        setCameraOpen(false);
      }
    };
    void scanCamera();
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, [cameraOpen, locale, site, zh]);
  return (
    <main className="tenant-site-main">
      <section className="tenant-hero">
        <div>
          <p className="tp-kicker">{zh ? "企业商品官网 · 公开证据" : "PRODUCT SITE · OPEN EVIDENCE"}</p>
          <span className="tp-demo-ribbon">{zh ? "每一件资料，都回到一个批次" : "Every record returns to one batch"}</span>
          <h1>{site.brand.slogans[locale]}</h1>
          <p className="tenant-lead">{site.product.description}</p>
          <div className="tenant-hero-actions">
            <a className="tp-red-btn" href={`${base}/agent?batch=${encodeURIComponent(scopedBatch(site, batch))}`}>{zh ? "查看这批依据" : "View this batch"} →</a>
            <a className="tp-paper-btn" href={localizedSiteRoute(site, "wallet", locale, scopedBatch(site, batch))}>{zh ? "钱包身份" : "Wallet identity"} →</a>
          </div>
        </div>
        <form className="tenant-batch-card" onSubmit={(event) => { event.preventDefault(); openBatch(batch); }}>
          <span className="tp-kicker">{zh ? "查一批商品" : "INSPECT A BATCH"}</span>
          <h2>{zh ? "先看清，再下单。" : "Check first. Buy next."}</h2>
          <label htmlFor="tenant-batch">{zh ? "批次号" : "Batch ID"}</label>
          <div><input id="tenant-batch" value={batch} onChange={(event) => setBatch(event.target.value.toUpperCase())} /><button className="tp-red-btn" type="submit">{zh ? "查询" : "Inspect"}</button></div>
          <small>{zh ? "Agent 会把能确认的事实、缺口和下一步讲清楚。" : "The Agent explains what is known, missing, and next."}</small>
          <label className="tenant-qr-upload">{zh ? "上传包装二维码" : "Upload package QR"}<input type="file" accept="image/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) void scanQr(file); }} /></label>
          <button type="button" className="tenant-camera-button" onClick={() => { setScanMessage(""); setCameraOpen(true); }}>{zh ? "打开相机扫码" : "Scan with camera"}</button>
          {scanMessage && <small className="tenant-scan-message" role="status">{scanMessage}</small>}
          {cameraOpen && <div className="tenant-camera-box"><video ref={videoRef} muted playsInline aria-label={zh ? "二维码相机预览" : "QR camera preview"} /><button type="button" onClick={() => setCameraOpen(false)}>{zh ? "关闭相机" : "Close camera"}</button></div>}
        </form>
      </section>
      <section className="tenant-fact-grid">
        {site.batch.evidenceCategories.slice(0, 3).map((item, index) => <article key={item}><b>0{index + 1}</b><strong>{item}</strong><span>{zh ? "已绑定当前批次" : "Linked to this batch"}</span></article>)}
      </section>
      <section className="tenant-route-grid">
        <a href={localizedSiteRoute(site, "agent", locale, scopedBatch(site, batch))}><span className="tp-kicker">{zh ? "消费者" : "CONSUMER"}</span><h2>{zh ? "问商品助手" : "Ask the product Agent"}</h2><p>{zh ? "结论、依据、不确定、下一步。" : "Conclusion, sources, uncertainty, next step."}</p></a>
        <a href={localizedSiteRoute(site, "merchant", locale, scopedBatch(site, batch))}><span className="tp-kicker">{zh ? "企业" : "BUSINESS"}</span><h2>{zh ? "把资料整理清楚" : "Make the record legible"}</h2><p>{zh ? "上传、核验、确认、发布。" : "Collect, verify, confirm, publish."}</p></a>
        <a href={localizedSiteRoute(site, "institution", locale, scopedBatch(site, batch))}><span className="tp-kicker">{zh ? "机构" : "INSTITUTION"}</span><h2>{zh ? "一批一查" : "Review one batch at a time"}</h2><p>{zh ? "检测、签名、争议都有记录。" : "Testing, signatures, and disputes stay recorded."}</p></a>
      </section>
    </main>
  );
}

const AGENT_FLOW_STAGE_LABELS: Record<string, { zh: string; en: string }> = {
  begin: { zh: "Agent 开始运行", en: "Agent run started" },
  reading_batch: { zh: "读取当前批次", en: "Reading this batch" },
  verifier_checked: { zh: "Verifier 完成规则核验", en: "Verifier checked rules" },
  jev_routed: { zh: "JEV 完成分流", en: "JEV routed next step" },
  model_started: { zh: "模型开始整理解释", en: "Model started explanation" },
  model_completed: { zh: "模型解释完成", en: "Model explanation completed" },
  answer: { zh: "回答已生成", en: "Answer generated" },
  done: { zh: "Agent 运行结束", en: "Agent run finished" },
};

function flowStatus(event: ChatEvent): AgentFlowStatus {
  if (event.status === "fallback") return "fallback";
  if (event.status === "unavailable") return "unavailable";
  if (event.status === "active") return "active";
  if (event.status === "completed") return "completed";
  if (event.kind === "done" || event.stage === "done") return "completed";
  return "info";
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
    providerIssue?: ChatEvent["providerIssue"];
    dataMode?: string;
    traceId?: string;
    evidenceIds?: string[];
    chainContext?: ChatEvent["chainContext"];
  }>();
  const [lifecycle, setLifecycle] = useState<LifecycleView | null>(null);
  const [overview, setOverview] = useState<PublicBatchOverview | null>(null);
  const [agentService, setAgentService] = useState<{
    providerConfigured?: boolean;
    configuredProvider?: string | null;
    configuredModel?: string | null;
    lastSuccessfulProvider?: string | null;
    lastSuccessfulModel?: string | null;
    lastModelRuntimeStatus?: string | null;
  } | null>(null);
  const [flowEvents, setFlowEvents] = useState<AgentFlowEvent[]>([]);
  const [lifecycleUpdated, setLifecycleUpdated] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const lifecycleRevisionRef = useRef<number | undefined>(undefined);
  const flowSeqRef = useRef(0);
  const zh = locale === "zh";
  const overviewSource = zh ? "批次总览 API" : "Batch overview API";
  const lifecycleSource = zh ? "生命周期 API" : "Lifecycle API";
  const chainSource = zh ? "链状态 API" : "Chain status API";
  const appendFlowEvent = useCallback((event: Omit<AgentFlowEvent, "id" | "at">) => {
    flowSeqRef.current += 1;
    const item: AgentFlowEvent = {
      ...event,
      id: `flow-${Date.now()}-${flowSeqRef.current}`,
      at: new Date().toISOString(),
    };
    setFlowEvents((previous) => {
      const duplicateActive = item.status === "active" && previous.some((candidate) => candidate.status === "active"
        && candidate.source === item.source && candidate.label === item.label && candidate.batchId === item.batchId);
      return duplicateActive ? previous : [...previous.slice(-99), item];
    });
  }, []);
  useEffect(() => {
    const nextBatch = currentBatch(site);
    setBatchId(nextBatch);
  }, [site]);
  useEffect(() => {
    let active = true;
    void fetchAgentStatus().then((next) => {
      if (active) setAgentService(next);
    }).catch(() => {
      if (active) setAgentService(null);
    });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const syncFromUrl = () => {
      const nextBatch = currentBatch(site);
      setBatchId((previous) => {
        if (previous === nextBatch) return previous;
        setQuery(nextBatch);
        setQuickPrompt(null);
        setFlowEvents([]);
        lifecycleRevisionRef.current = undefined;
        return nextBatch;
      });
    };
    window.addEventListener("popstate", syncFromUrl);
    window.addEventListener("truthpass:batch-changed", syncFromUrl);
    return () => {
      window.removeEventListener("popstate", syncFromUrl);
      window.removeEventListener("truthpass:batch-changed", syncFromUrl);
    };
  }, [site]);
  useEffect(() => {
    let active = true;
    setOverview(null);
    appendFlowEvent({
      source: overviewSource,
      label: zh ? "请求批次总览" : "Requesting batch overview",
      detail: zh ? `正在读取 ${batchId} 的商品、证据、核验和购买状态。` : `Reading product, evidence, verification, and purchase state for ${batchId}.`,
      status: "active",
      batchId,
    });
    void fetchBatchOverview(batchId).then((next) => {
      if (!active) return;
      setOverview(next);
      appendFlowEvent({
        source: overviewSource,
        label: zh ? "批次总览已读取" : "Batch overview loaded",
        detail: zh
          ? `${next.product?.name ?? "商品"} · 核验 ${next.verification?.status ?? next.batch?.status ?? "待核验"} · ${next.evidence?.length ?? 0} 条证据。`
          : `${next.product?.name ?? "Product"} · verification ${next.verification?.status ?? next.batch?.status ?? "pending"} · ${next.evidence?.length ?? 0} evidence records.`,
        status: "completed",
        batchId: next.batch?.batchId ?? batchId,
        evidenceCount: next.evidence?.length ?? 0,
        dataMode: next.dataMode ?? next.batch?.dataMode ?? "demo/synthetic",
      });
      const chain = next.chainContext;
      if (chain) {
        appendFlowEvent({
          source: chainSource,
          label: zh ? "当前批次链状态已返回" : "Current batch chain state returned",
          detail: `${chain.chainName} (${chain.chainId}) · ${chain.anchorStatus} · ${chain.rpcReachable ? (zh ? "RPC 可达" : "RPC reachable") : (zh ? "RPC 不可达" : "RPC unavailable")}${chain.transaction ? ` · ${zh ? "已有当前交易 receipt" : "current receipt available"}` : ` · ${zh ? "没有当前交易 receipt" : "no current receipt"}`}.`,
          status: chain.rpcReachable ? "completed" : "unavailable",
          batchId: chain.batchId ?? batchId,
          dataMode: next.dataMode ?? next.batch?.dataMode ?? site.product.demoMode,
        });
      }
    }).catch((error: unknown) => {
      if (!active) return;
      appendFlowEvent({
        source: overviewSource,
        label: zh ? "批次总览读取失败" : "Batch overview failed",
        detail: error instanceof Error ? error.message : (zh ? "接口未返回批次总览。" : "The overview API did not return a batch."),
        status: "unavailable",
        batchId,
      });
    });
    return () => { active = false; };
  }, [appendFlowEvent, batchId, zh]);

  useEffect(() => {
    let active = true;
    lifecycleRevisionRef.current = undefined;
    const refresh = async () => {
      try {
        const next = await fetchLifecycle(batchId);
        if (!active) return;
        const firstRead = lifecycleRevisionRef.current === undefined;
        const changed = !firstRead && lifecycleRevisionRef.current !== next.contextRevision;
        lifecycleRevisionRef.current = next.contextRevision;
        setLifecycleUpdated(changed);
        setLifecycle(next);
        if (changed || firstRead) {
          appendFlowEvent({
            source: lifecycleSource,
            label: changed ? (zh ? "生命周期资料刚刚更新" : "Lifecycle data updated") : (zh ? "生命周期已读取" : "Lifecycle loaded"),
            detail: `${zh ? "上下文版本" : "Context revision"} v${next.contextRevision} · ${next.events.length} ${zh ? "个阶段" : "stages"} · ${next.nextAction === "complete" ? (zh ? "流程完成" : "complete") : `${zh ? "下一步" : "next"} ${next.nextAction}`}.`,
            status: "completed",
            batchId,
            dataMode: next.dataMode,
          });
        }
      } catch (error: unknown) {
        if (!active) return;
        appendFlowEvent({
          source: lifecycleSource,
          label: zh ? "生命周期读取失败" : "Lifecycle read failed",
          detail: error instanceof Error ? error.message : (zh ? "生命周期接口未返回。" : "The lifecycle API did not respond."),
          status: "unavailable",
          batchId,
          dataMode: site.product.demoMode,
        });
      }
    };
    void refresh();
    const timer = window.setInterval(() => { if (site.product.demoMode === "demo/synthetic") void refresh(); }, 10000);
    return () => { active = false; window.clearInterval(timer); };
  }, [appendFlowEvent, batchId, site.product.demoMode, zh]);
  const requestStatus = agentMeta?.serviceStatus ?? agentMeta?.agentMode;
  const modelActuallyUsed = agentMeta?.modelAssisted === true && requestStatus === "model_assisted";
  const agentRibbon = modelActuallyUsed
    ? (zh ? `${agentMeta?.provider ?? "DeepSeek"} · 已参与解释` : `${agentMeta?.provider ?? "DeepSeek"} · explanation active`)
    : requestStatus === "provider_unavailable"
      ? (agentMeta?.providerIssue === "billing_required"
        ? (zh ? "模型额度未满足 · 基础资料仍可查" : "Model credits unavailable · evidence remains available")
        : (zh ? "模型暂不可用 · 基础资料仍可查" : "Model unavailable · evidence remains available"))
      : requestStatus === "rate_limited"
        ? (zh ? "请求受限 · 使用基础回答" : "Rate limited · fallback answer")
        : requestStatus === "maintenance"
          ? (zh ? "服务维护中 · 使用基础回答" : "Maintenance · fallback answer")
          : agentMeta
            ? (zh ? "基础回答 · 模型未参与" : "Evidence fallback · model not used")
            : (zh ? "等待真实 Agent 查询" : "Waiting for an Agent query");
  const runtimeNotice = agentMeta?.providerIssue === "billing_required"
    ? (zh ? "模型账户额度未满足，已安全回退；批次读取、Verifier 和 JEV 仍已运行。" : "Model billing or credits are unavailable; the evidence fallback is active. Batch reading, Verifier, and JEV still ran.")
    : modelActuallyUsed
      ? (zh ? `${agentMeta?.provider ?? "模型"} 已参与本次解释；回答仍受当前批次引用校验。` : `${agentMeta?.provider ?? "Model"} explained this run; citations remain scoped to this batch.`)
      : agentMeta
        ? (zh ? "本次查询已完成批次读取、规则核验和 JEV 分流，模型原文未发布。" : "This run completed batch reading, rule checks, and JEV routing; raw model text was not published.")
        : agentService?.providerConfigured
          ? (zh ? `已配置 ${agentService.configuredProvider ?? "模型服务"}，等待本次查询结果。` : `${agentService.configuredProvider ?? "Model provider"} is configured; waiting for this run.`)
          : (zh ? "模型未配置，当前会使用有来源的基础回答。" : "No model provider is configured; sourced fallback answers remain available.");
  const handleFlowEvent = useCallback((event: ChatEvent) => {
    const stage = event.stage ?? (AGENT_FLOW_STAGE_LABELS[event.kind] ? event.kind : undefined);
    if (!stage && event.kind !== "meta") return;
    const label = stage
      ? (AGENT_FLOW_STAGE_LABELS[stage]?.[locale] ?? stage)
      : (locale === "zh" ? "运行摘要已返回" : "Run metadata returned");
    const detail = event.detail
      ?? (event.pipelineDetail
        ? `Verifier ${event.pipelineDetail.verifier.status} · JEV ${event.pipelineDetail.jev.decision} · ${locale === "zh" ? "模型" : "model"} ${event.pipelineDetail.deepseek.status}`
        : undefined)
      ?? event.text
      ?? (event.kind === "meta"
        ? (locale === "zh" ? "Verifier、JEV、模型和引用状态已写入运行摘要。" : "Verifier, JEV, model, and citation state were returned.")
        : "");
    appendFlowEvent({
      source: "Agent SSE",
      label,
      detail,
      status: flowStatus(event),
      batchId: event.batchId ?? batchId,
      traceId: event.traceId,
      evidenceCount: event.evidenceIds?.length,
      dataMode: event.dataMode ?? site.product.demoMode,
    });
  }, [appendFlowEvent, batchId, locale, site.product.demoMode]);
  return (
    <main className="tenant-site-main tenant-agent-main">
      <section className="tenant-section-heading tenant-agent-heading"><div><p className="tp-kicker">{zh ? "商品 Agent" : "PRODUCT AGENT"}</p><h1>{zh ? "你问什么，我查什么。" : "Ask once. Get the record."}</h1><p>{zh ? "所有流程从对话开始。需要时，我会把证据、生命周期、钱包和下一步打开给你。" : "Start with a question. I will open the evidence, lifecycle, wallet step, or next action when you need it."}</p></div><span className="tp-demo-ribbon">{agentRibbon}</span></section>
      <section className="tenant-agent-single tenant-panel">
        <div className="tenant-panel-head"><strong>{zh ? "和商品助手对话" : "Talk to the product Agent"}</strong><span>{batchId}</span></div>
        <div className={`tenant-agent-runtime-notice ${agentMeta?.providerIssue ? "attention" : modelActuallyUsed ? "model" : ""}`} role="status">
          <strong>{zh ? "你现在看到的是一次真实查询" : "This is a live scoped query"}</strong>
          <span>{runtimeNotice}</span>
        </div>
        <AgentDataFlowRail
          events={flowEvents}
          batchId={batchId}
          dataMode={overview?.dataMode ?? lifecycle?.dataMode ?? site.product.demoMode}
          traceId={agentMeta?.traceId}
          locale={locale}
          onClear={() => setFlowEvents([])}
        />
        <ChatPanel
          onStart={() => { setVerifyState("running"); setStage("searching"); }}
          onDone={() => { setVerifyState("done"); setStage("evidence_review"); }}
          onMeta={setAgentMeta}
          onFlowEvent={handleFlowEvent}
          onBatch={(id) => {
            const scoped = scopedBatch(site, id);
            if (scoped !== id.trim().toUpperCase()) {
              appendFlowEvent({
                source: overviewSource,
                label: zh ? "批次不属于当前企业站点" : "Batch is outside this tenant",
                detail: zh ? `${id} 没有被当前站点允许，已保留 ${batchId}。` : `${id} is not allowed for this site; keeping ${batchId}.`,
                status: "unavailable",
                batchId,
                dataMode: site.product.demoMode,
              });
              return;
            }
            setBatchId(scoped);
            if (scoped !== batchId) {
              setFlowEvents([]);
              lifecycleRevisionRef.current = undefined;
            }
            const url = new URL(window.location.href);
            url.searchParams.set("batch", scoped);
            window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
            window.dispatchEvent(new CustomEvent("truthpass:batch-changed", { detail: { batchId: scoped } }));
          }}
          onPurchasePrepared={() => setStage("purchase_prepared")}
          onWalletPending={() => setStage("wallet_pending")}
          onReceiptVerified={() => setStage("receipt_verified")}
          batchId={batchId}
          autoQueryBatch={query}
          autoQueryPrompt={quickPrompt}
          locale={locale}
          productLabel={site.product.name}
          minimal
        />
        <div className="tenant-agent-actions"><button type="button" className="tp-paper-btn" onClick={() => setShowContext((value) => !value)}>{showContext ? (zh ? "收起资料" : "Hide record") : (zh ? "打开这批资料" : "Open this record")} →</button><span>{stage === "receipt_verified" ? (zh ? "购买回执已核验" : "Receipt verified") : (zh ? "只在你需要时展开详细资料" : "Open details only when needed")}</span></div>
      </section>
      {showContext && <section className="tenant-context-drawer"><div className="tenant-context-column"><div className="tenant-panel-head"><strong>{zh ? "证据和当前状态" : "Evidence and status"}</strong><span>{site.product.demoMode}</span></div><ProductPanel state={verifyState} batchId={batchId} locale={locale} /><EvidencePanel state={verifyState} batchId={batchId} locale={locale} /></div><div className="tenant-context-column"><section className="tenant-usage-panel" aria-label={zh ? "产品使用说明" : "Product usage guide"}><div className="tenant-panel-head"><strong>{zh ? "使用教程与贴士" : "How to use"}</strong><span>{zh ? "来源可见" : "Sourced"}</span></div><div className="tenant-usage-grid"><div><b>{zh ? "使用教程" : "Guide"}</b>{site.product.usageGuide.map((item) => <article key={item.title}><strong>{item.title}</strong><p>{item.body}</p><small>{item.source}</small></article>)}</div><div><b>{zh ? "使用贴士" : "Tips"}</b>{site.product.usageTips.map((item) => <article key={item.title}><strong>{item.title}</strong><p>{item.body}</p><small>{item.source}</small></article>)}</div></div></section>{lifecycle && <section className="tenant-lifecycle-strip" aria-label={zh ? "实时生命周期" : "Live lifecycle"}><div className="tenant-panel-head"><strong>{zh ? "这批现在走到哪一步" : "Where this batch is now"}</strong><span>{lifecycleUpdated ? (zh ? "资料刚刚更新" : "Just updated") : `v${lifecycle.contextRevision}`}</span></div><div className="tenant-lifecycle-mini">{lifecycle.events.map((event) => <div className={`tenant-lifecycle-mini-item ${event.status}`} key={event.stage}><b>{event.label}</b><span>{event.status}</span><small>{event.detail}</small></div>)}</div></section>}</div></section>}
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
      <SiteStateBar site={site} locale={locale} view={view} batchId={currentBatch(site)} />
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
