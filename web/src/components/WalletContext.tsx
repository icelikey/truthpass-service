import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { confirmChainTx, fetchChainStatus, fetchPaymentStatus, prepareWalletTx } from "../api";
import {
  BOT_CHAIN_NETWORK_PARAMS,
  discoverWalletOptions,
  ensureBotChainMainnet,
  shortHex,
  waitForTransactionReceipt,
  type Eip1193Provider,
  type WalletKind,
  type WalletOption,
} from "../lib/wallet";
import type { ChainStatusData, SessionChainTx, WalletActionKind } from "../types";

export type WalletRole = "consumer" | "producer" | "inspection" | "logistics" | "review" | "arbitration" | "enterprise_agent";
export const WALLET_ROLE_LABELS: Record<WalletRole, string> = {
  consumer: "消费者",
  producer: "生产方",
  inspection: "检测机构",
  logistics: "物流方",
  review: "审核机构",
  arbitration: "仲裁方",
  enterprise_agent: "企业 Agent",
};
const WALLET_ROLE_LABELS_EN: Record<WalletRole, string> = {
  consumer: "Consumer",
  producer: "Producer",
  inspection: "Inspection lab",
  logistics: "Logistics",
  review: "Reviewer",
  arbitration: "Arbitrator",
  enterprise_agent: "Enterprise Agent",
};

export interface WalletContextValue {
  address: string | null;
  chainId: number | null;
  walletName: string | null;
  walletKind: WalletKind | null;
  walletRole: WalletRole | null;
  bindingStatus: "unbound" | "binding" | "bound_verified" | "error";
  bindWalletRole: (role: WalletRole, tenantId?: string, authorizationToken?: string) => Promise<boolean>;
  connecting: boolean;
  txBusy: boolean;
  lastTx: SessionChainTx | null;
  chainStatus: ChainStatusData | undefined;
  walletModalOpen: boolean;
  setWalletModalOpen: (open: boolean) => void;
  connectWallet: (kind: WalletKind) => Promise<string | null>;
  switchToBotChain: () => Promise<boolean>;
  disconnectWallet: () => void;
  executeOnChainAction: (params: {
    action: WalletActionKind;
    batchId: string;
    purchaseId?: string;
    points?: number;
    reason?: string;
  }) => Promise<SessionChainTx>;
}

const WalletContext = createContext<WalletContextValue | null>(null);

export function useWallet(): WalletContextValue {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used inside WalletProvider");
  return ctx;
}

