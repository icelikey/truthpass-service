export interface BotChainReadOnlyConfig {
  network: "bot-mainnet";
  chainId: 677;
  rpcUrl: string;
  explorerUrl: string;
  contractAddress: string;
  domainSeparator: string;
}

export const BOT_CHAIN_MAINNET: BotChainReadOnlyConfig = Object.freeze({
  network: "bot-mainnet",
  chainId: 677,
  rpcUrl: "https://rpc.botchain.ai",
  explorerUrl: "https://scan.botchain.ai",
  contractAddress: "0x0033462bee153cb9DF12b5c447b9C282DbfbE877",
  domainSeparator: "0xb0843104b533c579fb232c23f6c5a3d900ec0e507e85dec8d99be2cba9a2a8eb",
});

export interface BotChainRpcResult {
  chainId: number;
  contractAddress: string;
  contractCodePresent: boolean;
  readOnly: true;
}

export async function inspectBotChain(fetchImpl: typeof fetch = fetch, config = BOT_CHAIN_MAINNET): Promise<BotChainRpcResult> {
  let requestId = 0;
  const rpc = async (method: string, params: unknown[]) => {
    const response = await fetchImpl(config.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++requestId, method, params }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("BOT Chain RPC HTTP " + response.status);
    const body = await response.json() as { result?: string; error?: { message?: string } };
    if (body.error) throw new Error(body.error.message ?? "BOT Chain RPC error");
    return body.result;
  };
  const chainIdHex = await rpc("eth_chainId", []);
  const chainId = Number.parseInt(String(chainIdHex).replace(/^0x/, ""), 16);
  if (chainId !== config.chainId) throw new Error("BOT Chain chain ID mismatch: " + chainId);
  const code = await rpc("eth_getCode", [config.contractAddress, "latest"]);
  if (!code || code === "0x") throw new Error("BOT Chain contract bytecode not found");
  return { chainId, contractAddress: config.contractAddress, contractCodePresent: true, readOnly: true };
}
