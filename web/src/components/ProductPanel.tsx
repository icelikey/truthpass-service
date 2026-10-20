import { useEffect, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchMetricDetail, fetchProduct, fetchVerification } from "../api";
import { ICON_URLS, METRIC_BAR_PCT } from "../data";
import { useCountUp } from "../hooks/useCountUp";
import type { KeyMetric, MetricSource, ProductBatch, ProductionPublicSummary, VerifyState } from "../types";
import { useModal } from "./ModalContext";

function parseMetricValue(value: string): { num: number | null; suffix: string; decimals: number } {
  const m = value.match(/^([\d.]+)(.*)$/);
  if (!m) return { num: null, suffix: value, decimals: 0 };
  const decimals = m[1].match(/\.(\d+)/)?.[1]?.length ?? 0;
  return { num: parseFloat(m[1]), suffix: m[2], decimals };
}

function AnimatedValue({ value }: { value: string }) {
  const { num, suffix, decimals } = parseMetricValue(value);
  const animated = useCountUp(num ?? 0, 1500);
  if (num === null) return <>{value}</>;
  return (
    <>
      {animated.toFixed(decimals)}
      {suffix}
    </>
  );
}

function MetricSources({ sources, en = false }: { sources: MetricSource[]; en?: boolean }) {
  return (
    <>
      {sources.map((s, i) => (
        <div className="source-item" key={i}>
          <b>{s.name}</b> · {s.method}
          <br />
          {en ? "Report: " : "报告编号："}{s.reportNo}
          <br />
          PDF：{s.pdf}
          <br />
          {en ? "Tested: " : "检测时间："}{s.time}
          <br />
          {en ? "Signature: " : "签名："}<span className="journey-hash">{s.signature}</span>
        </div>
      ))}
    </>
  );
}

function MetricDetailModal({ batchId, metricKey, label, value, en = false }: { batchId: string; metricKey: string; label: string; value: string; en?: boolean }) {
  const { data, isLoading } = useQuery({
    queryKey: ["metric", batchId, metricKey],
    queryFn: () => fetchMetricDetail(batchId, metricKey),
  });
  return (
    <div>
      <p style={{ marginTop: 0 }}>
        {en ? "Value: " : "数值："}<b style={{ color: "var(--cyan-2)" }}>{data?.value ?? value}</b>
        {data && (
          <>
            {" "}· {en ? "Threshold: " : "门槛："}<b style={{ color: "var(--ok)" }}>{data.threshold}</b>
          </>
        )}
      </p>
      {data?.heavyMetals && (
        <>
          <h4 style={{ margin: "18px 0 6px" }}>{en ? "Heavy metal checks" : "重金属检测项"}</h4>
          {data.heavyMetals.map((m) => (
            <div className="hm-row" key={m.name}>
              <span className={m.passed ? "mark" : "mark fail"}>{m.passed ? "✓" : "✗"}</span>
              <span className="hm-name">{m.name}</span>
              <span className="hm-value">{m.value} mg/kg</span>
              <span className="hm-limit">（≤ {m.limit} mg/kg）</span>
            </div>
          ))}
        </>
      )}
      <h4 style={{ margin: "18px 0 4px" }}>{en ? "Sources" : "来源"}</h4>
      {isLoading && <p style={{ color: "var(--muted)" }}>{en ? "Loading…" : "加载中…"}</p>}
      {data && <MetricSources sources={data.sources} en={en} />}
      <p style={{ color: "var(--muted)", marginBottom: 0 }}>
        {en ? "Unit: " : "单位："}{data?.unit ?? label}
      </p>
    </div>
  );
}

