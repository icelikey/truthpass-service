export type WalletKind = "metamask" | "okx" | "binance" | "injected";

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
  on?(event: string, handler: (...args: any[]) => void): void;
  removeListener?(event: string, handler: (...args: any[]) => void): void;
  isMetaMask?: boolean;
  isOkxWallet?: boolean;
  isOKExWallet?: boolean;
  isBinance?: boolean;
  isRabby?: boolean;
  isTokenPocket?: boolean;
  isBitKeep?: boolean;
  providers?: Eip1193Provider[];
}

export interface WalletOption {
  kind: WalletKind;
  name: string;
  subtitle: string;
  badge: string;
  detected: boolean;
  provider: Eip1193Provider | null;
  installUrl: string;
}

export const BOT_CHAIN_NETWORK_PARAMS = {
  chainId: "0x2a5",
  chainIdDec: 677,
  chainName: "BOT Chain Mainnet",
  nativeCurrency: {
    name: "BOT",
    symbol: "BOT",
    decimals: 18,
  },
  rpcUrls: ["https://rpc.botchain.ai"],
  blockExplorerUrls: ["https://scan.botchain.ai"],
};

const eip6963Providers = new Map<string, { info: { name?: string; rdns?: string }; provider: Eip1193Provider }>();

if (typeof window !== "undefined") {
  window.addEventListener("eip6963:announceProvider", ((event: CustomEvent) => {
    const detail = event.detail;
    if (detail?.provider && detail?.info) {
      const key = detail.info.rdns || detail.info.name || Math.random().toString(36);
      eip6963Providers.set(key, detail);
    }
  }) as EventListener);
  try {
    window.dispatchEvent(new Event("eip6963:requestProvider"));
  } catch {
    // ignore in older environments
  }
}

function getWindowAny(): Record<string, any> {
  return typeof window !== "undefined" ? (window as unknown as Record<string, any>) : {};
}

export function discoverWalletOptions(): WalletOption[] {
  const win = getWindowAny();
  const eth = win.ethereum as Eip1193Provider | undefined;
  const subProviders: Eip1193Provider[] = Array.isArray(eth?.providers) ? eth!.providers! : eth ? [eth] : [];

  for (const entry of eip6963Providers.values()) {
    if (!subProviders.includes(entry.provider)) {
      subProviders.push(entry.provider);
    }
  }

  // 1. MetaMask
  let metamaskProvider: Eip1193Provider | null = null;
  for (const [, entry] of eip6963Providers.entries()) {
    if (entry.info.rdns?.includes("metamask") || entry.info.name?.toLowerCase().includes("metamask")) {
      metamaskProvider = entry.provider;
      break;
    }
  }
  if (!metamaskProvider) {
    metamaskProvider =
      subProviders.find((p) => p.isMetaMask && !p.isOkxWallet && !p.isOKExWallet && !p.isBinance) ??
      (eth?.isMetaMask ? eth : null);
  }

  // 2. OKX Wallet
  let okxProvider: Eip1193Provider | null = (win.okxwallet as Eip1193Provider | undefined) ?? null;
  if (!okxProvider) {
    for (const [, entry] of eip6963Providers.entries()) {
      if (entry.info.rdns?.includes("okx") || entry.info.name?.toLowerCase().includes("okx")) {
        okxProvider = entry.provider;
        break;
      }
    }
  }
  if (!okxProvider) {
    okxProvider = subProviders.find((p) => p.isOkxWallet || p.isOKExWallet) ?? null;
  }

  // 3. Binance Wallet
  let binanceProvider: Eip1193Provider | null =
    (win.binancew3w?.ethereum as Eip1193Provider | undefined) ??
    (win.BinanceChain as Eip1193Provider | undefined) ??
    null;
  if (!binanceProvider) {
    for (const [, entry] of eip6963Providers.entries()) {
      if (entry.info.rdns?.includes("binance") || entry.info.name?.toLowerCase().includes("binance")) {
        binanceProvider = entry.provider;
        break;
      }
    }
  }
  if (!binanceProvider) {
    binanceProvider = subProviders.find((p) => p.isBinance) ?? null;
  }

  // 4. Other EVM Injected Wallet (Rabby, TokenPocket, Bitget, Coinbase, or fallback window.ethereum)
  const otherProvider: Eip1193Provider | null =
    subProviders.find((p) => p !== metamaskProvider && p !== okxProvider && p !== binanceProvider) ??
    eth ??
    okxProvider ??
    binanceProvider ??
    null;

  return [
    {
      kind: "metamask",
      name: "MetaMask",
      subtitle: "最常用的 EVM 浏览器插件钱包 · 支持自动添加 BOT Chain (677)",
      badge: "推荐",
      detected: Boolean(metamaskProvider),
      provider: metamaskProvider ?? eth ?? null,
      installUrl: "https://metamask.io/download/",
    },
    {
      kind: "okx",
      name: "OKX Wallet",
      subtitle: "欧易 Web3 多链钱包 · 支持 EIP-1193 / EIP-6963 直连",
      badge: "多链",
      detected: Boolean(okxProvider),
      provider: okxProvider ?? eth ?? null,
      installUrl: "https://www.okx.com/web3",
    },
    {
      kind: "binance",
      name: "Binance Wallet",
      subtitle: "币安 Web3 钱包 · 支持 EVM 自定义主网签名",
      badge: "生态",
      detected: Boolean(binanceProvider),
      provider: binanceProvider ?? eth ?? null,
      installUrl: "https://www.binance.com/zh-CN/web3wallet",
    },
    {
      kind: "injected",
      name: "其他 EVM 钱包",
      subtitle: "Rabby / TokenPocket / Bitget / Trust Wallet 等注入式 EVM 钱包",
      badge: "EVM 通用",
      detected: Boolean(otherProvider),
      provider: otherProvider,
      installUrl: "https://ethereum.org/zh/wallets/find-wallet/",
    },
  ];
}

