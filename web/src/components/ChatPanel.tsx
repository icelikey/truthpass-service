import { useEffect, useRef, useState, type FormEvent } from "react";
import { useChatStream, type ChatMessage } from "../hooks/useChatStream";
import type { ChatLine } from "../types";

const FISH_OIL_BATCHES = [
  { id: "FO-2026-001", name: "深海鱼油软胶囊" },
  { id: "FO-2026-002", name: "高纯度 Omega-3 鱼油" },
  { id: "FO-2026-003", name: "儿童 DHA 鱼油滴剂" },
  { id: "FO-2026-004", name: "三文鱼油胶囊" },
  { id: "FO-2026-005", name: "南极磷虾油" },
  { id: "FO-2026-006", name: "高浓度 Omega-3 软胶囊" },
  { id: "FO-2026-007", name: "深海鳕鱼肝油" },
  { id: "FO-2026-008", name: "孕妇 DHA 鱼油" },
  { id: "FO-2026-009", name: "鱼油凝胶软糖" },
  { id: "FO-2026-010", name: "高纯度磷虾油胶囊" },
];

function extractBatchId(text: string): string | null {
  const full = text.match(/([A-Z]{2,3}-\d{4}-\d{3})/i);
  if (full) return full[1].toUpperCase();
  const short = text.match(/\b0*(\d{1,2})\b/);
  if (short) {
    const n = parseInt(short[1], 10);
    if (n >= 1 && n <= 10) return `FO-2026-${String(n).padStart(3, "0")}`;
  }
  return null;
}

function LineView({ line }: { line: ChatLine }) {
  switch (line.cls) {
    case "lead":
      return <div className="conclusion lead">{line.text}</div>;
    case "conclusion":
      return <div className="conclusion">{line.text}</div>;
    case "disclaimer":
      return <div className="disclaimer">{line.text}</div>;
    case "cmd":
      return <div className="reason-line cmd">{line.text}</div>;
    default:
      return <div className="reason-line">{line.text}</div>;
  }
}

function MessageView({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="msg user">
        <div className="msg-bubble">{message.lines.map((l) => l.text).join("")}</div>
      </div>
    );
  }
  return (
    <div className="msg agent">
      <div className="msg-bubble">
        {message.lines.map((line, i) => (
          <LineView key={i} line={line} />
        ))}
        {message.error && <div className="disclaimer">{message.error}</div>}
      </div>
    </div>
  );
}

export function ChatPanel({
  onStart,
  onDone,
  onBatch,
}: {
  onStart: () => void;
  onDone: () => void;
  onBatch: (id: string) => void;
}) {
  const { messages, ask } = useChatStream();
  const [input, setInput] = useState("");
  const [batchOpen, setBatchOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const chatLogRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const busy = messages.length > 0 && !messages[messages.length - 1].done;

  useEffect(() => {
    const el = chatLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const runVerify = async (question: string, batch?: string) => {
    if (!question.trim() || busy) return;
    setInput("");
    const bid = batch ?? extractBatchId(question);
    if (bid) {
      onBatch(bid);
      onStart();
      await ask(question, bid);
      onDone();
    } else {
      // 随意对话：只对话，不触发验证状态，中间框保持待检测
      await ask(question, "");
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    runVerify(input);
  };

  const toggleVoice = () => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    if (listening) {
      recognitionRef.current?.stop();
      setListening(false);
      return;
    }
    const recognition = new SR();
    recognition.lang = "zh-CN";
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event: any) => {
      let text = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        text += event.results[i][0].transcript;
      }
      setInput(text);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition;
    recognition.start();
    setListening(true);
  };

  return (
    <aside id="agent" className="panel chat-panel">
      <div className="chat-head">
        <div className="chat-head-icon" aria-hidden="true">
          <img src="/assets/brand-mark.png" alt="" />
        </div>
        <div className="chat-head-text">
          <strong>与 TruthPass Agent 对话</strong>
          <small>
            <span className="status-dot" title="在线" />
            在线 · 基于真实数据的 AI 助手
          </small>
        </div>
      </div>

      <div className="chat-log" ref={chatLogRef} aria-live="polite">
        <div className="msg agent">
          <div className="msg-bubble">
            <div className="conclusion">你好，请输入商品名或批次号，开始溯源验证。</div>
            <div className="reason-line">例如：鱼油、燕窝，或批次号 FO-2026-001。</div>
          </div>
        </div>
        {messages.map((message) => (
          <MessageView key={message.id} message={message} />
        ))}
      </div>

      <div className="chat-quick">
        <div className="quick-group">
          <span className="chat-quick-label">商品：</span>
          <button
            onClick={() => {
              runVerify("帮我溯源鱼油", "FO-2026-001");
            }}
            disabled={busy}
          >
            鱼油
          </button>
        </div>
        <div className="quick-group">
          <span className="chat-quick-label">批次：</span>
          <div className="batch-select">
            <button className="batch-trigger" type="button" onClick={() => setBatchOpen((v) => !v)} disabled={busy}>
              选择批次 <span aria-hidden="true">▾</span>
            </button>
            {batchOpen && (
              <div className="batch-menu">
                {FISH_OIL_BATCHES.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => {
                      setBatchOpen(false);
                      runVerify(`查询批次 ${b.id}`, b.id);
                    }}
                  >
                    <b>{b.id}</b>
                    <span>{b.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <form className="chat-input" onSubmit={submit}>
        <button
          type="button"
          className={listening ? "voice-btn listening" : "voice-btn"}
          onClick={toggleVoice}
          aria-label={listening ? "停止语音输入" : "开始语音输入"}
          disabled={busy}
        >
          {listening ? "⏺" : "🎤"}
        </button>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={listening ? "正在聆听，请说话…" : "输入商品名或批次号，例如：鱼油 / FO-2026-001"}
          autoComplete="off"
          disabled={busy}
        />
        <button type="submit" aria-label="发送" disabled={busy}>
          ➤
        </button>
      </form>
    </aside>
  );
}
