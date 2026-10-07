import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { sha256Canonical } from "../evidence.js";
import type { JevDecision, JevProvider, JevRoute, JevState } from "./model.js";
import { JEV_SCHEMA_VERSION } from "./model.js";

type ProviderKind = "jev" | "deepseek";
type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;

export interface HttpJevProviderOptions {
  kind: ProviderKind;
  baseUrl: string;
  apiKey: string;
  modelId: string;
  modelVersion?: string;
  ttlMs?: number;
  timeoutMs?: number;
  fetch?: FetchLike;
}

export interface EnvProviderConfig {
  enabled: boolean;
  source: "jev" | "deepseek" | "none";
  provider?: HttpJevProvider;
  reason?: string;
}

function trimBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function boolValue(value: string | undefined): boolean {
  return value === "1" || value?.toLowerCase() === "true" || value?.toLowerCase() === "yes";
}

function routeValue(value: unknown): JevRoute {
  const route = String(value ?? "");
  if (["route_to_rule_verifier", "request_more_evidence", "route_to_recheck", "reject_evidence"].includes(route)) {
    return route as JevRoute;
  }
  if (["route_to_rule", "rule_verifier", "verify", "accepted"].includes(route)) return "route_to_rule_verifier";
  if (["recheck", "review"].includes(route)) return "route_to_recheck";
  if (["reject", "rejected"].includes(route)) return "reject_evidence";
  return "request_more_evidence";
}

function nextActionFor(decision: JevRoute): JevDecision["nextAction"] {
  if (decision === "route_to_rule_verifier") return "run_deterministic_verifier";
  if (decision === "request_more_evidence") return "collect_evidence";
  if (decision === "route_to_recheck") return "run_recheck";
  return "stop";
}

function jsonObject(value: unknown): Record<string, unknown> | undefined {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== "string") return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function outputHash(decision: Omit<JevDecision, "outputHash">): string {
  return sha256Canonical(decision);
}

function toDecision(input: JevState, raw: Record<string, unknown>, options: HttpJevProviderOptions): JevDecision {
  const output = (raw.output && typeof raw.output === "object" ? raw.output : raw) as Record<string, unknown>;
  const decision = routeValue(output.decision ?? output.route ?? output.choice ?? output.result);
  const confidenceCandidate = Number(output.confidence ?? output.score ?? output.probability ?? 0);
  const confidence = Number.isFinite(confidenceCandidate) ? Math.max(0, Math.min(1, confidenceCandidate)) : 0;
  const missingEvidenceCodes = Array.isArray(output.missingEvidenceCodes)
    ? output.missingEvidenceCodes.filter((item): item is string => typeof item === "string")
    : Array.isArray(output.missing)
      ? output.missing.filter((item): item is string => typeof item === "string")
      : [];
  const conflictCodes = Array.isArray(output.conflictCodes)
    ? output.conflictCodes.filter((item): item is string => typeof item === "string")
    : [];
  const now = Date.now();
  const unsigned: Omit<JevDecision, "outputHash"> = {
    taskId: input.taskId,
    decision,
    confidence,
    evidenceScope: input.requestedChecks.join(",") || "batch_identity",
    missingEvidenceCodes,
    conflictCodes,
    selectedServiceIds: input.evidenceRefs.map((item) => item.kind),
    nextAction: nextActionFor(decision),
    modelId: options.modelId,
    modelVersion: options.modelVersion ?? `${options.kind}-http-v1`,
    inputHash: input.inputHash,
    expiresAt: new Date(now + (options.ttlMs ?? 15 * 60_000)).toISOString(),
    schemaVersion: JEV_SCHEMA_VERSION,
    modelAssisted: true,
  };
  return { ...unsigned, outputHash: outputHash(unsigned) };
}

export class HttpJevProvider implements JevProvider {
  private readonly options: {
    kind: ProviderKind;
    baseUrl: string;
    apiKey: string;
    modelId: string;
    modelVersion: string;
    ttlMs: number;
    timeoutMs: number;
    fetch: FetchLike;
  };

  constructor(options: HttpJevProviderOptions) {
    this.options = {
      kind: options.kind,
      baseUrl: trimBaseUrl(options.baseUrl),
      apiKey: options.apiKey,
      modelId: options.modelId,
      modelVersion: options.modelVersion ?? `${options.kind}-http-v1`,
      ttlMs: options.ttlMs ?? 15 * 60_000,
      timeoutMs: options.timeoutMs ?? 3_000,
      fetch: options.fetch ?? fetch,
    };
  }

  async decide(input: JevState, signal?: AbortSignal): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    const combinedSignal = signal ?? controller.signal;
    try {
      const request = this.options.kind === "deepseek"
        ? {
            url: `${this.options.baseUrl}/chat/completions`,
            body: {
              model: this.options.modelId,
              temperature: 0,
              response_format: { type: "json_object" },
              messages: [
                { role: "system", content: "Return JSON only. Decide the safe route for the supplied evidence state. Use keys decision, confidence, missingEvidenceCodes, conflictCodes." },
                { role: "user", content: JSON.stringify(input) },
              ],
            },
          }
        : {
            url: `${this.options.baseUrl}/v1/decide`,
            body: {
              input: JSON.stringify(input),
              schema: {
                decision: { type: "choice", options: ["route_to_rule_verifier", "request_more_evidence", "route_to_recheck", "reject_evidence"] },
                confidence: { type: "score", min: 0, max: 1 },
              },
              model: this.options.modelId,
            },
          };
      const response = await this.options.fetch(request.url, {
        method: "POST",
        headers: { authorization: `Bearer ${this.options.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify(request.body),
        signal: combinedSignal,
      });
      if (!response.ok) throw new Error(`provider HTTP ${response.status}`);
      const payload = await response.json() as Record<string, unknown>;
      const raw = this.options.kind === "deepseek"
        ? jsonObject(((payload.choices as Array<Record<string, unknown>> | undefined)?.[0]?.message as Record<string, unknown> | undefined)?.content)
        : payload;
      if (!raw) throw new Error("provider returned no JSON decision");
      return toDecision(input, raw, this.options);
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Read a local .env file without printing values or overwriting explicit env vars. */
export function loadLocalEnv(path = resolve(process.cwd(), ".env.local")): void {
  try {
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(line);
      if (!match || process.env[match[1]] !== undefined) continue;
      process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
    }
  } catch {
    // Missing local configuration is an expected offline mode.
  }
}

export function providerFromEnv(env = process.env): EnvProviderConfig {
  if (!boolValue(env.TRUTHPASS_LIVE_API)) return { enabled: false, source: "none", reason: "TRUTHPASS_LIVE_API is not true" };
  if (env.JEV_API_KEY && env.JEV_BASE_URL) {
    return {
      enabled: true,
      source: "jev",
      provider: new HttpJevProvider({ kind: "jev", baseUrl: env.JEV_BASE_URL, apiKey: env.JEV_API_KEY, modelId: env.JEV_MODEL ?? "jev" }),
    };
  }
  if (env.DEEPSEEK_API_KEY) {
    return {
      enabled: true,
      source: "deepseek",
      provider: new HttpJevProvider({ kind: "deepseek", baseUrl: env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com", apiKey: env.DEEPSEEK_API_KEY, modelId: env.DEEPSEEK_MODEL ?? "deepseek-chat" }),
    };
  }
  return { enabled: false, source: "none", reason: "live mode enabled but no provider credentials are configured" };
}
