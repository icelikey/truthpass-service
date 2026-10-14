import type { EvidenceKind } from "../data/model.js";
import { canonicalJson } from "../data/canonical.js";
import type { JevRoleView } from "../jev/model.js";
import { getPolicySnapshot, type PolicySnapshot } from "../rules/policy.js";
import type { ConsumerAnswer } from "./consumer-assistant.js";

export type AgentRole = "production" | "inspection" | "consumer";

interface EvidenceAgentInput { schemaVersion: "agent.input.v1"; role: "production" | "inspection"; view: JevRoleView; }
export interface ProductionAgentInput extends EvidenceAgentInput { role: "production"; }
export interface InspectionAgentInput extends EvidenceAgentInput { role: "inspection"; policy: PolicySnapshot; }
export interface AgentFinding { code: string; summary: string; sourceIds: string[]; }

interface AgentOutputBase { schemaVersion: "agent.output.v1"; batchId: string; }
export interface ProductionAgentOutput extends AgentOutputBase { role: "production"; findings: AgentFinding[]; }
export interface InspectionAgentOutput extends AgentOutputBase { role: "inspection"; findings: AgentFinding[]; }
export interface ConsumerAgentInput {
  schemaVersion: "agent.input.v1";
  role: "consumer";
  batchId: string;
  question: string;
  evidenceCard: ConsumerAnswer;
  analyses: { production: ProductionAgentOutput; inspection: InspectionAgentOutput };
}
export interface ConsumerAgentOutput extends AgentOutputBase { role: "consumer"; selectedFactIds: string[]; }
export type AgentInput = ProductionAgentInput | InspectionAgentInput | ConsumerAgentInput;
export type AgentOutput = ProductionAgentOutput | InspectionAgentOutput | ConsumerAgentOutput;

export class AgentContractError extends Error {
  constructor(readonly path: string, message: string) { super(path + ": " + message); }
}

export function parseAgentInput(role: "production", value: unknown): ProductionAgentInput;
export function parseAgentInput(role: "inspection", value: unknown): InspectionAgentInput;
export function parseAgentInput(role: "consumer", value: unknown): ConsumerAgentInput;
export function parseAgentInput(role: AgentRole, value: unknown): AgentInput;
export function parseAgentInput(role: AgentRole, value: unknown): AgentInput {
  const input = objectAt(value, "input");
  if (role === "consumer") {
    exactKeys(input, ["schemaVersion", "role", "batchId", "question", "evidenceCard", "analyses"], "input");
    literal(input.schemaVersion, "agent.input.v1", "input.schemaVersion");
    literal(input.role, role, "input.role");
    const batchId = stringAt(input.batchId, "input.batchId");
    const question = stringAt(input.question, "input.question");
    const evidenceCard = parseConsumerCard(input.evidenceCard, batchId);
    const analyses = objectAt(input.analyses, "input.analyses");
    exactKeys(analyses, ["production", "inspection"], "input.analyses");
    return {
      schemaVersion: "agent.input.v1", role, batchId, question, evidenceCard, analyses: {
        production: parseUpstreamOutput("production", analyses.production, batchId),
        inspection: parseUpstreamOutput("inspection", analyses.inspection, batchId),
      },
    };
  }

  const keys = role === "production" ? ["schemaVersion", "role", "view"] : ["schemaVersion", "role", "view", "policy"];
  exactKeys(input, keys, "input");
  literal(input.schemaVersion, "agent.input.v1", "input.schemaVersion");
  literal(input.role, role, "input.role");

  const view = objectAt(input.view, "input.view");
  literal(view.schemaVersion, "jev.view.v1", "input.view.schemaVersion");
  literal(view.role, role, "input.view.role");
  const expectedKinds: EvidenceKind[] = role === "production" ? ["production"] : ["inspection", "cold_chain", "shipment"];
  const viewKinds = stringArray(view.allowedEvidenceKinds, "input.view.allowedEvidenceKinds");
  if (!sameSet(viewKinds, expectedKinds)) fail("input.view.allowedEvidenceKinds", "与角色允许的证据类型不一致");

  const context = objectAt(view.context, "input.view.context");
  literal(context.schemaVersion, "jev.context.v1", "input.view.context.schemaVersion");
  const batch = objectAt(context.batch, "input.view.context.batch");
  const batchId = stringAt(batch.batchId, "input.view.context.batch.batchId");
  if (!Array.isArray(context.evidence)) fail("input.view.context.evidence", "必须是数组");
  for (const [index, item] of context.evidence.entries()) {
    const path = "input.view.context.evidence[" + index + "]";
    const evidence = objectAt(item, path);
    stringAt(evidence.evidenceId, path + ".evidenceId");
    literal(evidence.batchId, batchId, path + ".batchId");
    if (!expectedKinds.includes(evidence.kind as EvidenceKind)) fail(path + ".kind", "角色无权接收此证据类型");
  }

  if (role === "production") return { schemaVersion: "agent.input.v1", role, view: input.view as JevRoleView };
  const policy = objectAt(input.policy, "input.policy") as unknown as PolicySnapshot;
  let approved: PolicySnapshot;
  try { approved = getPolicySnapshot(policy.policyId, policy.version); }
  catch { return fail("input.policy", "不是已批准的 PolicySnapshot"); }
  if (canonicalJson(policy) !== canonicalJson(approved)) fail("input.policy", "内容与已批准快照不一致");
  return { schemaVersion: "agent.input.v1", role, view: input.view as JevRoleView, policy: approved };
}

