import { useCallback, useEffect, useRef, useState } from "react";
import { ChatPanel } from "./ChatPanel";
import { AgentDataFlowRail, type AgentFlowEvent, type AgentFlowStatus } from "./AgentDataFlowRail";
import { EvidencePanel } from "./EvidencePanel";
import { ProductPanel } from "./ProductPanel";
import { MerchantApp } from "./MerchantApp";
import { InstitutionReviewPanel } from "./InstitutionReviewPanel";
import { useWallet, WALLET_ROLE_LABELS, type WalletRole } from "./WalletContext";
import type { ChatEvent, VerifyState, LifecycleView, LifecycleStage, PublicBatchOverview, ChainStatusData } from "../types";
import type { ConsumerAgentStage } from "./ConsumerFlowBar";
import type { TenantSiteConfig } from "../siteConfig";
import { createConsumerAgentGrant, fetchBatchOverview, fetchChainStatus, fetchConsumerAgentGrants, fetchConsumerAgentGuidance, fetchLifecycle, revokeConsumerAgentGrant, simulateLifecycleStage, type ConsumerAgentGrantView } from "../api";
import { useAuth } from "../hooks/useAuth";
import { AgentDemoDashboard } from "./AgentDemoDashboard";

type TenantView = "home" | "agent" | "agent-demo" | "wallet" | "merchant" | "institution" | "developers" | "preview";

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
    ["agent", zh ? "查商品" : "Agent", localizedSiteRoute(site, "agent", locale, batchId)],
    ["wallet", zh ? "钱包身份" : "Wallet", localizedSiteRoute(site, "wallet", locale, batchId)],
  ];
  const workspaceLabels: Array<[TenantView, string, string]> = [
    ["merchant", zh ? "企业工作台" : "Merchant", localizedSiteRoute(site, "merchant", locale, batchId)],
    ["institution", zh ? "机构审核" : "Institution", localizedSiteRoute(site, "institution", locale, batchId)],
    ["developers", zh ? "开发者" : "Developers", routeFor(site, "developers", locale)],
  ];
  const isConsumerView = view === "home" || view === "agent" || view === "agent-demo" || view === "wallet";
  const isAgentConsumerView = view === "agent" || view === "agent-demo";
  const alternateLocale = zh ? "en" : "zh";
  const localeHref = localizedSiteRoute(site, view, alternateLocale, view === "developers" ? undefined : batchId);
  return (
    <header className="tenant-site-header">
      <a className="tp-brand" href={localizedSiteRoute(site, "home", locale, batchId)} aria-label={`${site.brand.name} TruthPass`}>
        <span className="tp-brand-word">TruthPass</span><span className="tenant-site-mark">{site.brand.mark}</span>
      </a>
      <div className="tenant-site-context"><strong>{site.brand.name}</strong><span>{site.product.name}</span></div>
      {!isAgentConsumerView && <nav aria-label={zh ? "企业站点导航" : "Site navigation"}>
        {(isConsumerView ? consumerLabels : [...consumerLabels, ...workspaceLabels]).map(([key, label, href]) => <a key={key} className={view === key ? "active" : ""} href={href}>{label}</a>)}
      </nav>}
      {isConsumerView && !isAgentConsumerView && (
        <details className="tenant-nav-more">
          <summary>{zh ? "更多" : "More"}</summary>
          <div className="tenant-nav-more-menu">
            {workspaceLabels.map(([key, label, href]) => <a key={key} className={view === key ? "active" : ""} href={href}>{label}</a>)}
          </div>
        </details>
      )}
      {site.locale.supported.includes(alternateLocale) && <a className="tenant-language-link" href={localeHref}>{zh ? "EN" : "中文"}</a>}
      <a className="tenant-auth-link" href={`${zh ? "/" : "/en"}?view=consumer&auth=1&batch=${encodeURIComponent(batchId)}`}>{zh ? "登录 / 注册" : "Sign in"}</a>
      {!isAgentConsumerView && <a className="tenant-back-link" href={`${zh ? "/" : "/en"}?view=consumer&batch=${encodeURIComponent(batchId)}`}>{zh ? "回到 TruthPass" : "Back to TruthPass"}</a>}
    </header>
  );
}

