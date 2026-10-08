import { useEffect, useRef, useState, type FormEvent } from "react";
import { useChatStream, type ChatMessage } from "../hooks/useChatStream";
import { createOrder, fetchRecommend, postIotSimulation, type IotSimulationMode } from "../api";
import { saveOrderRecord } from "../lib/supabase";
import type { ChatLine, RecommendItem } from "../types";

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

const QUICK_PROMPTS = [
  { label: "证据缺口", q: "这批还缺什么证据？" },
  { label: "签名状态", q: "检测报告的签名能核验吗？" },
  { label: "能买吗", q: "这批现在能放心买吗？" },
  { label: "数据来源", q: "这些证据来自谁？" },
];

const CHAT_SUGGESTIONS = [
  { label: "问证据缺口", value: "这批还缺什么证据？" },
  { label: "问签名状态", value: "检测报告的签名能核验吗？" },
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

function MessageView({ message, onOrder }: { message: ChatMessage; onOrder: (item: RecommendItem) => void }) {
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
        {!message.done && message.lines.length === 0 && (
          <div className="thinking">TruthPass 正在思考中....</div>
        )}
        {message.recommendations && (
          <div className="recommend-list">
            {message.recommendations.map((item, index) => (
              <div className="recommend-card" key={item.batchId}>
                {item.imageUrl && <img src={item.imageUrl} alt="" />}
                <div className="recommend-info">
                  <b>{index + 1}. {item.name}</b>
                  <span>{item.batchId} · {item.origin} · {item.productionDate}</span>
                  <p>{item.reason}</p>
                  {item.expertise && <p className="recommend-expertise">专业提示：{item.expertise}</p>}
                </div>
                <button type="button" className="recommend-order" onClick={() => onOrder(item)}>补货</button>
              </div>
            ))}
          </div>
        )}
        {message.order && (
          <div className="order-card">
            {message.order.imageUrl && <img src={message.order.imageUrl} alt="" />}
            <div className="order-info">
              <b>补货已生成 · {message.order.orderId}</b>
              <span>{message.order.productName} · {message.order.batchId} · 数量 {message.order.quantity}</span>
              <span className="order-status">状态：已确认</span>
            </div>
          </div>
        )}
        {message.error && <div className="disclaimer">{message.error}</div>}
      </div>
    </div>
  );
}

export function ChatPanel({
  onStart,
  onDone,
  onBatch,
  batchId,
}: {
  onStart: () => void;
  onDone: () => void;
  onBatch: (id: string) => void;
  batchId: string | null;
}) {
  const { messages, ask, pushUser, pushAgent } = useChatStream();
  const [input, setInput] = useState("");
  const [batchOpen, setBatchOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [iotBusy, setIotBusy] = useState(false);
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
    const bid = batch ?? extractBatchId(question) ?? batchId;
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

  const recommend = async (text: string) => {
    setInput("");
    pushUser(text);
    pushAgent([{ cls: "plain", text: "好的，我来帮你看补货建议。" }]);
    try {
      const items = await fetchRecommend();
      if (!items.length) {
        pushAgent([{ cls: "plain", text: "当前暂无可补货批次，请保持规律服用。" }]);
      } else {
        pushAgent(
          [{ cls: "plain", text: "根据你的服用情况，建议补货以下批次：" }],
          { recommendations: items },
        );
      }
    } catch {
      pushAgent([{ cls: "disclaimer", text: "推荐服务暂不可用。" }]);
    }
  };

  const handleOrder = async (item: RecommendItem) => {
    if (busy) return;
    try {
      const order = await createOrder(item.batchId, 1);
      void saveOrderRecord({
        orderId: order.orderId,
        batchId: order.batchId,
        productName: order.productName,
        imageUrl: order.imageUrl,
        quantity: order.quantity,
        status: order.status,
      });
      pushAgent(
        [
          { cls: "conclusion", text: `已为你补货：${order.orderId}` },
          { cls: "disclaimer", text: "此为 demo 模拟补货，不产生真实交易。" },
        ],
        { order },
      );
    } catch {
      pushAgent([{ cls: "disclaimer", text: "补货失败，请稍后重试。" }]);
    }
  };

  const simulateIot = async (mode: IotSimulationMode) => {
    const target = batchId ?? "FO-2026-001";
    if (busy || iotBusy) return;
    setIotBusy(true);
    try {
      const result = await postIotSimulation(target, mode);
      await ask(`已上传 IoT 模拟数据：${mode}`, target);
      void result;
    } catch (error) {
      console.error("IoT 模拟上传失败", error);
    } finally {
      setIotBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    if (/(推荐|补货|快吃完|复购|再买|帮我选)/.test(text)) {
      recommend(text);
    } else {
      runVerify(text);
    }
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
          <strong>TruthPass 鱼油助理</strong>
          <small>
            <span className="status-dot" title="在线" />
            在线 · 基于真实数据的 AI 助手
          </small>
        </div>
      </div>

      <div className="chat-log" ref={chatLogRef} aria-live="polite">
        <div className="msg agent">
          <div className="msg-bubble">
            <div className="reason-line">
              你好，我是你的 TruthPass 鱼油助理。从购前咨询、服用提醒，到补货与溯源验证，我全程陪你。今天吃鱼油了吗？
            </div>
          </div>
        </div>
        {messages.map((message) => (
          <MessageView key={message.id} message={message} onOrder={handleOrder} />
        ))}
      </div>

      <div className="chat-quick">
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
        {batchId && <div className="quick-group">
          <span className="chat-quick-label">你想了解：</span>
          {QUICK_PROMPTS.map((prompt) => (
            <button key={prompt.label} onClick={() => runVerify(prompt.q, batchId ?? "FO-2026-001")} disabled={busy}>
              {prompt.label}
            </button>
          ))}
        </div>}
        {batchId && <div className="quick-group">
          <span className="chat-quick-label">IoT 模拟：</span>
          <button onClick={() => simulateIot("normal")} disabled={busy || iotBusy}>正常温度</button>
          <button onClick={() => simulateIot("cold_chain_gap")} disabled={busy || iotBusy}>冷链异常</button>
          <button onClick={() => simulateIot("device_offline")} disabled={busy || iotBusy}>设备离线</button>
        </div>}
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