export function parseAgentOutput(role: "production", inputValue: unknown, value: unknown): ProductionAgentOutput;
export function parseAgentOutput(role: "inspection", inputValue: unknown, value: unknown): InspectionAgentOutput;
export function parseAgentOutput(role: "consumer", inputValue: unknown, value: unknown): ConsumerAgentOutput;
export function parseAgentOutput(role: AgentRole, inputValue: unknown, value: unknown): AgentOutput;
export function parseAgentOutput(role: AgentRole, inputValue: unknown, value: unknown): AgentOutput {
  const input = parseAgentInput(role, inputValue);
  const output = objectAt(value, "output");
  exactKeys(output, role === "consumer" ? ["schemaVersion", "role", "batchId", "selectedFactIds"] : ["schemaVersion", "role", "batchId", "findings"], "output");
  literal(output.schemaVersion, "agent.output.v1", "output.schemaVersion");
  literal(output.role, role, "output.role");
  const batchId = role === "consumer" ? (input as ConsumerAgentInput).batchId : (input as ProductionAgentInput | InspectionAgentInput).view.context.batch.batchId;
  literal(output.batchId, batchId, "output.batchId");

  if (role === "consumer") {
    const consumerInput = input as ConsumerAgentInput;
    const selectedFactIds = stringArray(output.selectedFactIds, "output.selectedFactIds");
    const allowedFactIds = new Set(consumerInput.evidenceCard.facts.map((_, index) => "F" + index));
    if (selectedFactIds.length > 30 || new Set(selectedFactIds).size !== selectedFactIds.length) fail("output.selectedFactIds", "最多 30 个且不能重复");
    if (selectedFactIds.some((id) => !allowedFactIds.has(id))) fail("output.selectedFactIds", "只能选择证据卡中已登记的事实 ID");
    return { schemaVersion: "agent.output.v1", role, batchId, selectedFactIds };
  }

  const evidenceInput = input as ProductionAgentInput | InspectionAgentInput;
  const allowedSourceIds = new Set(evidenceInput.view.context.evidence.map((item) => item.evidenceId));
  const findings = parseFindings(output.findings, allowedSourceIds, "output.findings");
  return role === "production"
    ? { schemaVersion: "agent.output.v1", role, batchId, findings }
    : { schemaVersion: "agent.output.v1", role, batchId, findings };
}