function SiteStateBar({ site, locale, view, batchId }: { site: TenantSiteConfig; locale: "zh" | "en"; view: TenantView; batchId: string }) {
  const zh = locale === "zh";
  const consumerView = view === "home" || view === "agent" || view === "agent-demo" || view === "wallet";
  return (
    <div className="tenant-site-statebar">
      <span className="tp-demo-ribbon">{site.product.demoMode === "demo/synthetic" ? (zh ? "演示资料 · 不能替代真实商品认证" : "DEMO / SYNTHETIC · NOT CERTIFICATION") : (zh ? "正式资料" : "PRODUCTION DATA")}</span>
      {!consumerView && <span>{zh ? `当前页面：${view}` : `Current page: ${view}`}</span>}
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
          <p className="tp-kicker">{zh ? "商品批次查询" : "BATCH LOOKUP"}</p>
          <span className="tp-demo-ribbon">{zh ? "一批一查，记录说话" : "One batch. One record."}</span>
          <h1>{site.brand.slogans[locale]}</h1>
          <p className="tenant-lead">{zh ? "扫码或输入批次，我来把这批货的记录查一遍：生产、检测、运输、保存，哪里有记录，哪里还缺，直接告诉你。" : "Scan or enter a batch and I will check its production, testing, delivery, and storage records, including what is missing."}</p>
          <div className="tenant-hero-actions">
            <a className="tp-red-btn" href={`${base}/agent?batch=${encodeURIComponent(scopedBatch(site, batch))}`}>{zh ? "查这一批" : "View this batch"} →</a>
            <a className="tp-paper-btn" href={localizedSiteRoute(site, "agent", locale, scopedBatch(site, batch))}>{zh ? "查记录" : "Ask the Agent"} →</a>
          </div>
        </div>
        <form className="tenant-batch-card" onSubmit={(event) => { event.preventDefault(); openBatch(batch); }}>
          <span className="tp-kicker">{zh ? "查一批商品" : "INSPECT A BATCH"}</span>
          <h2>{zh ? "这件货，谁做的？怎么检的？路上有没有断记录？" : "Check first. Buy next."}</h2>
          <label htmlFor="tenant-batch">{zh ? "批次号" : "Batch ID"}</label>
          <div><input id="tenant-batch" value={batch} onChange={(event) => setBatch(event.target.value.toUpperCase())} /><button className="tp-red-btn" type="submit">{zh ? "查询" : "Inspect"}</button></div>
          <small>{zh ? "先看看这批货有没有记录，再决定要不要继续了解。" : "See what this batch records before you decide what to do next."}</small>
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
        <a href={localizedSiteRoute(site, "agent", locale, scopedBatch(site, batch))}><span className="tp-kicker">{zh ? "消费者" : "CONSUMER"}</span><h2>{zh ? "查商品记录" : "Check the product record"}</h2><p>{zh ? "查记录、看依据、知道还缺什么。" : "Check the record, see the basis, and know what is missing."}</p></a>
        <a href={localizedSiteRoute(site, "merchant", locale, scopedBatch(site, batch))}><span className="tp-kicker">{zh ? "企业" : "BUSINESS"}</span><h2>{zh ? "把资料整理清楚" : "Make the record legible"}</h2><p>{zh ? "上传、核验、确认、发布。" : "Collect, verify, confirm, publish."}</p></a>
        <a href={localizedSiteRoute(site, "institution", locale, scopedBatch(site, batch))}><span className="tp-kicker">{zh ? "机构" : "INSTITUTION"}</span><h2>{zh ? "一批一查" : "Review one batch at a time"}</h2><p>{zh ? "检测、签名、争议都有记录。" : "Testing, signatures, and disputes stay recorded."}</p></a>
      </section>
    </main>
  );
}

