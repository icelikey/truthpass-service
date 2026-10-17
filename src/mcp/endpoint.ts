import { createHash, randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";

export type McpJsonRpcId = string | number | null;

export type TruthPassMcpDependencies = {
  origin: () => string;
  defaultBatchId: string;
  knownBatch: (batchId: string) => boolean;
  manifest: (origin: string) => unknown;
  inspectBatch: (batchId: string, traceId: string) => Promise<unknown>;
  explainBatch: (batchId: string, question: string | undefined, traceId: string) => Promise<unknown>;
  lifecycle: (batchId: string, traceId: string) => Promise<unknown>;
  protectedAuthorized?: (req: IncomingMessage) => boolean;
};

type RpcRequest = {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
};

type RpcResponse = {
  jsonrpc: "2.0";
  id: McpJsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data: { traceId: string; [key: string]: unknown } };
};

const READ_ONLY_TOOLS = [
  {
    name: "truthpass.manifest",
    description: "读取 TruthPass MCP 能力和数据边界清单。只读。",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "truthpass.inspect_batch",
    description: "读取一个批次的确定性验证结果和证据引用。只读。",
    inputSchema: {
      type: "object",
      properties: { batchId: { type: "string", minLength: 1 } },
      required: ["batchId"],
      additionalProperties: false,
    },
  },
  {
    name: "truthpass.explain_batch",
    description: "解释批次当前结论、原因和下一步。只读。",
    inputSchema: {
      type: "object",
      properties: { batchId: { type: "string", minLength: 1 }, question: { type: "string", maxLength: 1000 } },
      required: ["batchId"],
      additionalProperties: false,
    },
  },
  {
    name: "truthpass.lifecycle",
    description: "读取批次生命周期同步状态。只读。",
    inputSchema: {
      type: "object",
      properties: { batchId: { type: "string", minLength: 1 } },
      required: ["batchId"],
      additionalProperties: false,
    },
  },
];

// These names are advertised so clients can explain why a write cannot happen
// in an unattended MCP call. They never create or hold a private key.
const PROTECTED_TOOLS = [
  "truthpass.anchor",
  "truthpass.prepare_write",
  "truthpass.wallet_prepare",
  "truthpass.submit",
  "truthpass.evidence",
  "truthpass.verification",
  "truthpass.purchase",
  "truthpass.contribution",
  "truthpass.dispute",
  "truthpass.audit_finding",
  "truthpass.audit_approval",
  "truthpass.resolve_challenge",
];

function traceIdFromRequest(req: IncomingMessage): string {
  const supplied = req.headers["x-truthpass-request-id"] ?? req.headers["x-request-id"];
  if (typeof supplied === "string" && /^[A-Za-z0-9._:-]{3,128}$/.test(supplied.trim())) return supplied.trim();
  return "mcp-" + createHash("sha256").update(randomUUID()).digest("hex").slice(0, 24);
}
function jsonRpcId(value: unknown): McpJsonRpcId {
  return typeof value === "string" || typeof value === "number" || value === null ? value : null;
}

function errorResponse(id: McpJsonRpcId, traceId: string, code: number, message: string, data: Record<string, unknown> = {}): RpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message, data: { traceId, ...data } } };
}

function resultResponse(id: McpJsonRpcId, result: unknown, traceId: string): RpcResponse {
  // `_meta` is MCP-compatible metadata and keeps request tracing available to
  // clients without changing the shape of the domain result.
  if (result && typeof result === "object" && !Array.isArray(result)) {
    return { jsonrpc: "2.0", id, result: { ...(result as Record<string, unknown>), _meta: { traceId } } };
  }
  return { jsonrpc: "2.0", id, result: { value: result, _meta: { traceId } } };
}

function paramsObject(params: unknown): Record<string, unknown> {
  if (params === undefined) return {};
  if (!params || typeof params !== "object" || Array.isArray(params)) throw new Error("params 必须是 JSON 对象");
  return params as Record<string, unknown>;
}

function batchIdFrom(params: Record<string, unknown>, deps: TruthPassMcpDependencies): string {
  const raw = typeof params.batchId === "string" && params.batchId.trim() ? params.batchId.trim().toUpperCase() : deps.defaultBatchId;
  if (!deps.knownBatch(raw)) throw new Error("BATCH_NOT_FOUND");
  return raw;
}

function pendingConfirmation(tool: string, traceId: string): Record<string, unknown> {
  return {
    schemaVersion: "truthpass.mcp.pending-confirmation.v1",
    status: "pending_confirmation",
    tool,
    requiresConfirmation: true,
    confirmation: { mode: "external_wallet", reason: "受保护写操作必须由用户确认并由外部钱包签名。" },
    submitted: false,
    privateKey: false,
    nextAction: "请求用户确认后，使用外部钱包签名并通过受保护的写入接口提交。",
    _meta: { traceId },
  };
}

