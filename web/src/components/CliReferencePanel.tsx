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

export function CliReferencePanel() {
  const [manifest, setManifest] = useState<CliReferenceManifest | null>(null);
  const [verification, setVerification] = useState<CliReferenceVerification | null>(null);

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

  return (
    <section id="cli-reference" className="cli-reference-demo">
      <div className="cli-reference-demo-head">
        <div>
          <span className="cli-reference-kicker">CLI REFERENCE IMPLEMENTATION</span>
          <h2>同一批证据，服务商家、Agent 和消费者</h2>
          <p>商家保留原有系统，TruthPass 把商品、批次、验证、购买和售后能力暴露成可发现的开放接口。</p>
        </div>
        <span className="cli-reference-demo-badge">DEMO / SYNTHETIC</span>
      </div>

      <div className="cli-reference-flow" aria-label="CLI 参考实现企业演示流程">
        {[
          ["01", "商家发布", "商品 + ProductPolicy + 批次"],
          ["02", "证据接入", "生产 / 检测 / 冷链 / 出货"],
          ["03", "确定性验收", "Verifier 输出状态和缺口"],
          ["04", "Agent 交易", "查询、购买准备、售后反馈"],
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
              <small>公开批次证据卡</small>
              <strong>海蓝营养 · FO-2026-001</strong>
            </div>
            <span className="cli-reference-status">{verification?.status ?? "loading"}</span>
          </div>
          <p>{verification?.summary ?? "正在读取 CLI 参考实现批次验证结果…"}</p>
          <div className="cli-reference-checks">
            {(verification?.checks ?? []).map((check) => (
              <span key={check.label} className={check.status === "passed" ? "passed" : "review"}>
                {check.status === "passed" ? "✓" : "○"} {check.label}
              </span>
            ))}
          </div>
          <small className="cli-reference-hash">evidenceRoot: {verification?.evidenceRoot ?? "—"}</small>
          <small className="cli-reference-hash">anchor: {verification?.anchor.status ?? "—"} · data: {verification?.dataMode ?? "—"}</small>
        </div>

        <div className="cli-reference-manifest-card">
          <div className="cli-reference-card-head">
            <div>
              <small>Agent 可发现能力</small>
              <strong>{manifest?.protocol ?? "CLI_REFERENCE"} Manifest v{manifest?.version ?? "—"}</strong>
            </div>
            <span className="cli-reference-open-badge">OPEN</span>
          </div>
          <div className="cli-reference-capabilities">
            {(manifest?.capabilities ?? ["product.read", "batch.verify", "order.prepare", "assistant.read"]).map((capability) => (
              <code key={capability}>{capability}</code>
            ))}
          </div>
          <p>健康数据默认排除，原始报告和个人信息保留在链下；公共层发布规则、状态和可验证哈希。</p>
          <a href="/api/cli/reference/manifest" target="_blank" rel="noreferrer">查看 CLI 参考实现 Manifest ↗</a>
        </div>
      </div>
    </section>
  );
}

