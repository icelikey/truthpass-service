import { useEffect, useState } from "react";
import {
  fetchVerificationRecords,
  type VerificationHistoryRecord,
} from "../lib/supabase";
import { HistoryDetail } from "./HistoryDetail";

export function HistoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [records, setRecords] = useState<VerificationHistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetchVerificationRecords()
      .then(setRecords)
      .finally(() => setLoading(false));
  }, [open]);

  if (!open) return null;

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <div className="auth-modal history-modal" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div>
            <p className="eyebrow">TruthPass</p>
            <h2>我的验证记录</h2>
          </div>
          <button className="close-button" onClick={onClose} aria-label="关闭">×</button>
        </div>
        {loading ? (
          <p style={{ color: "var(--muted)" }}>加载中…</p>
        ) : records.length === 0 ? (
          <p style={{ color: "var(--muted)" }}>还没有验证记录，先去完成一次批次验证吧。</p>
        ) : (
          <div className="history-list">
            {records.map((r) => (
              <div className="history-item" key={r.id}>
                <details>
                  <summary>
                    <span className="history-row">
                      <span className="history-main">
                        <b>{r.product_name}</b>
                        <span>{r.batch_id}</span>
                      </span>
                      <span className="history-right">
                        <span className={r.status === "accepted" ? "green-text" : "red-text"}>
                          {r.status === "accepted" ? "通过" : "未通过"}
                        </span>
                        <span className="history-time">
                          {new Date(r.created_at).toLocaleString("zh-CN")}
                        </span>
                      </span>
                    </span>
                  </summary>
                  <HistoryDetail batchId={r.batch_id} details={r.details} />
                </details>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
