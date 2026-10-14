import { useState, type FormEvent } from "react";

export function AuthModal({
  open,
  onClose,
  onAuth,
}: {
  open: boolean;
  onClose: () => void;
  onAuth: (mode: "signin" | "signup", email: string, password: string) => Promise<boolean | void>;
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
      const confirmationRequired = await onAuth(mode, email, password);
      if (mode === "signup" && confirmationRequired) {
        setError("注册成功，请检查邮箱并完成确认后再登录。");
        setPassword("");
      } else {
        onClose();
      }
    } catch (err) {
      setError(readableAuthError(err));
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

function readableAuthError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/invalid login credentials/i.test(message)) return "账号或密码不正确；如果还没有账号，请先注册。";
  if (/email not confirmed/i.test(message)) return "邮箱尚未确认，请先完成邮箱确认。";
  if (/user already registered/i.test(message)) return "该邮箱已经注册，请直接登录。";
  if (/password/i.test(message) && /weak|characters|length|least/i.test(message)) return "密码强度不足，请使用至少 6 位密码。";
  if (/supabase 未配置/i.test(message)) return "登录服务尚未配置，请联系管理员。";
  return "操作失败，请检查邮箱和密码后重试。";
}
