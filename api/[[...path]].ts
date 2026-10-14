import type { IncomingMessage, ServerResponse } from "node:http";
import { handleApi as handleLegacyApi } from "../src/web-server.js";
import { handleApi as handleIntegratedApi } from "../api-server.js";

export default async function handler(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    const host = typeof request.headers.host === "string" ? request.headers.host : "localhost";
    const url = new URL(request.url ?? "/", `https://${host}`);
    if (url.pathname.startsWith("/api/")) {
      if (await handleIntegratedApi(url, request, response)) return;
      if (await handleLegacyApi(url, request, response)) return;
    }
    response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ status: "not_found" }));
  } catch (error) {
    response.writeHead(400, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ status: "error", message: error instanceof Error ? error.message : String(error) }));
  }
}
