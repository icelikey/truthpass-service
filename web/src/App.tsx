import { useRef, useState } from "react";
import { AuthModal } from "./components/AuthModal";
import { ChatPanel } from "./components/ChatPanel";
import { Community } from "./components/Community";
import { EvidencePanel } from "./components/EvidencePanel";
import { Hero } from "./components/Hero";
import { HistoryModal } from "./components/HistoryModal";
import { ModalProvider } from "./components/ModalContext";
import { ObserverDrawer } from "./components/ObserverDrawer";
import { ProductPanel } from "./components/ProductPanel";
import { ReportSection } from "./components/ReportSection";
import { TopBar } from "./components/TopBar";
import { useAuth } from "./hooks/useAuth";
import { fetchProduct, fetchVerification } from "./api";
import { saveVerificationRecord } from "./lib/supabase";
import type { VerifyState } from "./types";

export default function App() {
  const [toast, setToast] = useState<string | null>(null);
  const [observerOpen, setObserverOpen] = useState(false);
  const [verifyState, setVerifyState] = useState<VerifyState>("idle");
  const [batchId, setBatchId] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [focusTech, setFocusTech] = useState(false);
  const { user, signUp, signIn, signOut } = useAuth();
  const toastTimer = useRef<number | undefined>(undefined);
  const inQueryMode = !!batchId;

  const showToast = (msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  };

  const handleDone = () => {
    setVerifyState("done");
    if (batchId && !user) {
      showToast("请先登录，验证记录才会保存到你的账号");
    } else if (batchId && user) {
      (async () => {
        try {
          const [product, verification] = await Promise.all([
            fetchProduct(batchId),
            fetchVerification(batchId),
          ]);
          await saveVerificationRecord({
            batchId,
            productName: product.name,
            status: verification.status,
            details: {
              origin: product.origin,
              productionDate: product.productionDate,
              verdict: verification.status === "accepted" ? "通过验收" : "未通过验收",
              score: verification.score,
              evidenceHash: verification.evidenceHash,
              metrics: product.keyMetrics.map((m) => ({
                label: m.label,
                value: m.value,
                status: m.status,
              })),
              rules: verification.rules.map((r) => ({
                name: r.name,
                passed: r.passed,
              })),
            },
          });
          showToast("已保存验证记录");
        } catch (err) {
          console.error("保存验证记录失败:", err);
          showToast("验证记录保存失败，请确认已登录且数据库表已创建");
        }
      })();
    }
  };

  const handleAuth = async (mode: "signin" | "signup", email: string, password: string) => {
    if (mode === "signin") await signIn(email, password);
    else await signUp(email, password);
  };

  return (
    <ModalProvider>
      <div className="bg-scene" aria-hidden="true">
        <div className="bg-rays" />
        <div className="bg-fish" />
        <div className="bg-depth" />
      </div>
      <TopBar
        onOpenObserver={() => setObserverOpen(true)}
        onOpenEvidence={() => {
          if (!batchId) setBatchId("FO-2026-001");
          setVerifyState("done");
          setFocusTech(true);
          setTimeout(() => {
            document.getElementById("evidence")?.scrollIntoView({ behavior: "smooth", block: "start" });
          }, 150);
        }}
        userEmail={user?.email ?? null}
        onOpenAuth={() => setAuthOpen(true)}
        onOpenHistory={() => setHistoryOpen(true)}
        onSignOut={signOut}
      />
      <Hero />
      <main className={inQueryMode ? "layout" : "assistant-only"}>
        <ChatPanel
          onStart={() => setVerifyState("running")}
          onDone={handleDone}
          onBatch={(id) => setBatchId(id)}
          batchId={batchId}
        />
        {inQueryMode && <ProductPanel state={verifyState} batchId={batchId ?? ""} />}
        {inQueryMode && <EvidencePanel state={verifyState} batchId={batchId ?? "FO-2026-001"} focusTech={focusTech} />}
      </main>
      {inQueryMode && <ReportSection batchId={batchId} />}
      {inQueryMode && <Community onToast={showToast} batchId={batchId} />}
      <ObserverDrawer open={observerOpen} onClose={() => setObserverOpen(false)} batchId={batchId} />
      <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} onAuth={handleAuth} />
      <HistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} />
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </ModalProvider>
  );
}
