import type { AgentInvocation, AgentInvoker } from "./runtime.js";
import type { AgentFinding, AgentInput } from "./contracts.js";

export interface CompatibleModelOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

interface SanitizedInput {
  value: Record<string, unknown>;
  batchId: string;
  sourceIds: Map<string, string>;
}

export function createCompatibleAgentInvoker(options: CompatibleModelOptions = {}): AgentInvoker {
  const fetchImpl = options.fetchImpl ?? fetch;

  return async (invocation) => {
    const sanitized = sanitizeInput(invocation.input);
    if (sanitized.sourceIds.size === 0) return emptyOutput(invocation, sanitized.batchId);
    const apiKey = options.apiKey ?? process.env.AGENT_API_KEY;
    const model = options.model ?? process.env.AGENT_MODEL;
    const baseUrl = options.baseUrl ?? process.env.AGENT_BASE_URL ?? "https://api.stepfun.com/step_plan/v1";
    if (!apiKey || !model) throw new Error("Agent 模型未配置：需要 AGENT_API_KEY 和 AGENT_MODEL");

    const response = await fetchImpl(completionsEndpoint(baseUrl), {
      method: "POST",
      headers: { Authorization: "Bearer " + apiKey, "Content-Type": "application/json" },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: invocation.systemPrompt + " 输出中的 batchId 必须为 CURRENT_BATCH。" },
          { role: "user", content: JSON.stringify(sanitized.value) },
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!response.ok) throw new Error("Agent 模型请求失败：HTTP " + response.status);

    const body = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> };
    const content = body.choices?.[0]?.message?.content;
    if (typeof content !== "string") throw new Error("Agent 模型未返回 JSON 内容");

    let output: unknown;
    try {
      output = JSON.parse(content);
    } catch {
      throw new Error("Agent 模型返回了无效 JSON");
    }
    return restoreReferences(output, sanitized);
  };
}

function completionsEndpoint(baseUrl: string): string {
  let base = baseUrl.trim();
  while (base.endsWith("/")) base = base.slice(0, -1);
  return base.endsWith("/chat/completions") ? base : base + "/chat/completions";
}

function sanitizeInput(input: AgentInput): SanitizedInput {
  if (input.role === "consumer") {
    const sourceIds = new Map<string, string>();
    const refs = new Map<string, string>();
    const refFor = (id: string) => {
      if (!refs.has(id)) {
        const ref = "E" + refs.size;
        refs.set(id, ref);
        sourceIds.set(ref, id);
      }
      return refs.get(id)!;
    };
    const sanitizeFindings = (findings: AgentFinding[]) =>
      findings.map((finding) => ({ ...finding, sourceIds: finding.sourceIds.map(refFor) }));
    const card = input.evidenceCard;
    const replaceIds = (text: string) => [...refs].reduce((value, [id, ref]) => value.split(id).join(ref), text);
    return {
      value: {
        schemaVersion: input.schemaVersion,
        role: input.role,
        batchId: "CURRENT_BATCH",
        question: input.question,
        evidenceCard: {
          ...card,
          batchId: "CURRENT_BATCH",
          evidenceIds: card.evidenceIds.map(refFor),
          facts: card.facts.map((text, index) => ({ factId: "F" + index, text: replaceIds(text) })),
        },
        analyses: {
          production: { ...input.analyses.production, batchId: "CURRENT_BATCH", findings: sanitizeFindings(input.analyses.production.findings) },
          inspection: { ...input.analyses.inspection, batchId: "CURRENT_BATCH", findings: sanitizeFindings(input.analyses.inspection.findings) },
        },
      },
      batchId: input.batchId,
      sourceIds,
    };
  }
  const sourceIds = new Map<string, string>();
  const batchId = input.view.context.batch.batchId;
  const fillingBatchId = input.view.context.batch.fillingBatchId;
  const aliases = new Map<string, string>();
  let evidenceIndex = 0;
  const evidence = input.view.context.evidence.map((item) => {
    const ref = "E" + evidenceIndex++;
    sourceIds.set(ref, item.evidenceId);
    return {
      evidenceId: ref,
      kind: item.kind,
      sourceKind: item.sourceKind,
      status: item.status,
      dataMode: item.dataMode,
      payload: item.status === "submitted" ? safePayload(item.kind, item.payload, batchId, fillingBatchId, aliases) : {},
    };
  });

  const context = {
    schemaVersion: "jev.context.v1",
    entity: input.view.context.entity,
    product: { category: input.view.context.product.category },
    batch: { batchId: "CURRENT_BATCH", productionAt: input.view.context.batch.productionAt, dataMode: input.view.context.batch.dataMode },
    evidence,
  };

  if (input.role === "production") {
    return { value: { schemaVersion: input.schemaVersion, role: input.role, view: { schemaVersion: input.view.schemaVersion, role: input.role, context } }, batchId, sourceIds };
  }
  return {
    value: {
      schemaVersion: input.schemaVersion,
      role: input.role,
      view: { schemaVersion: input.view.schemaVersion, role: input.role, context },
      policy: { policyId: input.policy.policyId, version: input.policy.version, productCategory: input.policy.productCategory },
    },
    batchId,
    sourceIds,
  };
}

