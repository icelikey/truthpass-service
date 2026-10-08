import {
  getBotChainConfig,
  normalizeBotChainNetwork,
  parseChainId,
  type BotChainConfig,
  type BotChainNetworkAlias,
} from "./chain-config.js";

/** A small fetch-compatible type makes the JSON-RPC client easy to test. */
export type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse<T> {
  jsonrpc: "2.0";
  id: number;
  result?: T;
  error?: JsonRpcError;
}

export interface BotChainClientOptions {
  network?: BotChainNetworkAlias;
  config?: BotChainConfig;
  fetch?: FetchLike;
  /** Safe default. A write is never attempted unless this is explicitly false. */
  dryRun?: boolean;
  timeoutMs?: number;
}

export class BotChainError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "BotChainError";
  }
}

export class BotChainRpcError extends BotChainError {
  readonly method: string;
  readonly rpcError?: JsonRpcError;

  constructor(method: string, message: string, rpcError?: JsonRpcError) {
    super(`${method}: ${message}`);
    this.name = "BotChainRpcError";
    this.method = method;
    this.rpcError = rpcError;
  }
}

export class ChainNetworkMismatchError extends BotChainError {
  readonly expected: number;
  readonly actual: number;

  constructor(expected: number, actual: number) {
    super(`BOT Chain network mismatch: expected chain ${expected}, RPC reported ${actual}`);
    this.name = "ChainNetworkMismatchError";
    this.expected = expected;
    this.actual = actual;
  }
}

export interface EvidenceAnchorInput {
  /** @deprecated Legacy three-argument demo calldata only. */
  batchCommitment: string;
  evidenceRoot: string;
  schemaHash: string;
  /** Optional override for a deployed legacy contract address. */
  contractAddress?: string;
}

/** States accepted by `anchorEvidence`; 5/6 are revision states, not anchors. */
export type EvidenceState = 1 | 2 | 3 | 4;

/** Input for TruthPassEvidenceAnchor.sol's production eight-argument ABI. */
export interface TruthPassEvidenceAnchorInput {
  requestId: string;
  evidenceRoot: string;
  subjectHash: string;
  schemaHash: string;
  sourceHash: string;
  state: EvidenceState;
  domainSeparator: string;
  contractAddress?: string;
}

export interface EvidenceAnchorTransaction {
  to: string;
  data: string;
  value: "0x0";
  chainId: number;
  chainIdHex: string;
}

export interface EvidenceAnchorSubmission {
  mode: "dry-run" | "submitted";
  network: BotChainConfig["network"];
  chainId: number;
  transaction: EvidenceAnchorTransaction;
  txHash?: string;
  receipt?: BotChainTransactionReceipt;
}

export interface WaitForReceiptOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export interface BotChainLog {
  address: string;
  topics: string[];
  data: string;
  logIndex?: string;
  transactionHash?: string;
  blockNumber?: string;
}

export interface BotChainTransactionReceipt {
  transactionHash: string;
  transactionIndex?: string;
  blockHash?: string;
  blockNumber?: string;
  from?: string;
  to?: string | null;
  cumulativeGasUsed?: string;
  gasUsed?: string;
  status?: string;
  logs: BotChainLog[];
  [key: string]: unknown;
}

export interface ParsedEvidenceAnchorEvent {
  batchCommitment: string;
  evidenceRoot: string;
  schemaHash: string;
  requestId?: string;
  subjectHash?: string;
  sourceHash?: string;
  state?: number;
  writer?: string;
  address: string;
  logIndex?: string;
  transactionHash?: string;
}

export const ANCHOR_EVIDENCE_SIGNATURE = "anchorEvidence(bytes32,bytes32,bytes32)";
export const TRUTHPASS_ANCHOR_EVIDENCE_SIGNATURE =
  "anchorEvidence(bytes32,bytes32,bytes32,bytes32,bytes32,uint8,uint256,bytes32)";
export const EVIDENCE_ANCHORED_SIGNATURE =
  "EvidenceAnchored(bytes32,bytes32,bytes32,bytes32,bytes32,uint8,address)";
export const LEGACY_EVIDENCE_ANCHORED_SIGNATURE = "EvidenceAnchored(bytes32,bytes32,bytes32)";
/** Solidity getter selector for `DOMAIN_SEPARATOR()`. */
export const DOMAIN_SEPARATOR_SELECTOR = "0x3644e515";

const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;