export function WalletProvider({
  children,
  activeBatchId,
  onToast,
  locale = "zh",
}: {
  children: ReactNode;
  activeBatchId: string | null;
  onToast: (msg: string) => void;
  locale?: "zh" | "en";
}) {
  const en = locale === "en";
  const queryClient = useQueryClient();
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [walletName, setWalletName] = useState<string | null>(null);
  const [walletKind, setWalletKind] = useState<WalletKind | null>(null);
  const [walletRole, setWalletRole] = useState<WalletRole | null>(null);
  const [bindingStatus, setBindingStatus] = useState<"unbound" | "binding" | "bound_verified" | "error">("unbound");
  // Selection is UI intent; walletKind is only set after a real provider
  // returns an authorized account. Keeping them separate prevents a failed
  // connection from being rendered as a connected wallet.
  const [selectedWalletKind, setSelectedWalletKind] = useState<WalletKind | null>(null);
  const [provider, setProvider] = useState<Eip1193Provider | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [txBusy, setTxBusy] = useState(false);
  const [lastTx, setLastTx] = useState<SessionChainTx | null>(null);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [options, setOptions] = useState<WalletOption[]>(() => discoverWalletOptions());
  const [txError, setTxError] = useState<string | null>(null);
  const [activeAction, setActiveAction] = useState<WalletActionKind | null>(null);
  const [txStage, setTxStage] = useState<{ step: number; label: string; detail?: string } | null>(null);
  const [selectedBatch, setSelectedBatch] = useState<string>(activeBatchId || "FO-2026-001");
  const [customNote, setCustomNote] = useState<string>("");
  const [txSeq, setTxSeq] = useState<number>(0);
  const [latestPurchaseId, setLatestPurchaseId] = useState<string | null>(null);

  useEffect(() => {
    if (activeBatchId) {
      setSelectedBatch(activeBatchId);
    }
  }, [activeBatchId]);

  // Tenant routes update the batch query with replaceState so the page does
  // not reload. Keep the wallet drawer's target batch in the same URL scope.
  useEffect(() => {
    const handleBatchChanged = (event: Event) => {
      const next = (event as CustomEvent<{ batchId?: unknown }>).detail?.batchId;
      if (typeof next === "string" && next.trim()) setSelectedBatch(next.trim().toUpperCase());
    };
    window.addEventListener("truthpass:batch-changed", handleBatchChanged);
    return () => window.removeEventListener("truthpass:batch-changed", handleBatchChanged);
  }, []);

  const { data: chainStatus } = useQuery({
    queryKey: ["chain-status"],
    queryFn: fetchChainStatus,
    staleTime: 10_000,
  });
  const { data: paymentStatus } = useQuery({
    queryKey: ["payment-status"],
    queryFn: fetchPaymentStatus,
    staleTime: 30_000,
  });

  useEffect(() => {
    const refresh = () => setOptions(discoverWalletOptions());
    refresh();
    const timer = window.setTimeout(refresh, 600);
    return () => window.clearTimeout(timer);
  }, [walletModalOpen]);

  useEffect(() => {
    if (!provider?.on) return;
    const handleAccountsChanged = (accounts: string[]) => {
      if (Array.isArray(accounts) && accounts.length > 0) {
        setAddress(accounts[0]);
        setWalletRole(null);
        setBindingStatus("unbound");
        setTxError("钱包账户已切换，请重新绑定身份");
        onToast("钱包账户已切换，请重新绑定身份");
      } else {
        setAddress(null);
        setWalletRole(null);
        setBindingStatus("unbound");
      }
    };
    const handleChainChanged = (hex: string) => {
      const parsed = parseInt(String(hex), 16);
      if (!Number.isNaN(parsed)) setChainId(parsed);
    };
    provider.on("accountsChanged", handleAccountsChanged);
    provider.on("chainChanged", handleChainChanged);
    return () => {
      provider.removeListener?.("accountsChanged", handleAccountsChanged);
      provider.removeListener?.("chainChanged", handleChainChanged);
    };
  }, [onToast, provider]);

  const connectWallet = useCallback(
    async (kind: WalletKind): Promise<string | null> => {
      setTxError(null);
      setSelectedWalletKind(kind);
      const discovered = discoverWalletOptions();
      setOptions(discovered);
      const target = discovered.find((o) => o.kind === kind);
      if (!target?.provider) {
        const requestedName = discovered.find((o) => o.kind === kind)?.name ?? kind;
        const message = `未检测到 ${requestedName} 插件。请安装 MetaMask、OKX Wallet 或 Binance Wallet 后重试。`;
        setTxError(message);
        onToast(message);
        return null;
      }

      setConnecting(true);
      try {
        const accounts = (await Promise.race([
          target.provider.request({ method: "eth_requestAccounts" }),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("钱包插件响应超时，请点击浏览器右上角钱包图标确认授权弹窗")), 12_000),
          ),
        ])) as string[];
        if (!Array.isArray(accounts) || accounts.length === 0) {
          throw new Error("未获取到钱包账户授权");
        }
        const connectedAddr = accounts[0];
        setProvider(target.provider);
        setAddress(connectedAddr);
        setWalletName(target.name);
        setWalletKind(target.kind);

        try {
          const rawChainHex = (await target.provider.request({ method: "eth_chainId" })) as string;
          const currentChain = parseInt(rawChainHex, 16);
          if (!Number.isNaN(currentChain)) setChainId(currentChain);
        } catch {
          // ignore
        }

        onToast(`已连接 ${target.name} (${shortHex(connectedAddr)})`);

        const switchedChainId = await Promise.race([
          ensureBotChainMainnet(target.provider),
          new Promise<number>((_, reject) => setTimeout(() => reject(new Error("切换 BOT Chain 网络超时，请在钱包中手动切换到 Chain ID 677")), 8_000)),
        ]);
        setChainId(switchedChainId);
        if (switchedChainId !== BOT_CHAIN_NETWORK_PARAMS.chainIdDec) {
          throw new Error(`当前网络 Chain ID 为 ${switchedChainId}，需要切换到 BOT Chain 677`);
        }
        onToast(`已切换至 BOT Chain Mainnet (Chain ID: ${switchedChainId})`);

        return connectedAddr;
      } catch (err: any) {
        const message = err?.message || "连接钱包被拒绝或失败";
        setTxError(message);
        onToast(`钱包连接提示：${message}`);
        return null;
      } finally {
        setConnecting(false);
      }
    },
    [onToast],
  );

  const switchToBotChain = useCallback(async (): Promise<boolean> => {
    if (!provider) {
      const msg = "请先连接 MetaMask、OKX Wallet 或 Binance Wallet";
      setTxError(msg);
      onToast(msg);
      return false;
    }
    try {
      const updated = await Promise.race([
        ensureBotChainMainnet(provider),
        new Promise<number>((_, reject) =>
          setTimeout(
            () =>
              reject(
                new Error(
                  "BOT Chain 节点响应超时，请在钱包中手动切换到 Chain ID 677",
                ),
              ),
            5_000,
          ),
        ),
      ]);
      setChainId(updated);
      onToast("已切换至 BOT Chain Mainnet (Chain ID: 677)");
      return updated === BOT_CHAIN_NETWORK_PARAMS.chainIdDec;
    } catch (err: any) {
      const msg = err?.message || "切换网络超时";
      setTxError(msg);
      onToast(msg);
      return false;
    }
  }, [provider, onToast]);

  const disconnectWallet = useCallback(() => {
    setAddress(null);
    setChainId(null);
    setWalletName(null);
    setWalletKind(null);
    setWalletRole(null);
    setBindingStatus("unbound");
    setSelectedWalletKind(null);
    setProvider(null);
    setLatestPurchaseId(null);
    setTxError(null);
    setTxStage(null);
    onToast("已断开钱包连接");
  }, [onToast]);

  const bindWalletRole = useCallback(async (role: WalletRole, tenantId = "demo", authorizationToken?: string): Promise<boolean> => {
    if (!provider || !address) {
      const msg = "请先连接真实钱包，再绑定身份";
      setTxError(msg);
      onToast(msg);
      return false;
    }
    setBindingStatus("binding");
    setTxError(null);
    try {
      const query = new URLSearchParams({ address, tenantId, role });
      const challengeResponse = await fetch(`/api/wallet/bind/challenge?${query.toString()}`);
      const challenge = await challengeResponse.json() as { message?: string; error?: string };
      if (!challengeResponse.ok || !challenge.message) throw new Error(challenge.error || "身份绑定挑战获取失败");
      const signature = await provider.request({ method: "personal_sign", params: [challenge.message, address] }) as string;
      const bindResponse = await fetch("/api/wallet/bind", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address, tenantId, role, message: challenge.message, signature, ...(authorizationToken ? { authorizationToken } : {}) }),
      });
      const bound = await bindResponse.json() as { status?: string; error?: string };
      if (!bindResponse.ok || bound.status !== "bound_verified") throw new Error(bound.error || "身份绑定失败");
      setWalletRole(role);
      setBindingStatus("bound_verified");
      onToast(`已验证并绑定身份：${WALLET_ROLE_LABELS[role]}`);
      return true;
    } catch (err: any) {
      const message = err?.message || "身份签名被拒绝或失败";
      setBindingStatus("error");
      setTxError(message);
      onToast(`钱包身份绑定提示：${message}`);
      return false;
    }
  }, [address, onToast, provider]);

  const executeOnChainAction = useCallback(
    async (params: {
      action: WalletActionKind;
      batchId: string;
      purchaseId?: string;
      challengeId?: string;
      points?: number;
      reason?: string;
    }): Promise<SessionChainTx> => {
      setTxError(null);
      setActiveAction(params.action);
      const allowedRoles: Partial<Record<WalletActionKind, WalletRole[]>> = {
        purchase: ["consumer"],
        contribution: ["consumer"],
        dispute: ["consumer"],
        evidence: ["producer", "inspection", "logistics"],
        verification: ["review"],
        audit_finding: ["review"],
        audit_approval: ["review"],
        resolve_challenge: ["arbitration"],
      };
      const requiredRoles = allowedRoles[params.action];
      if (requiredRoles && !walletRole || (requiredRoles && walletRole && !requiredRoles.includes(walletRole))) {
        const expected = requiredRoles.map((role) => WALLET_ROLE_LABELS[role]).join(" / ");
        const message = `请先绑定对应身份：${expected}`;
        setTxError(message);
        onToast(message);
        setActiveAction(null);
        throw new Error(message);
      }
      if (!provider || !address) {
        const message = "请先连接真实 EVM 钱包；未检测到插件时只提供只读演示，不能发起主网交易。";
        setTxError(message);
        onToast(message);
        setActiveAction(null);
        throw new Error(message);
      }

      setTxBusy(true);
      try {
        setTxStage({ step: 1, label: en ? "Step 1/3 · Preparing the mainnet transaction…" : "第 1/3 步 · 正在准备真实主网交易…", detail: `${en ? "Batch " : "批次 "}${params.batchId}` });
        const ensuredChainId = await ensureBotChainMainnet(provider);
        setChainId(ensuredChainId);
        if (ensuredChainId !== BOT_CHAIN_NETWORK_PARAMS.chainIdDec) {
          throw new Error(`当前网络 Chain ID 为 ${ensuredChainId}，需要 BOT Chain 677`);
        }
        const prepared = await prepareWalletTx({
          action: params.action,
          batchId: params.batchId,
          wallet: address,
          purchaseId: params.purchaseId ?? (params.action === "contribution" ? latestPurchaseId ?? undefined : undefined),
          challengeId: params.challengeId,
          points: params.points,
          reason: params.reason,
        });
        const txReq = prepared.txRequest;
        const eventName = prepared.event;
        const calldataHex = txReq.data;
        setTxStage({
          step: 2,
          label: en ? `Step 2/3 · Confirm the transaction in ${walletName ?? "your wallet"} and pay BOT Gas…` : `第 2/3 步 · 请在 ${walletName ?? "钱包"} 中确认交易并支付 BOT Gas…`,
          detail: `${en ? "Target " : "目标 "}${shortHex(txReq.to, 10, 8)} · ${prepared.description}`,
        });
        const txHash = (await provider.request({
          method: "eth_sendTransaction",
          params: [{ from: address, to: txReq.to, data: txReq.data, value: txReq.value }],
        })) as string;
        if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) throw new Error("钱包返回了无效交易哈希");
        setTxStage({ step: 3, label: en ? "Step 3/3 · Waiting for the BOT Chain Mainnet receipt…" : "第 3/3 步 · 等待 BOT Chain Mainnet 回执…", detail: shortHex(txHash, 12, 8) });
        const receipt = await waitForTransactionReceipt(provider, txHash, 80, 1500);
        if (!receipt || receipt.status !== 1) throw new Error("交易未确认成功，请检查钱包余额、网络或回执状态");
        const confirmed = await confirmChainTx({
          action: params.action,
          event: eventName,
          batchId: params.batchId,
          wallet: address,
          providerName: walletName ?? "EVM Wallet",
          contractAddress: prepared.contractAddress,
          txHash,
          blockNumber: receipt.blockNumber,
          calldata: calldataHex,
          mode: "wallet_broadcast",
          ids: prepared.ids,
        });
        setLastTx(confirmed.transaction);
        window.dispatchEvent(new CustomEvent("truthpass:lifecycle-updated", { detail: { batchId: params.batchId, action: params.action } }));
        if (params.action === "purchase" && typeof prepared.ids?.purchaseId === "string") {
          setLatestPurchaseId(prepared.ids.purchaseId);
        }
        setTxSeq((n) => n + 1);
        setTxStage(null);
        void queryClient.invalidateQueries({ queryKey: ["chain-status"] });
        void queryClient.invalidateQueries({ queryKey: ["observer"] });
        onToast(`✓ 主网 receipt 与业务事件已确认 (${eventName}) · ${shortHex(txHash, 12, 8)}`);
        return confirmed.transaction;
      } catch (err: any) {
        setTxStage(null);
        const msg = err?.message || "链上交易签名或广播失败";
        setTxError(msg);
        onToast(`链上交互提示：${msg}`);
        throw err;
      } finally {
        setTxBusy(false);
        setActiveAction(null);
      }
    },
    [provider, address, walletName, walletRole, latestPurchaseId, onToast, queryClient],
  );

  const targetBatch = selectedBatch || activeBatchId || "FO-2026-001";
  const walletReady = Boolean(address && chainId === BOT_CHAIN_NETWORK_PARAMS.chainIdDec && walletRole);
  const walletNextStep = !address
    ? (en ? "Choose a wallet to connect" : "选择一个钱包开始连接")
    : bindingStatus !== "bound_verified"
      ? (en ? "Choose an identity and sign the binding" : "选择身份并完成签名绑定")
      : chainId !== BOT_CHAIN_NETWORK_PARAMS.chainIdDec
        ? (en ? "Switch to BOT Chain Mainnet (Chain ID 677)" : "切换到 BOT Chain Mainnet (Chain ID 677)")
        : txBusy
          ? (en ? "Waiting for wallet confirmation and mainnet receipt" : "等待钱包确认并核验主网回执")
          : (en ? "Return to the page for the next action" : "回到页面继续下一步操作");
  // Keep the technical transaction selector inside the active tenant's
  // batch namespace. A rice tenant must never be offered fish-oil batches
  // (and vice versa), even though this modal is shared by every site.
  const batchSeed = activeBatchId || selectedBatch || "FO-2026-001";
  const batchMatch = /^([A-Z]+)-(\d{4})-(\d+)$/.exec(batchSeed);
  const batchPrefix = batchMatch?.[1] ?? "FO";
  const batchYear = batchMatch?.[2] ?? "2026";
  const batchWidth = Math.max(3, batchMatch?.[3]?.length ?? 3);
  const batchOptions = Array.from({ length: 8 }, (_, index) =>
    `${batchPrefix}-${batchYear}-${String(index + 1).padStart(batchWidth, "0")}`,
  );

  return (
    <WalletContext.Provider
      value={{
        address,
        chainId,
        walletName,
        walletKind,
        walletRole,
        bindingStatus,
        bindWalletRole,
        connecting,
        txBusy,
        lastTx,
        chainStatus,
        walletModalOpen,
        setWalletModalOpen,
        connectWallet,
        switchToBotChain,
        disconnectWallet,
        executeOnChainAction,
      }}
    >
      {children}
      {walletModalOpen && (
        <div className="modal-backdrop" onClick={() => setWalletModalOpen(false)}>
          <div className="modal-card wallet-modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="wallet-modal-header">
              <div>
                <span className="wallet-eyebrow">BOT CHAIN MAINNET · CHAIN ID 677 (0x2a5)</span>
                <h3>{en ? "Connect your wallet" : "连接你的钱包"}</h3>
              </div>
              <button className="close-button" type="button" onClick={() => setWalletModalOpen(false)} aria-label={en ? "Close" : "关闭"}>
                ×
              </button>
            </div>

            <p className="wallet-modal-desc">
              {en ? <>Connect <strong>MetaMask</strong>, <strong>OKX Wallet</strong>, or <strong>Binance Wallet</strong>, then follow the prompts to bind an identity and check the network. Every on-chain action is confirmed in your own wallet.</> : <>连接 <strong>MetaMask</strong>、<strong>OKX Wallet</strong> 或 <strong>Binance Wallet</strong> 后，按提示完成身份绑定和网络检查。每次上链操作都会在你自己的钱包里确认。</>}
            </p>
            <p className="wallet-custody-note">{en ? "TruthPass never creates or holds a wallet for you; use a wallet you control." : "TruthPass 不会自动创建或托管钱包；请使用你自己控制的钱包。"}</p>

            <div className="wallet-summary-grid" aria-label={en ? "Wallet status summary" : "钱包状态摘要"}>
              <div className="wallet-summary-item">
                <span>{en ? "Connection" : "连接"}</span>
                <strong>{address ? `${walletName ?? (en ? "EVM wallet" : "EVM 钱包")} · ${shortHex(address)}` : (en ? "Not connected" : "尚未连接")}</strong>
              </div>
              <div className="wallet-summary-item">
                <span>{en ? "Identity" : "身份"}</span>
                <strong>{bindingStatus === "bound_verified" && walletRole ? (en ? WALLET_ROLE_LABELS_EN[walletRole] : WALLET_ROLE_LABELS[walletRole]) : (en ? "Not bound" : "待绑定")}</strong>
              </div>
              <div className="wallet-summary-item">
                <span>{en ? "Network" : "网络"}</span>
                <strong>{chainId === BOT_CHAIN_NETWORK_PARAMS.chainIdDec ? "BOT Chain · 677" : address ? (en ? `Chain 677 required (current ${chainId ?? "unknown"})` : `需要 Chain 677（当前 ${chainId ?? "未知"}）`) : (en ? "Checked after connection" : "连接后检查")}</strong>
              </div>
              <div className="wallet-summary-item wallet-summary-next">
                <span>{en ? "Next step" : "下一步"}</span>
                <strong>{walletNextStep}</strong>
              </div>
            </div>
            {(txStage || txError) && (
              <div className={txError ? "wallet-next-step-status error" : "wallet-next-step-status"} role={txError ? "alert" : "status"}>
                <strong>{txError ? (en ? "Action required" : "需要处理") : (en ? "Current progress" : "当前进度")}</strong>
                <span>{txError ?? txStage?.label}</span>
              </div>
            )}

            <div className="wallet-payment-status" role="status" aria-label={en ? "Payment provider status" : "支付方式状态"}>
              <div className="wallet-section-head">
                <div>
                  <b>{en ? "Payment options" : "支付方式"}</b>
                  <small>{en ? "Payment gateway status is separate from wallet and chain receipt status." : "支付网关状态与钱包、链上 receipt 分开核验。"}</small>
                </div>
                <span className="wallet-disconnected-pill">{en ? "No false success" : "未收到回执不显示成功"}</span>
              </div>
              <div className="wallet-payment-grid">
                {(paymentStatus?.providers ?? [
                  { provider: "alipay" as const, configured: false, mode: "unconfigured" as const },
                  { provider: "paypal" as const, configured: false, mode: "unconfigured" as const },
                ]).map((provider) => {
                  const label = provider.provider === "alipay" ? "支付宝" : "PayPal";
                  const labelEn = provider.provider === "alipay" ? "Alipay" : "PayPal";
                  return (
                    <div className={`wallet-payment-provider ${provider.configured ? "configured" : "unconfigured"}`} key={provider.provider}>
                      <strong>{en ? labelEn : label}</strong>
                      <span>{provider.configured ? (en ? `Configured · ${provider.mode}` : `已配置 · ${provider.mode}`) : (en ? "Not configured" : "尚未配置")}</span>
                      {!provider.configured && provider.missing?.length ? <small>{en ? "Missing server configuration" : "缺少服务端配置"}</small> : null}
                    </div>
                  );
                })}
              </div>
              <small className="wallet-payment-note">{en ? "A payment provider callback alone does not create a blockchain purchase record. The purchase still needs the external wallet flow and a verified receipt." : "支付平台回调本身不会创建链上购买记录；购买仍需要外部钱包流程和真实 receipt 核验。"}</small>
            </div>

            <div className="wallet-identity-card">
              <div className="wallet-section-head">
                <div>
                  <b>{en ? "Confirm who you represent" : "先确认你代表谁"}</b>
                  <small>{en ? "A signature proves control of this wallet only; it does not transfer funds. After binding, available actions are shown for this identity." : "签名只证明当前钱包的控制权，不会发起转账。绑定后，页面会按身份显示可做的事。"}</small>
                </div>
                <span className={bindingStatus === "bound_verified" ? "wallet-connected-pill" : "wallet-disconnected-pill"}>
                  {bindingStatus === "bound_verified" ? `✓ ${en ? "Bound: " : "已绑定："}${walletRole ? (en ? WALLET_ROLE_LABELS_EN[walletRole] : WALLET_ROLE_LABELS[walletRole]) : (en ? "Verified" : "已验证")}` : (en ? "Identity not bound" : "尚未绑定身份")}
                </span>
              </div>
              <div className="wallet-role-picker" role="list" aria-label={en ? "Choose wallet identity" : "选择钱包身份"}>
                {(Object.keys(WALLET_ROLE_LABELS) as WalletRole[]).map((role) => (
                  <button
                    key={role}
                    type="button"
                    className={walletRole === role ? "wallet-role-chip active" : "wallet-role-chip"}
                    disabled={!address || bindingStatus === "binding"}
                    onClick={() => void bindWalletRole(role)}
                  >
                    {en ? WALLET_ROLE_LABELS_EN[role] : WALLET_ROLE_LABELS[role]}
                  </button>
                ))}
              </div>
              <small className="wallet-binding-note">
                {bindingStatus === "binding" ? (en ? "Confirm the identity signature in your wallet…" : "请在钱包弹窗中确认身份签名…") : bindingStatus === "error" ? (en ? "Binding did not complete. Choose an identity and sign again." : "绑定未完成，请重新选择身份并签名。") : (en ? "Actions require the corresponding identity permission." : "没有对应身份权限时，相关操作不会完成。")}
              </small>
            </div>

            {/* 1. 钱包选择器 */}
            <div className="wallet-section">
              <div className="wallet-section-head">
                <b>{en ? "1. Choose and connect an EVM wallet" : "1. 选择并连接 EVM 钱包"}</b>
                {address ? (
                  <span className="wallet-connected-pill">
                    ● {en ? "Connected" : "已连接"} {walletName} · {shortHex(address)} · Chain {chainId ?? 677}
                  </span>
                ) : (
                  <span className="wallet-disconnected-pill">{en ? "Not connected or bound (actions unlock after binding)" : "未连接或未绑定身份（绑定后才会启用对应操作）"}</span>
                )}
              </div>
              <div className="wallet-grid">
                {options.map((opt) => {
                  const isSelected = selectedWalletKind === opt.kind;
                  const isConnected = Boolean(address && walletKind === opt.kind);
                  return (
                    <div key={opt.kind} className="wallet-option-wrap">
                      <button
                        type="button"
                        className={isSelected ? "wallet-option-btn active" : "wallet-option-btn"}
                        disabled={connecting}
                        onClick={() => connectWallet(opt.kind)}
                      >
                        <div className="wallet-option-top">
                          <strong>{opt.name}</strong>
                          <span className={opt.detected ? "wallet-badge detected" : "wallet-badge"}>
                            {isConnected
                              ? (en ? "✓ Connected" : "✓ 当前已连接")
                              : connecting && isSelected
                                ? (en ? "⏳ Requesting authorization…" : "⏳ 正在请求授权…")
                                : isSelected
                                ? (en ? "Selected" : "已选中")
                                  : opt.detected
                                    ? (en ? "Extension detected" : "已检测到插件")
                                    : (en ? "Extension not detected" : "未检测到插件")}
                          </span>
                        </div>
                        <small>{opt.subtitle}</small>
                      </button>
                      {!opt.detected && <a className="wallet-install-link" href={opt.installUrl} target="_blank" rel="noreferrer">
                        {en ? "Install " : "安装 "}{opt.name} {en ? "extension" : "插件"} ↗
                      </a>}
                    </div>
                  );
                })}
              </div>
              {!options.some((option) => option.detected) && (
                <div className="wallet-plugin-notice" role="status">
                  <div>
                    <strong>{en ? "No wallet extension detected" : "未检测到钱包插件"}</strong>
                    <small>{en ? "Install an official extension, then return here to detect it again." : "先安装官方插件，安装完成后回到这里重新检测。"}</small>
                    <div className="wallet-install-actions" aria-label={en ? "Official wallet installation links" : "官方钱包安装入口"}>
                      {options
                        .filter((option) => option.kind === "metamask" || option.kind === "okx" || option.kind === "binance")
                        .map((option) => (
                          <a key={option.kind} className="wallet-install-cta" href={option.installUrl} target="_blank" rel="noreferrer">
                            {en ? "Install " : "安装 "}{option.name} ↗
                          </a>
                        ))}
                    </div>
                  </div>
                  <button type="button" className="wallet-action-ghost" onClick={() => setOptions(discoverWalletOptions())}>{en ? "Detect extensions again" : "重新检测插件"}</button>
                </div>
              )}
              {address && (
                <div className="wallet-bar-actions">
                  {chainId !== 677 && (
                    <button type="button" className="wallet-action-primary" onClick={switchToBotChain}>
                      {en ? "Switch wallet network to BOT Chain Mainnet (Chain ID 677)" : "切换钱包网络至 BOT Chain Mainnet (Chain ID 677)"}
                    </button>
                  )}
                  <button type="button" className="wallet-action-ghost" onClick={disconnectWallet}>
                    {en ? "Disconnect wallet" : "断开钱包"} ({shortHex(address)})
                  </button>
                </div>
              )}
            </div>

            <details className="wallet-technical-details">
              <summary>{en ? "Technical details (chain actions, contract, calldata, batch, and mainnet record)" : "技术详情（链上操作、合约、Calldata、目标批次、主网记录）"}</summary>
              <div className="wallet-technical-body">
                {/* 2. 真实产品功能链上交互 */}
                <div className="wallet-section">
              <div className="wallet-section-head">
                <b>{en ? "2. Product confirmation and disputes" : "2. 商品确认和争议处理"}</b>
                <span>
                  {en ? "Contract: TruthPassConsumerGateway (" : "合约：TruthPassConsumerGateway ("}
                  {shortHex(chainStatus?.contracts.consumerGateway.address ?? "0x5192484B107E51EADFda4DBF4c9fFa41C03453F1")}
                  )
                </span>
              </div>

              {/* 交互参数与签名模式控制栏 */}
              <div className="wallet-interact-controls">
                <label className="wallet-control-field">
                  <span>{en ? "Batch to verify" : "目标核验批次"}</span>
                  <select
                    value={targetBatch}
                    onChange={(e) => setSelectedBatch(e.target.value)}
                    disabled={txBusy}
                  >
                    {batchOptions.map((b) => (
                      <option key={b} value={b}>
                        {b}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="wallet-control-field wallet-control-grow">
                  <span>{en ? "On-chain note / dispute ID (optional; encoded in contract calldata)" : "上链备注 / 争议编号（可选，将编码进合约 Calldata）"}</span>
                  <input
                    type="text"
                    value={customNote}
                    onChange={(e) => setCustomNote(e.target.value)}
                    placeholder={en ? `For example: ${targetBatch} delivery scan / challengeId or recheck note` : `例如：${targetBatch} 消费者收货扫码核验 / challengeId 或复检说明`}
                    disabled={txBusy}
                  />
                </label>

                <div className="wallet-control-field">
                  <span>{en ? "Action mode" : "交互模式"}</span>
                  <strong>{en ? "⛓️ Real wallet broadcast (BOT Chain gas required)" : "⛓️ 真实钱包广播（需要 BOT Chain Gas）"}</strong>
                </div>
              </div>

              <div className="wallet-tx-actions">
                <button
                  type="button"
                  className={activeAction === "purchase" ? "wallet-tx-btn running" : "wallet-tx-btn"}
                  disabled={!walletReady || txBusy}
                  onClick={() =>
                    executeOnChainAction({
                      action: "purchase",
                      batchId: targetBatch,
                      purchaseId: customNote.trim() ? `ORD-${targetBatch}-${customNote.trim()}` : undefined,
                    }).catch(() => undefined)
                  }
                >
                  <strong>
                    {activeAction === "purchase" ? (en ? "⏳ Confirming purchase record…" : "⏳ 正在确认购买记录…") : (en ? "🛒 1. Confirm purchase record" : "🛒 1. 确认购买记录")}
                  </strong>
                   <small>{en ? "Link this purchase to the current batch." : "把本次购买和当前批次关联起来。"}</small>
                  <span className="wallet-tx-cta">{en ? "Confirm wallet action →" : "确认钱包操作 →"}</span>
                </button>

                <button
                  type="button"
                  className={activeAction === "contribution" ? "wallet-tx-btn running" : "wallet-tx-btn"}
                  disabled={!walletReady || txBusy || !latestPurchaseId}
                  onClick={() =>
                    executeOnChainAction({
                      action: "contribution",
                      batchId: targetBatch,
                        purchaseId: latestPurchaseId ?? undefined,
                      points: 20,
                    }).catch(() => undefined)
                  }
                >
                  <strong>
                    {activeAction === "contribution" ? (en ? "⏳ Submitting feedback…" : "⏳ 正在提交反馈…") : (en ? "💬 2. Submit purchase feedback" : "💬 2. 提交购买反馈")}
                  </strong>
                   <small>{latestPurchaseId ? (en ? "Link your feedback to the verified purchase." : "把你的反馈和已确认的购买关联起来。") : (en ? "Confirm the purchase record first." : "请先完成购买记录确认。")}</small>
                  <span className="wallet-tx-cta">{en ? "Confirm wallet action →" : "确认钱包操作 →"}</span>
                </button>

                <button
                  type="button"
                  className={activeAction === "dispute" ? "wallet-tx-btn running" : "wallet-tx-btn"}
                  disabled={!walletReady || txBusy}
                  onClick={() =>
                    executeOnChainAction({
                      action: "dispute",
                      batchId: targetBatch,
                      reason:
                        customNote.trim() || `Consumer quality audit request for ${targetBatch}`,
                    }).catch(() => undefined)
                  }
                >
                  <strong>
                    {activeAction === "dispute" ? (en ? "⏳ Submitting review request…" : "⏳ 正在提交复核申请…") : (en ? "⚠️ 3. Request human review" : "⚠️ 3. 申请人工复核")}
                  </strong>
                   <small>{en ? "Submit an append-only review request when the record looks wrong." : "当你认为资料有问题时，提交一份不可静默删除的复核申请。"}</small>
                  <span className="wallet-tx-cta">{en ? "Confirm wallet action →" : "确认钱包操作 →"}</span>
                </button>
              </div>

              <div className="wallet-role-actions">
                <div className="wallet-role-actions-head">
                  <div>
                    <strong>{en ? "Institution and review wallets" : "机构和审核钱包"}</strong>
                    <small>{en ? "These are institution actions, not consumer purchases. A public record is left only after the matching role confirms; without permission, the transaction does not complete." : "这些操作不是消费者购买。对应机构确认后，页面会留下可查看的公开记录；没有对应权限时，交易不会完成。"}</small>
                  </div>
                  <span>{en ? "Producer · inspection lab · reviewer · arbitrator" : "生产方 · 检测机构 · 审核方 · 仲裁方"}</span>
                </div>
                <div className="wallet-role-action-grid">
                  <button type="button" className={activeAction === "evidence" ? "wallet-tx-btn running" : "wallet-tx-btn"} disabled={!walletReady || txBusy} onClick={() => executeOnChainAction({ action: "evidence", batchId: targetBatch }).catch(() => undefined)}>
                    <strong>{activeAction === "evidence" ? (en ? "⏳ Anchoring evidence…" : "⏳ 正在锚定证据…") : (en ? "🏭 Producer / lab: anchor evidence" : "🏭 生产方 / 检测机构：锚定证据")}</strong>
                    <small>{en ? "Confirm that this production or inspection record came from the institution." : "确认这份生产或检测资料确实由本机构提供。"}</small>
                    <span className="wallet-tx-cta">{en ? "Leave a public record →" : "确认后留下公开记录 →"}</span>
                  </button>
                  <button type="button" className={activeAction === "verification" ? "wallet-tx-btn running" : "wallet-tx-btn"} disabled={!walletReady || txBusy} onClick={() => executeOnChainAction({ action: "verification", batchId: targetBatch }).catch(() => undefined)}>
                    <strong>{activeAction === "verification" ? (en ? "⏳ Submitting verification…" : "⏳ 正在提交核验…") : (en ? "⚖️ Reviewer: submit verification" : "⚖️ 监管 / 审核机构：提交核验")}</strong>
                    <small>{en ? "Confirm that the review result belongs to this batch." : "确认审核结果和当前批次对应。"}</small>
                    <span className="wallet-tx-cta">{en ? "Reviewer confirmation →" : "审核方确认 →"}</span>
                  </button>
                  <button type="button" className={activeAction === "audit_finding" ? "wallet-tx-btn running" : "wallet-tx-btn"} disabled={!walletReady || txBusy} onClick={() => executeOnChainAction({ action: "audit_finding", batchId: targetBatch, challengeId: customNote.trim() || undefined }).catch(() => undefined)}>
                    <strong>{activeAction === "audit_finding" ? (en ? "⏳ Submitting audit finding…" : "⏳ 正在提交调查发现…") : (en ? "🔎 Audit Agent: submit finding" : "🔎 审核 Agent：提交调查发现")}</strong>
                    <small>{en ? "Record the investigation finding for the disputed evidence." : "记录对争议资料的调查发现。"}</small>
                    <span className="wallet-tx-cta">{en ? "Continue after linking a dispute →" : "绑定争议后继续 →"}</span>
                  </button>
                  <button type="button" className={activeAction === "audit_approval" ? "wallet-tx-btn running" : "wallet-tx-btn"} disabled={!walletReady || txBusy} onClick={() => executeOnChainAction({ action: "audit_approval", batchId: targetBatch, challengeId: customNote.trim() || undefined }).catch(() => undefined)}>
                    <strong>{activeAction === "audit_approval" ? (en ? "⏳ Approving finding…" : "⏳ 正在批准发现…") : (en ? "⚖️ Reviewer: approve finding" : "⚖️ 监管机构：批准调查发现")}</strong>
                    <small>{en ? "Approve the audit finding for final handling." : "批准调查意见，进入最终处理。"}</small>
                    <span className="wallet-tx-cta">{en ? "Reviewer confirmation →" : "审核方确认 →"}</span>
                  </button>
                  <button type="button" className={activeAction === "resolve_challenge" ? "wallet-tx-btn running" : "wallet-tx-btn"} disabled={!walletReady || txBusy} onClick={() => executeOnChainAction({ action: "resolve_challenge", batchId: targetBatch, challengeId: customNote.trim() || undefined }).catch(() => undefined)}>
                    <strong>{activeAction === "resolve_challenge" ? (en ? "⏳ Submitting ruling…" : "⏳ 正在提交裁决…") : (en ? "⚖️ Arbitrator: resolve dispute" : "⚖️ 仲裁机构：结案裁决")}</strong>
                    <small>{en ? "Record the dispute resolution and close the case." : "给出争议处理结果并结束流程。"}</small>
                    <span className="wallet-tx-cta">{en ? "Arbitrator confirmation →" : "仲裁方确认 →"}</span>
                  </button>
                </div>
              </div>

              {/* 实时步骤进度条 */}
              {txStage && (
                <div className="wallet-stage-box">
                  <div className="wallet-stage-top">
                    <span className="wallet-spinner" />
                    <strong>{txStage.label}</strong>
                  </div>
                  {txStage.detail && <small>{txStage.detail}</small>}
                </div>
              )}

              {txError && <div className="wallet-error-box">💡 {txError}</div>}

              {/* 最新上链交易回执详情卡片 */}
              {lastTx && (
                <div className="wallet-receipt-box" key={lastTx.id || txSeq}>
                  <div className="wallet-receipt-main">
                    <div className="wallet-receipt-head">
                      <span className="wallet-receipt-badge">✓ {en ? `Public record verified #${txSeq}` : `公开记录已确认 #${txSeq}`}</span>
                      <strong>
                        {en ? "Batch " : "批次 "}{lastTx.batchId} · {lastTx.event === "PurchaseRecorded" ? (en ? "Purchase record" : "购买记录") : lastTx.event === "VerificationRecorded" ? (en ? "Review record" : "审核记录") : lastTx.event === "EvidenceAnchored" ? (en ? "Evidence record" : "资料记录") : (en ? "Processing record" : "处理记录")}
                      </strong>
                      <small>{new Date(lastTx.createdAt).toLocaleTimeString()}</small>
                    </div>
                    <div className="wallet-receipt-meta">
                      <span>
                        {en ? "Confirming wallet: " : "确认钱包："}<code>{shortHex(lastTx.wallet, 8, 6)}</code> ({lastTx.providerName})
                      </span>
                      <span>
                        {en ? "Public record location: " : "公开记录位置："}<code>{shortHex(lastTx.contractAddress, 8, 6)}</code>
                      </span>
                      <span>
                        {en ? "Mainnet block: " : "主网区块："}<code>{lastTx.blockNumber !== undefined ? `#${lastTx.blockNumber}` : (en ? "Receipt returned no block" : "回执未返回区块号")}</code>
                      </span>
                    </div>
                    {lastTx.calldata && (
                      <div className="wallet-receipt-code">
                        <span>{en ? "Contract ABI calldata:" : "合约 ABI Calldata:"}</span>
                        <code>{shortHex(lastTx.calldata, 28, 12)}</code>
                      </div>
                    )}
                    {lastTx.signature && (
                      <div className="wallet-receipt-code">
                        <span>{en ? "Wallet signature:" : "钱包签名回执 (Sig):"}</span>
                        <code>{shortHex(lastTx.signature, 24, 12)}</code>
                      </div>
                    )}
                    <div className="wallet-receipt-code">
                      <span>{en ? "BOT Chain mainnet tx hash:" : "BOT Chain 主网交易哈希:"}</span>
                      <code>{lastTx.txHash}</code>
                    </div>
                  </div>
                  <a href={lastTx.explorerUrl} target="_blank" rel="noreferrer" className="explorer-link-btn">
                    {en ? "Verify in BOT Chain explorer ↗" : "在 BOT Chain 浏览器核验 ↗"}
                  </a>
                </div>
              )}
                </div>

                {/* 3. BOT Chain Mainnet (677) 主网已部署合约与可验证交易记录 */}
                <div className="wallet-section">
              <div className="wallet-section-head">
                <b>{en ? "3. Public record lookup" : "3. 公开记录查询"}</b>
                <span>
                  RPC:{" "}
                  <strong className={chainStatus?.liveRpc?.reachable ? "green-text" : "amber-text"}>
                    {chainStatus?.liveRpc?.reachable
                      ? (en ? `Online${chainStatus.liveRpc?.latestBlockNumber !== undefined ? ` · latest block #${chainStatus.liveRpc.latestBlockNumber}` : " · block height unavailable"}` : `在线${chainStatus.liveRpc?.latestBlockNumber !== undefined ? ` · 最新区块 #${chainStatus.liveRpc.latestBlockNumber}` : " · 区块高度未读取"}`)
                      : "https://rpc.botchain.ai"}
                  </strong>
                </span>
              </div>

              {chainStatus && chainStatus.contracts && (
                <>
                  <div className="mainnet-contracts-list">
                    {Object.values(chainStatus.contracts).map((c: any) => (
                      <div className="mainnet-contract-row" key={c.address}>
                        <div>
                          <strong>{c.name}</strong>
                          <small>{c.role}</small>
                          <code>{c.address}</code>
                        </div>
                        <div className="mainnet-links">
                          <a
                            href={c.explorerUrl || c.explorerAddressUrl || `https://scan.botchain.ai/address/${c.address}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {en ? "Contract address ↗" : "合约地址 ↗"}
                          </a>
                          <a
                            href={
                              c.deployTxUrl ||
                              c.explorerTxUrl ||
                              `https://scan.botchain.ai/tx/${c.deployTxHash || c.deploymentTxHash}`
                            }
                            target="_blank"
                            rel="noreferrer"
                          >
                            {en ? `Deployment tx (#${c.blockNumber || c.deploymentBlockNumber}) ↗` : `部署交易 ( #${c.blockNumber || c.deploymentBlockNumber}) ↗`}
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="mainnet-tx-list">
                    <div className="mainnet-tx-title">
                      本会话 receipt 与历史回放凭证 (scan.botchain.ai)
                      {(chainStatus.sessionTransactions?.length ?? 0) > 0 && (
                        <span className="session-count-pill">
                          含本次会话新增 {chainStatus.sessionTransactions.length} 笔交互
                        </span>
                      )}
                    </div>
                    {((chainStatus.sessionTransactions?.length ?? 0) > 0
                      ? [
                          ...(chainStatus.sessionTransactions ?? []).map((s, i) => ({
                            rowKey: s.id || `sess-${i}-${s.createdAt}`,
                            event: s.event,
                            label: `🟢 本次会话交互 · ${s.event} (${s.providerName || "Wallet"})`,
                            batchId: s.batchId,
                            txHash: s.txHash,
                            blockNumber: s.blockNumber,
                            contractAddress: s.contractAddress,
                            explorerUrl: s.explorerUrl,
                          })),
                          ...(chainStatus.verifiedTransactions ?? []).map((v, i) => ({
                            ...v,
                            label: `历史回放凭证 · ${v.label}`,
                            rowKey: `ver-${i}-${v.txHash}`,
                          })),
                        ]
                      : (chainStatus.verifiedTransactions ?? []).map((v, i) => ({
                          ...v,
                          label: `历史回放凭证 · ${v.label}`,
                          rowKey: `ver-${i}-${v.txHash}`,
                        }))
                    ).map((tx: any) => (
                      <div className="mainnet-tx-row" key={tx.rowKey}>
                        <div>
                          <b>{tx.label}</b>
                          <span>
                            批次 {tx.batchId || "未知"} · {tx.blockNumber ? `区块 #${tx.blockNumber}` : "回执区块未读取"}
                          </span>
                          <code>{tx.txHash}</code>
                        </div>
                        <a href={tx.explorerUrl} target="_blank" rel="noreferrer" className="explorer-link-btn">
                          区块浏览器核验 ↗
                        </a>
                      </div>
                    ))}
                  </div>
                </>
              )}
                </div>
              </div>
            </details>
          </div>
        </div>
      )}
    </WalletContext.Provider>
  );
}
