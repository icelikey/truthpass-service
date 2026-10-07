import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { Transaction } from "ethers";

export interface RelayerPolicy {
  rpcUrl: string;
  chainId: bigint;
  contractAddress: string;
  maxRawTransactionBytes?: number;
}

export interface RelayedTransaction {
  txHash: string;
  chainId: number;
  to: string;
  status: "submitted";
}

type RpcFetch = (input: string, init?: RequestInit) => Promise<Response>;

async function rpc(fetcher: RpcFetch, policy: RelayerPolicy, method: string, params: unknown[]): Promise<unknown> {
  const response = await fetcher(policy.rpcUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
  if (!response.ok) throw new Error(`RPC HTTP ${response.status}`);
  const result = await response.json() as { result?: unknown; error?: { message?: string } };
  if (result.error) throw new Error(`RPC ${result.error.message ?? "request failed"}`);
  return result.result;
}

/** Submit only an externally signed transaction; this function never handles a private key. */
export async function submitSignedTransaction(fetcher: RpcFetch, policy: RelayerPolicy, rawTransaction: string): Promise<RelayedTransaction> {
  if (!/^0x[0-9a-f]+$/i.test(rawTransaction)) throw new Error("rawTransaction 必须是十六进制字符串");
  const bytes = (rawTransaction.length - 2) / 2;
  if (bytes > (policy.maxRawTransactionBytes ?? 32_000)) throw new Error("rawTransaction 超过大小限制");
  const parsed = Transaction.from(rawTransaction);
  if (parsed.chainId !== policy.chainId) throw new Error(`Chain ID 不匹配：期望 ${policy.chainId}，得到 ${parsed.chainId}`);
  if (!parsed.to || parsed.to.toLowerCase() !== policy.contractAddress.toLowerCase()) throw new Error("交易目标不是允许的 TruthPass 合约");
  const txHash = String(await rpc(fetcher, policy, "eth_sendRawTransaction", [rawTransaction]));
  return { txHash, chainId: Number(policy.chainId), to: parsed.to, status: "submitted" };
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json; charset=utf-8");
  response.end(JSON.stringify(value));
}

async function readBody(request: IncomingMessage): Promise<{ rawTransaction?: string }> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}") as { rawTransaction?: string };
}

export function createRelayerServer(policy: RelayerPolicy, fetcher: RpcFetch = fetch): ReturnType<typeof createServer> {
  return createServer(async (request, response) => {
    try {
      if (request.method !== "POST" || request.url !== "/v1/relay") return json(response, 404, { error: "not found" });
      const input = await readBody(request);
      if (!input.rawTransaction) return json(response, 400, { error: "rawTransaction 必填" });
      return json(response, 202, await submitSignedTransaction(fetcher, policy, input.rawTransaction));
    } catch (error) {
      return json(response, 422, { error: error instanceof Error ? error.message : String(error) });
    }
  });
}

if (process.argv[1]?.endsWith("relayer-server.ts")) {
  const contractAddress = process.env.TRUTHPASS_CONTRACT_ADDRESS;
  if (!contractAddress) throw new Error("TRUTHPASS_CONTRACT_ADDRESS is required");
  const port = Number(process.env.TRUTHPASS_RELAYER_PORT ?? 8790);
  createRelayerServer({ rpcUrl: process.env.TRUTHPASS_MAINNET_RPC_URL ?? "https://rpc.botchain.ai", chainId: 677n, contractAddress }).listen(port, "0.0.0.0", () => console.log(`TruthPass relayer listening on ${port}`));
}