function asBytes32(value: string, field: string): string {
  const withPrefix = value.startsWith("0x") ? value : `0x${value}`;
  if (!HEX32.test(withPrefix)) {
    throw new BotChainError(`${field} must be a 32-byte hex value`);
  }
  return withPrefix.toLowerCase();
}

function asAddress(value: string, field = "contractAddress"): string {
  if (!ADDRESS.test(value)) {
    throw new BotChainError(`${field} must be a 20-byte hex address`);
  }
  return value.toLowerCase();
}

function asHexQuantity(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value)) {
    throw new BotChainRpcError(field, `expected a hex quantity, received ${String(value)}`);
  }
  return value;
}

/** ABI calldata for the planned TruthPass `anchorEvidence` function. */
export function encodeAnchorEvidenceCalldata(input: EvidenceAnchorInput): string {
  return [
    ANCHOR_EVIDENCE_SELECTOR,
    asBytes32(input.batchCommitment, "batchCommitment").slice(2),
    asBytes32(input.evidenceRoot, "evidenceRoot").slice(2),
    asBytes32(input.schemaHash, "schemaHash").slice(2),
  ].join("");
}

function uintWord(value: number | bigint, field: string): string {
  const numeric = typeof value === "bigint" ? value : BigInt(value);
  if (numeric < 0n || numeric > ((1n << 256n) - 1n)) {
    throw new BotChainError(`${field} is outside the uint256 range`);
  }
  return numeric.toString(16).padStart(64, "0");
}

/** ABI calldata matching `TruthPassEvidenceAnchor.anchorEvidence`. */
export function encodeTruthPassEvidenceAnchorCalldata(
  input: TruthPassEvidenceAnchorInput,
  chainId: number,
): string {
  if (!Number.isInteger(input.state) || input.state < 1 || input.state > 4) {
    throw new BotChainError("state must be one of the TruthPass anchor states 1..4");
  }
  return [
    TRUTHPASS_ANCHOR_EVIDENCE_SELECTOR,
    asBytes32(input.requestId, "requestId").slice(2),
    asBytes32(input.evidenceRoot, "evidenceRoot").slice(2),
    asBytes32(input.subjectHash, "subjectHash").slice(2),
    asBytes32(input.schemaHash, "schemaHash").slice(2),
    asBytes32(input.sourceHash, "sourceHash").slice(2),
    uintWord(input.state, "state"),
    uintWord(chainId, "chainId"),
    asBytes32(input.domainSeparator, "domainSeparator").slice(2),
  ].join("");
}

export function buildEvidenceAnchorTransaction(
  input: TruthPassEvidenceAnchorInput,
  config: BotChainConfig,
): EvidenceAnchorTransaction {
  const address = asAddress(input.contractAddress ?? config.contractAddress ?? "", "contractAddress");
  return {
    to: address,
    data: encodeTruthPassEvidenceAnchorCalldata(input, config.chainId),
    value: "0x0",
    chainId: config.chainId,
    chainIdHex: config.chainIdHex,
  };
}

