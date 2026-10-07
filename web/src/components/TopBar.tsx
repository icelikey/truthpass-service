export function TopBar({ onOpenObserver }: { onOpenObserver: () => void }) {
  return (
    <header className="topbar">
      <div className="brand">
        <img className="brand-mark" src="/assets/brand-mark.png" alt="TruthPass" width="52" height="52" />
        <span className="brand-zh">TruthPass</span>
      </div>
      <span className="brand-tagline">看见真实的供应链 · 让好产品被信任</span>
      <span className="chip">DEMO / SYNTHETIC</span>
      <button className="ghost-button" type="button" onClick={onOpenObserver}>
        评委观察台
      </button>
    </header>
  );
}
