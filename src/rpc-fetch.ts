import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { HttpsProxyAgent } from "https-proxy-agent";

/** A small fetch-compatible JSON-RPC transport for environments where Node's
 * built-in undici fetch does not inherit the Windows system proxy. */
export type RpcFetch = (input: string | URL, init?: RequestInit) => Promise<Response>;

function headerRecord(headers: HeadersInit | undefined): Record<string, string> {
  if (!headers) return {};
  if (headers instanceof Headers) {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => { result[key] = value; });
    return result;
  }
  if (Array.isArray(headers)) return Object.fromEntries(headers);
  return Object.fromEntries(Object.entries(headers));
}

function requestBody(body: BodyInit | null | undefined): Buffer | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(body);
  if (ArrayBuffer.isView(body)) return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  return Buffer.from(String(body));
}

/**
 * Build a fetch implementation for chain RPC calls.
 *
 * `TRUTHPASS_HTTPS_PROXY` is intentionally explicit. We do not silently
 * discover a desktop proxy on production hosts; local Windows runs can set it
 * to the user's already authenticated proxy (for example 127.0.0.1:7897).
 */
export function createRpcFetch(options: { proxyUrl?: string; timeoutMs?: number } = {}): RpcFetch {
  const proxyUrl = options.proxyUrl ?? process.env.TRUTHPASS_HTTPS_PROXY;
  const timeoutMs = options.timeoutMs ?? 15_000;

  if (!proxyUrl) return globalThis.fetch.bind(globalThis) as RpcFetch;

  const agent = new HttpsProxyAgent(proxyUrl);
  return (input, init = {}) => new Promise<Response>((resolve, reject) => {
    const target = new URL(input.toString());
    if (target.protocol !== "https:" && target.protocol !== "http:") {
      reject(new Error(`Unsupported RPC URL protocol: ${target.protocol}`));
      return;
    }
    const body = requestBody(init.body);
    const headers = headerRecord(init.headers);
    if (body && !Object.keys(headers).some((key) => key.toLowerCase() === "content-length")) {
      headers["content-length"] = String(body.length);
    }
    const requestOptions = {
      method: init.method ?? (body ? "POST" : "GET"),
      headers,
      agent: target.protocol === "https:" ? agent : undefined,
      timeout: timeoutMs,
    };
    const request = (target.protocol === "https:" ? httpsRequest : httpRequest)(target, requestOptions, (response) => {
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
      response.on("end", () => resolve(new Response(Buffer.concat(chunks), {
        status: response.statusCode ?? 0,
        statusText: response.statusMessage ?? "",
        headers: response.headers as Record<string, string>,
      })));
      response.on("error", reject);
    });
    request.on("timeout", () => request.destroy(new Error(`RPC request timed out after ${timeoutMs}ms`)));
    request.on("error", reject);
    if (init.signal) {
      if (init.signal.aborted) {
        request.destroy(new Error("RPC request aborted"));
        return;
      }
      init.signal.addEventListener("abort", () => request.destroy(new Error("RPC request aborted")), { once: true });
    }
    if (body) request.write(body);
    request.end();
  });
}