function safePayload(
  kind: string,
  payload: Record<string, unknown>,
  batchId: string,
  fillingBatchId: string,
  aliases: Map<string, string>,
): Record<string, unknown> {
  if (kind === "production") {
    return {
      stage: payload.stage,
      sequence: finite(payload.sequence),
      startedAt: safeDate(payload.startedAt),
      endedAt: safeDate(payload.endedAt),
      inputs: safeLots(payload.inputs, batchId, fillingBatchId, aliases),
      outputs: safeLots(payload.outputs, batchId, fillingBatchId, aliases),
      observations: safeObservations(payload.observations),
      deviations: safeDeviations(payload.deviations),
    };
  }

  const reportBatchId = payload.reportBatchId;
  return {
    reportBatchRelation: typeof reportBatchId === "string" ? reportBatchId === batchId || reportBatchId === fillingBatchId ? "target_batch" : "different_batch" : undefined,
    epaDhaPercent: finite(payload.epaDhaPercent),
    peroxideValue: finite(payload.peroxideValue),
    totox: finite(payload.totox),
    coldChainGapHours: finite(payload.coldChainGapHours),
    logisticsGapHours: finite(payload.logisticsGapHours),
    maxGapHours: finite(payload.maxGapHours),
  };
}

function safeLots(value: unknown, batchId: string, fillingBatchId: string, aliases: Map<string, string>): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const lot = item as Record<string, unknown>;
    const id = typeof lot.lotId === "string" ? lot.lotId : "";
    return [{ lotRef: lotAlias(id, batchId, fillingBatchId, aliases), quantity: finite(lot.quantity), unit: safeUnit(lot.unit) }];
  });
}

function safeObservations(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 30).flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const code = typeof record.code === "string" && /^[a-z0-9_-]{1,40}$/i.test(record.code) ? record.code : undefined;
    return [{ code, value: finite(record.value), unit: safeUnit(record.unit) }];
  });
}

function safeDeviations(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const code = (item as Record<string, unknown>).code;
    return typeof code === "string" && /^[a-z0-9_-]{1,40}$/i.test(code) ? [code] : [];
  });
}

function lotAlias(id: string, batchId: string, fillingBatchId: string, aliases: Map<string, string>): string {
  if (id === batchId || id === fillingBatchId) return "target_batch";
  if (!aliases.has(id)) aliases.set(id, "lot_" + (aliases.size + 1));
  return aliases.get(id)!;
}

function safeUnit(value: unknown): string | undefined {
  return typeof value === "string" && /^[a-z%°/0-9._-]{1,16}$/i.test(value) ? value : undefined;
}

function safeDate(value: unknown): string | undefined {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return undefined;
  return new Date(value).toISOString();
}

function finite(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function restoreReferences(value: unknown, sanitized: SanitizedInput): unknown {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const output = structuredClone(value) as Record<string, unknown>;
  if (output.batchId === "CURRENT_BATCH") output.batchId = sanitized.batchId;
  if (Array.isArray(output.sourceIds)) output.sourceIds = output.sourceIds.map((id) => typeof id === "string" ? sanitized.sourceIds.get(id) ?? id : id);
  for (const key of ["findings", "themes", "anomalies"]) {
    if (!Array.isArray(output[key])) continue;
    output[key] = (output[key] as Array<Record<string, unknown>>).map((finding, index) => ({
      ...normalizeFinding(finding, sanitized.sourceIds, index),
    }));
  }
  return output;
}

function normalizeFinding(finding: Record<string, unknown>, sourceIds: Map<string, string>, index: number): Record<string, unknown> {
  const normalized = { ...finding };
  if (normalized.code === undefined && typeof normalized.type === "string") {
    normalized.code = normalized.type;
    delete normalized.type;
  }
  if (typeof normalized.code === "string") {
    const code = normalized.code.toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 64);
    normalized.code = /^[a-z][a-z0-9_]{1,63}$/.test(code) ? code : "finding_" + (index + 1);
  }
  if (normalized.summary === undefined) {
    if (typeof normalized.description === "string") normalized.summary = normalized.description;
    else if (typeof normalized.content === "string") normalized.summary = normalized.content;
  }
  delete normalized.description;
  delete normalized.content;
  if (normalized.sourceIds === undefined) {
    if (Array.isArray(normalized.evidenceIds)) normalized.sourceIds = normalized.evidenceIds;
    else if (typeof normalized.evidenceId === "string") normalized.sourceIds = [normalized.evidenceId];
  }
  delete normalized.evidenceId;
  delete normalized.evidenceIds;
  if (Array.isArray(normalized.sourceIds)) {
    normalized.sourceIds = normalized.sourceIds.map((id) => typeof id === "string" ? sourceIds.get(id) ?? id : id);
  }
  return normalized;
}

function emptyOutput(invocation: AgentInvocation, batchId: string): unknown {
  return invocation.role === "consumer"
    ? { schemaVersion: "agent.output.v1", role: invocation.role, batchId, selectedFactIds: [] }
    : { schemaVersion: "agent.output.v1", role: invocation.role, batchId, findings: [] };
}
