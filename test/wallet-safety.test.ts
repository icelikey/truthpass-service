import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import test from "node:test";

type Listener = (event: any) => void;

function installEip6963Window(): {
  metamask: Record<string, unknown>;
  okx: Record<string, unknown>;
  binance: Record<string, unknown>;
  generic: Record<string, unknown>;
} {
  const listeners = new Map<string, Set<Listener>>();
  const on = (type: string, listener: Listener) => {
    const entries = listeners.get(type) ?? new Set<Listener>();
    entries.add(listener);
    listeners.set(type, entries);
  };
  const emit = (event: any) => {
    for (const listener of listeners.get(event.type) ?? []) listener(event);
    return true;
  };

  const provider = () => ({ request: async () => [] });
  const metamask = provider();
  const okx = provider();
  const binance = provider();
  const generic = provider();
  const announcements = [
    { info: { name: "MetaMask", rdns: "io.metamask" }, provider: metamask },
    { info: { name: "OKX Wallet", rdns: "com.okex.wallet" }, provider: okx },
    { info: { name: "Binance Wallet", rdns: "com.binance.wallet" }, provider: binance },
  ];

  const fakeWindow = {
    ethereum: generic,
    addEventListener: on,
    dispatchEvent(event: any) {
      if (event.type === "eip6963:requestProvider") {
        for (const detail of announcements) emit({ type: "eip6963:announceProvider", detail });
      }
      return true;
    },
  };
  Object.defineProperty(globalThis, "window", { configurable: true, value: fakeWindow });
  return { metamask, okx, binance, generic };
}

test("EIP-6963 discovery keeps named wallets bound to their own provider", async () => {
  const expected = installEip6963Window();
  const { discoverWalletOptions } = await import("../web/src/lib/wallet.js");
  const options = discoverWalletOptions();
  const byKind = new Map(options.map((option) => [option.kind, option]));

  assert.equal(byKind.get("metamask")?.provider, expected.metamask);
  assert.equal(byKind.get("okx")?.provider, expected.okx);
  assert.equal(byKind.get("binance")?.provider, expected.binance);
  assert.equal(byKind.get("injected")?.provider, expected.generic);
  assert.equal(byKind.get("metamask")?.detected, true);
  assert.equal(byKind.get("okx")?.detected, true);
  assert.equal(byKind.get("binance")?.detected, true);
});

test("wallet actions contain no demo-wallet or fabricated-receipt fallback", async () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const source = await readFile(resolve(root, "web/src/components/WalletContext.tsx"), "utf8");
  for (const forbidden of ["connectDemoWallet", "fallbackMap", "wallet_signed_relayed", "mainnet_verified_anchor"]) {
    assert.equal(source.includes(forbidden), false, `禁止的演示回退仍存在: ${forbidden}`);
  }
});
