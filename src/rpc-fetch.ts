/** A fetch-compatible JSON-RPC transport with timeout support. */
export type RpcFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

export function createRpcFetch(options: { proxyUrl?: string; timeoutMs?: number } = {}): RpcFetch {
  const timeoutMs = options.timeoutMs ?? 15_000;
  return (input, init = {}) => {
    const signal = init.signal ?? AbortSignal.timeout(timeoutMs);
    return globalThis.fetch(input, { ...init, signal });
  };
}