function MetricCard({ metric, batchId, en = false }: { metric: KeyMetric; batchId: string; en?: boolean }) {
  const { openModal } = useModal();
  const pct = metric.bar ?? 0;
  const warn = metric.key === "peroxide";
  const missing = metric.status === "missing";
  const failed = metric.status === "fail";
  const wide = metric.key === "heavy-metal";
  const [barPct, setBarPct] = useState(0);

  useEffect(() => {
    const t = window.setTimeout(() => setBarPct(pct), 120);
    return () => window.clearTimeout(t);
  }, [pct]);

  let cardClass = "metric-card";
  if (missing) cardClass += " missing";
  if (failed) cardClass += " fail";
  if (wide) cardClass += " wide";

  return (
    <div className={cardClass}>
      <button
        className="metric-q"
        title={en ? "View sources" : "查看来源"}
        onClick={() =>
          missing
            ? openModal(
                `${metric.label}`,
                <div>
                  <p style={{ marginTop: 0, color: "var(--warn)" }}>{en ? "This check is not covered yet." : "该检测项尚未覆盖。"}</p>
                  <p style={{ color: "var(--muted)" }}>
                    {en ? "An independent testing service can add a report; it will join the evidence chain after deterministic review." : "可继续调用独立检测服务补充报告，结果通过确定性验收后再加入证据链。"}
                  </p>
                </div>,
              )
            : openModal(`${metric.label} ${metric.value}`, <MetricDetailModal batchId={batchId} metricKey={metric.key} label={metric.label} value={metric.value} en={en} />)
        }
      >
        ?
      </button>
      <div className="metric-icon" aria-hidden="true">
        <img src={ICON_URLS[metric.icon]} alt="" />
      </div>
      <div className="metric-label">{metric.label}</div>
      <div className={missing ? "metric-value missing" : failed ? "metric-value fail" : warn ? "metric-value warn" : "metric-value"}>
        {failed && <span className="fail-flag">✗</span>}
        <AnimatedValue value={metric.value} />
      </div>
      <div className="metric-bar">
        <span className="metric-bar-fill" style={{ width: `${barPct}%` } as CSSProperties} />
      </div>
      <div className="metric-unit">{metric.unit}</div>
    </div>
  );
}

function RulesView({ batchId, en = false }: { batchId: string; en?: boolean }) {
  const { data, isLoading } = useQuery({ queryKey: ["verification", batchId], queryFn: () => fetchVerification(batchId) });
  if (isLoading) return <p style={{ color: "var(--muted)" }}>{en ? "Loading…" : "加载中…"}</p>;
  return (
    <>
      {(data?.rules ?? []).map((rule) => (
        <div className="rule-row" key={rule.name}>
          <span className={rule.passed ? "mark" : "mark fail"}>{rule.passed ? "✓" : "✗"}</span>
          <span className="rule-name">{rule.name}</span>
          <span className="rule-desc">{rule.desc}</span>
        </div>
      ))}
      <p className={data?.status === "accepted" ? "rule-verdict" : "rule-verdict fail"}>
        {en ? "Overall: " : "综合："}{data?.status === "accepted" ? (en ? "Accepted under current rules" : "按当前规则通过") : (en ? "Not accepted" : "未通过")} ({en ? "score" : "得分"} {data?.score}/100) · {en ? "evidence hash" : "证据哈希"} {data?.evidenceHash.slice(0, 16)}…
      </p>
    </>
  );
}

const SOURCE_LABELS: Record<string, string> = {
  manufacturer: "厂家自报",
  third_party: "第三方记录",
  platform_device: "平台设备",
  consumer: "消费者反馈",
};

const PROCESS_STATUS_LABELS: Record<ProductionPublicSummary["status"], string> = {
  conformant: "过程记录完整",
  nonconformant: "存在记录异常",
  incomplete: "过程记录未完整",
  review: "过程记录需复核",
};

function ProductionProcess({ process, en = false }: { process: ProductionPublicSummary; en?: boolean }) {
  const sourceLabels: Record<string, string> = en ? { manufacturer: "Manufacturer statement", third_party: "Third-party record", platform_device: "Platform device", consumer: "Consumer feedback" } : SOURCE_LABELS;
  const statusLabels: Record<ProductionPublicSummary["status"], string> = en ? { conformant: "Process record complete", nonconformant: "Record anomaly", incomplete: "Process record incomplete", review: "Process record needs review" } : PROCESS_STATUS_LABELS;
  return (
    <section className="production-process" aria-label={en ? "Production process" : "生产过程公开"}>
      <div className="production-process-head">
        <div><span className="eyebrow">{en ? "Production process" : "生产过程公开"}</span><strong>{statusLabels[process.status]}</strong></div>
        <span className="production-process-count">{en ? "Recorded " : "已记录 "}{process.observedStageCount}/{process.requiredStageCount} {en ? "stages" : "道工序"}</span>
      </div>
      <div className="production-facts">
        {process.originRegion && <div><span>{en ? "Origin region" : "原料来源"}</span><strong>{process.originRegion}</strong></div>}
        {process.facts.map((fact) => <div key={fact.label + fact.value}><span>{fact.label}</span><strong>{fact.value}</strong></div>)}
      </div>
      <div className="production-stages">
        {process.stages.map((stage) => <span key={stage.stage} className={"production-stage " + stage.status}>{stage.label} · {stage.status === "observed" ? (en ? "Recorded" : "已记录") : stage.status === "restricted" ? (en ? "Restricted" : "受限") : stage.status === "missing" ? (en ? "Missing" : "缺失") : (en ? "Not covered" : "未覆盖")}</span>)}
      </div>
      {process.missingStages.length > 0 && <p className="production-missing">{en ? "Not covered: " : "尚未覆盖："}{process.missingStages.join(en ? ", " : "、")}</p>}
      <p className="production-note">{en ? "Source types: " : "来源类别："}{process.sourceKinds.map((kind) => sourceLabels[kind] ?? kind).join(en ? ", " : "、")} · {process.dataMode}. {en ? "A process record does not equal a passing product test." : "过程记录不等同于成品检测合格。"}</p>
    </section>
  );
}


