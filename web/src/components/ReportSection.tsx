import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { jsPDF } from "jspdf";
import html2canvas from "html2canvas";
import { fetchProduct, fetchVerification } from "../api";
import type { KeyMetric, ProductBatch } from "../types";

const REPORT_ITEMS = [
  { key: "epa-dha", label: "EPA+DHA" },
  { key: "peroxide", label: "过氧化值" },
  { key: "cold-chain", label: "冷链" },
  { key: "heavy-metal", label: "重金属报告" },
];

function metricFor(product: ProductBatch, key: string): KeyMetric | undefined {
  return product.keyMetrics.find((m) => m.key === key);
}

function buildReportHtml(
  product: ProductBatch,
  verification: { status: string; score: number; evidenceHash: string; rules: Array<{ name: string; desc: string; passed: boolean }> },
  selected: string[],
): string {
  const rows = selected
    .map((key) => {
      const m = metricFor(product, key);
      if (!m) return "";
      const verdict = m.status === "pass" ? "达标" : m.status === "fail" ? "超标" : "未覆盖";
      const cls = m.status === "pass" ? "ok" : m.status === "fail" ? "fail" : "muted";
      return `<tr><td>${m.label}</td><td>${m.value}</td><td>${m.unit}</td><td class="${cls}">${verdict}</td></tr>`;
    })
    .join("");

  const now = new Date().toLocaleString("zh-CN");
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<title>TruthPass 检测报告 · ${product.batchId}</title>
<style>
body{font-family:-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;color:#1a2733;max-width:680px;margin:32px auto;padding:0 24px;line-height:1.6;background:#fff}
h1{font-size:24px;border-bottom:2px solid #0e7f7f;padding-bottom:12px;color:#0b3d4c;margin-top:0}
h2{font-size:16px;margin-top:26px}
table{border-collapse:collapse;width:100%;margin-top:12px;font-size:13px}
th,td{border:1px solid #d8e2e8;padding:9px 12px;text-align:left}
th{background:#eef5f6;color:#0b3d4c}
.meta{color:#52606d;font-size:14px}
.ok{color:#0e7f4f;font-weight:600}
.fail{color:#c0392b;font-weight:600}
.muted{color:#8a97a0}
.foot{margin-top:26px;color:#8a97a0;font-size:12px;border-top:1px solid #e2e8ec;padding-top:12px}
</style>
</head>
<body>
<h1>TruthPass 检测报告</h1>
<p class="meta">批次号：${product.batchId}　商品：${product.name}</p>
<p class="meta">产地：${product.origin}　生产日期：${product.productionDate}</p>
<p class="meta">验收结论：<strong class="${verification.status === "accepted" ? "ok" : "fail"}">${verification.status === "accepted" ? "通过验收" : "未通过验收"}</strong>（得分 ${verification.score}/100）</p>
<h2>检测项目</h2>
<table><thead><tr><th>检测项</th><th>检测结果</th><th>单位</th><th>判定</th></tr></thead><tbody>${rows}</tbody></table>
<h2>验收规则</h2>
<table><thead><tr><th>规则</th><th>说明</th><th>结果</th></tr></thead><tbody>
${verification.rules.map((r) => `<tr><td>${r.name}</td><td>${r.desc}</td><td class="${r.passed ? "ok" : "fail"}">${r.passed ? "通过" : "不通过"}</td></tr>`).join("")}
</tbody></table>
<p class="foot">证据哈希：${verification.evidenceHash}<br/>生成时间：${now}<br/>本报告为 demo/synthetic 演示数据，不作为真实供应链证明。</p>
</body>
</html>`;
}

export function ReportSection({ batchId }: { batchId: string | null }) {
  const [selected, setSelected] = useState<string[]>(REPORT_ITEMS.map((i) => i.key));
  const [downloading, setDownloading] = useState(false);

  const productQuery = useQuery({
    queryKey: ["product", batchId],
    queryFn: () => fetchProduct(batchId ?? ""),
    enabled: !!batchId,
  });
  const verificationQuery = useQuery({
    queryKey: ["verification", batchId],
    queryFn: () => fetchVerification(batchId ?? ""),
    enabled: !!batchId,
  });

  const html = useMemo(() => {
    if (!productQuery.data || !verificationQuery.data) return "";
    return buildReportHtml(productQuery.data, verificationQuery.data, selected);
  }, [productQuery.data, verificationQuery.data, selected]);

  const toggle = (key: string) =>
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));

  const download = async () => {
    if (!html || downloading) return;
    setDownloading(true);
    try {
      const container = document.createElement("div");
      container.innerHTML = html;
      container.style.position = "fixed";
      container.style.left = "-9999px";
      container.style.top = "0";
      container.style.width = "720px";
      container.style.background = "#fff";
      document.body.appendChild(container);

      const canvas = await html2canvas(container, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
      document.body.removeChild(container);

      const pdf = new jsPDF("p", "mm", "a4");
      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();
      const margin = 16;
      const imgWidth = pageWidth - margin * 2;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      const imgData = canvas.toDataURL("image/png");
      const contentHeight = pageHeight - margin * 2;

      let heightLeft = imgHeight;
      let position = margin;
      pdf.addImage(imgData, "PNG", margin, position, imgWidth, imgHeight);
      heightLeft -= contentHeight;
      while (heightLeft > 0) {
        position -= contentHeight;
        pdf.addPage();
        pdf.addImage(imgData, "PNG", margin, position, imgWidth, imgHeight);
        heightLeft -= contentHeight;
      }
      pdf.save(`${batchId ?? "batch"}-检测报告.pdf`);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section className="report-section">
      <div className="panel">
        <div className="report-head">
          <div>
            <span className="eyebrow">检测报告</span>
            <h2>{batchId ? `批次 ${batchId} · ${productQuery.data?.name ?? ""}` : "请先选择批次"}</h2>
          </div>
        </div>

        {batchId ? (
          <>
            <div className="report-items">
              <span className="report-label">选择检测项：</span>
              {REPORT_ITEMS.map((item) => (
                <button
                  key={item.key}
                  className={selected.includes(item.key) ? "feedback-tag active" : "feedback-tag"}
                  type="button"
                  onClick={() => toggle(item.key)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="report-actions">
              <button className="join-btn" type="button" onClick={download} disabled={downloading}>
                {downloading ? "正在生成 PDF…" : "下载检测报告"}
              </button>
            </div>
          </>
        ) : (
          <p style={{ color: "var(--muted)" }}>完成一次批次验证后，可在这里下载该批次的检测报告。</p>
        )}
      </div>
    </section>
  );
}
