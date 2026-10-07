import { useQuery } from "@tanstack/react-query";
import { fetchJevDetection, fetchObserver, type ObserverServiceView } from "../api";

const LIVE_TEXT: Record<ObserverServiceView["live"], string> = {
  degraded: "降级",
  offline: "离线",
  online: "在线",
};
const LIVE_CLASS: Record<ObserverServiceView["live"], string> = {
  degraded: "amber-text",
  offline: "red-text",
  online: "green-text",
};
const VERDICT_TEXT: Record<ObserverServiceView["verdict"], string> = {
  rejected: "拒绝",
  "not-called": "未调用",
  passed: "通过",
};
const VERDICT_CLASS: Record<ObserverServiceView["verdict"], string> = {
  rejected: "red-text",
  "not-called": "",
  passed: "green-text",
};

export function ObserverDrawer({ open, onClose, batchId }: { open: boolean; onClose: () => void; batchId: string | null }) {
  const { data, isLoading } = useQuery({
    queryKey: ["observer", batchId],
    queryFn: () => fetchObserver(batchId ?? "FO-2026-001"),
    enabled: open && !!batchId,
  });
  const jev = useQuery({ queryKey: ["jev-detection"], queryFn: fetchJevDetection, enabled: open });
  const route = jev.data?.answers.route;
  const scope = jev.data?.answers.evidence_scope;
  if (!open) return null;

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="observer-drawer" aria-hidden={!open}>
        <div className="drawer-head">
          <div>
            <p className="eyebrow">JUDGE OBSERVER MODE</p>
            <h2>系统观察台</h2>
          </div>
          <button className="close-button" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <p className="drawer-intro">网页只是同一条 CLI 验证链的可视化投影。每一步都可以回到事件、规则和哈希。</p>
        {!batchId ? (
          <p style={{ color: "var(--muted)" }}>暂无验证任务，请先在左侧完成一次批次验证。</p>
        ) : isLoading || !data ? (
          <p style={{ color: "var(--muted)" }}>正在读取服务与验收状态…</p>
        ) : (
          <>
            <div className="observer-row"><span>当前验证任务</span><strong>{data.task}</strong></div>
            <div className="observer-row"><span>规则集</span><strong>{data.policy}</strong></div>
            <div className="observer-row">
              <span>JEV 决策门</span>
              <strong>{jev.isLoading ? "调用 TypeSafe…" : (route?.choice ?? data.jev) + " · " + (route?.confidence ?? 0).toFixed(2)}</strong>
            </div>
            <div className="jev-live-result" aria-label="TypeSafe JEV 检测结果">
              <div className="jev-live-head">
                <span>实时检测结果</span>
                <span className={jev.isError ? "amber-text" : "green-text"}>{jev.isLoading ? "请求中" : jev.isError ? "演示模式" : "已返回"}</span>
              </div>
              {jev.isError && <p style={{ color: "var(--muted)" }}>未启用实时 JEV 检测，当前展示演示数据。</p>}
              {jev.data && (
                <>
                  <div className="observer-row"><span>模型</span><strong>{jev.data.model}</strong></div>
                  <div className="observer-row"><span>证据路由</span><strong>{route?.choice}</strong></div>
                  <div className="observer-row"><span>证据覆盖</span><strong>{scope?.choice}</strong></div>
                  <div className="observer-row"><span>确定性验收</span><strong className="green-text">{jev.data.deterministicVerifier.status}</strong></div>
                  <details><summary>查看结构化返回</summary><pre>{JSON.stringify(jev.data.answers, null, 2)}</pre></details>
                </>
              )}
            </div>
            <div className="observer-row"><span>证据根哈希</span><strong>{data.evidenceRoot}</strong></div>
            <div className="observer-row"><span>链上状态</span><strong className="green-text">{data.chainStatus}</strong></div>
            <div className="service-table">
              <div className="table-head"><span>服务</span><span>历史</span><span>当前</span><span>本次</span></div>
              {data.services.map((service) => (
                <div key={service.id}>
                  <span>{service.id}</span>
                  <span>{service.history}</span>
                  <span className={LIVE_CLASS[service.live]}>{LIVE_TEXT[service.live]}</span>
                  <span className={VERDICT_CLASS[service.verdict]}>{VERDICT_TEXT[service.verdict]}</span>
                </div>
              ))}
            </div>
          </>
        )}
        <div className="drawer-boundary">
          <span>边界提醒</span>
          <p>链上确认提交过的记录没有被悄悄改写；设备、实验室和生产方的现实真实性仍需要多源、复检和争议机制共同维护。</p>
        </div>
      </aside>
    </>
  );
}
