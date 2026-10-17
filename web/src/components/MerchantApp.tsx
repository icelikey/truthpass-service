import { useEffect, useMemo, useState } from "react";
import { fetchAgentStatus, fetchLifecycle, postChat, postIotSimulation, requestAgentReport, simulateLifecycleStage, type IotSimulationMode } from "../api";
import { useWallet } from "./WalletContext";
import { exportMerchantAudit, importDemoEvidence, loadMerchantSummary, reconcileMerchantBatch, validateMerchantBatch } from "../merchant/merchantApi";
import type { AuditExport, EvidenceIssue, MerchantBatchSummary, MerchantSummary, ReconciliationResult } from "../merchant/types";
import type { ChatEvent, LifecycleView } from "../types";

type MerchantTab = "overview" | "import" | "review" | "preview" | "audit";

const statusLabel: Record<MerchantBatchSummary["status"] | EvidenceIssue["status"], string> = {
  accepted_with_scope: "证据门禁通过",
  passed: "已通过",
  review: "待复核",
  missing: "缺失",
  rejected: "已拒绝",
  revoked: "已撤销",
};

function StatusPill({ status }: { status: keyof typeof statusLabel }) {
  return <span className={`merchant-status-pill ${status}`}>{statusLabel[status]}</span>;
}

export function MerchantApp() {
  const { setWalletModalOpen, address, chainId } = useWallet();
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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadMerchantSummary()
      .then(async (next) => {
        setSummary(next);
        setSelectedBatch(next.batches[0] ?? null);
        const [status, nextLifecycle] = await Promise.all([
          fetchAgentStatus().catch(() => null),
          fetchLifecycle(next.batches[0]?.batchId ?? "FO-2026-001").catch(() => null),
        ]);
        setAgentStatus(status);
        setLifecycle(nextLifecycle);
      })
      .finally(() => setLoading(false));
  }, []);

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
    const next = await validateMerchantBatch(summary?.tenantId ?? "demo-tenant", batch.batchId);
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
      setReconciliation(await reconcileMerchantBatch(summary?.tenantId ?? "demo-tenant", selectedBatch?.batchId ?? "FO-2026-001"));
      setMessage("已完成生产、检测、冷链和出货对账；冲突项不会自动改写批次状态。");
    } catch {
      setMessage("对账暂时无法完成，请先确认企业 API 凭证和批次资料。");
    }
  };

  const refreshLifecycle = async (batchId = selectedBatch?.batchId ?? "FO-2026-001") => {
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
      setLifecycle(await simulateLifecycleStage(selectedBatch?.batchId ?? "FO-2026-001", stage));
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
      setAgentReport(await requestAgentReport(selectedBatch?.batchId ?? "FO-2026-001"));
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
      setSensorDemo(await postIotSimulation(selectedBatch?.batchId ?? "FO-2026-001", mode));
      await refreshLifecycle(selectedBatch?.batchId ?? "FO-2026-001");
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
      void refreshLifecycle(detail?.batchId ?? selectedBatch?.batchId ?? "FO-2026-001");
    };
    window.addEventListener("truthpass:lifecycle-updated", handleLifecycleUpdate);
    return () => window.removeEventListener("truthpass:lifecycle-updated", handleLifecycleUpdate);
  }, [selectedBatch?.batchId]);

  const askAgent = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || agentBusy) return;
    const batchId = selectedBatch?.batchId ?? "FO-2026-001";
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

  const importEvidence = async (kind: EvidenceIssue["kind"]) => {
    const result = await importDemoEvidence(
      summary?.tenantId ?? "demo-tenant",
      selectedBatch?.batchId ?? "FO-2026-001",
      kind,
    );
    setMessage(result.message);
    setTab("review");
  };

  const loadAudit = async () => {
    setAudit(await exportMerchantAudit(summary?.tenantId ?? "demo-tenant"));
    setTab("audit");
  };

  if (loading || !summary) {
    return (
      <main className="merchant-shell merchant-dashboard-shell">
        <div className="merchant-loading">正在加载企业证据工作台…</div>
      </main>
    );
  }

  const demo = summary.source === "demo/synthetic";
  const previewBatch = selectedBatch ?? summary.batches[0];
  const overviewRows = [
    { batchId: "FO-2026-001", productName: "海蓝营养 · 深海鱼油软胶囊", completeness: 100, status: "accepted_with_scope" as const, issuers: 3 },
    { batchId: "FO-2026-002", productName: "海蓝营养 · 高纯度 Omega-3", completeness: 78, status: "review" as const, issuers: 4 },
    { batchId: "FO-2026-003", productName: "海蓝营养 · 鳕鱼肝油", completeness: 100, status: "accepted_with_scope" as const, issuers: 3 },
    { batchId: "FO-2026-004", productName: "海蓝营养 · 三文鱼丁", completeness: 65, status: "review" as const, issuers: 2 },
    { batchId: "FO-2026-005", productName: "海蓝营养 · 海苔脆片", completeness: 88, status: "accepted_with_scope" as const, issuers: 4 },
  ];
  const kpis = demo
    ? [
        ["批次证据", "24", "个批次", "cube"],
        ["证据完整度", "92%", "整体平均", "ring"],
        ["待复核", "3", "个批次", "alert"],
        ["来源机构", "6", "家合作机构", "institution"],
      ]
    : [
        ["批次证据", String(summary.batchCount), "个批次", "cube"],
        ["证据完整度", `${Math.round((summary.batches.reduce((total, batch) => total + batch.completeness, 0) / Math.max(summary.batches.length, 1)))}%`, "整体平均", "ring"],
        ["待复核", String(summary.reviewCount), "个批次", "alert"],
        ["来源机构", "—", "待接入机构目录", "institution"],
      ];

  return (
    <main className="merchant-shell merchant-dashboard-shell">
      <div className="merchant-app-frame">
        <aside className="merchant-sidebar" aria-label="商家工作台导航">
          <a href="/" className="merchant-sidebar-brand">
            <img src="/assets/brand-mark.png" alt="TruthPass" />
            <span>TruthPass<small>白牌商品证据基础设施</small></span>
          </a>
          <nav>
            {[
              ["overview", "⌂", "工作台"],
              ["import", "◇", "批次管理"],
              ["review", "▣", "证据中心"],
              ["preview", "♧", "机构与合作"],
              ["audit", "▥", "数据报表"],
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
            <strong>让每一份食品<br />都有可验证的证据</strong>
            <span>{demo ? "DEMO / SYNTHETIC" : "EXTERNAL"}</span>
            <small>仅用于产品演示</small>
          </div>
        </aside>

        <section className="merchant-app-main">
          <header className="merchant-topbar merchant-global-topbar">
            <a href="/" className="merchant-brand">
              <img src="/assets/brand-mark.png" alt="TruthPass" />
              <span>TruthPass <small>企业证据工作台</small></span>
            </a>
            <nav className="merchant-global-nav" aria-label="平台导航">
              <a className="active" href="/merchant">企业工作台</a>
              <a href="/">消费者视角</a>
              <a href="#help">帮助中心</a>
            </nav>
            <div className="merchant-top-actions">
              <span className="merchant-notification" aria-label="有待处理提醒">♧<i /></span>
              <span className="merchant-demo-pill">{demo ? "DEMO / SYNTHETIC" : "EXTERNAL"}</span>
              <button type="button" className="merchant-wallet-button" onClick={() => setWalletModalOpen(true)}>{address && chainId === 677 ? "机构钱包 · Chain 677" : "打开机构钱包"}</button>
              <span className="merchant-account">{summary.brandName}（企业版）⌄</span>
            </div>
          </header>

          <section className="merchant-heading merchant-dashboard-heading">
            <div>
              <span className="eyebrow">企业证据工作台</span>
              <h1>企业工作台</h1>
              <p>管理白牌商品的全链路证据，建立消费者信任</p>
            </div>
            <div className="merchant-heading-controls">
              <button type="button" className="merchant-select-control">{summary.brandName}（示例企业）⌄</button>
              <span className="merchant-date-control">2024-11-01 → 2026-02-28　▣</span>
            </div>
          </section>

          <nav className="merchant-tabs merchant-secondary-tabs" aria-label="企业工作台功能">
            {([["overview", "总览"], ["import", "批次导入"], ["review", "待复核"], ["preview", "公开预览"], ["audit", "审计导出"]] as const).map(([id, label]) => (
              <button key={id} type="button" className={tab === id ? "active" : ""} onClick={() => id === "audit" ? void loadAudit() : setTab(id)}>
                {label}{id === "review" && summary.reviewCount > 0 && <em>{summary.reviewCount}</em>}
              </button>
            ))}
          </nav>

          {message && (
            <div className="merchant-notice" role="status">
              {message}
              <button type="button" onClick={() => setMessage("")} aria-label="关闭提示">×</button>
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

              <section className="merchant-section merchant-lifecycle-section" aria-label="批次全生命周期">
                <div className="merchant-section-head merchant-lifecycle-head">
                  <div><span className="eyebrow">批次全流程</span><h2>全生命周期资料</h2><p>生产方、检测机构、物流、消费者和监管角色共享同一批次信息。</p></div>
                  <div className="merchant-lifecycle-actions">
                    <span className="merchant-sync-meta">{lifecycle ? `${lifecycle.contextMode} · v${lifecycle.contextRevision}` : "正在读取同步上下文"}</span>
                    <button type="button" className="merchant-secondary" onClick={() => void generateAgentReport()} disabled={lifecycleBusy}>生成 Agent 汇报</button>
                    <button type="button" className="merchant-secondary" onClick={() => void refreshLifecycle()} disabled={lifecycleBusy}>↻ 刷新同步</button>
                  </div>
                </div>
                {lifecycle ? (
                  <>
                    <div className="merchant-lifecycle-meta"><span>资料来源：{lifecycle.contextSource}</span><span>最后同步：{new Date(lifecycle.syncedAt).toLocaleString("zh-CN")}</span><span>数据模式：{lifecycle.dataMode}</span></div>
                    <div className="merchant-lifecycle-track">
                      {lifecycle.events.map((event, index) => (
                        <div className={`merchant-lifecycle-event ${event.status}`} key={event.stage}>
                          <div className="merchant-lifecycle-node">{event.status === "verified" ? "✓" : event.status === "awaiting_user" ? "⌁" : event.status === "synced" ? "●" : index + 1}</div>
                          <div className="merchant-lifecycle-copy"><strong>{event.label}</strong><span>{event.role}</span><small>{event.detail}</small><em>{event.status === "verified" ? "已确认" : event.status === "synced" ? "已同步" : event.status === "awaiting_user" ? "等待用户钱包" : "待处理"}</em></div>
                          {event.status !== "verified" && <button type="button" className="merchant-lifecycle-sync" onClick={() => void syncLifecycle(event.stage)} disabled={lifecycleBusy}>{event.stage === "purchase" ? "模拟购买" : event.stage === "regulatory_review" ? "模拟复核" : "同步变化"}</button>}
                        </div>
                      ))}
                    </div>
                    {agentReport && <div className="merchant-agent-report-card"><div className="merchant-agent-report-head"><div><span className="eyebrow">AGENT REPORT</span><strong>生产 / 检测 / 消费者协作汇报</strong></div><span className="merchant-report-status">{agentReport.writePlan?.status === "pending_wallet_signature" ? "待机构钱包签名" : "等待补证"}</span></div><p>{(agentReport.selectedFacts ?? []).slice(0, 3).join("；") || "Agent 没有选择可公开的事实。"}</p><div className="merchant-agent-report-meta"><span>验证：{agentReport.verification?.status ?? "unknown"}</span><span>上链事件：{agentReport.writePlan?.eventName ?? "—"}</span><span>角色：{agentReport.writePlan?.requiredRole ?? "—"}</span><span>上下文：v{agentReport.contextRevision ?? "—"}</span><span>审计：{agentReport.agentAudit ? "已记录" : "待读取"}</span></div><small>{agentReport.writePlan?.nextAction}</small><button type="button" className="merchant-primary" onClick={() => setWalletModalOpen(true)}>打开机构钱包 →</button></div>}
                  </>
                ) : <div className="merchant-empty">尚未读取生命周期上下文。</div>}
              </section>

              <section className="merchant-section merchant-sensor-section" aria-label="传感器数据回放">
                <div className="merchant-section-head"><div><span className="eyebrow">服务器回放</span><h2>传感器资料怎么进入证据卡</h2><p>用一条模拟温控数据，完整展示“设备发送 → 服务端校验 → 批次更新”。</p></div><span className="merchant-demo-pill">DEMO / SYNTHETIC</span></div>
                <div className="merchant-sensor-actions"><button type="button" className="merchant-secondary" onClick={() => void runSensorDemo("normal")} disabled={lifecycleBusy}>模拟正常温控</button><button type="button" className="merchant-secondary" onClick={() => void runSensorDemo("cold_chain_gap")} disabled={lifecycleBusy}>模拟冷链异常</button><button type="button" className="merchant-secondary" onClick={() => void runSensorDemo("device_offline")} disabled={lifecycleBusy}>模拟设备离线</button></div>
                {sensorDemo && <div className="merchant-sensor-result"><div className="merchant-sensor-steps">{(sensorDemo.pipeline ?? ["设备发送", "服务端接收", "批次关联", "确定性校验"]).map((step, index, all) => <span key={step} className={index === all.length - 1 ? "done" : ""}><b>{index + 1}</b>{step}{index < all.length - 1 && <i>→</i>}</span>)}</div><div className="merchant-sensor-result-copy"><strong>{sensorMode === "normal" ? "温控正常" : sensorMode === "cold_chain_gap" ? "冷链异常" : "设备离线"} · {sensorDemo.verification?.status === "accepted" ? "校验通过" : "进入复核"}</strong><p>{sensorDemo.message}</p><small>{sensorDemo.evidenceId} · payloadHash {sensorDemo.payloadHash}</small></div></div>}
              </section>

              <section className="merchant-section merchant-batch-table-section">
                <div className="merchant-section-head">
                  <div><span className="eyebrow">批次总览</span><h2>批次列表</h2></div>
                  <div className="merchant-table-actions">
                    <button type="button" className="merchant-primary" onClick={() => setTab("import")}>⇧　导入证据</button>
                    <button type="button" className="merchant-more-button" aria-label="更多批次操作">···</button>
                  </div>
                </div>
                <div className="merchant-searchbar">⌕　搜索批次号、商品名称或状态…</div>
                <div className="merchant-batch-table" role="table" aria-label="批次列表">
                  <div className="merchant-batch-table-row merchant-batch-table-head" role="row">
                    <span>批次号</span><span>商品名称</span><span>证据完整度</span><span>证据状态</span><span>来源机构</span><span>操作</span>
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
                      <StatusPill status={row.status} />
                      <span>{row.issuers} 家机构</span>
                      <span className="merchant-table-open">查看证据卡　→</span>
                    </button>
                  ))}
                </div>
                <div className="merchant-table-footer"><span>共 {demo ? 24 : summary.batchCount} 条记录</span><span>‹　 <b>1</b>　2　3　4　5　›</span></div>
              </section>
            </>
          )}

          {tab === "import" && (
            <section className="merchant-section merchant-import-layout">
              <div className="merchant-import-card">
                <span className="eyebrow">资料导入</span><h2>导入批次资料</h2>
                <p>首期支持 CSV、Excel 映射和 API 接入。当前浏览器演示使用明确的 Demo fixture，不保存企业 Token。</p>
                <div className="merchant-dropzone"><span>⇧</span><strong>拖入文件或选择数据源</strong><small>CSV / XLSX / JSON · 原始报告保留在链下</small><button type="button" className="merchant-secondary" onClick={() => setMessage("文件导入界面已准备，等待企业数据映射。")}>选择文件</button></div>
                <div className="merchant-import-actions">{([["production", "生产记录"], ["inspection", "检测报告"], ["cold_chain", "冷链记录"], ["shipment", "出货记录"]] as const).map(([kind, label]) => <button type="button" key={kind} onClick={() => void importEvidence(kind)}>导入 Demo · {label}</button>)}</div>
              </div>
              <div className="merchant-mapping-card"><span className="eyebrow">资料对应</span><h3>首期必需信息</h3>{["企业和品牌", "商品和批次", "样品和资料编号", "资料提供方", "发生时间和更新时间"].map((field) => <div className="merchant-field-row" key={field}><span>{field}</span><b>待对应</b></div>)}<small>真实企业接入需要先固定批次号和样品号，避免检测报告放错批次。</small></div>
            </section>
          )}

          {tab === "review" && (
            <section className="merchant-section">
              <div className="merchant-section-head"><div><span className="eyebrow">待处理问题</span><h2>资料审核列表</h2></div><span className="merchant-count">{reviewItems.length} 个待处理项</span></div>
              <div className="merchant-review-layout"><div className="merchant-review-list">{reviewItems.map((issue) => <button className={selectedIssue?.id === issue.id ? "merchant-review-item active" : "merchant-review-item"} key={issue.id} type="button" onClick={() => setSelectedIssue(issue)}><div><strong>{issue.title}</strong><span>{issue.batchId} · {issue.issuer}</span></div><StatusPill status={issue.status} /></button>)}</div><div className="merchant-review-detail">{selectedIssue ? <><div className="merchant-detail-head"><div><span className="eyebrow">EVIDENCE DETAIL</span><h3>{selectedIssue.title}</h3><p>{selectedIssue.batchId} · {selectedIssue.issuer}</p></div><StatusPill status={selectedIssue.status} /></div><dl><div><dt>签名状态</dt><dd>{selectedIssue.signature}</dd></div><div><dt>证据哈希</dt><dd className="mono">{selectedIssue.hash}</dd></div><div><dt>当前事实</dt><dd>{selectedIssue.detail}</dd></div><div><dt>下一步</dt><dd>{selectedIssue.nextAction}</dd></div></dl><div className="merchant-review-actions"><button className="merchant-primary" type="button" onClick={() => setMessage("已生成复核任务；真实生产环境将进入机构签名和人工审核流程。")}>创建复核任务</button><button className="merchant-secondary" type="button" onClick={() => void runReconciliation()}>运行批次对账</button><button className="merchant-secondary" type="button" onClick={() => setWalletModalOpen(true)}>打开机构钱包</button></div>{reconciliation && <div className={`merchant-reconciliation-result ${reconciliation.status}`} role="status"><strong>对账结果：{reconciliation.status}</strong><small>{reconciliation.reasons.length ? reconciliation.reasons.join("；") : "没有发现当前规则覆盖范围内的冲突。"}</small></div>}</> : <div className="merchant-empty">选择一个证据问题查看详情。</div>}</div></div>
            </section>
          )}

          {tab === "preview" && (
            <section className="merchant-section">
              <div className="merchant-section-head"><div><span className="eyebrow">消费者看到的页面</span><h2>公开资料卡</h2></div><span className="merchant-demo-pill">不会暴露内部报告</span></div>
              {previewBatch && <div className="merchant-public-card"><div className="merchant-public-card-head"><div><span>海蓝营养</span><h3>{previewBatch.productName}</h3><p>{previewBatch.batchId} · {previewBatch.policy}</p></div><StatusPill status={previewBatch.status} /></div><div className="merchant-public-grid">{previewBatch.issues.map((issue) => <div key={issue.id} className="merchant-public-item"><span>{issue.status === "passed" ? "✓" : issue.status === "revoked" ? "!" : "○"}</span><div><strong>{issue.title}</strong><small>{issue.issuer} · {issue.signature}</small></div></div>)}</div><div className="merchant-public-note">当前公开模式：{previewBatch.source}。证据状态来自确定性验证，Agent 只负责解释。</div></div>}
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
              <div className="merchant-product-preview-top"><img src="/assets/fish-oil-product.png" alt="海蓝营养鱼油商品" /><div><h3>海蓝营养</h3><strong>深海鱼油软胶囊</strong><small>即时鱼肉块（白牌商品）</small></div></div>
              <div className="merchant-product-preview-meta"><span>批次　<b>{previewBatch.batchId}</b></span><small>生产日期　2026-01-10　建议食用期至 2027-01-09</small></div>
              <div className="merchant-product-status-grid"><div><b>✓　通过</b><span>本批次已完成主要证据核验</span></div><div><b>◯　100%</b><span>证据完整度</span></div></div>
            </div>
            <div className="merchant-consumer-evidence-list">
              {[
                ["⚗", "检测证据", "微生物、重金属、营养成分等检测报告", "3 份"],
                ["❄", "冷链记录", "从产地到仓储的温控记录", "完整"],
                ["♜", "来源机构", "检测机构、冷链物流、原料供应商等", "3 家"],
              ].map(([icon, title, detail, value]) => <div key={title}><span>{icon}</span><div><strong>{title}</strong><small>{detail}</small></div><b>{value}　›</b></div>)}
            </div>
            <div className="merchant-consumer-issue"><span>!</span><div><strong>不确定项</strong><small>本批次的部分原料产地证明待补充</small></div><b>1 项　›</b></div>
            <div className="merchant-consumer-next"><span>▶</span><div><strong>下一步动作</strong><small>补充原料产地文件并提交复核</small></div><button type="button" onClick={() => setTab("review")}>查看详情</button></div>
          </aside>
        )}
      </div>

      {tab === "overview" && (
        <section className="merchant-agent-bar" aria-label="商品客服 Agent 演示">
          <div className="merchant-agent-avatar">◉</div>
          <div className="merchant-agent-intro"><strong>商品客服 Agent <span className={agentStatus?.agentMode === "model_assisted" ? "agent-live" : "agent-fallback"}>{agentStatus?.agentMode === "model_assisted" ? "● 在线 · 模型" : agentStatus?.status === "ready" ? "● 在线 · 兜底" : "○ 待连接"}</span></strong><small>基于批次证据卡和生产资料同步上下文回答，不自行生成质量结论</small>{agentStatus?.model && <small className="merchant-agent-model">模型：{agentStatus.model}</small>}</div>
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
