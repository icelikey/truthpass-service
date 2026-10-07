import { useRef, useState } from "react";
import { ChatPanel } from "./components/ChatPanel";
import { Community } from "./components/Community";
import { EvidencePanel } from "./components/EvidencePanel";
import { Hero } from "./components/Hero";
import { ModalProvider } from "./components/ModalContext";
import { ObserverDrawer } from "./components/ObserverDrawer";
import { ProductPanel } from "./components/ProductPanel";
import { ReportSection } from "./components/ReportSection";
import { TopBar } from "./components/TopBar";
import type { VerifyState } from "./types";

export default function App() {
  const [toast, setToast] = useState<string | null>(null);
  const [observerOpen, setObserverOpen] = useState(false);
  const [verifyState, setVerifyState] = useState<VerifyState>("idle");
  const [batchId, setBatchId] = useState<string | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);

  const showToast = (msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2400);
  };

  return (
    <ModalProvider>
      <div className="bg-scene" aria-hidden="true">
        <div className="bg-rays" />
        <div className="bg-fish" />
        <div className="bg-depth" />
      </div>
      <TopBar onOpenObserver={() => setObserverOpen(true)} />
      <Hero />
      <main className="layout">
        <ChatPanel
          onStart={() => setVerifyState("running")}
          onDone={() => setVerifyState("done")}
          onBatch={(id) => setBatchId(id)}
        />
        <ProductPanel state={verifyState} batchId={batchId ?? ""} />
        <EvidencePanel state={verifyState} batchId={batchId ?? ""} />
      </main>
      <ReportSection batchId={batchId} />
      <Community onToast={showToast} batchId={batchId} />
      <ObserverDrawer open={observerOpen} onClose={() => setObserverOpen(false)} batchId={batchId} />
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </ModalProvider>
  );
}
