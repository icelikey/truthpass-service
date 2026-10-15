import { useEffect, useMemo, useState } from "react";
import { exportMerchantAudit, importDemoEvidence, loadMerchantSummary, validateMerchantBatch } from "../merchant/merchantApi";
import type { AuditExport, EvidenceIssue, MerchantBatchSummary, MerchantSummary } from "../merchant/types";

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
  return <span className={`merchant-status status-${status}`}>{statusLabel[status]}</span>;
}

export function MerchantApp() {
  const [tab, setTab] = useState<MerchantTab>("overview");
  const [summary, setSummary] = useState<MerchantSummary | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<MerchantBatchSummary | null>(null);
  const [selectedIssue, setSelectedIssue] = useState<EvidenceIssue | null>(null);
  const [audit, setAudit] = useState<AuditExport | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadMerchantSummary().then((next) => { setSummary(next); setSelectedBatch(next.batches[0] ?? null); }).finally(() => setLoading(false)); }, []);

  const reviewItems = useMemo(() => summary?.batches.flatMap((batch) => batch.issues.filter((issue) => issue.status !== "passed").map((issue) => ({ ...issue, productName: batch.productName }))) ?? [], [summary]);

  const selectBatch = async (batch: MerchantBatchSummary) => {
    setSelectedBatch(batch);
    const next = await validateMerchantBatch(summary?.tenantId ?? "demo-tenant", batch.batchId);
    setSummary((current) => current ? { ...current, batches: current.batches.map((item) => item.batchId === batch.batchId ? next : item) } : current);
    setSelectedBatch(next);
  };

  const importEvidence = async (kind: EvidenceIssue["kind"]) => {
    const result = await importDemoEvidence(summary?.tenantId ?? "demo-tenant", selectedBatch?.batchId ?? "FO-2026-001", kind);
    setMessage(result.message);
    setTab("review");
  };

  const loadAudit = async () => { setAudit(await exportMerchantAudit(summary?.tenantId ?? "demo-tenant")); setTab("audit"); };

  if (loading || !summary) return <main className="merchant-shell"><div className="merchant-loading">正在加载企业证据工作台…</div></main>;

  return (
    <main className="merchant-shell">
      <header className="merchant-topbar">
        <a href="/" className="merchant-brand"><img src="/assets/brand-mark.png" alt="TruthPass" /><span>TruthPass <small>企业证据工作台</small></span></a>
        <div className="merchant-top-actions"><span className="merchant-demo-pill">{summary.source === "demo/synthetic" ? "DEMO / SYNTHETIC" : "EXTERNAL"}</span><a href="/">返回消费者端</a></div>
      </header>
      <section className="merchant-heading"><div><span className="eyebrow">MERCHANT EVIDENCE CONSOLE</span><h1>{summary.brandName}</h1><p>管理商品政策、批次证据、复核队列和公开证据卡。</p></div><button type="button" className="merchant-primary" onClick={() => setTab("import")}>＋ 导入证据</button></section>
      <nav className="merchant-tabs" aria-label="企业工作台导航">{([["overview", "总览"], ["import", "批次导入"], ["review", "待复核"], ["preview", "公开预览"], ["audit", "审计导出"]] as const).map(([id, label]) => <button key={id} type="button" className={tab === id ? "active" : ""} onClick={() => id === "audit" ? void loadAudit() : setTab(id)}>{label}{id === "review" && summary.reviewCount > 0 && <em>{summary.reviewCount}</em>}</button>)}</nav>
      {message && <div className="merchant-notice" role="status">{message}<button type="button" onClick={() => setMessage("")} aria-label="关闭提示">×</button></div>}

      {tab === "overview" && <>
        <section className="merchant-kpis">{[["商品", summary.productCount], ["批次", summary.batchCount], ["待复核", summary.reviewCount], ["消费者反馈", summary.feedbackCount]].map(([label, value]) => <div className="merchant-kpi" key={label as string}><span>{label}</span><strong>{value}</strong><small>{label === "待复核" ? "需要团队处理" : "当前租户"}</small></div>)}</section>
        <section className="merchant-section"><div className="merchant-section-head"><div><span className="eyebrow">BATCH OVERVIEW</span><h2>批次证据状态</h2></div><button type="button" onClick={() => setTab("review")} className="merchant-link">查看所有问题 →</button></div><div className="merchant-batch-grid">{summary.batches.map((batch) => <button className="merchant-batch-card" type="button" key={batch.batchId} onClick={() => void selectBatch(batch)}><div className="merchant-batch-card-top"><span>{batch.batchId}</span><StatusPill status={batch.status} /></div><h3>{batch.productName}</h3><p>{batch.policy}</p><div className="merchant-progress"><span style={{ width: `${batch.completeness}%` }} /></div><small>{batch.completeness}% 证据完整度 · {batch.issues.filter((item) => item.status !== "passed").length} 个待处理项</small></button>)}</div></section>
      </>}

      {tab === "import" && <section className="merchant-section merchant-import-layout"><div className="merchant-import-card"><span className="eyebrow">EVIDENCE INTAKE</span><h2>导入批次证据</h2><p>首期支持 CSV、Excel 映射和 API 接入。当前浏览器演示使用明确的 Demo fixture，不保存企业 Token。</p><div className="merchant-dropzone"><span>⇧</span><strong>拖入文件或选择数据源</strong><small>CSV / XLSX / JSON · 原始报告保留在链下</small><button type="button" className="merchant-secondary" onClick={() => setMessage("文件导入界面已准备，等待企业数据映射。")}>选择文件</button></div><div className="merchant-import-actions">{([["production", "生产记录"], ["inspection", "检测报告"], ["cold_chain", "冷链记录"], ["shipment", "出货记录"]] as const).map(([kind, label]) => <button type="button" key={kind} onClick={() => void importEvidence(kind)}>导入 Demo · {label}</button>)}</div></div><div className="merchant-mapping-card"><span className="eyebrow">FIELD MAPPING</span><h3>首期必需字段</h3>{["tenantId / brandId", "productId / batchId", "sampleId / evidenceId", "issuerId / keyId", "occurredAt / payloadHash"].map((field) => <div className="merchant-field-row" key={field}><span>{field}</span><b>待映射</b></div>)}<small>真实企业接入需要先固定批次号和样品号，避免检测报告错配。</small></div></section>}

      {tab === "review" && <section className="merchant-section"><div className="merchant-section-head"><div><span className="eyebrow">REVIEW QUEUE</span><h2>证据审核队列</h2></div><span className="merchant-count">{reviewItems.length} 个待处理项</span></div><div className="merchant-review-layout"><div className="merchant-review-list">{reviewItems.map((issue) => <button className={selectedIssue?.id === issue.id ? "merchant-review-item active" : "merchant-review-item"} key={issue.id} type="button" onClick={() => setSelectedIssue(issue)}><div><strong>{issue.title}</strong><span>{issue.batchId} · {issue.issuer}</span></div><StatusPill status={issue.status} /></button>)}</div><div className="merchant-review-detail">{selectedIssue ? <><div className="merchant-detail-head"><div><span className="eyebrow">EVIDENCE DETAIL</span><h3>{selectedIssue.title}</h3><p>{selectedIssue.batchId} · {selectedIssue.issuer}</p></div><StatusPill status={selectedIssue.status} /></div><dl><div><dt>签名状态</dt><dd>{selectedIssue.signature}</dd></div><div><dt>证据哈希</dt><dd className="mono">{selectedIssue.hash}</dd></div><div><dt>当前事实</dt><dd>{selectedIssue.detail}</dd></div><div><dt>下一步</dt><dd>{selectedIssue.nextAction}</dd></div></dl><button className="merchant-primary" type="button" onClick={() => setMessage("已生成复核任务；真实生产环境将进入机构签名和人工审核流程。")}>创建复核任务</button></> : <div className="merchant-empty">选择一个证据问题查看详情。</div>}</div></div></section>}

      {tab === "preview" && <section className="merchant-section"><div className="merchant-section-head"><div><span className="eyebrow">PUBLIC PREVIEW</span><h2>消费者公开证据卡</h2></div><span className="merchant-demo-pill">不会暴露原始报告</span></div>{selectedBatch && <div className="merchant-public-card"><div className="merchant-public-card-head"><div><span>海蓝营养</span><h3>{selectedBatch.productName}</h3><p>{selectedBatch.batchId} · {selectedBatch.policy}</p></div><StatusPill status={selectedBatch.status} /></div><div className="merchant-public-grid">{selectedBatch.issues.map((issue) => <div key={issue.id} className="merchant-public-item"><span>{issue.status === "passed" ? "✓" : issue.status === "revoked" ? "!" : "○"}</span><div><strong>{issue.title}</strong><small>{issue.issuer} · {issue.signature}</small></div></div>)}</div><div className="merchant-public-note">当前公开模式：{selectedBatch.source}。证据状态来自确定性验证，Agent 只负责解释。</div></div>}</section>}

      {tab === "audit" && <section className="merchant-section"><div className="merchant-section-head"><div><span className="eyebrow">AUDIT EXPORT</span><h2>审计记录导出</h2></div><button type="button" className="merchant-primary" onClick={() => { if (!audit) return; const blob = new Blob([JSON.stringify(audit, null, 2)], { type: "application/json" }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `${audit.tenantId}-audit-export.json`; a.click(); URL.revokeObjectURL(url); }}>下载 JSON</button></div>{audit ? <div className="merchant-audit-card"><div><strong>{audit.evidence.length}</strong><span>证据摘要</span></div><div><strong>{audit.events.length}</strong><span>审计事件</span></div><p>导出只包含 evidenceId、批次、类型、哈希、状态和 rawObjectRef，不包含原始 payload、地址和健康数据。</p>{audit.events.map((event) => <div className="merchant-audit-event" key={event.eventId}><span>{event.eventType}</span><small>{event.createdAt} · {event.requestId}</small></div>)}</div> : <div className="merchant-empty">正在加载审计导出…</div>}</section>}
    </main>
  );
}