async function invoke(req: RpcRequest, deps: TruthPassMcpDependencies, traceId: string, protectedAuthorized: boolean): Promise<RpcResponse | null> {
  const id = jsonRpcId(req.id);
  const notification = req.id === undefined;
  if (req.jsonrpc !== "2.0") return notification ? null : errorResponse(id, traceId, -32600, "无效的 JSON-RPC 请求", { reason: "jsonrpc 必须为 2.0" });
  if (typeof req.method !== "string" || !req.method.trim()) return notification ? null : errorResponse(id, traceId, -32600, "无效的 JSON-RPC 请求", { reason: "method 必须是非空字符串" });

  try {
    const method = req.method;
    const params = paramsObject(req.params);
    let result: unknown;
    if (method === "initialize") {
      result = {
        protocolVersion: "2025-06-18",
        serverInfo: { name: "truthpass-mcp", version: "1.4.0" },
        capabilities: { tools: { listChanged: false } },
        instructions: "TruthPass MCP 的公开工具为只读；受保护工具只返回 pending_confirmation。",
      };
    } else if (method === "ping") {
      result = { status: "ok" };
    } else if (method === "tools/list") {
      result = { tools: [...READ_ONLY_TOOLS, ...PROTECTED_TOOLS.map((name) => ({ name, description: "受保护写操作；只返回 pending_confirmation，不持有私钥。", inputSchema: { type: "object", additionalProperties: true } }))] };
    } else if (method === "tools/call") {
      const name = typeof params.name === "string" ? params.name : "";
      if (!name) return notification ? null : errorResponse(id, traceId, -32602, "tools/call 缺少 name", { method });
      const argumentsValue = params.arguments === undefined ? {} : params.arguments;
      const args = paramsObject(argumentsValue);
      if (PROTECTED_TOOLS.includes(name) && !protectedAuthorized) throw new Error("MCP_AUTH_REQUIRED");
      const toolResult = await invokeTool(name, args, deps, traceId);
      result = {
        content: [{ type: "text", text: JSON.stringify(toolResult) }],
        structuredContent: toolResult,
      };
    } else if (READ_ONLY_TOOLS.some((tool) => tool.name === method) || PROTECTED_TOOLS.includes(method)) {
      if (PROTECTED_TOOLS.includes(method) && !protectedAuthorized) throw new Error("MCP_AUTH_REQUIRED");
      result = await invokeTool(method, params, deps, traceId);
    } else {
      return notification ? null : errorResponse(id, traceId, -32601, "方法不存在", { method });
    }
    return notification ? null : resultResponse(id, result, traceId);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = message === "BATCH_NOT_FOUND" ? -32004 : message === "MCP_AUTH_REQUIRED" ? -32001 : message.includes("params") ? -32602 : -32000;
    return notification ? null : errorResponse(id, traceId, code, message, { method: req.method });
  }
}

async function invokeTool(name: string, args: Record<string, unknown>, deps: TruthPassMcpDependencies, traceId: string): Promise<unknown> {
  if (PROTECTED_TOOLS.includes(name)) return pendingConfirmation(name, traceId);
  if (name === "truthpass.manifest") return { schemaVersion: "truthpass.mcp.manifest.v1", protocol: "MCP_JSON_RPC", dataMode: "demo/synthetic", readOnly: true, tools: READ_ONLY_TOOLS.map((tool) => tool.name), protectedTools: PROTECTED_TOOLS, manifest: deps.manifest(deps.origin()) };
  const batchId = batchIdFrom(args, deps);
  if (name === "truthpass.inspect_batch") return deps.inspectBatch(batchId, traceId);
  if (name === "truthpass.explain_batch") return deps.explainBatch(batchId, typeof args.question === "string" ? args.question : undefined, traceId);
  if (name === "truthpass.lifecycle") return deps.lifecycle(batchId, traceId);
  throw new Error("工具不存在: " + name);
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  let raw = "";
  for await (const chunk of req) {
    raw += chunk.toString();
    if (raw.length > 64 * 1024) throw new Error("请求体过大");
  }
  if (!raw.trim()) throw new Error("请求体不能为空");
  return JSON.parse(raw);
}

function writeResponse(res: ServerResponse, status: number, body: unknown, traceId: string, origin: string): void {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "content-type, authorization, x-request-id, x-truthpass-request-id",
    "Access-Control-Expose-Headers": "x-truthpass-trace-id",
    "X-TruthPass-Trace-Id": traceId,
  });
  res.end(JSON.stringify(body));
}

export function createTruthPassMcpHttpHandler(deps: TruthPassMcpDependencies): (req: IncomingMessage, res: ServerResponse) => Promise<boolean> {
  return async (req, res) => {
    const traceId = traceIdFromRequest(req);
    const origin = deps.origin();
    if (req.method === "OPTIONS") {
      writeResponse(res, 204, "", traceId, origin);
      return true;
    }
    if (req.method !== "POST") {
      writeResponse(res, 405, errorResponse(null, traceId, -32600, "MCP 入口只接受 POST", { allowed: ["POST", "OPTIONS"] }), traceId, origin);
      return true;
    }
    try {
      const payload = await readJson(req);
      const requests = Array.isArray(payload) ? payload : [payload];
      if (!requests.length) {
        writeResponse(res, 400, errorResponse(null, traceId, -32600, "批量请求不能为空"), traceId, origin);
        return true;
      }
      const responses = [];
      for (const item of requests) {
        const response = await invoke(item as RpcRequest, deps, traceId, deps.protectedAuthorized?.(req) ?? false);
        if (response) responses.push(response);
      }
      if (!responses.length) {
        res.writeHead(204, { "Access-Control-Allow-Origin": origin, "X-TruthPass-Trace-Id": traceId });
        res.end();
        return true;
      }
      writeResponse(res, 200, Array.isArray(payload) ? responses : responses[0], traceId, origin);
      console.info(JSON.stringify({ event: "mcp_request", traceId, requestCount: requests.length, responseCount: responses.length }));
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeResponse(res, 400, errorResponse(null, traceId, -32700, "无效的 JSON", { reason: message }), traceId, origin);
      return true;
    }
  };
}