/** Build the old 3-argument demo transaction explicitly, if needed for an old contract. */
export function buildLegacyEvidenceAnchorTransaction(
  input: EvidenceAnchorInput,
  config: BotChainConfig,
): EvidenceAnchorTransaction {
  const address = asAddress(input.contractAddress ?? config.contractAddress ?? "", "contractAddress");
  return {
    to: address,
    data: encodeAnchorEvidenceCalldata(input),
    value: "0x0",
    chainId: config.chainId,
    chainIdHex: config.chainIdHex,
  };
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/**
 * Minimal BOT Chain JSON-RPC adapter. It only builds calldata and submits a
 * caller-provided signed transaction; it never accepts or derives a private
 * key. The default is dry-run, so even a supplied raw transaction is not sent.
 */
export class BotChainClient {
  readonly config: BotChainConfig;
  readonly dryRun: boolean;
  private readonly fetchImpl: FetchLike;
  private readonly timeoutMs: number;
  private requestId = 0;

  constructor(options: BotChainClientOptions = {}) {
    this.config = options.config ?? getBotChainConfig(options.network ?? "testnet");
    this.dryRun = options.dryRun ?? true;
    const globalFetch = globalThis.fetch;
    if (!options.fetch && typeof globalFetch !== "function") {
      throw new BotChainError("No fetch implementation is available for BOT Chain RPC");
    }
    this.fetchImpl = options.fetch ?? globalFetch.bind(globalThis);
    this.timeoutMs = options.timeoutMs ?? 15_000;
  }

  async request<T>(method: string, params: unknown[] = []): Promise<T> {
    const id = ++this.requestId;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(this.config.rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
        signal: controller.signal,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BotChainRpcError(method, message);
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      throw new BotChainRpcError(method, `HTTP ${response.status}`);
    }

    let payload: JsonRpcResponse<T>;
    try {
      payload = (await response.json()) as JsonRpcResponse<T>;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new BotChainRpcError(method, `invalid JSON-RPC response: ${message}`);
    }
    if (payload.error) {
      throw new BotChainRpcError(method, payload.error.message, payload.error);
    }
    if (!("result" in payload)) {
      throw new BotChainRpcError(method, "JSON-RPC response has no result");
    }
    return payload.result as T;
  }

  async getChainId(): Promise<number> {
    const value = asHexQuantity(await this.request<unknown>("eth_chainId"), "eth_chainId");
    return parseChainId(value);
  }

  async assertNetwork(): Promise<number> {
    const actual = await this.getChainId();
    if (actual !== this.config.chainId) {
      throw new ChainNetworkMismatchError(this.config.chainId, actual);
    }
    return actual;
  }

  async getCode(address: string, blockTag = "latest"): Promise<string> {
    const code = await this.request<unknown>("eth_getCode", [asAddress(address, "address"), blockTag]);
    if (typeof code !== "string" || !/^0x[0-9a-fA-F]*$/.test(code)) {
      throw new BotChainRpcError("eth_getCode", "invalid bytecode response");
    }
    return code;
  }

  async assertContractDeployed(address = this.config.contractAddress): Promise<string> {
    if (!address) throw new BotChainError("A deployed TruthPass contract address is required");
    const code = await this.getCode(address);
    if (code === "0x" || code === "0x0") {
      throw new BotChainError(`No contract bytecode found at ${address} on chain ${this.config.chainId}`);
    }
    return code;
  }

  async getDomainSeparator(address = this.config.contractAddress): Promise<string> {
    if (!address) throw new BotChainError("A deployed TruthPass contract address is required");
    const result = await this.request<unknown>("eth_call", [
      { to: asAddress(address, "contractAddress"), data: DOMAIN_SEPARATOR_SELECTOR },
      "latest",
    ]);
    return asBytes32(String(result), "DOMAIN_SEPARATOR");
  }

  async getTransactionReceipt(txHash: string): Promise<BotChainTransactionReceipt | null> {
    if (!/^0x[0-9a-fA-F]{64}$/.test(txHash)) {
      throw new BotChainError("txHash must be a 32-byte hex value");
    }
    return this.request<BotChainTransactionReceipt | null>("eth_getTransactionReceipt", [txHash]);
  }

  async waitForReceipt(
    txHash: string,
    options: WaitForReceiptOptions = {},
  ): Promise<BotChainTransactionReceipt> {
    const timeoutMs = options.timeoutMs ?? 120_000;
    const pollIntervalMs = options.pollIntervalMs ?? 2_000;
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
      const receipt = await this.getTransactionReceipt(txHash);
      if (receipt) return receipt;
      await delay(pollIntervalMs);
    }
    throw new BotChainError(`Timed out waiting for transaction receipt: ${txHash}`);
  }

  /**
   * Validate the configured RPC chain, then build or submit an anchor.
   * Submission requires a pre-signed raw transaction from an external wallet.
   */
  async anchorEvidence(
    input: TruthPassEvidenceAnchorInput,
    options: {
      rawTransaction?: string;
      dryRun?: boolean;
      waitForReceipt?: boolean;
      receipt?: WaitForReceiptOptions;
      skipNetworkCheck?: boolean;
    } = {},
  ): Promise<EvidenceAnchorSubmission> {
    if (!options.skipNetworkCheck) await this.assertNetwork();
    const transaction = buildEvidenceAnchorTransaction(input, this.config);
    const shouldDryRun = options.dryRun ?? this.dryRun;
    if (shouldDryRun) {
      return {
        mode: "dry-run",
        network: normalizeBotChainNetwork(this.config.network),
        chainId: this.config.chainId,
        transaction,
      };
    }
    if (!options.rawTransaction || !/^0x[0-9a-fA-F]+$/.test(options.rawTransaction)) {
      throw new BotChainError(
        "A pre-signed rawTransaction is required when dryRun is false; this adapter never handles private keys",
      );
    }
    const txHash = await this.request<string>("eth_sendRawTransaction", [options.rawTransaction]);
    const receipt = options.waitForReceipt
      ? await this.waitForReceipt(txHash, options.receipt)
      : undefined;
    return {
      mode: "submitted",
      network: normalizeBotChainNetwork(this.config.network),
      chainId: this.config.chainId,
      transaction,
      txHash,
      receipt,
    };
  }

  /**
   * Explicit legacy path for a pre-v0.7 three-argument demo contract. It is
   * intentionally separate so production callers cannot silently target the
   * old ABI after moving to TruthPassEvidenceAnchor.sol.
   */
  async anchorLegacyEvidence(
    input: EvidenceAnchorInput,
    options: {
      rawTransaction?: string;
      dryRun?: boolean;
      waitForReceipt?: boolean;
      receipt?: WaitForReceiptOptions;
      skipNetworkCheck?: boolean;
    } = {},
  ): Promise<EvidenceAnchorSubmission> {
    if (!options.skipNetworkCheck) await this.assertNetwork();
    const transaction = buildLegacyEvidenceAnchorTransaction(input, this.config);
    const shouldDryRun = options.dryRun ?? this.dryRun;
    if (shouldDryRun) {
      return {
        mode: "dry-run",
        network: normalizeBotChainNetwork(this.config.network),
        chainId: this.config.chainId,
        transaction,
      };
    }
    if (!options.rawTransaction || !/^0x[0-9a-fA-F]+$/.test(options.rawTransaction)) {
      throw new BotChainError(
        "A pre-signed rawTransaction is required when dryRun is false; this adapter never handles private keys",
      );
    }
    const txHash = await this.request<string>("eth_sendRawTransaction", [options.rawTransaction]);
    const receipt = options.waitForReceipt
      ? await this.waitForReceipt(txHash, options.receipt)
      : undefined;
    return {
      mode: "submitted",
      network: normalizeBotChainNetwork(this.config.network),
      chainId: this.config.chainId,
      transaction,
      txHash,
      receipt,
    };
  }
}

