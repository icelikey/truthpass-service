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
      <span className="brand-tagline">看见真实的供应链 · 让好产品被信任</span>
      <a
        className="chain-badge-link"
        href="https://scan.botchain.ai/address/0x0033462bee153cb9DF12b5c447b9C282DbfbE877"
        target="_blank"
        rel="noreferrer"
        title="在 BOT Chain Mainnet 区块浏览器核验合约"
      >
        <span className="chain-dot" />
        BOT Chain Mainnet · 677 ↗
      </a>
      <button
        className={address ? "wallet-connect-btn connected" : "wallet-connect-btn"}
        type="button"
        onClick={() => setWalletModalOpen(true)}
      >
        {address ? (
          <>
            <span className="chain-dot" />
            {walletName ?? "EVM"} · {shortHex(address)} ({chainId === 677 ? "BOT 677" : `Chain ${chainId ?? "?"}`})
          </>
        ) : (
          "连接钱包 (MetaMask / OKX / Binance)"
        )}
      </button>
      <button className="ghost-button" type="button" onClick={onOpenObserver}>
        评委观察台
      </button>
      <button className="ghost-button" type="button" onClick={onOpenEvidence}>
        CLI / BotChain
      </button>
      {userEmail ? (
        <div className="account">
          <span className="account-email" title={userEmail}>{userEmail}</span>
          <button className="ghost-button" type="button" onClick={onOpenHistory}>我的记录</button>
          <button className="ghost-button" type="button" onClick={onSignOut}>退出</button>
        </div>
      ) : (
        <button className="ghost-button" type="button" onClick={onOpenAuth}>登录 / 注册</button>
      )}
    </header>
  );
}
