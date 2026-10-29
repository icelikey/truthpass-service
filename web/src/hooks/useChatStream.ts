import { useCallback, useRef, useState } from "react";
import { postChat } from "../api";
import type { AgentStreamStage, ChatEvent, ChatLine, OrderCard, RecommendItem } from "../types";

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  lines: ChatLine[];
  done: boolean;
  error?: string;
  recommendations?: RecommendItem[];
  order?: OrderCard;
  meta?: Pick<
    ChatEvent,
    | "agentMode"
    | "serviceStatus"
    | "dataMode"
    | "provider"
    | "model"
    | "providerIssue"
    | "providerResponseStatus"
    | "runtimeStatus"
    | "validationStatus"
    | "validationReasons"
    | "modelAssisted"
    | "fallbackApplied"
    | "evidenceIds"
    | "retrieval"
    | "pipeline"
    | "pipelineDetail"
    | "batchId"
    | "traceId"
    | "sources"
    | "contextMode"
    | "contextSource"
    | "contextRevision"
    | "syncedAt"
    | "chainContext"
    | "stage"
    | "stages"
    | "stageStatuses"
    | "stageDetails"
  >;
}

const STREAM_STAGES: AgentStreamStage[] = [
  "begin",
  "reading_batch",
  "retrieval_completed",
  "verifier_checked",
  "jev_routed",
  "model_started",
  "model_completed",
  "answer",
  "done",
];

function stageFromEvent(event: ChatEvent): AgentStreamStage | undefined {
  if (event.stage && STREAM_STAGES.includes(event.stage)) return event.stage;
  if (event.kind === "answer") return "answer";
  if (event.kind !== "meta" && event.kind !== "line" && STREAM_STAGES.includes(event.kind as AgentStreamStage)) {
    return event.kind as AgentStreamStage;
  }
  return undefined;
}

let seq = 0;
const nextId = () => `m-${++seq}`;

export function useChatStream() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const patch = useCallback((id: string, updater: (m: ChatMessage) => ChatMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? updater(m) : m)));
  }, []);

  const pushUser = useCallback((text: string) => {
    setMessages((prev) => [...prev, { id: nextId(), role: "user", lines: [{ cls: "plain", text }], done: true }]);
  }, []);

  const pushAgent = useCallback((lines: ChatLine[], extras?: { recommendations?: RecommendItem[]; order?: OrderCard }) => {
    setMessages((prev) => [...prev, { id: nextId(), role: "agent", lines, done: true, ...extras }]);
  }, []);

  const ask = useCallback(
    async (question: string, batchId: string | null = null, onEvent?: (event: ChatEvent) => void, locale: "zh" | "en" = "zh") => {
      const text = question.trim();
      if (!text) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      const userMsg: ChatMessage = { id: nextId(), role: "user", lines: [{ cls: "plain", text }], done: true };
      const agentId = nextId();
      const agentMsg: ChatMessage = { id: agentId, role: "agent", lines: [], done: false };
      setMessages((prev) => [...prev, userMsg, agentMsg]);

      try {
        await postChat(
          text,
          batchId,
          (event) => {
            onEvent?.(event);
            if (event.kind === "begin") {
              patch(agentId, (m) => ({
                ...m,
                lines: [],
                meta: { ...m.meta, ...event, stage: "begin", stages: ["begin"], stageStatuses: { ...(m.meta?.stageStatuses ?? {}), begin: "completed" } },
              }));
            } else if (event.kind === "meta") {
              const stage = stageFromEvent(event);
              patch(agentId, (m) => ({
                ...m,
                meta: {
                  ...m.meta,
                  ...event,
                  ...(stage ? { stage, stages: [...new Set([...(m.meta?.stages ?? []), stage])] } : {}),
                  ...(stage ? { stageStatuses: { ...(m.meta?.stageStatuses ?? {}), [stage]: event.status ?? "completed" }, stageDetails: event.detail ? { ...(m.meta?.stageDetails ?? {}), [stage]: event.detail } : m.meta?.stageDetails } : {}),
                },
              }));
            } else if (event.kind !== "done" && (event.kind === "stage" || event.kind === "answer" || stageFromEvent(event)) && stageFromEvent(event)) {
              const stage = stageFromEvent(event)!;
              patch(agentId, (m) => ({
                ...m,
                meta: {
                  ...m.meta,
                  ...event,
                  stage,
                  stages: [...new Set([...(m.meta?.stages ?? []), stage])],
                  stageStatuses: { ...(m.meta?.stageStatuses ?? {}), [stage]: event.status ?? "completed" },
                  stageDetails: event.detail ? { ...(m.meta?.stageDetails ?? {}), [stage]: event.detail } : m.meta?.stageDetails,
                },
                ...(event.kind === "answer" && event.cls && event.text
                  ? { lines: [...m.lines, { cls: event.cls, text: event.text }] }
                  : {}),
              }));
            } else if (event.kind === "line" && event.cls && event.text) {
              patch(agentId, (m) => {
                const last = m.lines[m.lines.length - 1];
                if (last && last.cls === event.cls) {
                  return { ...m, lines: [...m.lines.slice(0, -1), { ...last, text: last.text + event.text }] };
                }
                return { ...m, lines: [...m.lines, { cls: event.cls!, text: event.text! }] };
              });
            } else if (event.kind === "done") {
              patch(agentId, (m) => ({
                ...m,
                done: true,
                meta: { ...m.meta, ...event, stage: "done", stages: [...new Set<AgentStreamStage>([...(m.meta?.stages ?? []), "done"])], stageStatuses: { ...(m.meta?.stageStatuses ?? {}), done: "completed" } },
              }));
            }
          },
          controller.signal,
          locale,
        );
      } catch {
        if (!controller.signal.aborted) {
          patch(agentId, (m) => ({ ...m, done: true, error: "连接中断，请重试" }));
        }
      }
    },
    [patch],
  );

  return { messages, ask, pushUser, pushAgent };
}
