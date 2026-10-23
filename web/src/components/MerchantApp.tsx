import { useEffect, useMemo, useState } from "react";
import { fetchAgentStatus, fetchLifecycle, postChat, postIotSimulation, requestAgentReport, simulateLifecycleStage, type IotSimulationMode } from "../api";
import { AuthModal } from "./AuthModal";
import { useAuth } from "../hooks/useAuth";
import { useWallet } from "./WalletContext";
import { exportMerchantAudit, importDemoEvidence, loadMerchantSummary, MerchantApiError, merchantRequestHeaders, reconcileMerchantBatch, requestMediaPresign, prepareMediaIntake, validateMerchantBatch } from "../merchant/merchantApi";
import type { AuditExport, EvidenceIssue, MerchantBatchSummary, MerchantSummary, ReconciliationResult, MediaIntakePreview, MediaPresignResponse } from "../merchant/types";
import type { ChatEvent, LifecycleView } from "../types";
import type { TenantSiteConfig } from "../siteConfig";

type MerchantTab = "overview" | "import" | "review" | "preview" | "audit";

const statusLabel: Record<MerchantBatchSummary["status"] | EvidenceIssue["status"], string> = {
  accepted_with_scope: "证据门禁通过",
  passed: "已通过",
  review: "待复核",
  missing: "缺失",
  rejected: "已拒绝",
  revoked: "已撤销",
};

const statusLabelEn: Record<keyof typeof statusLabel, string> = {
  accepted_with_scope: "Evidence gate passed",
  passed: "Passed",
  review: "Needs review",
  missing: "Missing",
  rejected: "Rejected",
  revoked: "Revoked",
};

function StatusPill({ status, en = false }: { status: keyof typeof statusLabel; en?: boolean }) {
  return <span className={`merchant-status-pill ${status}`}>{en ? statusLabelEn[status] : statusLabel[status]}</span>;
}

