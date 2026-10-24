import { useEffect, useRef, useState } from "react";
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
import { ConsumerExperiencePage } from "./components/ConsumerExperiencePage";
import { TenantSitePage } from "./components/TenantSitePage";
import { getTenantSite } from "./siteConfig";

export default function App() {
  const [toast, setToast] = useState<string | null>(null);
  const [observerOpen, setObserverOpen] = useState(false);
  const [verifyState, setVerifyState] = useState<VerifyState>("idle");
  const [batchId, setBatchId] = useState<string | null>(() => {
    const queryBatch = new URLSearchParams(window.location.search).get("batch")?.trim();
    if (queryBatch) return queryBatch.toUpperCase();
    try {
      return window.sessionStorage.getItem("truthpass.consumer.batch") || null;
    } catch {
      return null;
    }
  });
  const [authOpen, setAuthOpen] = useState(() => new URLSearchParams(window.location.search).get("auth") === "1");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [focusTech, setFocusTech] = useState(false);
  const [consumerStage, setConsumerStage] = useState<ConsumerAgentStage>("idle");
  const [afterSalesPrompt, setAfterSalesPrompt] = useState("");
  const { user, signUp, signIn, signOut, configured: authConfigured } = useAuth();
  const toastTimer = useRef<number | undefined>(undefined);
  const inQueryMode = !!batchId;
  const pathname = window.location.pathname;
  const tenantMatch = pathname.match(/^\/(en\/)?sites\/([^/]+)(?:\/([^/]+))?\/?$/);
  const tenantSite = tenantMatch ? getTenantSite(tenantMatch[2]) : null;
  const tenantLocale = tenantMatch?.[1] ? "en" : "zh";
  const tenantView = (tenantMatch?.[3] || "home") as "home" | "agent" | "wallet" | "merchant" | "institution" | "developers" | "preview";
  const tenantBatchQuery = new URLSearchParams(window.location.search).get("batch")?.trim().toUpperCase() || "";
  const tenantBatchPrefix = tenantSite?.batch.defaultBatchId.split("-")[0];
  const tenantActiveBatch = tenantSite && tenantBatchQuery.startsWith(`${tenantBatchPrefix}-`) ? tenantBatchQuery : tenantSite?.batch.defaultBatchId ?? null;
  const isMerchantRoute = pathname === "/merchant" || pathname === "/en/merchant";
  const isInstitutionRoute = pathname === "/institution" || pathname === "/en/institution";
  const queryParams = new URLSearchParams(window.location.search);
  // A QR/deep link normally carries only `?batch=...`. Treat that as the
  // focused consumer experience as well, otherwise a user who scans a batch
  // code without the legacy `view=consumer` flag falls back to the old
  // technical console. Explicit `view=console` remains available for the
  // internal legacy surface.
  const isConsumerView = queryParams.get("view") === "consumer" || (queryParams.has("batch") && queryParams.get("view") !== "console");
  const authRequested = new URLSearchParams(window.location.search).get("auth") === "1";
  const isPublicPageRoute = ["/", "/product", "/developers", "/en", "/en/product", "/en/developers", "/design-preview", "/cases/rice", "/en/cases/rice"].includes(pathname)
    && !authRequested
    && !((pathname === "/" || pathname === "/en") && isConsumerView);

  // Keep a deep link and a refresh on the same consumer batch. This makes the
  // evidence flow recoverable without turning the public landing page into a
  // long scrolling console.
  useEffect(() => {
    try {
      if (batchId) window.sessionStorage.setItem("truthpass.consumer.batch", batchId);
      else window.sessionStorage.removeItem("truthpass.consumer.batch");
    } catch {
      // Private browsing can disable sessionStorage; the in-memory flow still works.
    }
    if (isPublicPageRoute || pathname === "/merchant" || pathname === "/institution" || pathname === "/en/merchant" || pathname === "/en/institution") return;
    const url = new URL(window.location.href);
    if (batchId) url.searchParams.set("batch", batchId);
    else url.searchParams.delete("batch");
    url.searchParams.set("view", "consumer");
    url.searchParams.delete("auth");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, [batchId, isPublicPageRoute, pathname]);

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
              verdict: verification.status === "accepted" ? "在当前规则范围内" : "需要复核",
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
    if (pathname === "/cases/rice" || pathname === "/en/cases/rice") {
      const legacySite = getTenantSite("rice-demo")!;
      const legacyLocale = pathname.startsWith("/en/") ? "en" : "zh";
      const legacyBatchCandidate = new URLSearchParams(window.location.search).get("batch")?.trim().toUpperCase() || "";
      const legacyPrefix = legacySite.batch.defaultBatchId.split("-")[0];
      const legacyBatch = legacyBatchCandidate.startsWith(`${legacyPrefix}-`)
        ? legacyBatchCandidate
        : legacySite.batch.defaultBatchId;
      return (
        <ModalProvider>
          <WalletProvider activeBatchId={legacyBatch} onToast={showToast} locale={legacyLocale}>
            <TenantSitePage site={legacySite} view="home" locale={legacyLocale} />
            {toast && <div className="toast" role="status">{toast}</div>}
          </WalletProvider>
        </ModalProvider>
      );
    }
    return <PublicPageRouter pathname={pathname} />;
  }

  if (tenantMatch) {
    if (!tenantSite || !["home", "agent", "wallet", "merchant", "institution", "developers", "preview"].includes(tenantView)) {
      return <div className="tp-route-missing"><h1>404</h1><p>企业站点不存在，或页面还没有发布。</p><a href="/">回到 TruthPass</a></div>;
    }
    return (
      <ModalProvider>
          <WalletProvider activeBatchId={tenantActiveBatch} onToast={showToast} locale={tenantLocale as "zh" | "en"}>
          <TenantSitePage site={tenantSite} view={tenantView} locale={tenantLocale as "zh" | "en"} />
          {toast && <div className="toast" role="status">{toast}</div>}
        </WalletProvider>
      </ModalProvider>
    );
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

  // The public consumer query is a focused, plain-language experience. The
  // older evidence console remains available through the explicit /web-demo
  // entry point and is not used for the public batch flow.
  if ((pathname === "/" || pathname === "/en") && isConsumerView) {
    return (
      <ModalProvider>
        <WalletProvider activeBatchId={batchId} onToast={showToast}>
          <ConsumerExperiencePage
            locale={pathname === "/en" ? "en" : "zh"}
            batchId={batchId}
            verifyState={verifyState}
            stage={consumerStage}
            userEmail={user?.email ?? null}
            onOpenAuth={() => setAuthOpen(true)}
            onOpenHistory={() => setHistoryOpen(true)}
            onSignOut={signOut}
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
          />
          <AuthModal open={authOpen} onClose={() => setAuthOpen(false)} onAuth={handleAuth} configured={authConfigured} />
          <HistoryModal open={historyOpen} onClose={() => setHistoryOpen(false)} />
          {toast && <div className="toast" role="status">{toast}</div>}
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
        <ConsumerFlowBar stage={consumerStage} batchId={batchId} locale={pathname === "/en" ? "en" : "zh"} />
        <ConsumerActionDock stage={consumerStage} batchId={batchId} locale={pathname === "/en" ? "en" : "zh"} />
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
