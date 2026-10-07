import { test } from "node:test";
import assert from "node:assert/strict";
import { Wallet, Transaction } from "ethers";
import { submitSignedTransaction } from "../src/relayer-server.js";

test("relayer only accepts externally signed transactions for the configured chain and contract", async () => {
  const wallet = Wallet.createRandom();
  const raw = await wallet.signTransaction({ chainId: 677, nonce: 0, gasPrice: 1n, gasLimit: 21_000n, to: "0x0033462bee153cb9DF12b5c447b9C282DbfbE877", value: 0n, data: "0x" });
  let method = "";
  const result = await submitSignedTransaction(async (_input, init) => {
    method = JSON.parse(String(init?.body)).method;
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x" + "ab".repeat(32) }), { status: 200 });
  }, { rpcUrl: "https://example.invalid", chainId: 677n, contractAddress: "0x0033462bee153cb9DF12b5c447b9C282DbfbE877" }, raw);
  assert.equal(method, "eth_sendRawTransaction");
  assert.equal(result.status, "submitted");
  assert.equal(result.txHash.length, 66);
  assert.equal(Transaction.from(raw).chainId, 677n);
});

test("relayer rejects wrong chain and target before RPC", async () => {
  const wallet = Wallet.createRandom();
  const raw = await wallet.signTransaction({ chainId: 1, nonce: 0, gasPrice: 1n, gasLimit: 21_000n, to: "0x0000000000000000000000000000000000000001", value: 0n });
  await assert.rejects(() => submitSignedTransaction(async () => { throw new Error("must not call RPC"); }, { rpcUrl: "x", chainId: 677n, contractAddress: "0x0033462bee153cb9DF12b5c447b9C282DbfbE877" }, raw), /Chain ID/);
});
