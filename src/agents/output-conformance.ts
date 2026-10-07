/**
 * 模型输出在进入 contracts 严格校验前的最后一步归一化：
 * 无法修复的条目按条丢弃并告警，避免一条脏数据让整批 Agent 结果作废。
 * contracts 层保持严格门槛；本模块只做边界上的尽力修复。
 */
export interface OutputConformanceOptions {
  /** 允许引用的证据 ID（已还原为本地真实 ID） */
  sourceIds: Iterable<string>;
  /** consumer 证据卡的事实数量，用于过滤越界的 F 引用 */
  factCount?: number;
}

export function conformOutputToContract(value: unknown, options: OutputConformanceOptions): { invalidFactIds: number } {
  let invalidFactIds = 0;
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const output = value as Record<string, unknown>;
  if (Array.isArray(output.findings)) {
    const validSourceIds = new Set(options.sourceIds);
    const before = output.findings.length;
    const kept = output.findings.filter((item): item is Record<string, unknown> => isValidFinding(item, validSourceIds)).slice(0, 30);
    if (kept.length !== before) {
      console.warn("[agent] 丢弃 " + (before - kept.length) + " 条不符合契约的模型发现（共 " + before + " 条）");
    }
    output.findings = kept;
  }
  if (Array.isArray(output.selectedFactIds) && options.factCount !== undefined) {
    const factCount = options.factCount;
    const before = output.selectedFactIds.length;
    const kept = [...new Set(output.selectedFactIds.filter((id): id is string => isValidFactId(id, factCount)))].slice(0, 30);
    if (kept.length !== before) {
      invalidFactIds = before - kept.length;
      console.warn("[agent] 过滤 " + (before - kept.length) + " 个无效事实引用（共 " + before + " 个）");
    }
    output.selectedFactIds = kept;
  }
  return { invalidFactIds };
}

function isValidFinding(item: unknown, validSourceIds: Set<string>): boolean {
  if (!item || typeof item !== "object" || Array.isArray(item)) return false;
  const finding = item as Record<string, unknown>;
  if (typeof finding.code !== "string" || !/^[a-z][a-z0-9_]{1,63}$/.test(finding.code)) return false;
  if (typeof finding.summary !== "string" || finding.summary.trim() === "" || finding.summary.length > 500) return false;
  if (!Array.isArray(finding.sourceIds) || finding.sourceIds.length === 0 || finding.sourceIds.length > 100) return false;
  return finding.sourceIds.every((id) => typeof id === "string" && validSourceIds.has(id));
}

function isValidFactId(id: unknown, factCount: number): boolean {
  if (typeof id !== "string") return false;
  const match = id.match(/^F(\d{1,2})$/);
  return match !== null && parseInt(match[1], 10) < factCount;
}
