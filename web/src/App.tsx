import { useRef, useState } from "react";
import { AuthModal } from "./components/AuthModal";
import { AfterSalesPanel } from "./components/AfterSalesPanel";
import { ChatPanel } from "./components/ChatPanel";
import { ConsumerFlowBar, type ConsumerAgentStage } from "./components/ConsumerFlowBar";
import { ConsumerActionDock } from "./components/ConsumerActionDock";
import { CliReferencePanel } from "./components/CliReferencePanel";
import { MerchantApp } from "./components/MerchantApp";
import { InstitutionReviewPanel } from "./components/InstitutionReviewPanel";
import { Community } from "./components/Community";
import { EvidencePanel } from "./components/EvidencePanel";
import { Hero } from "./components/Hero";
import { HistoryModal } from "./components/HistoryModal";
import { ModalProvider } from "./components/ModalContext";
import { ObserverDrawer } from "./components/ObserverDrawer";
import { ProductPanel } from "./components/ProductPanel";
import { ReportSection } from "./components/ReportSection";
import { TopBar } from "./components/TopBar";
import { WalletProvider } from "./components/WalletContext";
import { useAuth } from "./hooks/useAuth";
import { fetchProduct, fetchVerification } from "./api";
import { saveVerificationRecord } from "./lib/supabase";
import type { VerifyState } from "./types";
import { PublicPageRouter } from "./PublicPages";

export default function App() {
  const [toast, setToast] = useState<string | null>(null);
  const [observerOpen, setObserverOpen] = useState(false);
  const [verifyState, setVerifyState] = useState<VerifyState>("idle");
  const [batchId, setBatchId] = useState<string | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [focusTech, setFocusTech] = useState(false);
  const [consumerStage, setConsumerStage] = useState<ConsumerAgentStage>("idle");
  const [afterSalesPrompt, setAfterSalesPrompt] = useState("");
  const { user, signUp, signIn, signOut, configured: authConfigured } = useAuth();
  const toastTimer = useRef<number | undefined>(undefined);
  const inQueryMode = !!batchId;
  const pathname = window.location.pathname;
  const isMerchantRoute = pathname.startsWith("/merchant");
  const isInstitutionRoute = pathname === "/institution" || pathname === "/en/institution";
  const isConsumerView = new URLSearchParams(window.location.search).get("view") === "consumer";
  const isPublicPageRoute = ["/", "/developers", "/en", "/en/merchant", "/en/developers"].includes(pathname) && !(pathname === "/" && isConsumerView);

  const showToast = (msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 3200);
  };

  const handleDone = () => {
    setVerifyState("done");
    setConsumerStage("evidence_review");
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

  if (isPublicPageRoute) {
    return <PublicPageRouter pathname={pathname} />;
  }

  if (isInstitutionRoute) {
    return (
      <ModalProvider>
        <WalletProvider activeBatchId="FO-2026-001" onToast={showToast}>
          <InstitutionReviewPanel locale={pathname === "/en/institution" ? "en" : "zh"} />
        </WalletProvider>
      </ModalProvider>
    );
  }

  if (isMerchantRoute) {
    return (
      <ModalProvider>
        <WalletProvider activeBatchId="FO-2026-001" onToast={showToast}>
          <MerchantApp />
        </WalletProvider>
      </ModalProvider>
    );
  }

  return (
    <ModalProvider>
      <WalletProvider activeBatchId={batchId} onToast={showToast}>
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
            setConsumerStage("evidence_review");
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
        <CliReferencePanel />
        <ConsumerFlowBar stage={consumerStage} batchId={batchId} />
        <ConsumerActionDock stage={consumerStage} batchId={batchId} />
        <main className={inQueryMode ? "layout" : "assistant-only"}>
          <ChatPanel
            onStart={() => {
              setVerifyState("running");
              setConsumerStage("searching");
            }}
            onDone={handleDone}
            onBatch={(id) => {
              setBatchId(id);
              setConsumerStage("batch_selected");
            }}
            onPurchasePrepared={() => setConsumerStage("purchase_prepared")}
            onWalletPending={() => setConsumerStage("wallet_pending")}
            onReceiptVerified={() => setConsumerStage("receipt_verified")}
            afterSalesPrompt={afterSalesPrompt}
            onPromptConsumed={() => setAfterSalesPrompt("")}
            batchId={batchId}
          />
          {inQueryMode && <ProductPanel state={verifyState} batchId={batchId ?? ""} />}
          {inQueryMode && <EvidencePanel state={verifyState} batchId={batchId ?? "FO-2026-001"} focusTech={focusTech} />}
        </main>
        {inQueryMode && (
          <AfterSalesPanel
            onPrompt={(question) => {
              setConsumerStage("after_sales");
              setAfterSalesPrompt(question);
              window.setTimeout(() => document.getElementById("agent")?.scrollIntoView({ behavior: "smooth", block: "center" }), 0);
            }}
          />
        )}
        {inQueryMode && <ReportSection batchId={batchId} />}
        {inQueryMode && <Community onToast={showToast} onFeedbackSubmitted={() => setConsumerStage("feedback_submitted")} batchId={batchId} />}
        <ObserverDrawer open={observerOpen} onClose={() => setObserverOpen(false)} batchId={batchId} />
        <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} onAuth={handleAuth} configured={authConfigured} />
        <HistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} />
        {toast && (
          <div className="toast" role="status">
            {toast}
          </div>
        )}
      </WalletProvider>
    </ModalProvider>
  );
}
