import { canonicalJson } from "../data/canonical.js";
import { getAgentToolAllowlist, type AgentToolName } from "../tools/truthpass-tools.js";
import { parseAgentInput, parseAgentOutput, type AgentInput, type AgentOutput, type AgentRole } from "./contracts.js";
import { conformOutputToContract } from "./output-conformance.js";

const roleGuidance: Record<AgentRole, string> = {
  production: [
    "你是真验的生产证据辅助分析角色，只分析输入中已登记的生产记录。",
    "识别批次交接、工序时间、已记录偏差和证据覆盖缺口；只报告输入明确支持的发现。",
    "不得判断商品是否合格、不得给分或风险等级、不得把厂商自报说成独立验证，也不得补写缺失事实。",
  ].join(" "),
  inspection: [
    "你是真验的检测证据辅助分析角色，只分析输入中已登记的检测、温控和运输证据。",
    "指出报告与批次、时间或证据范围之间可由输入支持的不一致或待核实项。签名字段存在不代表签名已通过密码学验证。",
    "不得计算或改写验收结论、分数或风险等级；最终判定由确定性代码完成。不得把证据缺失说成检测失败。",
  ].join(" "),
  consumer: [
    "你是真验的消费者 Agent。理解消费者问题，阅读确定性证据卡和生产、检测 Agent 的分析 JSON，只选择与问题相关、且已在证据卡中出现的事实索引。",
    "生产/检测 Agent 的 findings 是未验证的模型线索，不是事实；不得把它们转述为结论。你不能生成任何回答文本、事实、数值、验收判断或引用，只能返回证据卡已有的 selectedFactIds。",
    "不得决定或改写验收结论、分数、信誉或路由；购买查询、证据卡读取和反馈提交由应用的受限流程执行。用户想提交包装、气味或保存反馈时，引导其到页面下方的消费者共建表单，明确授权并确认已购买后提交；不得声称已替用户完成未执行的操作。",
  ].join(" "),
};

function findingSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["code", "summary", "sourceIds"],
    properties: {
      code: { type: "string", pattern: "^[a-z][a-z0-9_]{1,63}$" },
      summary: { type: "string" },
      sourceIds: { type: "array", items: { type: "string" } },
    },
  };
}

function outputSchema(role: AgentRole): Record<string, unknown> {
  if (role === "consumer") return {
    type: "object", additionalProperties: false, required: ["schemaVersion", "role", "batchId", "selectedFactIds"],
    properties: { schemaVersion: { type: "string", enum: ["agent.output.v1"] }, role: { type: "string", enum: [role] }, batchId: { type: "string" }, selectedFactIds: { type: "array", items: { type: "string", pattern: "^F[0-9]{1,2}$" } } },
  };
  const common = {
    schemaVersion: { type: "string", enum: ["agent.output.v1"] },
    role: { type: "string", enum: [role] },
    batchId: { type: "string" },
  };
  return { type: "object", additionalProperties: false, required: ["schemaVersion", "role", "batchId", "findings"], properties: { ...common, findings: { type: "array", items: findingSchema() } } };
}

function systemPrompt(role: AgentRole): string {
  return roleGuidance[role] + " 只返回一个 JSON 对象，字段必须严格符合此 schema；不得输出 Markdown 或额外字段：" + JSON.stringify(outputSchema(role));
}

export function getAgentRoleGuidance(role: AgentRole): string {
  return roleGuidance[role];
}

export interface AgentInvocation {
  role: AgentRole;
  systemPrompt: string;
  input: AgentInput;
  allowedTools: readonly AgentToolName[];
}

export type AgentInvoker = (invocation: AgentInvocation) => Promise<unknown>;

export function runAgent(role: "production", rawInput: unknown, invoke: AgentInvoker): Promise<Extract<AgentOutput, { role: "production" }>>;
export function runAgent(role: "inspection", rawInput: unknown, invoke: AgentInvoker): Promise<Extract<AgentOutput, { role: "inspection" }>>;
export function runAgent(role: "consumer", rawInput: unknown, invoke: AgentInvoker): Promise<Extract<AgentOutput, { role: "consumer" }>>;
export async function runAgent(role: AgentRole, rawInput: unknown, invoke: AgentInvoker): Promise<AgentOutput> {
  const input = parseAgentInput(role, rawInput);
  const rawOutput = await invoke({
    role,
    systemPrompt: systemPrompt(role),
    input: JSON.parse(canonicalJson(input)) as AgentInput,
    allowedTools: role === "consumer" ? [] : getAgentToolAllowlist(role),
  });
  const output = structuredClone(rawOutput);
  const conformance = conformOutputToContract(output, {
    sourceIds: input.role === "consumer"
      ? [...input.evidenceCard.evidenceIds, ...input.analyses.production.findings.flatMap((finding) => finding.sourceIds), ...input.analyses.inspection.findings.flatMap((finding) => finding.sourceIds)]
      : input.view.context.evidence.map((item) => item.evidenceId),
    factCount: input.role === "consumer" ? input.evidenceCard.facts.length : undefined,
  });
  if (role === "consumer" && conformance.invalidFactIds > 0) {
    throw new Error("只能选择证据卡中已登记的事实 ID");
  }
  return parseAgentOutput(role, input, output);
}
