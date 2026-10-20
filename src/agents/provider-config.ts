export type AgentProvider = "deepseek" | "opencode" | "compatible";

export interface ResolvedAgentProvider {
  provider: AgentProvider;
  apiKey: string;
  baseUrl: string;
  model: string;
  configured: boolean;
  source: "agent" | "opencode" | "none";
}

/**
 * Resolve the server-side model provider without ever exposing credentials.
 *
 * The existing AGENT_* variables remain the first choice so current DeepSeek
 * deployments keep their behaviour. OpenCode is an opt-in fallback for the
 * public Agent service when only OPENCODE_* is configured.
 */
export function resolveAgentProvider(env: NodeJS.ProcessEnv = process.env): ResolvedAgentProvider {
  const requestedProvider = env.AGENT_PROVIDER?.trim().toLowerCase();
  if (requestedProvider === "opencode") {
    const openCodeKey = env.OPENCODE_API_KEY?.trim();
    if (openCodeKey) {
      return {
        provider: "opencode",
        apiKey: openCodeKey,
        baseUrl: (env.OPENCODE_BASE_URL?.trim() || "https://opencode.ai/inference/openai/v1").replace(/\/+$/, ""),
        model: env.OPENCODE_MODEL?.trim() || "deepseek-v4.1-flash",
        configured: true,
        source: "opencode",
      };
    }
    return {
      provider: "opencode",
      apiKey: "",
      baseUrl: "",
      model: "deterministic-fallback",
      configured: false,
      source: "none",
    };
  }

  const agentKey = env.AGENT_API_KEY?.trim();
  const agentModel = env.AGENT_MODEL?.trim();
  if (agentKey && agentModel) {
    const baseUrl = (env.AGENT_BASE_URL?.trim() || "https://api.deepseek.com").replace(/\/+$/, "");
    return {
      provider: providerForBaseUrl(baseUrl, env.AGENT_PROVIDER),
      apiKey: agentKey,
      baseUrl,
      model: agentModel,
      configured: true,
      source: "agent",
    };
  }

  const openCodeKey = env.OPENCODE_API_KEY?.trim();
  if (openCodeKey) {
    return {
      provider: "opencode",
      apiKey: openCodeKey,
      baseUrl: (env.OPENCODE_BASE_URL?.trim() || "https://opencode.ai/inference/openai/v1").replace(/\/+$/, ""),
      model: env.OPENCODE_MODEL?.trim() || "deepseek-v4.1-flash",
      configured: true,
      source: "opencode",
    };
  }

  return {
    provider: "compatible",
    apiKey: "",
    baseUrl: "",
    model: "deterministic-fallback",
    configured: false,
    source: "none",
  };
}

function providerForBaseUrl(baseUrl: string, explicit?: string): AgentProvider {
  const value = explicit?.trim().toLowerCase();
  if (value === "deepseek" || value === "opencode" || value === "compatible") return value;
  try {
    const host = new URL(baseUrl).hostname.toLowerCase();
    if (host.includes("deepseek")) return "deepseek";
    if (host.includes("opencode.ai")) return "opencode";
  } catch {
    // Keep the generic label for a malformed or local compatible endpoint.
  }
  return "compatible";
}

export function providerEndpoint(baseUrl: string): string {
  let base = baseUrl.trim().replace(/\/+$/, "");
  if (base.endsWith("/chat/completions")) return base;
  // DeepSeek's public endpoint is rooted at /chat/completions. Keep the
  // historical compatibility with deployments that set /v1 in the base URL.
  if (/api\.deepseek\.com\/v1$/i.test(base)) base = base.replace(/\/v1$/i, "");
  return base + "/chat/completions";
}
