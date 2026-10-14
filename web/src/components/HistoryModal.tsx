import { useEffect, useState } from "react";
import {
  clearOrderRecords,
  clearVerificationRecords,
  fetchOrderRecords,
  fetchVerificationRecords,
  type OrderRecord,
  type VerificationHistoryRecord,
} from "../lib/supabase";
import { HistoryDetail } from "./HistoryDetail";

export function HistoryModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [records, setRecords] = useState<VerificationHistoryRecord[]>([]);
  const [orders, setOrders] = useState<OrderRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    Promise.all([fetchVerificationRecords(), fetchOrderRecords()])
      .then(([verifications, orderRecords]) => {
        setRecords(verifications);
        setOrders(orderRecords);
      })
      .finally(() => setLoading(false));
  }, [open]);

  const clearAll = async () => {
    if (!window.confirm("确定清除全部验证记录与补货记录？此操作不可撤销。")) return;
    setClearing(true);
    setError("");
    try {
      const [vOk, oOk] = await Promise.all([clearVerificationRecords(), clearOrderRecords()]);
      if (vOk && oOk) {
        setRecords([]);
        setOrders([]);
      } else {
        const [verifications, orderRecords] = await Promise.all([fetchVerificationRecords(), fetchOrderRecords()]);
        setRecords(verifications);
        setOrders(orderRecords);
        setError("清除失败：请确认 Supabase 表已开启 delete 权限（RLS 使用 for all）。");
      }
    } finally {
      setClearing(false);
    }
  };

  if (!open) return null;

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <div className="auth-modal history-modal" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div>
            <p className="eyebrow">TruthPass</p>
            <h2>我的记录</h2>
          </div>
          <div className="history-head-actions">
            {(records.length > 0 || orders.length > 0) && (
              <button className="history-clear" onClick={clearAll} disabled={clearing}>
                {clearing ? "清除中…" : "清除全部"}
              </button>
            )}
            <button className="close-button" onClick={onClose} aria-label="关闭">×</button>
          </div>
        </div>
        {error && <p className="auth-error">{error}</p>}
        {loading ? (
          <p style={{ color: "var(--muted)" }}>加载中…</p>
        ) : (
          <>
            <h3 className="history-section">验证记录</h3>
            {records.length > 0 ? (
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
                            <span className="history-time">{new Date(r.created_at).toLocaleString("zh-CN")}</span>
                          </span>
                        </span>
                      </summary>
                      <HistoryDetail batchId={r.batch_id} details={r.details} />
                    </details>
                  </div>
                ))}
              </div>
            ) : (
              <p className="history-empty">暂无验证记录</p>
            )}

            <h3 className="history-section">补货记录</h3>
            {orders.length > 0 ? (
              <div className="history-list">
                {orders.map((o) => (
                  <div className="history-item order-history-item" key={o.id}>
                    {o.image_url && <img src={o.image_url} alt="" />}
                    <span className="history-main">
                      <b>{o.product_name}</b>
                      <span>{o.batch_id} · 订单 {o.order_id}</span>
                    </span>
                    <span className="history-right">
                      <span className="green-text">已确认 · x{o.quantity}</span>
                      <span className="history-time">{new Date(o.created_at).toLocaleString("zh-CN")}</span>
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="history-empty">暂无补货记录</p>
            )}
          </>
        )}
      </div>
    </>
  );
}
