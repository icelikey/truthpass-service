import { useWallet } from "./WalletContext";
import { shortHex } from "../lib/wallet";

export function TopBar({
  onOpenObserver,
  onOpenEvidence,
  userEmail,
  onOpenAuth,
  onOpenHistory,
  onSignOut,
}: {
  onOpenObserver: () => void;
  onOpenEvidence: () => void;
  userEmail: string | null;
  onOpenAuth: () => void;
  onOpenHistory: () => void;
  onSignOut: () => void;
}) {
  const { address, chainId, walletName, setWalletModalOpen } = useWallet();

  return (
    <header className="topbar">
      <div className="brand">
        <img className="brand-mark" src="/assets/brand-mark.png" alt="TruthPass" width="52" height="52" />
        <span className="brand-zh">TruthPass</span>
      </div>
      <span className="brand-tagline">白牌商品证据控制台 · 批次可复核</span>

      <div className="topbar-actions">
        <a
          className="chain-badge-link"
          href="https://scan.botchain.ai/address/0x0033462bee153cb9DF12b5c447b9C282DbfbE877"
          target="_blank"
          rel="noreferrer"
          aria-label="在 BOT Chain 区块浏览器查看 EvidenceAnchor 合约"
          title="在 BOT Chain Mainnet 区块浏览器核验合约"
        >
          <span className="chain-dot" />
          公开记录
        </a>

        <button
          className={address ? "wallet-connect-btn connected" : "wallet-connect-btn"}
          type="button"
          aria-label={address ? `已连接钱包 ${shortHex(address)}` : "连接钱包"}
          onClick={() => setWalletModalOpen(true)}
        >
          {address ? (
            <>
              <span className="chain-dot" />
              {walletName ?? "EVM"} · {shortHex(address)}
              {chainId === 677 ? "" : ` · Chain ${chainId ?? "?"}`}
            </>
          ) : (
            "连接钱包"
          )}
        </button>

        <a className="ghost-button topbar-merchant-link" href="/merchant" aria-label="打开商家工作台">
          企业入口
        </a>
        <button
          className="ghost-button"
          type="button"
          aria-label="打开评委观察台"
          onClick={onOpenObserver}
        >
          查看全流程
        </button>
        <button
          className="ghost-button"
          type="button"
          aria-label="打开技术详情与 CLI / BotChain"
          onClick={onOpenEvidence}
        >
          资料说明
        </button>

        {userEmail ? (
          <div className="account">
            <span className="account-email" title={userEmail}>{userEmail}</span>
            <button className="ghost-button" type="button" aria-label="查看我的验证记录" onClick={onOpenHistory}>
              记录
            </button>
            <button className="ghost-button" type="button" aria-label="退出登录" onClick={onSignOut}>
              退出
            </button>
          </div>
        ) : (
          <button className="ghost-button" type="button" aria-label="登录或注册账号" onClick={onOpenAuth}>
            登录
          </button>
        )}
      </div>
    </header>
  );
}
