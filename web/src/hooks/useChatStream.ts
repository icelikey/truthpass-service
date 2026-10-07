import { useCallback, useRef, useState } from "react";
import { postChat } from "../api";
import type { ChatLine } from "../types";

export interface ChatMessage {
  id: string;
  role: "user" | "agent";
  lines: ChatLine[];
  done: boolean;
  error?: string;
}

let seq = 0;
const nextId = () => `m-${++seq}`;

export function useChatStream() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const patch = useCallback((id: string, updater: (m: ChatMessage) => ChatMessage) => {
    setMessages((prev) => prev.map((m) => (m.id === id ? updater(m) : m)));
  }, []);

  const ask = useCallback(
    async (question: string, batchId = "") => {
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
            if (event.kind === "begin") {
              patch(agentId, (m) => ({ ...m, lines: [] }));
            } else if (event.kind === "line" && event.cls && event.text) {
              patch(agentId, (m) => {
                const last = m.lines[m.lines.length - 1];
                if (last && last.cls === event.cls) {
                  return { ...m, lines: [...m.lines.slice(0, -1), { ...last, text: last.text + event.text }] };
                }
                return { ...m, lines: [...m.lines, { cls: event.cls!, text: event.text! }] };
              });
            } else if (event.kind === "done") {
              patch(agentId, (m) => ({ ...m, done: true }));
            }
          },
          controller.signal,
        );
      } catch {
        if (!controller.signal.aborted) {
          patch(agentId, (m) => ({ ...m, done: true, error: "连接中断，请重试" }));
        }
      }
    },
    [patch],
  );

  return { messages, ask };
}