export async function ensureBotChainMainnet(provider: Eip1193Provider): Promise<number> {
  const chainHex = (await provider.request({ method: "eth_chainId" })) as string;
  const currentChainId = parseInt(chainHex, 16);
  if (currentChainId === BOT_CHAIN_NETWORK_PARAMS.chainIdDec) {
    return currentChainId;
  }

  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BOT_CHAIN_NETWORK_PARAMS.chainId }],
    });
  } catch (switchError: any) {
    const code = switchError?.code ?? switchError?.data?.originalError?.code;
    if (code === 4902 || code === -32603 || String(switchError?.message ?? "").includes("Unrecognized chain")) {
      await provider.request({
        method: "wallet_addEthereumChain",
        params: [
          {
            chainId: BOT_CHAIN_NETWORK_PARAMS.chainId,
            chainName: BOT_CHAIN_NETWORK_PARAMS.chainName,
            nativeCurrency: BOT_CHAIN_NETWORK_PARAMS.nativeCurrency,
            rpcUrls: BOT_CHAIN_NETWORK_PARAMS.rpcUrls,
            blockExplorerUrls: BOT_CHAIN_NETWORK_PARAMS.blockExplorerUrls,
          },
        ],
      });
    } else {
      throw switchError;
    }
  }

  const updatedHex = (await provider.request({ method: "eth_chainId" })) as string;
  return parseInt(updatedHex, 16);
}

export async function waitForTransactionReceipt(
  provider: Eip1193Provider,
  txHash: string,
  maxAttempts = 16,
  intervalMs = 1500,
): Promise<{ blockNumber?: number; status?: number } | null> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const receipt = (await provider.request({
        method: "eth_getTransactionReceipt",
        params: [txHash],
      })) as { blockNumber?: string; status?: string } | null;
      if (receipt && receipt.blockNumber) {
        return {
          blockNumber: parseInt(receipt.blockNumber, 16),
          status: receipt.status ? parseInt(receipt.status, 16) : 1,
        };
      }
    } catch {
      // continue polling
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
  return null;
}

export function shortHex(value: string, head = 6, tail = 4): string {
  if (!value || value.length <= head + tail + 2) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
