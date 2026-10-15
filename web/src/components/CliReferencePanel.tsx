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
  if (!status) return { text: "loading", cls: "pending" };
  if (status === "anchored" || status === "confirmed") return { text: status, cls: "verified" };
  if (status === "anchor_pending" || status === "pending") return { text: "anchor_pending · 尚未完成锚定", cls: "anchor-pending" };
  return { text: status, cls: "review" };
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
          <span className="cli-reference-kicker">开放协议能力</span>
          <h2>同一批证据，服务商家、Agent 和消费者</h2>
          <p>商家保留原有系统；TruthPass 暴露商品、批次、验证、购买准备与售后能力。下列为演示参考实现。</p>
        </div>
        <span className={`status-pill ${dataMode === "external" ? "verified" : "demo"}`}>
          {dataMode === "external" ? "external" : "DEMO / SYNTHETIC"}
        </span>
      </div>

      <div className="cli-reference-flow" aria-label="开放协议能力流程">
        {[
          ["01", "协议发现", "Manifest 声明可读能力"],
          ["02", "商品与批次", "商品信息 + 批次证据"],
          ["03", "验证", "确定性验收与缺口"],
          ["04", "购买与售后", "准备订单 · 售后反馈"],
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
              {verification?.status ?? "loading"}
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
            aria-label={showHash ? "收起证据哈希" : "展开证据哈希与数据模式"}
            onClick={() => setShowHash((v) => !v)}
          >
            {showHash ? "收起技术字段" : "展开证据哈希"}
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
              <small>Agent 可发现能力</small>
              <strong>{manifest?.protocol ?? "CLI_REFERENCE"} · v{manifest?.version ?? "—"}</strong>
            </div>
            <span className="cli-reference-open-badge">OPEN</span>
          </div>
          <div className="cli-reference-capabilities">
            {(manifest?.capabilities ?? ["product.read", "batch.verify", "order.prepare", "assistant.read"]).map((capability) => (
              <code key={capability} className="friendly" title={capability}>
                {CAP_LABELS[capability] ?? capability}
                <span className="cli-cap-label">{capability}</span>
              </code>
            ))}
          </div>
          <p>健康疗效与个人数据不进公共层；公共层只发布规则、状态与可验证哈希。</p>
          <a href="/api/cli/reference/manifest" target="_blank" rel="noreferrer" aria-label="在新窗口查看 CLI 参考实现 Manifest">
            查看 Manifest ↗
          </a>
        </div>
      </div>
    </section>
  );
}