/**
 * Parse the planned event convention. The parser accepts the documented
 * two-indexed layout and also all-data/all-indexed layouts, so the contract
 * can choose its indexing strategy without changing the consumer interface.
 */
export function parseEvidenceAnchorEvents(
  receipt: BotChainTransactionReceipt,
  eventTopic = EVIDENCE_ANCHORED_TOPIC,
): ParsedEvidenceAnchorEvent[] {
  const events: ParsedEvidenceAnchorEvent[] = [];
  for (const log of receipt.logs ?? []) {
    if (!log.topics.length || log.topics[0].toLowerCase() !== eventTopic.toLowerCase()) continue;
    const words = log.data.startsWith("0x") ? log.data.slice(2).match(/.{64}/g) ?? [] : [];
    const indexedArguments = log.topics.slice(1);
    const requestId = indexedArguments[0] ?? `0x${words.shift() ?? ""}`;
    const evidenceRoot = indexedArguments[1] ?? `0x${words.shift() ?? ""}`;
    const subjectHash = indexedArguments[2] ?? `0x${words.shift() ?? ""}`;
    const schemaHash = `0x${words.shift() ?? ""}`;
    const sourceHash = `0x${words.shift() ?? ""}`;
    const stateWord = words.shift();
    const writerWord = words.shift();
    const isTruthPassLayout = eventTopic.toLowerCase() === EVIDENCE_ANCHORED_TOPIC.toLowerCase();
    // Legacy three-argument logs put the schema hash in the first data word.
    // The current contract has schema, source, state and writer in data.
    const legacySchemaHash = isTruthPassLayout ? schemaHash : subjectHash;
    const currentSourceHash = isTruthPassLayout ? sourceHash : undefined;
    const currentState = isTruthPassLayout && stateWord ? Number.parseInt(stateWord, 16) : undefined;
    const currentWriter = isTruthPassLayout && writerWord ? `0x${writerWord.slice(-40)}` : undefined;
    const batchCommitment = isTruthPassLayout ? subjectHash : requestId;
    if (!HEX32.test(batchCommitment) || !HEX32.test(evidenceRoot) || !HEX32.test(legacySchemaHash)) continue;
    if (isTruthPassLayout && (!HEX32.test(currentSourceHash ?? "") || currentState === undefined)) continue;
    events.push({
      batchCommitment: batchCommitment.toLowerCase(),
      evidenceRoot: evidenceRoot.toLowerCase(),
      schemaHash: legacySchemaHash.toLowerCase(),
      ...(isTruthPassLayout
        ? {
            requestId: requestId.toLowerCase(),
            subjectHash: subjectHash.toLowerCase(),
            sourceHash: currentSourceHash?.toLowerCase(),
            state: currentState,
            writer: currentWriter,
          }
        : {}),
      address: log.address,
      logIndex: log.logIndex,
      transactionHash: log.transactionHash ?? receipt.transactionHash,
    });
  }
  return events;
}

