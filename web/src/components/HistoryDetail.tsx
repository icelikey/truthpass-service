import { useQuery } from "@tanstack/react-query";
import { fetchProduct, fetchVerification } from "../api";
import type {
  VerificationDetails,
  VerificationMetric,
  VerificationRuleItem,
} from "../lib/supabase";

interface DetailView {
  origin?: string;
  productionDate?: string;
  verdict?: string;
  score?: number;
  evidenceHash?: string;
  metrics: VerificationMetric[];
  rules: VerificationRuleItem[];
}

function fromDetails(details: VerificationDetails): DetailView {
  return {
    origin: details.origin,
    productionDate: details.productionDate,
    verdict: details.verdict,
    score: details.score,
    evidenceHash: details.evidenceHash,
    metrics: details.metrics ?? [],
    rules: details.rules ?? [],
  };
}

export function HistoryDetail({
  batchId,
  details,
}: {
  batchId: string;
  details?: VerificationDetails | null;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["history-detail", batchId],
    queryFn: async (): Promise<DetailView> => {
      const [product, verification] = await Promise.all([
        fetchProduct(batchId),
        fetchVerification(batchId),
      ]);
      return {
        origin: product.origin,
        productionDate: product.productionDate,
        verdict: verification.status === "accepted" ? "通过验收" : "未通过验收",
        score: verification.score,
        evidenceHash: verification.evidenceHash,
        metrics: product.keyMetrics.map((m) => ({
          label: m.label,
          value: m.value,
          status: m.status,
        })),
        rules: verification.rules.map((r) => ({
          name: r.name,
          passed: r.passed,
        })),
      };
    },
    enabled: !details && !!batchId,
    staleTime: 60_000,
  });

  const view = details ? fromDetails(details) : data;

  if (!view) {
    return (
      <div className="history-detail">
        <p style={{ color: "var(--muted)", margin: 0 }}>
          {isLoading ? "加载详情中…" : "暂无详细数据"}
        </p>
      </div>
    );
  }

  return (
    <div className="history-detail">
      <div className="history-detail-meta">
        {view.origin && (
          <span>
            产地 <b>{view.origin}</b>
          </span>
        )}
        {view.productionDate && (
          <span>
            生产日期 <b>{view.productionDate}</b>
          </span>
        )}
        {view.verdict && (
          <span>
            结论{" "}
            <b className={view.verdict === "通过验收" ? "green-text" : "red-text"}>
              {view.verdict}
            </b>
          </span>
        )}
        {typeof view.score === "number" && (
          <span>
            评分 <b>{view.score}/100</b>
          </span>
        )}
      </div>

      {view.metrics.length > 0 && (
        <div className="history-metrics">
          {view.metrics.map((m) => (
            <div className="history-metric" key={m.label}>
              <span className="k">{m.label}</span>
              <span className={`v ${m.status === "fail" ? "fail" : m.status === "pass" ? "pass" : ""}`}>
                {m.value}
              </span>
            </div>
          ))}
        </div>
      )}

      {view.rules.length > 0 && (
        <div className="history-rules">
          {view.rules.map((r) => (
            <div className="history-rule" key={r.name}>
              <span>{r.name}</span>
              <span className={r.passed ? "ok" : "no"}>{r.passed ? "✓ 通过" : "✗ 未通过"}</span>
            </div>
          ))}
        </div>
      )}

      {view.evidenceHash && (
        <div className="history-hash">证据哈希 {view.evidenceHash}</div>
      )}
    </div>
  );
}