const AGENT_FLOW_STAGE_LABELS: Record<string, { zh: string; en: string }> = {
  begin: { zh: "先查这批", en: "Check this batch" },
  reading_batch: { zh: "找到这批记录", en: "Find the batch record" },
  verifier_checked: { zh: "逐项对照检测", en: "Compare the test records" },
  jev_routed: { zh: "看看运输和保存", en: "Check delivery and storage" },
  model_started: { zh: "挑出还缺的资料", en: "Find what is missing" },
  model_completed: { zh: "整理成结论", en: "Organize the result" },
  answer: { zh: "把结论讲明白", en: "Explain the result" },
  done: { zh: "查完了", en: "Done" },
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
  const [chainStatus, setChainStatus] = useState<ChainStatusData | null>(null);
  const [flowEvents, setFlowEvents] = useState<AgentFlowEvent[]>([]);
  const [lifecycleUpdated, setLifecycleUpdated] = useState(false);
  const [showContext, setShowContext] = useState(false);
  const [demoRunning, setDemoRunning] = useState(false);
  const lifecycleRevisionRef = useRef<number | undefined>(undefined);
  const flowSeqRef = useRef(0);
  const zh = locale === "zh";
  const { user, loading: authLoading, configured: authConfigured } = useAuth();
  const [agentGrants, setAgentGrants] = useState<ConsumerAgentGrantView[]>([]);
  const [grantLoading, setGrantLoading] = useState(false);
  const [grantToken, setGrantToken] = useState<string | null>(null);
  const [grantError, setGrantError] = useState<string | null>(null);
  const [grantOpen, setGrantOpen] = useState(false);
  const [agentGuidance, setAgentGuidance] = useState<Array<Record<string, unknown>>>([]);
  const [guidanceLoading, setGuidanceLoading] = useState(false);
  const overviewSource = zh ? "批次总览 API" : "Batch overview API";
  const lifecycleSource = zh ? "生命周期 API" : "Lifecycle API";
  const chainSource = zh ? "链状态 API" : "Chain status API";
  const loadAgentGrants = useCallback(async () => {
    if (!user) {
      setAgentGrants([]);
      return;
    }
    setGrantLoading(true);
    setGrantError(null);
    try {
      const result = await fetchConsumerAgentGrants();
      setAgentGrants(result.grants ?? []);
    } catch (error) {
      setGrantError(error instanceof Error ? error.message : (zh ? "授权状态读取失败" : "Could not load authorization"));
    } finally {
      setGrantLoading(false);
    }
  }, [user, zh]);
  useEffect(() => { void loadAgentGrants(); }, [loadAgentGrants]);
  const issueAgentGrant = useCallback(async () => {
    if (!user) {
      setGrantError(zh ? "请先登录，再授权你的查询工具。" : "Sign in before authorizing your query tool.");
      return;
    }
    setGrantLoading(true);
    setGrantError(null);
    try {
      const result = await createConsumerAgentGrant({
        label: zh ? "我的鱼油查询" : "My fish-oil lookup",
        agentId: `consumer-${user.id.slice(0, 8)}`,
        scopes: ["purchases.read", "updates.read", "guidance.read", "agent.query", "feedback.prepare"],
        batchIds: [batchId],
        productIds: [site.product.productId],
      });
      setGrantToken(result.token);
      await loadAgentGrants();
    } catch (error) {
      setGrantError(error instanceof Error ? error.message : (zh ? "授权创建失败" : "Could not create authorization"));
    } finally {
      setGrantLoading(false);
    }
  }, [batchId, loadAgentGrants, site.product.productId, user, zh]);
  const revokeAgentGrant = useCallback(async (grantId: string) => {
    setGrantLoading(true);
    setGrantError(null);
    try {
      await revokeConsumerAgentGrant(grantId);
      await loadAgentGrants();
    } catch (error) {
      setGrantError(error instanceof Error ? error.message : (zh ? "撤销失败" : "Could not revoke authorization"));
    } finally {
      setGrantLoading(false);
    }
  }, [loadAgentGrants, zh]);
  const loadPersonalGuidance = useCallback(async () => {
    if (!user || agentGrants.length === 0) {
      setAgentGuidance([]);
      return;
    }
    setGuidanceLoading(true);
    try {
      const result = await fetchConsumerAgentGuidance(batchId);
      setAgentGuidance(result.guidance ?? []);
    } catch (error) {
      setGrantError(error instanceof Error ? error.message : (zh ? "日常建议读取失败" : "Could not load daily guidance"));
    } finally {
      setGuidanceLoading(false);
    }
  }, [agentGrants.length, batchId, user, zh]);

  const guidanceCards = agentGuidance.flatMap((entry) => {
    const items = Array.isArray(entry.guidance) ? entry.guidance : [];
    return items.map((item) => {
      const card = item as { key?: unknown; title?: unknown; text?: unknown; source?: unknown };
      return {
        key: String(entry.batchId ?? batchId) + ":" + String(card.key ?? card.title ?? "guidance"),
        title: String(card.title ?? "使用提醒"),
        text: String(card.text ?? ""),
        source: String(card.source ?? "TruthPass 商品记录"),
        batchId: String(entry.batchId ?? batchId),
      };
    });
  });

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
    void fetchChainStatus().then((next) => {
      if (active) setChainStatus(next);
    }).catch(() => {
      if (active) setChainStatus(null);
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
  const runFishOilDemo = useCallback(async () => {
    if (demoRunning || site.product.demoMode !== "demo/synthetic") return;
    setDemoRunning(true);
    appendFlowEvent({
      source: lifecycleSource,
      label: zh ? "完整检测演示开始" : "Full inspection demo started",
      detail: zh ? "按生产、检测、冷链和出货顺序读取演示资料；购买和签名仍需要用户钱包确认。" : "Reading demo records in production, inspection, cold-chain, and shipment order; purchase and signing still require the user wallet.",
      status: "active",
      batchId,
      dataMode: site.product.demoMode,
    });
    const stages: LifecycleStage[] = ["production", "inspection", "cold_chain", "shipment"];
    try {
      for (const stage of stages) {
        const view = await simulateLifecycleStage(batchId, stage);
        const event = view.events.find((item) => item.stage === stage);
        setLifecycle(view);
        lifecycleRevisionRef.current = view.contextRevision;
        appendFlowEvent({
          source: lifecycleSource,
          label: event?.label ?? stage,
          detail: event?.detail ?? (zh ? "阶段资料已写入演示状态。" : "Stage data was written to the demo state."),
          status: "completed",
          batchId,
          dataMode: view.dataMode,
        });
      }
      const [nextOverview, chain] = await Promise.all([fetchBatchOverview(batchId), fetchChainStatus()]);
      setOverview(nextOverview);
      setChainStatus(chain);
      appendFlowEvent({
        source: overviewSource,
        label: zh ? "检测结果已重新核对" : "Inspection result rechecked",
        detail: zh
          ? `确定性状态：${nextOverview.verification?.status ?? nextOverview.batch?.status ?? "待核验"}；参数和缺口已按当前批次重新读取。`
          : `Deterministic status: ${nextOverview.verification?.status ?? nextOverview.batch?.status ?? "pending"}; parameters and gaps were reread for this batch.`,
        status: "completed",
        batchId,
        evidenceCount: nextOverview.evidence?.length ?? 0,
        dataMode: nextOverview.dataMode ?? site.product.demoMode,
      });
      const replayCount = chain.verifiedTransactions.filter((item) => item.batchId === batchId).length;
      appendFlowEvent({
        source: chainSource,
        label: zh ? "Chain 677 状态已核对" : "Chain 677 status checked",
        detail: chain.liveRpc.reachable
          ? (zh ? `RPC 可达；当前批次有 ${replayCount} 条已登记链上记录，仍需区分真实 receipt。` : `RPC reachable; ${replayCount} registered chain records exist for this batch, still distinct from a current receipt.`)
          : (zh ? `RPC 当前不可达；可展示 ${replayCount} 条历史回放记录，但不能把它们当作本次交易 receipt。` : `RPC is currently unavailable; ${replayCount} historical replay records can be shown, but they are not a receipt for this run.`),
        status: chain.liveRpc.reachable ? "completed" : "info",
        batchId,
        dataMode: chain.liveRpc.reachable ? site.product.demoMode : "replay_verified",
      });
      appendFlowEvent({
        source: lifecycleSource,
        label: zh ? "完整检测演示完成" : "Full inspection demo completed",
        detail: zh ? "生产→检测→冷链→出货已经跑过一遍；下一步是由用户钱包确认购买，系统再读取真实 receipt。" : "Production → inspection → cold chain → shipment completed once; the next step is wallet-confirmed purchase followed by a real receipt read.",
        status: "completed",
        batchId,
        dataMode: site.product.demoMode,
      });
    } catch (error: unknown) {
      appendFlowEvent({
        source: lifecycleSource,
        label: zh ? "完整检测演示中断" : "Full inspection demo interrupted",
        detail: error instanceof Error ? error.message : (zh ? "演示接口未返回完整状态。" : "The demo API did not return a complete state."),
        status: "unavailable",
        batchId,
        dataMode: site.product.demoMode,
      });
    } finally {
      setDemoRunning(false);
    }
  }, [appendFlowEvent, batchId, chainSource, demoRunning, lifecycleSource, overviewSource, site.product.demoMode, zh]);
  const agentRibbon = site.product.demoMode === "demo/synthetic"
    ? (zh ? "演示资料 · 先看记录" : "Demo record · check the record")
    : (zh ? "批次资料已整理" : "Batch record ready");
  const handleFlowEvent = useCallback((event: ChatEvent) => {
    const stage = event.stage ?? (AGENT_FLOW_STAGE_LABELS[event.kind] ? event.kind : undefined);
    if (!stage && event.kind !== "meta") return;
    const label = stage
      ? (AGENT_FLOW_STAGE_LABELS[stage]?.[locale] ?? stage)
      : (locale === "zh" ? "运行摘要已返回" : "Run metadata returned");
    const detail = event.detail
      ?? (locale === "zh"
        ? event.stage === "reading_batch" ? `找到 ${event.evidenceIds?.length ?? 0} 条这批货的登记记录。`
          : event.stage === "verifier_checked" ? (event.status === "completed" ? "已按登记的检测规则核对，并标出还缺的资料。" : "正在按登记规则核对这批货。")
            : event.stage === "jev_routed" ? "正在判断运输、保存和其他资料还缺什么。"
              : event.stage === "model_started" ? "正在把查到的内容整理成容易看懂的话。"
                : event.stage === "model_completed" ? (event.providerIssue ? "说明服务暂时不可用，已改用这批货的登记资料回答。" : "这批货的说明已经整理好。")
                  : event.kind === "meta" ? "查找记录已返回。" : event.text ?? ""
        : event.text
          ?? (event.kind === "meta" ? "Lookup record returned." : ""));
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
      <section className="tenant-section-heading tenant-agent-heading"><div><p className="tp-kicker">{zh ? "先看记录，再决定" : "READ THE RECORD FIRST"}</p><h1>{zh ? "买之前，先看这批货。" : "See the batch before you buy."}</h1><p>{zh ? `把包装上的批次号给我，我去找生产、检测、运输和保存记录。查到什么直说，缺什么也直说。` : `Give me the batch number. I will find production, testing, delivery, and storage records, then tell you what is supported and what is missing.`}</p></div><span className="tp-demo-ribbon">{agentRibbon}</span></section>
      <section className="tenant-agent-single tenant-panel">
        <div className="tenant-panel-head"><strong>{zh ? "我来查这批货" : "I check this batch"}</strong><span>{batchId}</span></div>
        <p className="tenant-agent-prompt-hint">{zh ? "你可以直接问：这鱼油从哪儿来、检测单怎么看、运输中有没有断记录，或者还缺哪份证明。" : "Ask where it came from, how to read the testing, whether delivery records have gaps, or which proof is missing."}</p>
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
        <div className="tenant-agent-actions"><button type="button" className="tp-paper-btn" onClick={() => setShowContext((value) => !value)}>{showContext ? (zh ? "收起回答依据" : "Hide answer basis") : (zh ? "看我查到的依据" : "See answer basis")} →</button><span>{stage === "receipt_verified" ? (zh ? "购买回执已核验" : "Receipt verified") : (zh ? "想看来源、状态和更新记录时再展开" : "Open sources and status only when needed")}</span></div>
        <section className="tenant-agent-access" aria-label={zh ? "我的商品提醒" : "My product watch list"}>
          <div className="tenant-panel-head"><div><strong>{zh ? "我的商品" : "My products"}</strong><small>{zh ? "让它持续盯住你授权的商品批次" : "Keep authorized product batches under watch"}</small><small className="tenant-agent-account-state">{user ? user.email : (!authConfigured && !authLoading ? (zh ? "账号服务尚未接入" : "Account service not configured") : (zh ? "登录后可授权" : "Sign in to authorize"))}</small></div><button type="button" className="tp-paper-btn" onClick={() => setGrantOpen((value) => !value)}>{grantOpen ? (zh ? "收起" : "Hide") : (zh ? "管理我的批次" : "Manage watch list")}</button></div>
          {grantOpen && <div className="tenant-agent-access-body">
            <p>{zh ? "授权后，你自己的 CLI 或其他助手只能读取你的购买记录、已绑定批次更新，并在授权范围内向 TruthPass 提问。它不能替你付款、签名或写链。" : "After authorization, your CLI or another assistant can read only your purchases, updates for bound batches, and ask TruthPass within this scope. It cannot pay, sign, or write to chain for you."}</p>
            {!authConfigured && !authLoading && <p className="tenant-agent-access-muted">{zh ? "当前云主机还没有接入账号服务，登录/注册和长期授权暂不可用；匿名查询和证据解释仍可使用。" : "The cloud host has no account provider configured yet, so sign-in and durable grants are unavailable; anonymous inspection and evidence explanations still work."}</p>}
            {!user && !authLoading && <p className="tenant-agent-access-muted">{zh ? "请先使用右上角登录/注册。" : "Use the sign-in control above first."}</p>}
            {user && <button type="button" className="tp-red-btn" onClick={() => void issueAgentGrant()} disabled={grantLoading}>{grantLoading ? (zh ? "处理中…" : "Working…") : (zh ? "授权我的查询工具" : "Authorize my query tool")}</button>}
            {grantError && <p className="tenant-agent-access-error">{grantError}</p>}
            {grantToken && <div className="tenant-agent-token"><strong>{zh ? "只显示这一次：复制到你的工具" : "Shown once: copy to your tool"}</strong><code>{grantToken}</code><small>{zh ? `示例：truthpass ask "这批鱼油最近有什么更新？" --remote ${window.location.origin} --token <PERSONAL_AGENT_TOKEN> --batch ${batchId}` : `Example: truthpass ask "What changed for this batch?" --remote ${window.location.origin} --token <PERSONAL_AGENT_TOKEN> --batch ${batchId}`}</small><button type="button" className="tp-paper-btn" onClick={() => { void navigator.clipboard?.writeText(grantToken); }}>{zh ? "复制授权凭证" : "Copy token"}</button></div>}
            <div className="tenant-agent-guidance">
              <div className="tenant-panel-head"><div><strong>{zh ? "日常使用提醒" : "Daily use guidance"}</strong><small>{zh ? "只解释已授权批次资料" : "Scoped to authorized batches"}</small></div><button type="button" className="tp-paper-btn" onClick={() => void loadPersonalGuidance()} disabled={guidanceLoading || !user || agentGrants.length === 0}>{guidanceLoading ? (zh ? "读取中…" : "Reading…") : (zh ? "读取建议" : "Load guidance")}</button></div>
              {!user && <p className="tenant-agent-access-muted">{zh ? "登录并授权后，才能读取你的批次使用提醒。" : "Sign in and authorize access to read reminders for your batches."}</p>}
              {user && agentGrants.length === 0 && <p className="tenant-agent-access-muted">{zh ? "先授权你的查询工具。" : "Authorize your query tool first."}</p>}
              {guidanceCards.length > 0 && <div className="tenant-agent-guidance-grid">{guidanceCards.map((card) => <article key={card.key}><strong>{card.title}</strong><p>{card.text}</p><small>{card.source} · {card.batchId}</small></article>)}</div>}
              {guidanceCards.length === 0 && user && agentGrants.length > 0 && !guidanceLoading && <p className="tenant-agent-access-muted">{zh ? "点击“读取建议”，会按你授权的批次返回保存、使用和异常处理提醒。" : "Load guidance to see storage, use, and exception reminders for the authorized batch."}</p>}
            </div>
            <div className="tenant-agent-grants">{agentGrants.length === 0 && !grantLoading && <span>{zh ? "还没有个人授权。" : "No personal grants yet."}</span>}{agentGrants.map((grant) => <div className="tenant-agent-grant-row" key={grant.grantId}><span><b>{grant.label}</b><small>{grant.scopes.join(" · ")} · {grant.batchIds.length ? grant.batchIds.join(", ") : (zh ? "所有已绑定批次" : "all bound batches")}</small></span>{!grant.revokedAt && <button type="button" className="tp-link-btn" onClick={() => void revokeAgentGrant(grant.grantId)}>{zh ? "撤销" : "Revoke"}</button>}</div>)}</div>
          </div>}
        </section>
      </section>
      {showContext && <section className="tenant-context-drawer"><div className="tenant-context-column"><div className="tenant-panel-head"><strong>{zh ? "这批资料从哪里来" : "Sources for this answer"}</strong><span>{site.product.demoMode}</span></div><ProductPanel state={verifyState} batchId={batchId} locale={locale} /><EvidencePanel state={verifyState} batchId={batchId} locale={locale} /><AgentDataFlowRail
        events={flowEvents}
        batchId={batchId}
        dataMode={overview?.dataMode ?? lifecycle?.dataMode ?? site.product.demoMode}
        traceId={agentMeta?.traceId}
        locale={locale}
        chainStatus={chainStatus}
        onClear={() => setFlowEvents([])}
        consumerFriendly
      /><div className="tenant-context-demo-action"><button type="button" className="tp-paper-btn" onClick={() => void runFishOilDemo()} disabled={demoRunning}>{demoRunning ? (zh ? "正在更新演示资料…" : "Updating demo records…") : (zh ? "更新一次演示资料" : "Refresh demo records")} →</button><span>{zh ? "仅用于演示持续变化，不会伪装成真实认证。" : "Demo refresh only; it never represents certification."}</span></div></div><div className="tenant-context-column"><section className="tenant-usage-panel" aria-label={zh ? "产品使用说明" : "Product usage guide"}><div className="tenant-panel-head"><strong>{zh ? "使用教程与贴士" : "How to use"}</strong><span>{zh ? "来源可见" : "Sourced"}</span></div><div className="tenant-usage-grid"><div><b>{zh ? "使用教程" : "Guide"}</b>{site.product.usageGuide.map((item) => <article key={item.title}><strong>{item.title}</strong><p>{item.body}</p><small>{item.source}</small></article>)}</div><div><b>{zh ? "使用贴士" : "Tips"}</b>{site.product.usageTips.map((item) => <article key={item.title}><strong>{item.title}</strong><p>{item.body}</p><small>{item.source}</small></article>)}</div></div></section>{lifecycle && <section className="tenant-lifecycle-strip" aria-label={zh ? "实时生命周期" : "Live lifecycle"}><div className="tenant-panel-head"><strong>{zh ? "这批现在走到哪一步" : "Where this batch is now"}</strong><span>{lifecycleUpdated ? (zh ? "资料刚刚更新" : "Just updated") : `v${lifecycle.contextRevision}`}</span></div>{lifecycle.simulation && <p className="tenant-lifecycle-simulation" role="status">{zh ? `演示数据每 ${Math.round(lifecycle.simulation.intervalMs / 1000)} 秒刷新 · tick ${lifecycle.simulation.tick} · 新证据 ${lifecycle.simulation.generatedEvidenceId}` : `Demo data refreshes every ${Math.round(lifecycle.simulation.intervalMs / 1000)}s · tick ${lifecycle.simulation.tick} · evidence ${lifecycle.simulation.generatedEvidenceId}`}</p>}<div className="tenant-lifecycle-mini">{lifecycle.events.map((event) => <div className={`tenant-lifecycle-mini-item ${event.status}`} key={event.stage}><b>{event.label}</b><span>{event.status}</span><small>{event.detail}</small></div>)}</div></section>}</div></section>}
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
  const origin = typeof window !== "undefined" ? window.location.origin : "https://truthpass-service.vercel.app";
  const mcpEndpoint = `${origin}/mcp`;
  const remoteCommand = `npx truthpass ask "检查 FO-2026-001 的检测、冷链和当前缺口" --remote ${origin} --stream`;
  const copyText = (value: string) => { void navigator.clipboard?.writeText(value); };
  return (
    <main className="tenant-site-main">
      <section className="tenant-section-heading">
        <div>
          <p className="tp-kicker">MCP · CLI · AGENT</p>
          <h1>{zh ? "让你的 AI 直接查到商品依据。" : "Let your AI query the product record directly."}</h1>
          <p>{zh ? "不用先学习 TruthPass 的技术名词。把连接地址或 Skill 交给你的 AI，它就能按批次查询、解释来源，并在需要签名时停下来等你确认。" : "Your AI does not need to learn TruthPass internals first. Give it the endpoint or Skill; it can query a batch, explain sources, and pause for your confirmation before protected actions."}</p>
        </div>
        <span className="tp-demo-ribbon">{site.agent.enabled ? (zh ? "Agent 已启用" : "Agent enabled") : (zh ? "Agent 未启用" : "Agent disabled")}</span>
      </section>
      <div className="tenant-dev-grid">
        <article className="tenant-panel">
          <span className="tp-kicker">MCP</span>
          <h2>{mcpEndpoint}</h2>
          <p>{zh ? "把这个地址添加到支持 MCP 的 AI 客户端。默认只读商品、批次、生命周期和链状态。" : "Add this endpoint to an MCP-capable AI client. It is read-only for products, batches, lifecycle, and chain state."}</p>
          <button className="tp-paper-btn" type="button" onClick={() => copyText(mcpEndpoint)}>{zh ? "复制 MCP 地址" : "Copy MCP endpoint"}</button>
        </article>
        <article className="tenant-panel">
          <span className="tp-kicker">CLI</span>
          <h2>npx truthpass ask</h2>
          <p>{zh ? "在终端直接问同一个 Agent，支持流式过程和 JSON 输出。" : "Ask the same Agent from a terminal with streaming progress or JSON output."}</p>
          <code className="tenant-command">{remoteCommand}</code>
          <div className="tenant-panel-actions">
            <button className="tp-paper-btn" type="button" onClick={() => copyText(remoteCommand)}>{zh ? "复制示例命令" : "Copy example"}</button>
            <a className="tp-red-btn" href="/downloads/truthpass-cli.zip" download>{zh ? "下载 CLI" : "Download CLI"} ↓</a>
          </div>
        </article>
        <article className="tenant-panel">
          <span className="tp-kicker">SKILL</span>
          <h2>truthpass-agent-skill.md</h2>
          <p>{zh ? "把 Skill 文件交给你的 AI，它会知道何时查询、如何引用，以及哪些话不能说。" : "Give the Skill file to your AI so it knows when to query, how to cite, and what it must not claim."}</p>
          <a className="tp-red-btn" href="/downloads/truthpass-agent-skill.md" download>{zh ? "下载 Agent Skill" : "Download Agent Skill"} ↓</a>
        </article>
      </div>
      <div className="tenant-capability-grid">
        {(zh ? ["自然语言查询", "按批次引用证据", "显示查找和核对过程", "受保护操作等你确认"] : ["Natural-language queries", "Batch-scoped citations", "Visible search trail", "Protected actions await you"]).map((item) => (
          <div key={item}><b>↗</b><strong>{item}</strong><small>{zh ? "跨批次、无来源或未确认的结论会被拦截。" : "Cross-batch, unsourced, and unconfirmed claims are blocked."}</small></div>
        ))}
      </div>
    </main>
  );
}

export function TenantSitePage({ site, view = "home", locale = site.locale.default }: { site: TenantSiteConfig; view?: TenantView; locale?: "zh" | "en" }) {
  if (view === "agent-demo") {
    return <AgentDemoDashboard site={site} locale={locale} />;
  }

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
