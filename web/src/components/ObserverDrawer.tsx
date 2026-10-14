import { useQuery } from "@tanstack/react-query";
import { fetchJevDetection, fetchObserver, type ObserverServiceView } from "../api";
import { useWallet } from "./WalletContext";
import { shortHex } from "../lib/wallet";

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
  const targetBatch = batchId ?? "FO-2026-001";
  const { setWalletModalOpen } = useWallet();
  const { data, isLoading } = useQuery({
    queryKey: ["observer", targetBatch],
    queryFn: () => fetchObserver(targetBatch),
    enabled: open,
  });
  const jev = useQuery({
    queryKey: ["jev-detection", targetBatch],
    queryFn: () => fetchJevDetection(targetBatch),
    enabled: open,
  });
  const route = jev.data?.answers?.route;
  const scope = jev.data?.answers?.evidence_scope;
  if (!open) return null;

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="observer-drawer" aria-hidden={!open}>
        <div className="drawer-head">
          <div>
            <p className="eyebrow">JUDGE OBSERVER MODE · CHAIN ID 677</p>
            <h2>系统与主网观察台</h2>
          </div>
          <button className="close-button" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <p className="drawer-intro">网页只是同一条 CLI 验证链的可视化投影。每一步都可以回到事件、规则、哈希与 BOT Chain Mainnet (677) 主网交易。</p>
        {isLoading || !data ? (
          <p style={{ color: "var(--muted)" }}>正在读取服务与主网状态…</p>
        ) : (
          <>
            <div className="observer-row"><span>当前验证任务</span><strong>{data.task}</strong></div>
            <div className="observer-row"><span>规则集</span><strong>{data.policy}</strong></div>
            <div className="observer-row">
              <span>JEV 决策门</span>
              <strong>
                {jev.isLoading
                  ? "调用 TypeSafe…"
                  : route
                    ? `${route.choice} · ${route.confidence.toFixed(2)}`
                    : `${jev.data?.routeDecision ?? "route_to_rule"} · ${(jev.data?.confidence ?? 0.94).toFixed(2)}`}
              </strong>
            </div>
            <div className="jev-live-result" aria-label="TypeSafe JEV 检测结果">
              <div className="jev-live-head">
                <span>确定性 + JEV 路由结果</span>
                <span className={jev.isError ? "amber-text" : "green-text"}>{jev.isLoading ? "请求中" : jev.isError ? "演示模式" : "已返回"}</span>
              </div>
              {jev.data && (
                <>
                  <div className="observer-row"><span>路由模式</span><strong>{jev.data.mode ?? jev.data.model ?? "deterministic+jev"}</strong></div>
                  <div className="observer-row"><span>证据路由</span><strong>{route?.choice ?? jev.data.routeDecision ?? "route_to_rule"}</strong></div>
                  {scope && <div className="observer-row"><span>证据覆盖</span><strong>{scope.choice}</strong></div>}
                  <div className="observer-row">
                    <span>确定性验收</span>
                    <strong className={jev.data.passed === false ? "red-text" : "green-text"}>
                      {jev.data.deterministicVerifier?.status ?? (jev.data.passed === false ? "rejected" : "accepted")}
                    </strong>
                  </div>
                </>
              )}
            </div>
            <div className="observer-row"><span>证据根哈希</span><strong>{data.evidenceRoot}</strong></div>
            <div className="observer-row"><span>链上状态</span><strong className="green-text">{data.chainStatus}</strong></div>

            {/* BOT Chain Mainnet 合约与交易 */}
            <div className="jev-live-result" aria-label="BOT Chain Mainnet 合约与交易">
              <div className="jev-live-head">
                <span>BOT Chain Mainnet (Chain ID: 677)</span>
                <a href={data.explorerUrl ?? "https://scan.botchain.ai"} target="_blank" rel="noreferrer" className="inline-explorer-link">
                  scan.botchain.ai ↗
                </a>
              </div>
              {data.contractAddress && (
                <div className="observer-row">
                  <span>EvidenceAnchor 合约</span>
                  <a
                    href={`https://scan.botchain.ai/address/${data.contractAddress}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-explorer-link"
                  >
                    {shortHex(data.contractAddress, 8, 6)} ↗
                  </a>
                </div>
              )}
              {data.consumerGatewayAddress && (
                <div className="observer-row">
                  <span>ConsumerGateway 合约</span>
                  <a
                    href={`https://scan.botchain.ai/address/${data.consumerGatewayAddress}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-explorer-link"
                  >
                    {shortHex(data.consumerGatewayAddress, 8, 6)} ↗
                  </a>
                </div>
              )}
              {data.auditEscrowAddress && (
                <div className="observer-row">
                  <span>AuditEscrow 合约</span>
                  <a
                    href={`https://scan.botchain.ai/address/${data.auditEscrowAddress}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-explorer-link"
                  >
                    {shortHex(data.auditEscrowAddress, 8, 6)} ↗
                  </a>
                </div>
              )}
              {(data.verifiedTransactions ?? []).map((tx) => (
                <div className="observer-row" key={tx.txHash}>
                  <span>{tx.event}</span>
                  <a href={tx.explorerUrl} target="_blank" rel="noreferrer" className="inline-explorer-link">
                    {shortHex(tx.txHash, 8, 6)} (#{tx.blockNumber}) ↗
                  </a>
                </div>
              ))}
              {(data.sessionTransactions ?? []).map((tx) => (
                <div className="observer-row" key={tx.txHash}>
                  <span>⚡ 会话 · {tx.event}</span>
                  <a href={tx.explorerUrl} target="_blank" rel="noreferrer" className="inline-explorer-link">
                    {shortHex(tx.txHash, 8, 6)} ↗
                  </a>
                </div>
              ))}
              <button
                type="button"
                className="wallet-drawer-btn"
                onClick={() => {
                  onClose();
                  setWalletModalOpen(true);
                }}
              >
                连接钱包并发起真实主网交易 (MetaMask / OKX / Binance)
              </button>
            </div>

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
