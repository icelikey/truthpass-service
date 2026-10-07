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

export interface AnchorPlan {
  network: "bot-mainnet";
  chainId: 677;
  contractAddress: string;
  domainSeparator: string;
  evidenceRoot: string;
  requestId: string;
  mode: "dry-run";
  submitted: false;
  transaction: { to: string; data: string; value: "0x0"; chainId: 677 };
}

export function buildEvidenceAnchorPlan(input: { requestId: string; evidenceRoot: string; subjectHash: string; schemaHash: string; sourceHash: string; state: 1 | 2 | 3 | 4 }, config = BOT_CHAIN_MAINNET): AnchorPlan {
  for (const [name, value] of Object.entries(input)) {
    if (name !== "state" && (!/^0x[0-9a-f]{64}$/i.test(String(value)))) throw new Error(name + " must be a 32-byte hex value");
  }
  const selector = "0x" + keccak256("anchorEvidence(bytes32,bytes32,bytes32,bytes32,bytes32,uint8,uint256,bytes32)").slice(0, 8);
  const words = [input.requestId, input.evidenceRoot, input.subjectHash, input.schemaHash, input.sourceHash, uintWord(input.state), uintWord(config.chainId), config.domainSeparator];
  return { network: config.network, chainId: config.chainId, contractAddress: config.contractAddress, domainSeparator: config.domainSeparator, evidenceRoot: input.evidenceRoot, requestId: input.requestId, mode: "dry-run", submitted: false, transaction: { to: config.contractAddress, data: selector + words.map((word) => word.slice(2)).join(""), value: "0x0", chainId: config.chainId } };
}

function uintWord(value: number): string { return "0x" + BigInt(value).toString(16).padStart(64, "0"); }
function keccak256(value: string): string { return keccak256Bytes(new TextEncoder().encode(value)); }
function keccak256Bytes(message: Uint8Array): string {
  const rate = 136;
  const paddedLength = Math.ceil((message.length + 1) / rate) * rate;
  const padded = new Uint8Array(paddedLength);
  padded.set(message); padded[message.length] = 0x01; padded[padded.length - 1] |= 0x80;
  const state = Array.from({ length: 25 }, () => 0n);
  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let lane = 0; lane < rate / 8; lane++) state[lane] ^= read64(padded, offset + lane * 8);
    keccakF(state);
  }
  const out: number[] = [];
  for (let lane = 0; out.length < 32; lane++) write64(state[lane], out);
  return out.slice(0, 32).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const MASK64 = (1n << 64n) - 1n;
const RC: bigint[] = [1n, 0x8082n, 0x800000000000808an, 0x8000000080008000n, 0x808bn, 0x80000001n, 0x8000000080008081n, 0x8000000000008009n, 0x8an, 0x88n, 0x80008009n, 0x8000000an, 0x8000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n, 0x800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x80000001n, 0x8000000080008008n];
const ROT = [[0, 36, 3, 41, 18], [1, 44, 10, 45, 2], [62, 6, 43, 15, 61], [28, 55, 25, 21, 56], [27, 20, 39, 8, 14]];
function rot(x: bigint, n: number): bigint { return n === 0 ? x : ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK64; }
function keccakF(a: bigint[]): void { for (const rc of RC) { const c: bigint[] = Array.from({length:5}, (_,x) => a[x]^a[x+5]^a[x+10]^a[x+15]^a[x+20]); const d: bigint[] = c.map((_,x) => c[(x+4)%5]^rot(c[(x+1)%5],1)); for(let x=0;x<5;x++) for(let y=0;y<5;y++) a[x+5*y]=(a[x+5*y]^d[x])&MASK64; const b: bigint[] = Array(25).fill(0n); for(let x=0;x<5;x++) for(let y=0;y<5;y++) b[y+5*((2*x+3*y)%5)]=rot(a[x+5*y],ROT[x][y]); for(let x=0;x<5;x++) for(let y=0;y<5;y++) a[x+5*y]=b[x+5*y]^((~b[(x+1)%5+5*y])&b[(x+2)%5+5*y]); for(let i=0;i<25;i++) a[i]&=MASK64; a[0]^=rc; } }
function read64(bytes: Uint8Array, offset: number): bigint { let value=0n; for(let i=0;i<8;i++) value |= BigInt(bytes[offset+i] ?? 0) << BigInt(8*i); return value; }
function write64(value: bigint, out: number[]): void { for(let i=0;i<8 && out.length<32;i++) out.push(Number((value >> BigInt(8*i)) & 255n)); }
