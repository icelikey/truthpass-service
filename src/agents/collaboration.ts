import { parseAgentInput, type AgentOutput, type ConsumerAgentInput } from "./contracts.js";
import { runAgent, type AgentInvoker } from "./runtime.js";
import type { ConsumerAnswer } from "./consumer-assistant.js";

export interface AgentCollaborationResult {
  production: Extract<AgentOutput, { role: "production" }>;
  inspection: Extract<AgentOutput, { role: "inspection" }>;
  consumer: Extract<AgentOutput, { role: "consumer" }>;
}

export type AgentCollaborationPhase =
  | { stage: "production_done" }
  | { stage: "inspection_done" }
  | { stage: "consumer_started" }
  | { stage: "consumer_done" };

export function renderConsumerFacts(card: ConsumerAnswer, selectedFactIds: string[]): string[] {
  const selected = new Set(selectedFactIds);
  const facts = card.facts.filter((_, index) => selected.has("F" + index));
  return facts.length ? facts : [...card.facts];
}

export async function runAgentCollaboration(
  productionInput: unknown,
  inspectionInput: unknown,
  question: string,
  evidenceCard: ConsumerAnswer,
  invoke: AgentInvoker,
  onPhase?: (phase: AgentCollaborationPhase) => void,
): Promise<AgentCollaborationResult> {
  const production = parseAgentInput("production", productionInput);
  const inspection = parseAgentInput("inspection", inspectionInput);
  const batchId = production.view.context.batch.batchId;
  if (inspection.view.context.batch.batchId !== batchId) throw new Error("生产与检测 Agent 输入必须属于同一批次");
  if (evidenceCard.batchId !== batchId) throw new Error("消费者证据卡必须与生产、检测 Agent 属于同一批次");

  const reportDone = <T>(task: Promise<T>, stage: "production_done" | "inspection_done"): Promise<T> =>
    task.then((value) => {
      onPhase?.({ stage });
      return value;
    });
  const [productionOutput, inspectionOutput] = await Promise.all([
    reportDone(runAgent("production", production, invoke), "production_done"),
    reportDone(runAgent("inspection", inspection, invoke), "inspection_done"),
  ]);
  onPhase?.({ stage: "consumer_started" });
  const consumerInput: ConsumerAgentInput = {
    schemaVersion: "agent.input.v1",
    role: "consumer",
    batchId,
    question,
    evidenceCard,
    analyses: { production: productionOutput, inspection: inspectionOutput },
  };
  const consumer = await runAgent("consumer", consumerInput, invoke);
  onPhase?.({ stage: "consumer_done" });
  return { production: productionOutput, inspection: inspectionOutput, consumer };
}
