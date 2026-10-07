import assert from "node:assert/strict";
import test from "node:test";
import {
  ANCHOR_EVIDENCE_SELECTOR,
  EVIDENCE_ANCHORED_TOPIC,
  TRUTHPASS_ANCHOR_EVIDENCE_SELECTOR,
  BotChainClient,
  ChainNetworkMismatchError,
  encodeAnchorEvidenceCalldata,
  encodeTruthPassEvidenceAnchorCalldata,
  keccak256Hex,
  parseEvidenceAnchorEvents,
  type FetchLike,
} from "../src/chain.js";
import { getBotChainConfig } from "../src/chain-config.js";

const ADDRESS = "0x1111111111111111111111111111111111111111";
const BATCH = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const REQUEST = "0x9999999999999999999999999999999999999999999999999999999999999999";
const ROOT = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const SUBJECT = BATCH;
const SCHEMA = "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc";
const SOURCE = "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const DOMAIN = "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
const TX_HASH = "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd";

function rpcResponse(id: number, result: unknown): Response {
  return new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("BOT Chain config is explicit for testnet and mainnet", () => {
  assert.equal(getBotChainConfig("testnet").chainId, 968);
  assert.equal(getBotChainConfig("bohr-testnet").chainIdHex, "0x3c8");
  assert.equal(getBotChainConfig("mainnet").chainId, 677);
  assert.equal(getBotChainConfig("bot-mainnet").chainIdHex, "0x2a5");
  assert.equal(getBotChainConfig("testnet", { contractAddress: ADDRESS }).contractAddress, ADDRESS);
});

test("Keccak implementation produces Ethereum-compatible selectors", () => {
  assert.equal(keccak256Hex(""), "c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470");
  assert.equal(ANCHOR_EVIDENCE_SELECTOR, "0x562ba668");
  assert.match(TRUTHPASS_ANCHOR_EVIDENCE_SELECTOR, /^0x[0-9a-f]{8}$/);
  assert.match(EVIDENCE_ANCHORED_TOPIC, /^0x[0-9a-f]{64}$/);
  assert.equal(
    encodeAnchorEvidenceCalldata({ batchCommitment: BATCH, evidenceRoot: ROOT, schemaHash: SCHEMA }),
    `0x562ba668${BATCH.slice(2)}${ROOT.slice(2)}${SCHEMA.slice(2)}`,
  );
});

test("TruthPassEvidenceAnchor calldata includes chain domain and state", () => {
  const data = encodeTruthPassEvidenceAnchorCalldata(
    { requestId: REQUEST, evidenceRoot: ROOT, subjectHash: SUBJECT, schemaHash: SCHEMA, sourceHash: SOURCE, state: 1, domainSeparator: DOMAIN },
    968,
  );
  assert.equal(data.slice(0, 10), TRUTHPASS_ANCHOR_EVIDENCE_SELECTOR);
  assert.equal((data.length - 10) / 64, 8);
  assert.equal(data.slice(-64), DOMAIN.slice(2));
});

test("dry-run checks RPC chain and builds calldata without sending a transaction", async () => {
  const calls: string[] = [];
  const fetch: FetchLike = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { id: number; method: string };
    calls.push(body.method);
    return rpcResponse(body.id, "0x3c8");
  };
  const client = new BotChainClient({
    network: "testnet",
    fetch,
    dryRun: true,
    config: getBotChainConfig("testnet", { contractAddress: ADDRESS }),
  });
  const result = await client.anchorEvidence({
    requestId: REQUEST,
    evidenceRoot: ROOT,
    subjectHash: SUBJECT,
    schemaHash: SCHEMA,
    sourceHash: SOURCE,
    state: 1,
    domainSeparator: DOMAIN,
  });
  assert.equal(result.mode, "dry-run");
  assert.equal(result.transaction.to, ADDRESS);
  assert.equal(result.transaction.chainId, 968);
  assert.deepEqual(calls, ["eth_chainId"]);
});