export function MerchantApp({ tenant, locale = "zh" }: { tenant?: TenantSiteConfig; locale?: "zh" | "en" } = {}) {
  const en = locale === "en";
  const merchantTenantId = tenant?.tenantId ?? "demo-tenant";
  const defaultBatchId = tenant?.batch.defaultBatchId ?? "FO-2026-001";
  const merchantProductId = tenant?.product.productId ?? "product-fish-oil";
  const merchantBrandName = tenant?.brand.name ?? (en ? "Demo brand" : "海蓝营养");
  const merchantProductName = tenant?.product.name ?? (en ? "Demo product" : "深海鱼油软胶囊");
  const demoConfig = { tenantId: merchantTenantId, brandName: merchantBrandName, productId: merchantProductId, productName: merchantProductName, defaultBatchId };
  const siteHome = tenant ? (locale === "en" ? `/en/sites/${tenant.slug}` : `/sites/${tenant.slug}`) : "/";
  const siteMerchant = tenant ? `${siteHome}/merchant` : "/merchant";
  const requestedBatchId = (() => {
    if (typeof window === "undefined") return defaultBatchId;
    const candidate = new URLSearchParams(window.location.search).get("batch")?.trim().toUpperCase();
    if (!candidate || !tenant) return candidate || defaultBatchId;
    const prefix = defaultBatchId.split("-")[0];
    return candidate.startsWith(`${prefix}-`) ? candidate : defaultBatchId;
  })();
  const { setWalletModalOpen, address, chainId } = useWallet();
  const { user, loading: authLoading, configured: authConfigured, signIn, signUp } = useAuth();
  const [tab, setTab] = useState<MerchantTab>("overview");
  const [summary, setSummary] = useState<MerchantSummary | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<MerchantBatchSummary | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<EvidenceIssue | null>(null);
  const [reconciliation, setReconciliation] = useState<ReconciliationResult | null>(null);
  const [audit, setAudit] = useState<AuditExport | null>(null);
  const [message, setMessage] = useState("");
  const [agentInput, setAgentInput] = useState("");
  const [agentReply, setAgentReply] = useState("");
  const [agentBusy, setAgentBusy] = useState(false);
  const [agentStatus, setAgentStatus] = useState<{ status?: string; agentMode?: string; model?: string | null; dataMode?: string } | null>(null);
  const [agentMeta, setAgentMeta] = useState<Pick<ChatEvent, "dataMode" | "contextMode" | "contextSource" | "contextRevision" | "syncedAt" | "traceId"> | null>(null);
  const [lifecycle, setLifecycle] = useState<LifecycleView | null>(null);
  const [lifecycleBusy, setLifecycleBusy] = useState(false);
  const [agentReport, setAgentReport] = useState<Awaited<ReturnType<typeof requestAgentReport>> | null>(null);
  const [sensorDemo, setSensorDemo] = useState<Awaited<ReturnType<typeof postIotSimulation>> | null>(null);
  const [sensorMode, setSensorMode] = useState<IotSimulationMode | null>(null);
  const [selectedMedia, setSelectedMedia] = useState<File | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false);
  const [mediaPresign, setMediaPresign] = useState<MediaPresignResponse | null>(null);
  const [mediaPreview, setMediaPreview] = useState<MediaIntakePreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [authOpen, setAuthOpen] = useState(false);
  const [accessError, setAccessError] = useState<string | null>(null);
  const merchantApiEnabled = import.meta.env.VITE_TRUTHPASS_MERCHANT_API_ENABLED === "true";
  const activeBatchId = selectedBatch?.batchId ?? requestedBatchId;
  const siteConsumer = tenant ? `${siteHome}/agent?batch=${encodeURIComponent(activeBatchId)}` : "/";

  useEffect(() => {
    if (merchantApiEnabled && authConfigured && !user) {
      setLoading(false);
      return;
    }
    if (merchantApiEnabled && authLoading) return;
    let active = true;
    setAccessError(null);
        loadMerchantSummary(merchantTenantId, demoConfig)
      .then(async (next) => {
        if (!active) return;
        setSummary(next);
        const initialBatch = next.batches.find((batch) => batch.batchId.toUpperCase() === requestedBatchId) ?? next.batches[0] ?? null;
        setSelectedBatch(initialBatch);
        const [status, nextLifecycle] = await Promise.all([
          fetchAgentStatus().catch(() => null),
          fetchLifecycle(initialBatch?.batchId ?? defaultBatchId).catch(() => null),
        ]);
        setAgentStatus(status);
        setLifecycle(nextLifecycle);
      })
      .catch((error: unknown) => {
        if (!active) return;
        const code = error instanceof MerchantApiError ? error.code : undefined;
        setAccessError(code === "TENANT_SCOPE_MISMATCH" ? "当前账号没有这个企业租户的权限，请让管理员邀请你后再进入。" : code === "SUPABASE_SESSION_REQUIRED" ? "请先登录企业账号，再查看企业证据。" : "企业证据服务暂时不可用，请稍后再试或联系管理员。 ");
      })
      .finally(() => setLoading(false));
    return () => { active = false; };
  }, [authConfigured, authLoading, merchantApiEnabled, user, merchantTenantId, defaultBatchId, requestedBatchId]);

  const reviewItems = useMemo(
    () =>
      summary?.batches.flatMap((batch) =>
        batch.issues
          .filter((issue) => issue.status !== "passed")
          .map((issue) => ({ ...issue, productName: batch.productName })),
      ) ?? [],
    [summary],
  );

  const selectBatch = async (batch: MerchantBatchSummary) => {
    setSelectedBatch(batch);
    const next = await validateMerchantBatch(summary?.tenantId ?? merchantTenantId, batch.batchId, demoConfig);
    setSummary((current) =>
      current
        ? { ...current, batches: current.batches.map((item) => (item.batchId === batch.batchId ? next : item)) }
        : current,
    );
    setSelectedBatch(next);
    setLifecycle(await fetchLifecycle(next.batchId).catch(() => null));
  };

  const runReconciliation = async () => {
    try {
      setReconciliation(await reconcileMerchantBatch(summary?.tenantId ?? merchantTenantId, selectedBatch?.batchId ?? defaultBatchId));
      setMessage("已完成生产、检测、冷链和出货对账；冲突项不会自动改写批次状态。");
    } catch {
      setMessage("对账暂时无法完成，请先确认企业 API 凭证和批次资料。");
    }
  };

  const refreshLifecycle = async (batchId = selectedBatch?.batchId ?? defaultBatchId) => {
    setLifecycleBusy(true);
    try {
      setLifecycle(await fetchLifecycle(batchId));
    } catch {
      setMessage("生命周期资料暂时无法读取，请检查 API 状态。");
    } finally {
      setLifecycleBusy(false);
    }
  };

  const syncLifecycle = async (stage: LifecycleView["events"][number]["stage"]) => {
    setLifecycleBusy(true);
    try {
      setLifecycle(await simulateLifecycleStage(selectedBatch?.batchId ?? defaultBatchId, stage));
      setMessage("已同步一条生产资料变化；消费者 Agent 和证据卡将在下一次查询时读取新的上下文版本。");
    } catch {
      setMessage("资料同步模拟失败，未修改当前批次状态。");
    } finally {
      setLifecycleBusy(false);
    }
  };

  const generateAgentReport = async () => {
    setLifecycleBusy(true);
    try {
      setAgentReport(await requestAgentReport(selectedBatch?.batchId ?? defaultBatchId, agentInput || undefined, summary?.tenantId ?? merchantTenantId));
    } catch {
      setMessage("Agent 汇报暂时无法生成，请检查 Agent Gateway 状态。");
    } finally {
      setLifecycleBusy(false);
    }
  };

  const runSensorDemo = async (mode: IotSimulationMode) => {
    setLifecycleBusy(true);
    setSensorMode(mode);
    try {
      setSensorDemo(await postIotSimulation(selectedBatch?.batchId ?? defaultBatchId, mode));
      await refreshLifecycle(selectedBatch?.batchId ?? defaultBatchId);
      setMessage("传感器模拟数据已传到服务器，完成批次关联和确定性校验。页面已刷新最新上下文。 ");
    } catch {
      setMessage("传感器模拟失败，当前批次没有被修改。 ");
    } finally {
      setLifecycleBusy(false);
    }
  };

  useEffect(() => {
    const handleLifecycleUpdate = (event: Event) => {
      const detail = (event as CustomEvent<{ batchId?: string }>).detail;
      if (detail?.batchId && detail.batchId !== selectedBatch?.batchId) return;
      void refreshLifecycle(detail?.batchId ?? selectedBatch?.batchId ?? defaultBatchId);
    };
    window.addEventListener("truthpass:lifecycle-updated", handleLifecycleUpdate);
    return () => window.removeEventListener("truthpass:lifecycle-updated", handleLifecycleUpdate);
  }, [selectedBatch?.batchId, defaultBatchId]);

  const askAgent = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || agentBusy) return;
    const batchId = selectedBatch?.batchId ?? defaultBatchId;
    setAgentInput(trimmed);
    setAgentBusy(true);
    setAgentReply("");
    setAgentMeta(null);
    try {
      await postChat(trimmed, batchId, (event) => {
        if (event.kind === "meta") {
          setAgentMeta({ dataMode: event.dataMode, contextMode: event.contextMode, contextSource: event.contextSource, contextRevision: event.contextRevision, syncedAt: event.syncedAt, traceId: event.traceId });
          setAgentStatus((current) => ({ ...(current ?? {}), status: event.serviceStatus, agentMode: event.agentMode, dataMode: event.dataMode }));
        }
        if (event.kind === "line" && event.text) setAgentReply((current) => current ? `${current}\n${event.text}` : event.text!);
      });
    } catch {
      setAgentReply("客服 Agent 暂时无法连接，已保留确定性证据卡。请稍后重试或转人工。");
    } finally {
      setAgentBusy(false);
    }
  };

  const prepareSelectedMedia = async () => {
    if (!selectedMedia) {
      setMessage("先选择一张照片、视频、报告或传感器文件。");
      return;
    }
    setMediaBusy(true);
    setMediaPresign(null);
    setMediaPreview(null);
    try {
      const digest = await crypto.subtle.digest("SHA-256", await selectedMedia.arrayBuffer());
      const hash = `0x${Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
      if (import.meta.env.VITE_TRUTHPASS_MERCHANT_API_ENABLED !== "true") {
        setMessage(`已在演示模式完成文件 Hash：${hash.slice(0, 18)}…；原文件未上传，也未写入真实企业数据。`);
        setMediaPreview({
          schemaVersion: "truthpass.enterprise.media-intake.v1",
          tenantId: (summary?.tenantId ?? merchantTenantId),
          requestId: "demo-media-request",
          traceId: "demo-media-trace",
          status: "awaiting_confirmation",
          nextAction: "演示模式只展示 Hash 和批次绑定；接入企业凭证后再上传到对象存储。",
          evidence: {
            evidenceId: `media-${hash.slice(2, 18)}`,
            batchId: selectedBatch?.batchId ?? defaultBatchId,
            kind: "production",
            issuerId: "demo-merchant",
            sourceKind: "manufacturer",
            occurredAt: new Date().toISOString(),
            dataMode: "demo/synthetic",
            payload: { mediaKind: selectedMedia.type.startsWith("image/") ? "photo" : selectedMedia.type.startsWith("video/") ? "video" : "pdf", contentHash: hash },
          },
        });
        return;
      }
      const presign = await requestMediaPresign((summary?.tenantId ?? merchantTenantId), { fileName: selectedMedia.name, contentType: selectedMedia.type || "application/octet-stream", size: selectedMedia.size, contentHash: hash });
      setMediaPresign(presign);
      const uploadHeaders = await merchantRequestHeaders(summary?.tenantId ?? merchantTenantId);
      const uploadResponse = await fetch(presign.uploadUrl, { method: presign.method, headers: { ...uploadHeaders, ...Object.fromEntries(Object.entries(presign.headers).flatMap(([key, value]) => value ? [[key, value]] : [])) } as Record<string, string>, body: selectedMedia });
      if (!uploadResponse.ok) throw new Error(`媒体上传失败：HTTP ${uploadResponse.status}`);
      const preview = await prepareMediaIntake((summary?.tenantId ?? merchantTenantId), {
        brandId: "brand-demo",
        productId: merchantProductId,
        batchId: selectedBatch?.batchId ?? defaultBatchId,
        evidenceKind: "production",
        mediaKind: selectedMedia.type.startsWith("image/") ? "photo" : selectedMedia.type.startsWith("video/") ? "video" : "pdf",
        issuerId: "merchant-operator",
        sourceKind: "manufacturer",
        capturedAt: new Date().toISOString(),
        contentHash: hash,
        rawObjectRef: presign.rawObjectRef,
        dataMode: presign.dataMode,
      });
      setMediaPreview(preview);
      setMessage("文件上传准备完成；请先确认批次和来源，再提交证据。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "文件 Hash 或上传准备失败。");
    } finally {
      setMediaBusy(false);
    }
  };

  const importEvidence = async (kind: EvidenceIssue["kind"]) => {
    const result = await importDemoEvidence(
      summary?.tenantId ?? merchantTenantId,
      selectedBatch?.batchId ?? defaultBatchId,
      kind,
      demoConfig,
    );
    setMessage(result.message);
    setTab("review");
  };

  const loadAudit = async () => {
    setAudit(await exportMerchantAudit(summary?.tenantId ?? merchantTenantId, demoConfig));
    setTab("audit");
  };

  if (merchantApiEnabled && !authConfigured) {
    return <main className="merchant-shell merchant-dashboard-shell"><div className="merchant-access-state"><p className="eyebrow">{en ? "MERCHANT EVIDENCE WORKSPACE" : "企业证据工作台"}</p><h1>{en ? "Merchant service is not configured" : "企业服务尚未配置"}</h1><p>{en ? "Supabase account service is disabled for this deployment. Configure account and tenant authorization first." : "当前部署没有启用 Supabase 账号服务，企业资料不会退回演示数据。请先配置账号和租户授权。"}</p></div></main>;
  }

  if (merchantApiEnabled && authConfigured && !user) {
    return <><main className="merchant-shell merchant-dashboard-shell"><div className="merchant-access-state"><p className="eyebrow">{en ? "MERCHANT EVIDENCE WORKSPACE" : "企业证据工作台"}</p><h1>{en ? "Sign in to view merchant evidence" : "先登录，再看企业资料"}</h1><p>{en ? "Batch, media, and audit records are available to authorized tenants only." : "企业批次、媒体和审计记录只对已授权租户开放。"}</p><button type="button" className="merchant-wallet-button" onClick={() => setAuthOpen(true)}>{en ? "Sign in to merchant account" : "登录企业账号"}</button></div></main><AuthModal open={authOpen} onClose={() => setAuthOpen(false)} configured={authConfigured} onAuth={async (mode, email, password) => mode === "signin" ? signIn(email, password) : signUp(email, password)} /></>;
  }

  if (accessError) {
    return <><main className="merchant-shell merchant-dashboard-shell"><div className="merchant-access-state"><p className="eyebrow">{en ? "MERCHANT EVIDENCE WORKSPACE" : "企业证据工作台"}</p><h1>{en ? "This account cannot access this workspace" : "当前账号还不能访问这里"}</h1><p>{accessError}</p><button type="button" className="merchant-wallet-button" onClick={() => window.location.reload()}>{en ? "Check access again" : "重新检查权限"}</button></div></main><AuthModal open={authOpen} onClose={() => setAuthOpen(false)} configured={authConfigured} onAuth={async (mode, email, password) => mode === "signin" ? signIn(email, password) : signUp(email, password)} /></>;
  }

  if (loading || !summary) {
    return (
      <main className="merchant-shell merchant-dashboard-shell">
        <div className="merchant-loading">{en ? "Loading merchant evidence workspace…" : "正在加载企业证据工作台…"}</div>
      </main>
    );
  }

  const demo = summary.source === "demo/synthetic";
  const previewBatch = selectedBatch ?? summary.batches[0];
  const overviewRows = summary.batches.map((batch) => ({
    batchId: batch.batchId,
    productName: batch.productName.startsWith(summary.brandName) ? batch.productName : `${summary.brandName} · ${batch.productName}`,
    completeness: batch.completeness,
    status: batch.status,
    issuers: new Set(batch.issues.map((issue) => issue.issuer)).size,
  }));
  const averageCompleteness = Math.round(summary.batches.reduce((total, batch) => total + batch.completeness, 0) / Math.max(summary.batches.length, 1));
  const kpis = [
    [en ? "Batch evidence" : "批次证据", String(summary.batchCount), en ? "batches" : "个批次", "cube"],
    [en ? "Evidence completeness" : "证据完整度", `${averageCompleteness}%`, en ? "overall average" : "整体平均", "ring"],
    [en ? "Needs review" : "待复核", String(summary.reviewCount), en ? "batches" : "个批次", "alert"],
    [en ? "Issuing organizations" : "来源机构", String(new Set(summary.batches.flatMap((batch) => batch.issues.map((issue) => issue.issuer))).size), en ? "partner organizations" : "家合作机构", "institution"],
  ];
  const isRiceSite = tenant?.slug === "rice-demo";
  const consumerEvidenceRows = isRiceSite
    ? [
      ["🌾", en ? "Farming & origin" : "种植与产地", en ? "Origin, weather, and soil records" : "产地、天气和土壤记录", en ? "Recorded" : "已记录"],
      ["⌁", en ? "Residue tests" : "农残检测", en ? "Residue and quality reports" : "农残和质量指标检测报告", en ? "2 reports" : "2 份"],
      ["♜", en ? "Issuing organizations" : "来源机构", en ? "Grower, lab, and logistics" : "种植方、检测机构和物流方", en ? "3 organizations" : "3 家"],
    ]
    : [
      ["⚗", en ? "Test evidence" : "检测证据", en ? "Microbial, heavy-metal, and nutrition reports" : "微生物、重金属、营养成分等检测报告", en ? "3 reports" : "3 份"],
      ["❄", en ? "Cold-chain records" : "冷链记录", en ? "Temperature records from origin to storage" : "从产地到仓储的温控记录", en ? "Complete" : "完整"],
      ["♜", en ? "Issuing organizations" : "来源机构", en ? "Labs, cold-chain logistics, suppliers" : "检测机构、冷链物流、原料供应商等", en ? "3 organizations" : "3 家"],
    ];
  const previewCompleteness = previewBatch?.completeness ?? 0;
  const previewAccepted = previewBatch?.status === "accepted_with_scope";
  const previewStatusLabel = previewAccepted ? (en ? "✓ Passed" : "✓　通过") : (en ? "◯ Needs review" : "◯　待复核");
  const previewStatusDetail = previewAccepted ? (en ? "Evidence checks are complete for the current scope" : "本批次已完成当前范围内的证据核验") : (en ? "Some records still need review" : "本批次仍有资料需要复核");
  const previewUncertainty = isRiceSite ? (en ? "Some soil or residue records are still missing" : "本批次的部分土壤或农残资料待补充") : (en ? "Some origin certificates are still missing" : "本批次的部分原料产地证明待补充");

  return (
    <main className="merchant-shell merchant-dashboard-shell">
      <div className="merchant-app-frame">
        <aside className="merchant-sidebar" aria-label={en ? "Merchant workspace navigation" : "商家工作台导航"}>
          <a href={siteHome} className="merchant-sidebar-brand">
            <img src="/assets/brand-mark.png" alt="TruthPass" />
            <span>TruthPass<small>{en ? "White-label product evidence infrastructure" : "白牌商品证据基础设施"}</small></span>
          </a>
          <nav>
            {[
              ["overview", "⌂", en ? "Workspace" : "工作台"],
              ["import", "◇", en ? "Batch management" : "批次管理"],
              ["review", "▣", en ? "Evidence center" : "证据中心"],
              ["preview", "♧", en ? "Partners" : "机构与合作"],
              ["audit", "▥", en ? "Reports" : "数据报表"],
            ].map(([id, icon, label]) => (
              <button
                key={id}
                type="button"
                className={tab === id || (id === "overview" && tab === "overview") ? "active" : ""}
                onClick={() => id === "audit" ? void loadAudit() : setTab(id as MerchantTab)}
              >
                <span aria-hidden="true">{icon}</span>{label}
              </button>
            ))}
          </nav>
          <div className="merchant-sidebar-foot">
            <strong>{en ? <>Every product<br />with verifiable evidence</> : <>让每一份食品<br />都有可验证的证据</>}</strong>
            <span>{demo ? "DEMO / SYNTHETIC" : "EXTERNAL"}</span>
            <small>{en ? "For product demos only" : "仅用于产品演示"}</small>
          </div>
        </aside>

        <section className="merchant-app-main">
          <header className="merchant-topbar merchant-global-topbar">
              <a href={siteHome} className="merchant-brand">
              <img src="/assets/brand-mark.png" alt="TruthPass" />
              <span>TruthPass <small>{en ? "Merchant evidence workspace" : "企业证据工作台"}</small></span>
            </a>
            <nav className="merchant-global-nav" aria-label={en ? "Platform navigation" : "平台导航"}>
              <a className="active" href={siteMerchant}>{en ? "Merchant workspace" : "企业工作台"}</a>
              <a href={siteConsumer}>{en ? "Consumer view" : "消费者视角"}</a>
              <a href="#help">{en ? "Help center" : "帮助中心"}</a>
            </nav>
            <div className="merchant-top-actions">
              <span className="merchant-notification" aria-label={en ? "Pending notifications" : "有待处理提醒"}>♧<i /></span>
              <span className="merchant-demo-pill">{demo ? "DEMO / SYNTHETIC" : "EXTERNAL"}</span>
              <button type="button" className="merchant-wallet-button" onClick={() => setWalletModalOpen(true)}>{address && chainId === 677 ? (en ? "Institution wallet · Chain 677" : "机构钱包 · Chain 677") : (en ? "Open institution wallet" : "打开机构钱包")}</button>
              <span className="merchant-account">{summary.brandName} {en ? "(business)" : "（企业版）"}⌄</span>
            </div>
          </header>

          <section className="merchant-heading merchant-dashboard-heading">
            <div>
              <span className="eyebrow">{en ? "MERCHANT EVIDENCE WORKSPACE" : "企业证据工作台"}</span>
              <h1>{en ? "Merchant workspace" : "企业工作台"}</h1>
              <p>{en ? "Manage the evidence trail for white-label products and build consumer trust." : "管理白牌商品的全链路证据，建立消费者信任"}</p>
            </div>
            <div className="merchant-heading-controls">
              <button type="button" className="merchant-select-control">{summary.brandName} {en ? "(demo tenant)" : "（示例企业）"}⌄</button>
              <span className="merchant-date-control">2024-11-01 → 2026-02-28　▣</span>
            </div>
          </section>

          <nav className="merchant-tabs merchant-secondary-tabs" aria-label={en ? "Merchant workspace sections" : "企业工作台功能"}>
            {([["overview", en ? "Overview" : "总览"], ["import", en ? "Import batches" : "批次导入"], ["review", en ? "Needs review" : "待复核"], ["preview", en ? "Public preview" : "公开预览"], ["audit", en ? "Audit export" : "审计导出"]] as const).map(([id, label]) => (
              <button key={id} type="button" className={tab === id ? "active" : ""} onClick={() => id === "audit" ? void loadAudit() : setTab(id)}>
                {label}{id === "review" && summary.reviewCount > 0 && <em>{summary.reviewCount}</em>}
              </button>
            ))}
          </nav>

          {message && (
            <div className="merchant-notice" role="status">
              {message}
              <button type="button" onClick={() => setMessage("")} aria-label={en ? "Close notice" : "关闭提示"}>×</button>
            </div>
          )}

          {tab === "overview" && (
            <>
              <section className="merchant-kpis merchant-dashboard-kpis">
                {kpis.map(([label, value, detail, icon]) => (
                  <div className="merchant-kpi merchant-dashboard-kpi" key={label}>
                    <div className="merchant-kpi-label"><span>{label}</span><b aria-hidden="true">{icon === "ring" ? "◯" : icon === "alert" ? "!" : icon === "institution" ? "♜" : "◇"}</b></div>
                    <strong>{value}</strong>
                    <small>{detail}</small>
                  </div>
                ))}
              </section>

              <section className="merchant-section merchant-lifecycle-section" aria-label={en ? "Batch lifecycle" : "批次全生命周期"}>
                <div className="merchant-section-head merchant-lifecycle-head">
                  <div><span className="eyebrow">{en ? "BATCH LIFECYCLE" : "批次全流程"}</span><h2>{en ? "Lifecycle evidence" : "全生命周期资料"}</h2><p>{en ? "Producers, labs, logistics, consumers, and reviewers share one batch record." : "生产方、检测机构、物流、消费者和监管角色共享同一批次信息。"}</p></div>
                  <div className="merchant-lifecycle-actions">
                    <span className="merchant-sync-meta">{lifecycle ? `${lifecycle.contextMode} · v${lifecycle.contextRevision}` : (en ? "Reading sync context" : "正在读取同步上下文")}</span>
                    <button type="button" className="merchant-secondary" onClick={() => void generateAgentReport()} disabled={lifecycleBusy}>{en ? "Generate Agent report" : "生成 Agent 汇报"}</button>
                    <button type="button" className="merchant-secondary" onClick={() => void refreshLifecycle()} disabled={lifecycleBusy}>↻ {en ? "Refresh sync" : "刷新同步"}</button>
                  </div>
                </div>
                {lifecycle ? (
                  <>
                    <div className="merchant-lifecycle-meta"><span>{en ? "Source: " : "资料来源："}{lifecycle.contextSource}</span><span>{en ? "Last sync: " : "最后同步："}{new Date(lifecycle.syncedAt).toLocaleString(en ? "en-US" : "zh-CN")}</span><span>{en ? "Data mode: " : "数据模式："}{lifecycle.dataMode}</span></div>
                    <div className="merchant-lifecycle-track">
                      {lifecycle.events.map((event, index) => (
                        <div className={`merchant-lifecycle-event ${event.status}`} key={event.stage}>
                          <div className="merchant-lifecycle-node">{event.status === "verified" ? "✓" : event.status === "awaiting_user" ? "⌁" : event.status === "synced" ? "●" : index + 1}</div>
                          <div className="merchant-lifecycle-copy"><strong>{event.label}</strong><span>{event.role}</span><small>{event.detail}</small><em>{event.status === "verified" ? (en ? "Verified" : "已确认") : event.status === "synced" ? (en ? "Synced" : "已同步") : event.status === "awaiting_user" ? (en ? "Waiting for wallet" : "等待用户钱包") : (en ? "Pending" : "待处理")}</em></div>
                          {event.status !== "verified" && <button type="button" className="merchant-lifecycle-sync" onClick={() => void syncLifecycle(event.stage)} disabled={lifecycleBusy}>{event.stage === "purchase" ? (en ? "Simulate purchase" : "模拟购买") : event.stage === "regulatory_review" ? (en ? "Simulate review" : "模拟复核") : (en ? "Sync change" : "同步变化")}</button>}
                        </div>
                      ))}
                    </div>
                    {agentReport && <div className="merchant-agent-report-card"><div className="merchant-agent-report-head"><div><span className="eyebrow">AGENT REPORT</span><strong>生产 / 检测 / 消费者协作汇报</strong></div><span className="merchant-report-status">{agentReport.writePlan?.status === "pending_wallet_signature" ? "待机构钱包签名" : "等待补证"}</span></div><p>{(agentReport.selectedFacts ?? []).slice(0, 3).join("；") || "Agent 没有选择可公开的事实。"}</p><div className="merchant-agent-report-meta"><span>验证：{agentReport.verification?.status ?? "unknown"}</span><span>上链事件：{agentReport.writePlan?.eventName ?? "—"}</span><span>角色：{agentReport.writePlan?.requiredRole ?? "—"}</span><span>上下文：v{agentReport.contextRevision ?? "—"}</span><span>审计：{agentReport.agentAudit ? "已记录" : "待读取"}</span></div><small>{agentReport.writePlan?.nextAction}</small>{agentReport.agentAudit?.records?.length ? <div className="merchant-audit-trace" aria-label="Agent 审计轨迹">{agentReport.agentAudit.records.map((record, index) => <div key={`${record.role}-${index}`}><b>{record.role}</b><span>{record.outputStatus}</span><small>引用 {record.citedEvidenceIds?.length ?? 0} 条证据 · {record.writeBoundary}</small></div>)}</div> : null}<button type="button" className="merchant-primary" onClick={() => setWalletModalOpen(true)}>打开机构钱包 →</button></div>}
                  </>
                ) : <div className="merchant-empty">{en ? "Lifecycle context has not been read." : "尚未读取生命周期上下文。"}</div>}
              </section>

              <section className="merchant-section merchant-sensor-section" aria-label={en ? "Sensor replay" : "传感器数据回放"}>
                <div className="merchant-section-head"><div><span className="eyebrow">{en ? "SERVER REPLAY" : "服务器回放"}</span><h2>{en ? "How sensor data enters the evidence card" : "传感器资料怎么进入证据卡"}</h2><p>{en ? "A simulated temperature reading shows device send → server validation → batch update." : "用一条模拟温控数据，完整展示“设备发送 → 服务端校验 → 批次更新”。"}</p></div><span className="merchant-demo-pill">DEMO / SYNTHETIC</span></div>
                <div className="merchant-sensor-actions"><button type="button" className="merchant-secondary" onClick={() => void runSensorDemo("normal")} disabled={lifecycleBusy}>{en ? "Simulate normal temperature" : "模拟正常温控"}</button><button type="button" className="merchant-secondary" onClick={() => void runSensorDemo("cold_chain_gap")} disabled={lifecycleBusy}>{en ? "Simulate cold-chain gap" : "模拟冷链异常"}</button><button type="button" className="merchant-secondary" onClick={() => void runSensorDemo("device_offline")} disabled={lifecycleBusy}>{en ? "Simulate offline device" : "模拟设备离线"}</button></div>
                {sensorDemo && <div className="merchant-sensor-result"><div className="merchant-sensor-steps">{(sensorDemo.pipeline ?? ["设备发送", "服务端接收", "批次关联", "确定性校验"]).map((step, index, all) => <span key={step} className={index === all.length - 1 ? "done" : ""}><b>{index + 1}</b>{step}{index < all.length - 1 && <i>→</i>}</span>)}</div><div className="merchant-sensor-result-copy"><strong>{sensorMode === "normal" ? "温控正常" : sensorMode === "cold_chain_gap" ? "冷链异常" : "设备离线"} · {sensorDemo.verification?.status === "accepted" ? "校验通过" : "进入复核"}</strong><p>{sensorDemo.message}</p><small>{sensorDemo.evidenceId} · payloadHash {sensorDemo.payloadHash}</small></div></div>}
              </section>

              <section className="merchant-section merchant-batch-table-section">
                <div className="merchant-section-head">
                  <div><span className="eyebrow">{en ? "BATCH OVERVIEW" : "批次总览"}</span><h2>{en ? "Batch list" : "批次列表"}</h2></div>
                  <div className="merchant-table-actions">
                    <button type="button" className="merchant-primary" onClick={() => setTab("import")}>⇧　{en ? "Import evidence" : "导入证据"}</button>
                    <button type="button" className="merchant-more-button" aria-label={en ? "More batch actions" : "更多批次操作"}>···</button>
                  </div>
                </div>
                <div className="merchant-searchbar">⌕　{en ? "Search batch ID, product, or status…" : "搜索批次号、商品名称或状态…"}</div>
                <div className="merchant-batch-table" role="table" aria-label={en ? "Batch list" : "批次列表"}>
                  <div className="merchant-batch-table-row merchant-batch-table-head" role="row">
                    <span>{en ? "Batch ID" : "批次号"}</span><span>{en ? "Product" : "商品名称"}</span><span>{en ? "Completeness" : "证据完整度"}</span><span>{en ? "Evidence status" : "证据状态"}</span><span>{en ? "Issuers" : "来源机构"}</span><span>{en ? "Action" : "操作"}</span>
                  </div>
                  {overviewRows.map((row) => (
                    <button className="merchant-batch-table-row" type="button" key={row.batchId} onClick={() => {
                      const found = summary.batches.find((batch) => batch.batchId === row.batchId);
                      if (found) void selectBatch(found);
                      setTab("preview");
                    }}>
                      <span className="mono">{row.batchId}</span>
                      <span>{row.productName}</span>
                      <span className="merchant-table-completeness"><b>{row.completeness}%</b><i><em style={{ width: `${row.completeness}%` }} /></i></span>
                          <StatusPill status={row.status} en={en} />
                      <span>{row.issuers} {en ? "organizations" : "家机构"}</span>
                      <span className="merchant-table-open">{en ? "View evidence card　→" : "查看证据卡　→"}</span>
                    </button>
                  ))}
                </div>
                <div className="merchant-table-footer"><span>{en ? `${summary.batches.length} demo records` : `共 ${summary.batches.length} 条演示记录`}</span><span>‹　 <b>1</b>　›</span></div>
              </section>
            </>
          )}

          {tab === "import" && (
            <section className="merchant-section merchant-import-layout">
              <div className="merchant-import-card">
                <span className="eyebrow">{en ? "IMPORT EVIDENCE" : "资料导入"}</span><h2>{en ? "Import batch evidence" : "导入批次资料"}</h2>
                <p>{en ? "CSV, Excel mapping, and API intake are supported. The browser demo uses an explicit fixture and stores no enterprise token." : "首期支持 CSV、Excel 映射和 API 接入。当前浏览器演示使用明确的 Demo fixture，不保存企业 Token。"}</p>
                <div className="merchant-dropzone"><span>⇧</span><strong>{selectedMedia ? selectedMedia.name : (en ? "Drop a file or choose a source" : "拖入文件或选择数据源")}</strong><small>{en ? "Photo / video / PDF / audio / sensor · raw media stays off-chain" : "照片 / 视频 / PDF / 语音 / 传感器 · 原始媒体保留在链下"}</small><input className="merchant-file-input" type="file" accept="image/*,video/*,audio/*,.pdf,.csv,.json" onChange={(event) => setSelectedMedia(event.target.files?.[0] ?? null)} aria-label={en ? "Choose batch evidence file" : "选择批次资料文件"} /><button type="button" className="merchant-secondary" onClick={() => void prepareSelectedMedia()} disabled={!selectedMedia || mediaBusy}>{mediaBusy ? (en ? "Computing hash…" : "正在计算 Hash…") : (en ? "Prepare upload" : "生成上传准备")}</button>{mediaPreview && <div className="merchant-media-preview" role="status"><strong>{en ? "Evidence ready for confirmation" : "已生成待确认证据"}</strong><small>{mediaPreview.evidence.evidenceId} · {mediaPreview.evidence.dataMode}</small><small>Hash：{mediaPreview.evidence.payload.contentHash}</small><em>{mediaPreview.nextAction}</em></div>}{mediaPresign && <small className="merchant-presign-note">{en ? "Storage: " : "存储："}{mediaPresign.storageMode} · {en ? "Upload URL valid for 15 minutes" : "上传地址已生成，15 分钟内有效"}</small>}</div>
                <div className="merchant-import-actions">{([["production", "生产记录"], ["inspection", "检测报告"], ["cold_chain", "冷链记录"], ["shipment", "出货记录"]] as const).map(([kind, label]) => <button type="button" key={kind} onClick={() => void importEvidence(kind)}>导入 Demo · {label}</button>)}</div>
              </div>
              <div className="merchant-mapping-card"><span className="eyebrow">资料对应</span><h3>首期必需信息</h3>{["企业和品牌", "商品和批次", "样品和资料编号", "资料提供方", "发生时间和更新时间"].map((field) => <div className="merchant-field-row" key={field}><span>{field}</span><b>待对应</b></div>)}<small>真实企业接入需要先固定批次号和样品号，避免检测报告放错批次。</small></div>
            </section>
          )}

          {tab === "review" && (
            <section className="merchant-section">
              <div className="merchant-section-head"><div><span className="eyebrow">待处理问题</span><h2>资料审核列表</h2></div><span className="merchant-count">{reviewItems.length} 个待处理项</span></div>
               <div className="merchant-review-layout"><div className="merchant-review-list">{reviewItems.map((issue) => <button className={selectedIssue?.id === issue.id ? "merchant-review-item active" : "merchant-review-item"} key={issue.id} type="button" onClick={() => setSelectedIssue(issue)}><div><strong>{issue.title}</strong><span>{issue.batchId} · {issue.issuer}</span></div><StatusPill status={issue.status} en={en} /></button>)}</div><div className="merchant-review-detail">{selectedIssue ? <><div className="merchant-detail-head"><div><span className="eyebrow">EVIDENCE DETAIL</span><h3>{selectedIssue.title}</h3><p>{selectedIssue.batchId} · {selectedIssue.issuer}</p></div><StatusPill status={selectedIssue.status} en={en} /></div><dl><div><dt>{en ? "Signature status" : "签名状态"}</dt><dd>{selectedIssue.signature}</dd></div><div><dt>{en ? "Evidence hash" : "证据哈希"}</dt><dd className="mono">{selectedIssue.hash}</dd></div><div><dt>{en ? "Current fact" : "当前事实"}</dt><dd>{selectedIssue.detail}</dd></div><div><dt>{en ? "Next step" : "下一步"}</dt><dd>{selectedIssue.nextAction}</dd></div></dl><div className="merchant-review-actions"><button className="merchant-primary" type="button" onClick={() => setMessage(en ? "Review task created; production will continue through institutional signing and human review." : "已生成复核任务；真实生产环境将进入机构签名和人工审核流程。")}>{en ? "Create review task" : "创建复核任务"}</button><button className="merchant-secondary" type="button" onClick={() => void runReconciliation()}>{en ? "Run batch reconciliation" : "运行批次对账"}</button><button className="merchant-secondary" type="button" onClick={() => setWalletModalOpen(true)}>{en ? "Open institution wallet" : "打开机构钱包"}</button></div>{reconciliation && <div className={`merchant-reconciliation-result ${reconciliation.status}`} role="status"><strong>{en ? "Reconciliation: " : "对账结果："}{reconciliation.status}</strong><small>{reconciliation.reasons.length ? reconciliation.reasons.join(en ? "; " : "；") : (en ? "No conflicts were found in the current rule scope." : "没有发现当前规则覆盖范围内的冲突。")}</small></div>}</> : <div className="merchant-empty">{en ? "Choose an evidence issue to view details." : "选择一个证据问题查看详情。"}</div>}</div></div>
            </section>
          )}

          {tab === "preview" && (
            <section className="merchant-section">
              <div className="merchant-section-head"><div><span className="eyebrow">消费者看到的页面</span><h2>公开资料卡</h2></div><span className="merchant-demo-pill">不会暴露内部报告</span></div>
              {previewBatch && <div className="merchant-public-card"><div className="merchant-public-card-head"><div><span>{summary.brandName}</span><h3>{previewBatch.productName}</h3><p>{previewBatch.batchId} · {previewBatch.policy}</p></div><StatusPill status={previewBatch.status} en={en} /></div><div className="merchant-public-grid">{previewBatch.issues.map((issue) => <div key={issue.id} className="merchant-public-item"><span>{issue.status === "passed" ? "✓" : issue.status === "revoked" ? "!" : "○"}</span><div><strong>{issue.title}</strong><small>{issue.issuer} · {issue.signature}</small></div></div>)}</div><div className="merchant-public-note">{en ? "Public mode: " : "当前公开模式："}{previewBatch.source}{en ? ". Evidence status comes from deterministic verification; the Agent only explains it." : "。证据状态来自确定性验证，Agent 只负责解释。"}</div></div>}
            </section>
          )}

          {tab === "audit" && (
            <section className="merchant-section">
              <div className="merchant-section-head"><div><span className="eyebrow">审核记录</span><h2>导出审核记录</h2></div><button type="button" className="merchant-primary" onClick={() => { if (!audit) return; const blob = new Blob([JSON.stringify(audit, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = audit.tenantId + "-audit-export.json"; a.click(); URL.revokeObjectURL(url); }}>下载记录</button></div>
              {audit ? <div className="merchant-audit-card"><div><strong>{audit.evidence.length}</strong><span>证据摘要</span></div><div><strong>{audit.events.length}</strong><span>审计事件</span></div><p>导出只包含 evidenceId、批次、类型、哈希、状态和 rawObjectRef，不包含原始 payload、地址和健康数据。</p>{audit.events.map((event) => <div className="merchant-audit-event" key={event.eventId}><span>{event.eventType}</span><small>{event.createdAt} · {event.requestId}</small></div>)}</div> : <div className="merchant-empty">正在加载审计导出…</div>}
            </section>
          )}
        </section>

        {tab === "overview" && previewBatch && (
          <aside className="merchant-consumer-preview" aria-label="消费者视角预览">
            <div className="merchant-consumer-preview-head"><div><span className="eyebrow">CONSUMER VIEW</span><h2>消费者视角</h2><p>扫描商品二维码，查看本批次的完整证据</p></div><button type="button" className="merchant-secondary">↗ 分享此页面</button></div>
            <div className="merchant-product-preview-card">
              <div className="merchant-product-preview-top"><img src={tenant?.product.productId === "fish-oil" ? "/assets/fish-oil-product.png" : "/assets/brand-mark.png"} alt={`${summary.brandName} ${previewBatch.productName}`} /><div><h3>{summary.brandName}</h3><strong>{previewBatch.productName}</strong><small>{en ? `${tenant?.product.category ?? "Product"} (demo product)` : `${tenant?.product.category ?? "商品"}（演示商品）`}</small></div></div>
              <div className="merchant-product-preview-meta"><span>批次　<b>{previewBatch.batchId}</b></span><small>生产日期　2026-01-10　建议食用期至 2027-01-09</small></div>
              <div className="merchant-product-status-grid"><div><b>{previewStatusLabel}</b><span>{previewStatusDetail}</span></div><div><b>◯　{previewCompleteness}%</b><span>证据完整度</span></div></div>
            </div>
            <div className="merchant-consumer-evidence-list">
              {consumerEvidenceRows.map(([icon, title, detail, value]) => <div key={title}><span>{icon}</span><div><strong>{title}</strong><small>{detail}</small></div><b>{value}　›</b></div>)}
            </div>
            <div className="merchant-consumer-issue"><span>!</span><div><strong>不确定项</strong><small>{previewUncertainty}</small></div><b>1 项　›</b></div>
            <div className="merchant-consumer-next"><span>▶</span><div><strong>下一步动作</strong><small>补充原料产地文件并提交复核</small></div><button type="button" onClick={() => setTab("review")}>查看详情</button></div>
          </aside>
        )}
      </div>

      {tab === "overview" && (
        <section className="merchant-agent-bar" aria-label="商品客服 Agent 演示">
          <div className="merchant-agent-avatar">◉</div>
              <div className="merchant-agent-intro"><strong>商品客服 Agent <span className={agentStatus?.agentMode === "model_assisted" ? "agent-live" : "agent-fallback"}>{agentStatus?.agentMode === "model_assisted" ? "● 在线 · 模型" : agentStatus?.agentMode === "deterministic_fallback" && agentStatus?.status !== "unavailable" ? "● 在线 · 兜底" : "○ 待连接"}</span></strong><small>基于批次证据卡和生产资料同步上下文回答，不自行生成质量结论</small>{agentStatus?.model && <small className="merchant-agent-model">模型：{agentStatus.model}</small>}</div>
          <div className="merchant-agent-prompts">
            {["这个产品有哪些检测记录？", "如何保存？", "这个批次还有哪些资料？", "哪些内容需要复核？"].map((prompt) => <button key={prompt} type="button" onClick={() => void askAgent(prompt)} disabled={agentBusy}>{prompt}</button>)}
            <form onSubmit={(event) => { event.preventDefault(); void askAgent(agentInput); }}><input value={agentInput} onChange={(event) => setAgentInput(event.target.value)} placeholder="请输入您的问题…" aria-label="商品客服 Agent 问题" disabled={agentBusy} /><button type="submit" disabled={agentBusy}>{agentBusy ? "⏳　回答中" : "➤　发送"}</button></form>
            {(agentReply || agentBusy) && <div className="merchant-agent-response" aria-live="polite"><div>{agentBusy && !agentReply ? "正在读取批次证据和生产资料…" : agentReply}</div>{agentMeta && <small>来源：{agentMeta.contextMode ?? "证据卡"} · {agentMeta.dataMode ?? "demo/synthetic"} · 上下文 v{agentMeta.contextRevision ?? "—"} · 确定性验证结论优先</small>}</div>}
          </div>
        </section>
      )}
    </main>
  );
}
