import { useEffect, useState } from "react";

interface CliReferenceManifest {
  protocol: string;
  version: string;
  manifestId: string;
  capabilities: string[];
  dataMode: string;
}

interface CliReferenceVerification {
  batchId: string;
  status: string;
  summary: string;
  evidenceRoot: string;
  dataMode: string;
  checks: Array<{ label: string; status: string }>;
  anchor: { status: string };
}

const CAP_LABELS: Record<string, string> = {
  "product.read": "商品信息",
  "batch.verify": "批次验证",
  "order.prepare": "购买准备",
  "assistant.read": "Agent 问答",
  "aftersales.create": "售后反馈",
  "evidence.read": "证据读取",
  "policy.read": "策略读取",
};

function anchorLabel(status?: string): { text: string; cls: string } {
  if (!status) return { text: "正在读取", cls: "pending" };
  if (status === "anchored" || status === "confirmed") return { text: "已确认", cls: "verified" };
  if (status === "anchor_pending" || status === "pending") return { text: "等待确认", cls: "anchor-pending" };
  return { text: "需要继续处理", cls: "review" };
}

function verificationLabel(status?: string): string {
  if (status === "accepted") return "当前规则通过";
  if (status === "rejected") return "需要复核";
  if (status === "missing_evidence") return "资料不足";
  return "正在读取";
}

export function CliReferencePanel() {
  const [manifest, setManifest] = useState<CliReferenceManifest | null>(null);
  const [verification, setVerification] = useState<CliReferenceVerification | null>(null);
  const [showHash, setShowHash] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/cli/reference/manifest").then((response) => response.json() as Promise<CliReferenceManifest>),
      fetch("/api/cli/reference/batches/FO-2026-001/verification").then((response) => response.json() as Promise<CliReferenceVerification>),
    ]).then(([nextManifest, nextVerification]) => {
      if (!cancelled) {
        setManifest(nextManifest);
        setVerification(nextVerification);
      }
    }).catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const anchor = anchorLabel(verification?.anchor.status);
  const dataMode = verification?.dataMode ?? manifest?.dataMode ?? "demo/synthetic";

  return (
    <section id="cli-reference" className="cli-reference-demo">
      <div className="cli-reference-demo-head">
        <div>
          <span className="cli-reference-kicker">商品资料如何流转</span>
          <h2>同一批资料，企业、Agent 和消费者都能看懂</h2>
          <p>企业继续使用自己的系统，TruthPass 帮它把商品、批次、检测、购买和售后信息整理成一份公开说明。下面是一份演示。</p>
        </div>
        <span className={`status-pill ${dataMode === "external" ? "verified" : "demo"}`}>
          {dataMode === "external" ? "真实资料" : "演示资料"}
        </span>
      </div>

      <div className="cli-reference-flow" aria-label="开放协议能力流程">
        {[
          ["01", "先看商品", "找到商品和批次"],
          ["02", "看资料", "生产、检测和运输"],
          ["03", "看清楚", "知道通过、缺少和不确定"],
          ["04", "做决定", "购买准备和售后帮助"],
        ].map(([step, title, detail]) => (
          <div className="cli-reference-flow-step" key={step}>
            <span>{step}</span>
            <strong>{title}</strong>
            <small>{detail}</small>
          </div>
        ))}
      </div>

      <div className="cli-reference-demo-grid">
        <div className="cli-reference-evidence-card">
          <div className="cli-reference-card-head">
            <div>
              <small>公开批次证据卡 · 演示</small>
              <strong>海蓝营养 · FO-2026-001</strong>
            </div>
            <span className={`status-pill ${verification?.status === "accepted" ? "verified" : verification?.status === "rejected" ? "rejected" : "review"}`}>
          {verificationLabel(verification?.status)}
            </span>
          </div>
          <p>{verification?.summary ?? "正在读取参考实现批次验证结果…"}</p>
          <div className="cli-reference-checks">
            {(verification?.checks ?? []).map((check) => (
              <span key={check.label} className={check.status === "passed" ? "passed" : "review"}>
                {check.status === "passed" ? "✓" : "○"} {check.label}
              </span>
            ))}
          </div>
          <div className="evidence-summary-row">
            <span>锚定状态</span>
            <span className={`status-pill ${anchor.cls}`}>{anchor.text}</span>
          </div>
          <button
            type="button"
            className="ghost-button"
            style={{ justifySelf: "start", marginTop: 4 }}
            aria-label={showHash ? "收起详细依据" : "展开详细依据"}
            onClick={() => setShowHash((v) => !v)}
          >
            {showHash ? "收起详细依据" : "查看详细依据"}
          </button>
          {showHash && (
            <>
              <small className="cli-reference-hash">evidenceRoot: {verification?.evidenceRoot ?? "—"}</small>
              <small className="cli-reference-hash">dataMode: {dataMode}</small>
            </>
          )}
        </div>

        <div className="cli-reference-manifest-card">
          <div className="cli-reference-card-head">
            <div>
              <small>Agent 可以帮助你做什么</small>
              <strong>商品助手能力</strong>
            </div>
            <span className="cli-reference-open-badge">公开</span>
          </div>
          <div className="cli-reference-capabilities">
            {(manifest?.capabilities ?? ["product.read", "batch.verify", "order.prepare", "assistant.read"]).map((capability) => (
              <code key={capability} className="friendly" title={capability}>
                {CAP_LABELS[capability] ?? capability}
                <span className="cli-cap-label">{capability}</span>
              </code>
            ))}
          </div>
          <p>健康和个人信息不会公开；页面只展示商品资料、确认状态和需要继续处理的地方。</p>
          <a href="/api/cli/reference/manifest" target="_blank" rel="noreferrer" aria-label="在新窗口查看完整能力说明">
            查看完整说明 ↗
          </a>
        </div>
      </div>
    </section>
  );
}
