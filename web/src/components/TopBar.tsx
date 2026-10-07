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
  return (
    <header className="topbar">
      <div className="brand">
        <img className="brand-mark" src="/assets/brand-mark.png" alt="TruthPass" width="52" height="52" />
        <span className="brand-zh">TruthPass</span>
      </div>
      <span className="brand-tagline">看见真实的供应链 · 让好产品被信任</span>
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