/* ------------------------------------------------------------------------- *
 * Keccak-256 (the Ethereum variant, domain suffix 0x01).
 * Node's built-in `sha3-256` uses the NIST suffix 0x06 and is not compatible
 * with EVM selectors, so the tiny implementation below keeps this adapter
 * dependency-free and produces standard Solidity function/event selectors.
 * ------------------------------------------------------------------------- */

const MASK_64 = (1n << 64n) - 1n;
const ROUND_CONSTANTS = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const ROTATION_OFFSETS = [
  [0, 36, 3, 41, 18],
  [1, 44, 10, 45, 2],
  [62, 6, 43, 15, 61],
  [28, 55, 25, 21, 56],
  [27, 20, 39, 8, 14],
];

function rotateLeft(value: bigint, offset: number): bigint {
  if (offset === 0) return value & MASK_64;
  return ((value << BigInt(offset)) | (value >> BigInt(64 - offset))) & MASK_64;
}

function keccakF(state: bigint[]): void {
  for (const roundConstant of ROUND_CONSTANTS) {
    const c = Array.from({ length: 5 }, (_, x) =>
      state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20],
    );
    const d = Array.from({ length: 5 }, (_, x) => c[(x + 4) % 5] ^ rotateLeft(c[(x + 1) % 5], 1));
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) state[x + 5 * y] = (state[x + 5 * y] ^ d[x]) & MASK_64;
    }

    const b = Array.from({ length: 25 }, () => 0n);
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        const newX = y;
        const newY = (2 * x + 3 * y) % 5;
        b[newX + 5 * newY] = rotateLeft(state[x + 5 * y], ROTATION_OFFSETS[x][y]);
      }
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        state[x + 5 * y] = (b[x + 5 * y] ^ ((~b[(x + 1) % 5 + 5 * y]) & b[(x + 2) % 5 + 5 * y])) & MASK_64;
      }
    }
    state[0] = (state[0] ^ roundConstant) & MASK_64;
  }
}

function readLittleEndian(bytes: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let index = 7; index >= 0; index -= 1) value = (value << 8n) | BigInt(bytes[offset + index]);
  return value;
}

function writeLittleEndian(value: bigint, output: number[]): void {
  for (let index = 0; index < 8; index += 1) {
    output.push(Number(value & 0xffn));
    value >>= 8n;
  }
}

export function keccak256Hex(value: string): string {
  const message = new TextEncoder().encode(value);
  const rate = 136;
  const paddedLength = Math.ceil((message.length + 1) / rate) * rate;
  const padded = new Uint8Array(paddedLength);
  padded.set(message);
  padded[message.length] = 0x01;
  padded[padded.length - 1] |= 0x80;
  const state = Array.from({ length: 25 }, () => 0n);
  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let lane = 0; lane < rate / 8; lane += 1) state[lane] ^= readLittleEndian(padded, offset + lane * 8);
    keccakF(state);
  }
  const output: number[] = [];
  for (let lane = 0; output.length < 32; lane += 1) writeLittleEndian(state[lane], output);
  return output.slice(0, 32).map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Selector/topic constants are evaluated after the Keccak implementation is initialized. */
export const ANCHOR_EVIDENCE_SELECTOR = `0x${keccak256Hex(ANCHOR_EVIDENCE_SIGNATURE).slice(0, 8)}`;
export const TRUTHPASS_ANCHOR_EVIDENCE_SELECTOR =
  `0x${keccak256Hex(TRUTHPASS_ANCHOR_EVIDENCE_SIGNATURE).slice(0, 8)}`;
export const EVIDENCE_ANCHORED_TOPIC = `0x${keccak256Hex(EVIDENCE_ANCHORED_SIGNATURE)}`;
export const LEGACY_EVIDENCE_ANCHORED_TOPIC = `0x${keccak256Hex(LEGACY_EVIDENCE_ANCHORED_SIGNATURE)}`;