function BatchCompleteness({ product, en = false }: { product: ProductBatch; en?: boolean }) {
  const metrics = product.keyMetrics;
  const passed = metrics.filter((m) => m.status === "pass").length;
  const missing = metrics.filter((m) => m.status === "missing").length;
  const failed = metrics.filter((m) => m.status === "fail").length;
  const total = Math.max(metrics.length, 1);
  const pct = Math.round((passed / total) * 100);
  const process = product.productionProcess;
  const gaps: string[] = [];
  if (missing > 0) gaps.push(en ? `${missing} checks not covered` : `${missing} 项检测未覆盖`);
  if (failed > 0) gaps.push(en ? `${failed} checks failed` : `${failed} 项未通过`);
  if (process.missingStages.length > 0) gaps.push(en ? `Stage gap: ${process.missingStages.join(", ")}` : `工序缺口：${process.missingStages.join("、")}`);

  return (
    <>
      <div className="product-completeness" aria-label={en ? "Evidence completeness summary" : "证据完整度摘要"}>
        <div className="gauge" style={{ ["--pct" as string]: `${pct}%` }} aria-label={`${en ? "Evidence completeness" : "证据完整度"} ${pct}%`}>
          {pct}%
        </div>
        <div>
          <div className="evidence-summary-row">
            <span>{en ? "Evidence completeness (registered checks)" : "证据完整度（按已登记指标）"}</span>
            <strong>{passed}/{total} {en ? "passed" : "通过"}</strong>
          </div>
          <div className="completeness-list" style={{ marginTop: 8 }}>
            <span className="ok">{en ? "Checks passed" : "检测通过"} {passed}</span>
            {missing > 0 && <span className="partial">{en ? "Not covered" : "未覆盖"} {missing}</span>}
            {failed > 0 && <span className="partial">{en ? "Failed" : "未通过"} {failed}</span>}
            <span className={process.status === "conformant" ? "ok" : "partial"}>
              {en ? "Stages" : "工序"} {process.observedStageCount}/{process.requiredStageCount}
            </span>
          </div>
          {gaps.length > 0 && (
            <div className="evidence-gaps" aria-label={en ? "Evidence gaps" : "证据缺口"}>
              {gaps.map((g) => (
                <span className="gap-chip" key={g}>{g}</span>
              ))}
            </div>
          )}
        </div>
      </div>
      {(gaps.length > 0 || (product.dataMode ?? "demo/synthetic") === "demo/synthetic") && (
        <div className="uncertainty-note" role="note">
          <strong>{en ? "About uncertainty" : "关于不确定项"}</strong>
          {(product.dataMode ?? "demo/synthetic") === "demo/synthetic"
            ? (en ? "This is demo material and is not product certification." : "当前为演示资料，不能视为真实商品认证。")
            : (en ? "Some later stages or checks are still being completed." : "部分后期环节或检测项仍在补齐中。")}
          {gaps.length > 0 ? (en ? ` Known gaps: ${gaps.join("; ")}.` : ` 已知缺口：${gaps.join("；")}。`) : " "}
          {en ? "A gap is not a failing verdict; the product Agent explains the source and next step." : "缺口不等于已判定不合格；商品助手会告诉你资料来自哪里以及下一步怎么做。"}
        </div>
      )}
    </>
  );
}

