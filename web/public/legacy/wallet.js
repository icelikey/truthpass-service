(function () {
  "use strict";

  const BOT_CHAIN = {
    chainId: "0x2a5",
    chainName: "BOT Chain Mainnet",
    rpcUrls: ["https://rpc.botchain.ai"],
    blockExplorerUrls: ["https://scan.botchain.ai"],
    nativeCurrency: { name: "BOT", symbol: "BOT", decimals: 18 },
  };

  let activeProvider = null;
  let activeProviderName = "unknown";
  let activeAccount = null;

  function providers() {
    const injected = window.ethereum;
    if (!injected) return [];
    const candidates = Array.isArray(injected.providers) ? injected.providers : [injected];
    return candidates.filter(Boolean);
  }

  function providerName(provider) {
    if (provider.isOKXWallet || provider.isOKExWallet) return "OKX Wallet";
    if (provider.isBinance) return "Binance Wallet";
    if (provider.isMetaMask) return "MetaMask";
    return "EVM Wallet";
  }

  function selectProvider(preferred) {
    const candidates = providers();
    if (candidates.length === 0) throw new Error("未检测到 MetaMask、OKX 或 Binance 钱包");
    if (!preferred) return candidates[0];
    return candidates.find((candidate) => providerName(candidate) === preferred) ?? candidates[0];
  }

  async function request(method, params) {
    if (!activeProvider) throw new Error("请先连接钱包");
    return activeProvider.request({ method, params });
  }

  async function ensureBotChain() {
    const current = await request("eth_chainId");
    if (String(current).toLowerCase() === BOT_CHAIN.chainId) return;
    try {
      await request("wallet_switchEthereumChain", [{ chainId: BOT_CHAIN.chainId }]);
    } catch (error) {
      if (error && typeof error === "object" && error.code === 4902) {
        await request("wallet_addEthereumChain", [BOT_CHAIN]);
      } else {
        throw error;
      }
    }
    const switched = await request("eth_chainId");
    if (String(switched).toLowerCase() !== BOT_CHAIN.chainId) {
      throw new Error("钱包没有切换到 BOT Chain Mainnet（Chain ID 677）");
    }
  }

  async function connect(preferred) {
    activeProvider = selectProvider(preferred);
    activeProviderName = providerName(activeProvider);
    const accounts = await request("eth_requestAccounts");
    activeAccount = Array.isArray(accounts) && accounts[0] ? accounts[0] : null;
    if (!activeAccount) throw new Error("钱包没有返回账户");
    await ensureBotChain();
    return state();
  }

  async function state() {
    if (!activeProvider || !activeAccount) return { connected: false };
    const chainId = await request("eth_chainId");
    const balance = await request("eth_getBalance", [activeAccount, "latest"]);
    return {
      connected: true,
      account: activeAccount,
      provider: activeProviderName,
      chainId,
      chainIdNumber: Number.parseInt(String(chainId).replace(/^0x/, ""), 16),
      balanceWei: balance,
    };
  }

  async function waitForReceipt(txHash, timeoutMs = 120000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const receipt = await request("eth_getTransactionReceipt", [txHash]);
      if (receipt) {
        if (receipt.status === "0x0") throw new Error(`交易已回滚：${txHash}`);
        return receipt;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 1200));
    }
    throw new Error(`等待交易 receipt 超时：${txHash}`);
  }

  const EVENT_TOPICS = {
    evidence: "0x4bae8c6d3e71d1f1033a1bb75143d24bbd3fe2525b796fe996863a3975f00482",
    verification: "0x92f6b474360b300b2f665005b2f1a8218a607f72752ddda643b130a9d00cea25",
    purchase: ["0x1ff9c79439eeda429a30948198b821cbc3a890237c7785a5ae4e71d2561e0756", "0x5d1efe61115e52e5f0e4aef667a82ee20590ad124fa42ed8b11b23cfa06a682c"],
    contribution: ["0x957d5ef8a0e38f341c0edf7911d1c7fbf2368e651867d864143ceede797402d8", "0x96d4aadc1918ad09973e5faea22a066b4a77f4a8ab7e8a2cfbf1e637a238dcfc"],
    dispute: ["0x7b956e50940431f5273463e68c737592e17d2b38e9ab2665febb7f54fb175efa", "0x8085efa996d3c05501d7a399135aa2cb000aac5b2f419ad5c4fa0266dbaadb67"],
  };

  function validateReceipt(receipt, transaction, action, expected) {
    if (!receipt || receipt.status === "0x0") throw new Error("交易已回滚");
    const target = String(expected?.target ?? transaction.to).toLowerCase();
    if (String(receipt.to ?? "").toLowerCase() !== target) throw new Error("交易目标与准备的合约不一致");
    const topics = (receipt.logs ?? []).map((log) => String(log.topics?.[0] ?? "").toLowerCase());
    const expectedTopics = Array.isArray(EVENT_TOPICS[action]) ? EVENT_TOPICS[action] : [EVENT_TOPICS[action]];
    if (!expectedTopics.some((topic) => topics.includes(topic))) throw new Error("交易成功但业务事件未确认");
    const anchorAddress = expected?.anchorAddress;
    if (anchorAddress && !receipt.logs.some((log) => String(log.address ?? "").toLowerCase() === String(anchorAddress).toLowerCase())) {
      throw new Error("交易成功但锚定合约事件未确认");
    }
    return { eventVerified: true, targetVerified: true };
  }

  async function sendPreparedTransaction(transaction, expected = {}) {
    await ensureBotChain();
    const txHash = await request("eth_sendTransaction", [{
      from: activeAccount,
      to: transaction.to,
      data: transaction.data,
      value: transaction.value ?? "0x0",
    }]);
    const receipt = await waitForReceipt(txHash);
    const validation = validateReceipt(receipt, transaction, expected.action, expected);
    return { txHash, receipt, explorerUrl: explorerTx(txHash), ...validation };
  }

  async function signTypedData(typedData) {
    return request("eth_signTypedData_v4", [activeAccount, JSON.stringify(typedData)]);
  }

  function explorerTx(txHash) {
    return `https://scan.botchain.ai/tx/${txHash}`;
  }

  function on(eventName, listener) {
    if (activeProvider && typeof activeProvider.on === "function") activeProvider.on(eventName, listener);
  }

  window.TruthPassWallet = {
    BOT_CHAIN,
    providers,
    providerName,
    connect,
    state,
    sendPreparedTransaction,
    validateReceipt,
    signTypedData,
    explorerTx,
    on,
  };
})();