test("adapter can read deployed contract domain without holding a private key", async () => {
  const calls: string[] = [];
  const fetch: FetchLike = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { id: number; method: string };
    calls.push(body.method);
    return rpcResponse(body.id, DOMAIN);
  };
  const client = new BotChainClient({ fetch, config: getBotChainConfig("testnet", { contractAddress: ADDRESS }) });
  assert.equal(await client.getDomainSeparator(), DOMAIN);
  assert.deepEqual(calls, ["eth_call"]);
});

test("wrong RPC network fails closed before any anchor write", async () => {
  const calls: string[] = [];
  const fetch: FetchLike = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { id: number; method: string };
    calls.push(body.method);
    return rpcResponse(body.id, "0x2a5");
  };
  const client = new BotChainClient({
    network: "testnet",
    fetch,
    dryRun: false,
    config: getBotChainConfig("testnet", { contractAddress: ADDRESS }),
  });
  await assert.rejects(
    () => client.anchorEvidence({
      requestId: REQUEST,
      evidenceRoot: ROOT,
      subjectHash: SUBJECT,
      schemaHash: SCHEMA,
      sourceHash: SOURCE,
      state: 1,
      domainSeparator: DOMAIN,
    }, { rawTransaction: "0x01" }),
    (error: unknown) => error instanceof ChainNetworkMismatchError,
  );
  assert.deepEqual(calls, ["eth_chainId"]);
});

test("submitted mode only accepts a pre-signed raw transaction and can read the receipt", async () => {
  const calls: string[] = [];
  const fetch: FetchLike = async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { id: number; method: string };
    calls.push(body.method);
    if (body.method === "eth_chainId") return rpcResponse(body.id, "0x3c8");
    if (body.method === "eth_sendRawTransaction") return rpcResponse(body.id, TX_HASH);
    return rpcResponse(body.id, {
      transactionHash: TX_HASH,
      blockNumber: "0x12",
      status: "0x1",
      logs: [],
    });
  };
  const client = new BotChainClient({
    network: "testnet",
    fetch,
    dryRun: false,
    config: getBotChainConfig("testnet", { contractAddress: ADDRESS }),
  });
  const result = await client.anchorEvidence(
    {
      requestId: REQUEST,
      evidenceRoot: ROOT,
      subjectHash: SUBJECT,
      schemaHash: SCHEMA,
      sourceHash: SOURCE,
      state: 1,
      domainSeparator: DOMAIN,
    },
    { rawTransaction: "0x1234", waitForReceipt: true, receipt: { timeoutMs: 10, pollIntervalMs: 1 } },
  );
  assert.equal(result.mode, "submitted");
  assert.equal(result.txHash, TX_HASH);
  assert.equal(result.receipt?.status, "0x1");
  assert.deepEqual(calls, ["eth_chainId", "eth_sendRawTransaction", "eth_getTransactionReceipt"]);
});

test("anchor receipt parser returns only matching evidence events", () => {
  const receipt = {
    transactionHash: TX_HASH,
    logs: [
      {
        address: ADDRESS,
        topics: [EVIDENCE_ANCHORED_TOPIC, REQUEST, ROOT, SUBJECT],
        data: `${SCHEMA}${SOURCE.slice(2)}${"0".repeat(63)}1${"0".repeat(24)}${ADDRESS.slice(2)}`,
        logIndex: "0x0",
      },
      { address: ADDRESS, topics: ["0x01"], data: "0x" },
    ],
  };
  assert.deepEqual(parseEvidenceAnchorEvents(receipt), [
    {
      address: ADDRESS,
      batchCommitment: SUBJECT,
      evidenceRoot: ROOT,
      schemaHash: SCHEMA,
      requestId: REQUEST,
      subjectHash: SUBJECT,
      sourceHash: SOURCE,
      state: 1,
      writer: ADDRESS,
      logIndex: "0x0",
      transactionHash: TX_HASH,
    },
  ]);
});