export function ProductPanel({ state, batchId, locale = "zh" }: { state: VerifyState; batchId: string; locale?: "zh" | "en" }) {
  const en = locale === "en";
  const { data: product, isLoading, isError } = useQuery({
    queryKey: ["product", batchId],
    queryFn: () => fetchProduct(batchId),
    enabled: state === "done",
  });
  const { openModal } = useModal();
  const [tooltipVisible, setTooltipVisible] = useState(false);

  if (state === "idle") {
    return (
      <section id="product" className="panel product-panel">
        <div className="pending-state">
          <div className="pending-icon" aria-hidden="true">◷</div>
          <h3>{en ? "Waiting for a batch" : "等待批次"}</h3>
          <p>{en ? "Choose or enter a batch in the Agent to see its summary, completeness, sources, and uncertainty." : "在 Agent 中选择或输入批次号后，这里会展示批次摘要、证据完整度、来源与不确定项。"}</p>
        </div>
      </section>
    );
  }

  if (state === "running") {
    return (
      <section id="product" className="panel product-panel">
        <div className="pending-state">
          <div className="pending-icon pulse" aria-hidden="true">◷</div>
          <h3>{en ? "Gathering evidence" : "正在汇总证据"}</h3>
          <p>{en ? "Reading registered evidence, linked test sources, and deterministic checks…" : "正在读取登记证据、关联检测来源并执行确定性验收，请稍候…"}</p>
        </div>
        <div className="metrics" style={{ marginTop: 20 }}>
          {[0, 1, 2].map((i) => (
            <div className="metric-card" key={i}>
              <div className="skeleton" style={{ width: 36, height: 36, borderRadius: 10 }} />
              <div className="skeleton" style={{ width: "60%", height: 14, marginTop: 12 }} />
              <div className="skeleton" style={{ width: "40%", height: 28, marginTop: 8 }} />
            </div>
          ))}
        </div>
      </section>
    );
  }

  if (isLoading) {
    return (
      <section id="product" className="panel product-panel">
        <div className="product-top">
          <div className="skeleton" style={{ width: 260, height: 260, borderRadius: 16, flex: "none" }} />
          <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 12 }}>
            <div className="skeleton" style={{ width: "50%", height: 16 }} />
            <div className="skeleton" style={{ width: "72%", height: 26 }} />
            <div className="skeleton" style={{ width: "36%", height: 14 }} />
            <div className="skeleton" style={{ width: "82%", height: 14 }} />
            <div className="skeleton" style={{ width: "60%", height: 14 }} />
          </div>
        </div>
        <div className="metrics" style={{ marginTop: 20 }}>
          {[0, 1, 2].map((i) => (
            <div className="metric-card" key={i}>
              <div className="skeleton" style={{ width: 36, height: 36, borderRadius: 10 }} />
              <div className="skeleton" style={{ width: "60%", height: 14, marginTop: 12 }} />
              <div className="skeleton" style={{ width: "40%", height: 28, marginTop: 8 }} />
            </div>
          ))}
        </div>
      </section>
    );
  }
  if (isError || !product) {
    return (
      <section id="product" className="panel product-panel">
        <p style={{ color: "var(--warn)" }}>{en ? "Batch data could not be loaded. Check that the backend is running." : "批次数据加载失败，请确认后端服务已启动。"}</p>
      </section>
    );
  }

  return (
    <section id="product" className="panel product-panel">
      <div className="product-top">
        <div className="product-figure">
          <img src={product.imageUrl} alt={`${product.name} ${product.batchId}`} />
          <div className="packaging" aria-hidden="true">
            <span className="pk-brand">BATCH</span>
            <span className="pk-sub">EVIDENCE</span>
            <span className="pk-sub">DEMO</span>
          </div>
          <p className="figure-note" aria-hidden="true">
            {en ? "Demo batch" : "演示批次"}
            <br />
            {en ? "Not certification" : "非真实认证"}
          </p>
        </div>
        <div className="product-meta">
          <div className="product-kicker-row">
            <span className="product-kicker">{en ? "Batch summary" : "批次摘要"}</span>
            <span className={`mode-badge ${(product.dataMode ?? "demo/synthetic") === "external" ? "external" : ""}`}>
              {(product.dataMode ?? "demo/synthetic") === "external" ? (en ? "External data" : "真实资料") : (en ? "Demo data" : "演示资料")}
            </span>
            <span className={`status-pill ${product.verification.status === "accepted" ? "verified" : product.verification.status === "rejected" ? "rejected" : "review"}`}>
              {product.verification.status === "accepted" ? (en ? "Accepted under current rules" : "当前规则通过") : product.verification.status === "rejected" ? (en ? "Needs review" : "需要复核") : (en ? "Insufficient evidence" : "资料不足")}
            </span>
          </div>
          <h2 className="product-name">{product.name}</h2>
          <p className="product-batch batch-id-chip">
            {en ? "Batch " : "批次 "}<code>{product.batchId}</code>
          </p>
          <p className="product-source">
            {en ? "Data source: " : "数据来源："}{product.dataSource === "postgres" ? (en ? "registered business records" : "企业登记资料") : (en ? "demo records" : "演示资料")}
            · {en ? "Confirmed and missing items are shown separately" : "页面会区分已确认和仍需补充的内容"}
          </p>
          <p className="product-tags">
            {product.supplyChainTags.map((tag) => (
              <span key={tag}>{tag}</span>
            ))}
          </p>
          <ul className="product-facts">
            <li>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 21.5S5.5 16.4 5.5 10.7a6.5 6.5 0 1 1 13 0c0 5.7-6.5 10.8-6.5 10.8z" />
                <circle cx="12" cy="10.7" r="2.4" />
              </svg>
              <span>{product.origin}</span>
            </li>
            <li>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <rect x="3.2" y="5" width="17.6" height="15.5" rx="2.4" />
                <path d="M8 3v4.2M16 3v4.2M3.2 10.2h17.6" />
              </svg>
              <span>{product.productionDate} {en ? "Produced" : "生产"}</span>
            </li>
            <li>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="12" r="8.2" />
                <path d="M12 7.6v8.8M8.2 9.8l7.6 4.4M15.8 9.8l-7.6 4.4" />
                <path d="M12 7.6L10.6 9M12 7.6l1.4 1.4M12 16.4l-1.4-1.4M12 16.4l1.4-1.4" />
              </svg>
              <span>{en ? "Cold-chain shipping" : "全程冷链运输"}</span>
            </li>
          </ul>
        </div>
      </div>

      <div className="verdict-wrap">
        <button
          className={product.verification.status === "rejected" ? "verdict fail" : "verdict"}
          type="button"
          aria-label={en ? "View full acceptance rules and scoring" : "查看完整验收规则与得分说明"}
          onClick={() => openModal(en ? "Full acceptance rules (v1.0 · 9 checks)" : "完整验收规则（v1.0 · 9 项）", <RulesView batchId={batchId} en={en} />)}
          onMouseEnter={() => setTooltipVisible(true)}
          onMouseLeave={() => setTooltipVisible(false)}
        >
          <span className="verdict-icon">{product.verification.status === "rejected" ? "✗" : "✓"}</span>
          <span className="verdict-text">
            <strong>{product.verification.status === "rejected" ? (en ? "Acceptance failed" : "未通过验收") : (en ? "Accepted under current rules" : "按当前规则通过")}</strong>
            <small>{product.verification.summary}</small>
          </span>
          <span className="verdict-chevron">›</span>
        </button>
        {tooltipVisible && (
          <div className="verdict-tooltip" role="tooltip">
            {en ? "This conclusion follows the current v1.0 rules. Open the details for the full rule set." : "结论依据当前 v1.0 规则生成，点“查看详细说明”可展开完整规则。"}
          </div>
        )}
      </div>

      <BatchCompleteness product={product} en={en} />

      <div className="metrics">
        {product.keyMetrics.map((metric) => (
          <MetricCard key={metric.key} metric={metric} batchId={batchId} en={en} />
        ))}
      </div>

      <ProductionProcess process={product.productionProcess} en={en} />

      <div className="scope-bar">
        <span className="scope-label">{en ? "Scope" : "适用范围"}</span>
        <span className="scope-text">{en ? "General scope: this conclusion applies to " : "通用范围：本结论适用于 "}{product.verification.scope}{en ? "." : "。"}</span>
        <button className="scope-link" type="button" onClick={() => openModal(en ? "Full acceptance rules (v1.0 · 9 checks)" : "完整验收规则（v1.0 · 9 项）", <RulesView batchId={batchId} en={en} />)}>
          {en ? "View details →" : "查看详细说明 →"}
        </button>
      </div>
    </section>
  );
}
