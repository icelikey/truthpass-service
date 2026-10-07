import { useState, type FormEvent } from "react";

export function AuthModal({
  open,
  onClose,
  onAuth,
}: {
  open: boolean;
  onClose: () => void;
  onAuth: (mode: "signin" | "signup", email: string, password: string) => Promise<void>;
}) {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  if (!open) return null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      await onAuth(mode, email, password);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "操作失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <div className="auth-modal" role="dialog" aria-modal="true">
        <div className="drawer-head">
          <div>
            <p className="eyebrow">TruthPass 账号</p>
            <h2>{mode === "signin" ? "登录" : "注册"}</h2>
          </div>
          <button className="close-button" onClick={onClose} aria-label="关闭">×</button>
        </div>
        <form onSubmit={submit} className="auth-form">
          <label>
            <span>邮箱</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required placeholder="you@example.com" />
          </label>
          <label>
            <span>密码</span>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={6} placeholder="至少 6 位" />
          </label>
          {error && <p className="auth-error">{error}</p>}
          <button className="join-btn full" type="submit" disabled={busy}>
            {busy ? "处理中…" : mode === "signin" ? "登录" : "注册"}
          </button>
          <button
            className="auth-switch"
            type="button"
            onClick={() => setMode(mode === "signin" ? "signup" : "signin")}
          >
            {mode === "signin" ? "没有账号？去注册" : "已有账号？去登录"}
          </button>
        </form>
      </div>
    </>
  );
}
