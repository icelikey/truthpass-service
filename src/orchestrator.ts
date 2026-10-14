import type { FeedbackRecord, TaskRequest } from "./types.js";
import { ServiceRegistry, type RankedService } from "./registry.js";

export type WorkflowNode = "task_adapter" | "discovery_probe" | "router" | "reputation";
export type WorkflowStatus = "completed" | "no_eligible_service";

export interface WorkflowTraceEntry {
  node: WorkflowNode;
  status: "completed" | "skipped";
  note: string;
}

export interface VerificationWorkflowResult {
  status: WorkflowStatus;
  task: TaskRequest;
  ranking: RankedService[];
  selectedServiceId?: string;
  feedback?: FeedbackRecord;
  trace: WorkflowTraceEntry[];
}

/** Workflow nodes pass structured state; production/inspection/feedback are the domain-agent roles. */
export async function runVerificationWorkflow(
  task: TaskRequest,
  registry: ServiceRegistry,
  createdAt?: string,
): Promise<VerificationWorkflowResult> {
  const trace: WorkflowTraceEntry[] = [
    { node: "task_adapter", status: "completed", note: "任务已通过结构化合同进入流程" },
  ];

  const ranking = await registry.evaluate(task);
  trace.push({ node: "discovery_probe", status: "completed", note: "候选服务已探测并完成确定性验收" });

  const winner = ranking.find((item) => item.eligible);
  if (!winner?.execution) {
    trace.push({ node: "router", status: "skipped", note: "没有符合服务履约条件的候选服务" });
    trace.push({ node: "reputation", status: "skipped", note: "没有成功履约结果可记录" });
    return { status: "no_eligible_service", task, ranking, trace };
  }

  trace.push({ node: "router", status: "completed", note: `已选择服务 ${winner.service.id}` });
  const feedback = await registry.recordFeedback(winner.service.id, task, winner.execution, createdAt);
  trace.push({ node: "reputation", status: "completed", note: "本次服务履约已生成反馈记录" });

  return {
    status: "completed",
    task,
    ranking,
    selectedServiceId: winner.service.id,
    feedback,
    trace,
  };
}