function parseUpstreamOutput(role: "production", value: unknown, batchId: string): ProductionAgentOutput;
function parseUpstreamOutput(role: "inspection", value: unknown, batchId: string): InspectionAgentOutput;
function parseUpstreamOutput(role: "production" | "inspection", value: unknown, batchId: string): ProductionAgentOutput | InspectionAgentOutput {
  const path = "input.analyses." + role;
  const output = objectAt(value, path);
  exactKeys(output, ["schemaVersion", "role", "batchId", "findings"], path);
  literal(output.schemaVersion, "agent.output.v1", path + ".schemaVersion");
  literal(output.role, role, path + ".role");
  literal(output.batchId, batchId, path + ".batchId");
  const rawFindings = output.findings;
  if (!Array.isArray(rawFindings) || rawFindings.length > 30) fail(path + ".findings", "必须是最多 30 项的数组");
  const sourceIds = new Set(rawFindings.flatMap((item) => {
    const finding = objectAt(item, path + ".findings");
    return Array.isArray(finding.sourceIds) ? finding.sourceIds.filter((id): id is string => typeof id === "string") : [];
  }));
  const findings = parseFindings(rawFindings, sourceIds, path + ".findings");
  return role === "production"
    ? { schemaVersion: "agent.output.v1", role, batchId, findings }
    : { schemaVersion: "agent.output.v1", role, batchId, findings };
}

function parseConsumerCard(value: unknown, batchId: string): ConsumerAnswer {
  const card = objectAt(value, "input.evidenceCard");
  exactKeys(card, ["batchId", "decision", "headline", "facts", "uncertainties", "nextActions", "evidenceIds", "dataMode"], "input.evidenceCard");
  literal(card.batchId, batchId, "input.evidenceCard.batchId");
  if (!["accepted", "partial", "rejected", "review", "not_assessed"].includes(String(card.decision))) fail("input.evidenceCard.decision", "状态无效");
  if (card.dataMode !== "demo/synthetic" && card.dataMode !== "external") fail("input.evidenceCard.dataMode", "模式无效");
  return {
    batchId,
    decision: card.decision as ConsumerAnswer["decision"],
    headline: stringAt(card.headline, "input.evidenceCard.headline"),
    facts: stringArray(card.facts, "input.evidenceCard.facts"),
    uncertainties: stringArray(card.uncertainties, "input.evidenceCard.uncertainties"),
    nextActions: stringArray(card.nextActions, "input.evidenceCard.nextActions"),
    evidenceIds: stringArray(card.evidenceIds, "input.evidenceCard.evidenceIds"),
    dataMode: card.dataMode,
  };
}

function parseFindings(value: unknown, allowedIds: Set<string>, path: string): AgentFinding[] {
  if (!Array.isArray(value) || value.length > 30) fail(path, "必须是最多 30 项的数组");
  return value.map((raw, index) => {
    const itemPath = path + "[" + index + "]";
    const item = objectAt(raw, itemPath);
    exactKeys(item, ["code", "summary", "sourceIds"], itemPath);
    const code = stringAt(item.code, itemPath + ".code");
    if (!/^[a-z][a-z0-9_]{1,63}$/.test(code)) fail(itemPath + ".code", "格式无效");
    const summary = stringAt(item.summary, itemPath + ".summary");
    if (summary.length > 500) fail(itemPath + ".summary", "最多 500 字符");
    const sourceIds = stringArray(item.sourceIds, itemPath + ".sourceIds");
    if (sourceIds.length === 0) fail(itemPath + ".sourceIds", "每条 Agent 发现必须引用至少一个来源 ID");
    if (sourceIds.some((id) => !allowedIds.has(id))) fail(itemPath + ".sourceIds", "包含输入中不存在的证据 ID");
    return { code, summary, sourceIds };
  });
}

function objectAt(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(path, "必须是对象");
  return value as Record<string, unknown>;
}
function exactKeys(value: Record<string, unknown>, allowed: string[], path: string): void {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length) fail(path, "包含未定义字段: " + extras.join(", "));
}
function stringAt(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") fail(path, "必须是非空字符串");
  return value;
}
function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length > 100) fail(path, "必须是最多 100 项的数组");
  return value.map((item, index) => stringAt(item, path + "[" + index + "]"));
}
function literal(value: unknown, expected: string, path: string): void {
  if (value !== expected) fail(path, "必须等于 " + expected);
}
function sameSet(actual: string[], expected: string[]): boolean {
  return actual.length === expected.length && expected.every((value) => actual.includes(value));
}
function fail(path: string, message: string): never { throw new AgentContractError(path, message); }
