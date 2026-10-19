import { useEffect, useRef, useState, type FormEvent } from "react";
import { useChatStream, type ChatMessage } from "../hooks/useChatStream";
import { createOrder, fetchRecommend, postIotSimulation, type IotSimulationMode } from "../api";
import { saveOrderRecord } from "../lib/supabase";
import { useWallet } from "./WalletContext";
import { shortHex } from "../lib/wallet";
import type { ChatLine, OrderCard, RecommendItem } from "../types";

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
  { label: "这批是什么？", q: "这批是什么？" },
  { label: "检测结果怎么看？", q: "检测结果怎么看？" },
  { label: "运输有没有问题？", q: "运输有没有问题？" },
  { label: "还缺什么资料？", q: "还缺什么资料？" },
  { label: "现在能不能继续了解？", q: "现在能不能继续了解？" },
  { label: "链上有没有记录？", q: "查看这批商品的链上状态" },
];

type AgentSection = { label: "结论" | "依据" | "不确定" | "下一步"; text: string };

function parseAgentSections(lines: ChatLine[]): AgentSection[] {
  const content = lines.map((line) => line.text.trim()).filter(Boolean).join(" ");
  if (!content) return [];
  const matches = [...content.matchAll(/(结论|依据|不确定|下一步)\s*[:：]/g)];
  if (matches.length >= 2) {
    return matches.map((match, index) => ({
      label: match[1] as AgentSection["label"],
      text: content.slice(match.index! + match[0].length, matches[index + 1]?.index ?? content.length).trim(),
    })).filter((section) => section.text.length > 0);
  }
  return lines.map((line): AgentSection => {
    const label: AgentSection["label"] = line.cls === "conclusion" || line.cls === "lead"
      ? "结论"
      : line.cls === "disclaimer"
        ? "不确定"
        : line.cls === "cmd"
          ? "下一步"
          : "依据";
    return { label, text: line.text.trim() };
  }).filter((section) => section.text.length > 0);
}

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

function serviceStatusMeta(status?: string): { pill: string; cls: string; sse: string } | null {
  switch (status) {
    case "model_assisted":
      return { pill: "智能回答", cls: "verified", sse: "loading" };
    case "deterministic_fallback":
      return { pill: "基础回答", cls: "fallback", sse: "fallback" };
    case "provider_unavailable":
      return { pill: "暂时无法连接", cls: "unavailable", sse: "unavailable" };
    case "rate_limited":
      return { pill: "请求较多", cls: "rate-limited", sse: "rate-limited" };
    case "maintenance":
      return { pill: "maintenance", cls: "unavailable", sse: "unavailable" };
    default:
      return null;
  }
}

function MessageView({
  message,
  onOrder,
  onAnchorOrder,
  onHandoff,
  txBusy,
  walletReady,
}: {
  message: ChatMessage;
  onOrder: (item: RecommendItem) => void;
  onAnchorOrder: (order: OrderCard) => void;
  onHandoff: () => void;
  txBusy: boolean;
  walletReady: boolean;
}) {
  if (message.role === "user") {
    return (
      <div className="msg user">
        <div className="msg-bubble">{message.lines.map((l) => l.text).join("")}</div>
      </div>
    );
  }

  const agentMode = message.meta?.agentMode;
  const serviceStatus = message.meta?.serviceStatus ?? agentMode;
  const dataMode = message.meta?.dataMode ?? "demo/synthetic";
  const statusMeta = serviceStatusMeta(serviceStatus);
  const agentLabel = agentMode === "model_assisted" ? "智能回答" : agentMode === "deterministic_fallback" ? "基础回答" : "商品助手";
  const isLoading = !message.done && message.lines.length === 0;
  const showHandoff =
    serviceStatus === "provider_unavailable" ||
    serviceStatus === "rate_limited" ||
    serviceStatus === "deterministic_fallback" ||
    Boolean(message.error);
  const structuredSections = message.done ? parseAgentSections(message.lines) : [];

  return (
    <div className="msg agent">
      <div className="chat-meta" aria-label="回答元信息">
        <span className={`status-pill ${agentMode === "model_assisted" ? "verified" : "fallback"}`}>
          {agentLabel}
        </span>
        <span className={`mode-badge ${dataMode === "external" ? "external" : ""}`}>{dataMode === "external" ? "真实资料" : "演示资料"}</span>
        {statusMeta && serviceStatus !== agentMode && (
          <span className={`status-pill ${statusMeta.cls}`}>{statusMeta.pill}</span>
        )}
        {message.meta?.batchId && (
          <span className="batch-id-chip"><code>{message.meta.batchId}</code></span>
        )}
        {message.meta?.contextRevision !== undefined && (
          <span className="batch-id-chip">资料更新 v{message.meta.contextRevision}</span>
        )}
        {message.meta?.chainContext && (
          <span className={`batch-id-chip chain-chat-chip ${message.meta.chainContext.rpcReachable ? "live" : "offline"}`}>
            {message.meta.chainContext.rpcReachable ? "链在线" : "链暂不可读"} · {message.meta.chainContext.anchorStatus}
          </span>
        )}
      </div>
      {(message.meta?.model || message.meta?.provider || message.meta?.pipeline?.length) && (
        <details className="agent-trace-details">
          <summary>回答依据 · {message.meta.modelAssisted ? `${message.meta.provider ?? "模型"} 已参与解释` : "基础回答"} </summary>
          <div className="agent-trace-grid">
            <span><b>模型</b>{message.meta.modelAssisted ? `${message.meta.provider ?? "兼容接口"} · ${message.meta.model ?? "已配置模型"}` : "deterministic fallback"}</span>
            <span><b>流程</b>{(message.meta.pipeline ?? []).map((stage) => stage === "verifier" ? "规则核验" : stage === "jev" ? "JEV 分流" : stage === "deepseek" ? "DeepSeek 解释" : stage).join(" → ")}</span>
            {message.meta.pipelineDetail && <span><b>结果</b>规则：{message.meta.pipelineDetail.verifier.status} · JEV：{message.meta.pipelineDetail.jev.decision} · 模型：{message.meta.pipelineDetail.deepseek.status}</span>}
            <span><b>引用</b>{message.meta.evidenceIds?.length ? message.meta.evidenceIds.join(" · ") : "当前回答没有额外证据 ID"}</span>
            <span><b>Trace ID</b><code>{message.meta.traceId ?? "—"}</code></span>
          </div>
        </details>
      )}

      {isLoading && (
        <div className="chat-sse-state loading" role="status">正在生成回答…</div>
      )}
      {!message.done && message.lines.length > 0 && (
        <div className="chat-sse-state loading" role="status">流式输出中…</div>
      )}
      {message.done && statusMeta?.sse === "fallback" && (
        <div className="chat-sse-state fallback" role="status">当前使用基础回答，内容仍来自已登记资料。</div>
      )}
      {message.done && statusMeta?.sse === "unavailable" && (
        <div className="chat-sse-state unavailable" role="status">模型服务暂不可用，请稍后重试或转人工。</div>
      )}
      {message.done && statusMeta?.sse === "rate-limited" && (
        <div className="chat-sse-state rate-limited" role="status">请求过于频繁（rate limited），请稍后再问。</div>
      )}

      <div className="msg-bubble">
        {structuredSections.length > 0 ? (
          <div className="agent-structured-answer" aria-label="Agent 回答结构">
            {structuredSections.map((section, index) => (
              <section key={`${section.label}-${index}`} className={`agent-answer-section agent-answer-${section.label}`}>
                <strong>{section.label}</strong>
                <p>{section.text}</p>
              </section>
            ))}
          </div>
        ) : message.lines.map((line, i) => (
          <LineView key={i} line={line} />
        ))}
        {!message.done && message.lines.length === 0 && (
          <div className="thinking">TruthPass 正在整理证据与来源…</div>
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
                <button type="button" className="recommend-order" aria-label={`为 ${item.batchId} 生成购买准备`} onClick={() => onOrder(item)}>
                  购买准备
                </button>
              </div>
            ))}
          </div>
        )}
        {message.order && (
          <div className="order-card">
            {message.order.imageUrl && <img src={message.order.imageUrl} alt="" />}
            <div className="order-info">
              <b>购买准备已生成 · {message.order.orderId}</b>
              <span>{message.order.productName} · {message.order.batchId} · 数量 {message.order.quantity}</span>
              <div className="order-flow-steps" aria-label="购买进度">
                <span className="active">1 购买准备</span>
                <span className={message.order.txHash ? "active" : "current"}>2 商家确认</span>
                <span className={message.order.txHash ? "active" : ""}>3 钱包确认</span>
              </div>
              <span className="order-status">
                状态：{message.order.txHash ? "交易已确认" : "等待商家确认价格和地址"}
              </span>
              {message.order.txHash ? (
                <a
                  href={message.order.explorerUrl ?? `https://scan.botchain.ai/tx/${message.order.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  className="order-chain-link"
                  aria-label={`在区块浏览器核验交易 ${shortHex(message.order.txHash, 10, 6)}`}
                >
                  BOT Chain 交易 {shortHex(message.order.txHash, 10, 6)} · 核验 ↗
                </a>
              ) : (
                <>
                  <button
                    type="button"
                    className="order-anchor-btn"
                    aria-label="使用钱包签名上链存证购买凭证"
                    disabled={!walletReady || txBusy}
                    onClick={() => onAnchorOrder(message.order!)}
                  >
                    {txBusy ? "正在等待钱包确认…" : "确认钱包操作"}
                  </button>
                  {!walletReady && <small className="order-wallet-hint">连接自己的钱包后，才可以确认购买记录。</small>}
                </>
              )}
            </div>
          </div>
        )}
        {message.meta?.sources && message.meta.sources.length > 0 && (
          <div className="chat-sources">
            <b>来源</b> · {message.meta.sources.join(" · ")}
          </div>
        )}
        {message.meta?.chainContext && (
          <div className="chat-chain-context">
            <span>Chain {message.meta.chainContext.chainId} · {message.meta.chainContext.chainName}</span>
            <span>{message.meta.chainContext.latestBlockNumber ? `最新区块 #${message.meta.chainContext.latestBlockNumber}` : "最新区块未读取"}</span>
            {message.meta.chainContext.transaction ? <a href={message.meta.chainContext.transaction.explorerUrl} target="_blank" rel="noreferrer">查看 receipt ↗</a> : <span>当前没有本次会话 receipt</span>}
          </div>
        )}
        {showHandoff && (
          <div className="chat-handoff">
            <button type="button" aria-label="请求人工客服接手" onClick={onHandoff}>
              转人工客服
            </button>
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
  onPurchasePrepared,
  onWalletPending,
  onReceiptVerified,
  afterSalesPrompt,
  onPromptConsumed,
  batchId,
  autoQueryBatch,
  locale = "zh",
}: {
  onStart: () => void;
  onDone: () => void;
  onBatch: (id: string) => void;
  onPurchasePrepared?: () => void;
  onWalletPending?: () => void;
  onReceiptVerified?: () => void;
  afterSalesPrompt?: string;
  onPromptConsumed?: () => void;
  batchId: string | null;
  /** Run the same real Agent query as the batch selector when a consumer searches above the chat. */
  autoQueryBatch?: string | null;
  locale?: "zh" | "en";
}) {
  const { messages, ask, pushUser, pushAgent } = useChatStream();
  const en = locale === "en";
  const { address, chainId, executeOnChainAction, txBusy } = useWallet();
  const walletReady = Boolean(address && chainId === 677);
  const [input, setInput] = useState("");
  const [batchOpen, setBatchOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [iotBusy, setIotBusy] = useState(false);
  const [sensorRun, setSensorRun] = useState<{
    mode: IotSimulationMode;
    evidenceId: string;
    payloadHash: string;
    message: string;
    pipeline: string[];
    verification?: { status?: string; reasons?: string[] };
  } | null>(null);
  const chatLogRef = useRef<HTMLDivElement>(null);
  const recognitionRef = useRef<any>(null);
  const busy = messages.length > 0 && !messages[messages.length - 1].done;
  const lastAutoQueryRef = useRef<string | null>(null);

  useEffect(() => {
    if (!afterSalesPrompt) return;
    setInput(afterSalesPrompt);
    onPromptConsumed?.();
  }, [afterSalesPrompt, onPromptConsumed]);

  useEffect(() => {
    const el = chatLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const runVerify = async (question: string, batch?: string) => {
    if (!question.trim() || busy) return;
    setInput("");
    const bid = batch ?? extractBatchId(question) ?? batchId;
    if (bid) {
      onStart();
      onBatch(bid);
      await ask(question, bid);
      onDone();
    } else {
      await ask(question, "");
    }
  };

  useEffect(() => {
    if (!autoQueryBatch || lastAutoQueryRef.current === autoQueryBatch || busy) return;
    lastAutoQueryRef.current = autoQueryBatch;
    void runVerify(`查询批次 ${autoQueryBatch}`, autoQueryBatch);
  }, [autoQueryBatch, busy]);

  const recommend = async (text: string) => {
    setInput("");
    pushUser(text);
    pushAgent([{ cls: "plain", text: "好的，我来根据已登记批次给出补货参考（演示数据）。" }]);
    try {
      const items = await fetchRecommend();
      if (!items.length) {
        pushAgent([{ cls: "plain", text: "当前暂无可展示的补货批次。" }]);
      } else {
        pushAgent(
          [{ cls: "plain", text: "以下为演示批次参考，不构成购买建议或疗效承诺：" }],
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
      onPurchasePrepared?.();
      pushAgent(
        [
          { cls: "conclusion", text: `已生成购买准备单：${order.orderId}` },
          { cls: "plain", text: "下一步由商家 Checkout Adapter 完成价格、地址与支付；确认后再由钱包写入购买凭证。当前若无 txHash，状态为 anchor_pending。" },
          { cls: "disclaimer", text: "演示环境不展示虚构价格、库存或疗效。" },
        ],
        { order },
      );
    } catch {
      pushAgent([{ cls: "disclaimer", text: "购买准备失败，请稍后重试。" }]);
    }
  };

  const handleAnchorOrder = async (order: OrderCard) => {
    try {
      onWalletPending?.();
      const tx = await executeOnChainAction({
        action: "purchase",
        batchId: order.batchId,
        purchaseId: order.orderId,
      });
      onReceiptVerified?.();
      pushAgent(
        [
          { cls: "conclusion", text: `订单 ${order.orderId} 已提交链上存证交易。` },
          { cls: "cmd", text: `TxHash: ${tx.txHash}` },
          { cls: "disclaimer", text: "请以区块浏览器 receipt 为准；界面展示不等于业务结算完成。" },
        ],
        { order: { ...order, txHash: tx.txHash, explorerUrl: tx.explorerUrl } },
      );
    } catch {
      // Error handled by WalletProvider toast
    }
  };

  const handleHandoff = () => {
    pushAgent([
      { cls: "conclusion", text: "已记录人工转接意向。" },
      { cls: "plain", text: "请通过商家售后渠道继续；Agent 不会把模型回答包装成质量判定。" },
      { cls: "disclaimer", text: "转接入口为产品流程占位，当前演示不创建真实工单。" },
    ]);
  };

  const simulateIot = async (mode: IotSimulationMode) => {
    const target = batchId ?? "FO-2026-001";
    if (busy || iotBusy) return;
    setIotBusy(true);
    try {
      const result = await postIotSimulation(target, mode);
      setSensorRun({ mode, evidenceId: result.evidenceId, payloadHash: result.payloadHash, message: result.message, pipeline: result.pipeline ?? ["设备发送", "服务端接收", "批次关联", "确定性校验"], verification: result.verification });
      await ask(`已上传 IoT 模拟数据：${mode}`, target);
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
          <strong>{en ? "TruthPass Product Agent" : "TruthPass Agent 客服"}</strong>
          <small>
            <span className="status-dot" title={en ? "Online" : "在线"} />
            {en ? "Explains sources · shows uncertainty · gives the next step" : "解释资料来源 · 告诉你不确定的地方 · 给出下一步"}
          </small>
        </div>
      </div>

      <div className="chat-log" ref={chatLogRef} aria-live="polite">
        <div className="msg agent">
          <div className="chat-meta" aria-label={en ? "Welcome message metadata" : "欢迎语元信息"}>
            <span className="status-pill demo">{en ? "Demo data" : "演示资料"}</span>
            <span className="status-pill pending">{en ? "Product Agent" : "商品助手"}</span>
          </div>
          <div className="msg-bubble">
            <div className="agent-structured-answer" aria-label="Agent 回答结构">
              <section className="agent-answer-section agent-answer-结论"><strong>{en ? "Conclusion" : "结论"}</strong><p>{en ? "I will show the product evidence without making a quality promise for anyone." : "我帮你看商品依据，不替任何一方做质量承诺。"}</p></section>
              <section className="agent-answer-section agent-answer-依据"><strong>{en ? "Evidence" : "依据"}</strong><p>{en ? "Production, testing, delivery, and aftercare records are grouped by batch." : "生产、检测、运输和售后资料都按批次整理。"}</p></section>
              <section className="agent-answer-section agent-answer-不确定"><strong>{en ? "Uncertain" : "不确定"}</strong><p>{en ? "This fish oil record is synthetic demo data and is not certification." : "当前鱼油资料是演示资料，不能替代真实认证。"}</p></section>
              <section className="agent-answer-section agent-answer-下一步"><strong>{en ? "Next step" : "下一步"}</strong><p>{en ? "Choose a batch or ask me what evidence is still missing." : "先选择批次，或者直接问我“还缺什么资料”。"}</p></section>
            </div>
          </div>
        </div>
        {messages.map((message) => (
          <MessageView
            key={message.id}
            message={message}
            onOrder={handleOrder}
            onAnchorOrder={handleAnchorOrder}
            onHandoff={handleHandoff}
            txBusy={txBusy}
            walletReady={walletReady}
          />
        ))}
      </div>

      <div className="chat-quick">
        <div className="quick-group">
          <span className="chat-quick-label">{en ? "Batch:" : "批次查询："}</span>
          <div className="batch-select">
            <button
              className="batch-trigger"
              type="button"
              aria-label={en ? "Choose demo batch" : "选择演示批次"}
              aria-expanded={batchOpen}
              onClick={() => setBatchOpen((v) => !v)}
              disabled={busy}
            >
              {en ? "Choose batch" : "选择批次"} <span aria-hidden="true">▾</span>
            </button>
            {batchOpen && (
              <div className="batch-menu">
                {FISH_OIL_BATCHES.map((b) => (
                  <button
                    key={b.id}
                    type="button"
                    aria-label={`${en ? "Inspect batch" : "查询批次"} ${b.id} ${b.name}`}
                    onClick={() => {
                      setBatchOpen(false);
                      runVerify(`${en ? "Inspect batch" : "查询批次"} ${b.id}`, b.id);
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
        {batchId && (
          <div className="quick-group">
            <span className="chat-quick-label">{en ? "Ask about:" : "你想了解："}</span>
            {(en ? QUICK_PROMPTS.map((prompt) => ({ ...prompt, label: prompt.label === "检测" ? "Testing" : prompt.label === "运输" ? "Delivery" : prompt.label === "缺口" ? "Missing" : prompt.label === "链状态" ? "Chain" : prompt.label, q: prompt.q })) : QUICK_PROMPTS).map((prompt) => (
              <button
                key={prompt.label}
                type="button"
                aria-label={prompt.q}
                onClick={() => runVerify(prompt.q, batchId ?? "FO-2026-001")}
                disabled={busy}
              >
                {prompt.label}
              </button>
            ))}
            <button type="button" aria-label="请求人工客服接手" onClick={handleHandoff} disabled={busy}>
              转人工
            </button>
          </div>
        )}
        {batchId && (
          <div className="quick-group">
            <span className="chat-quick-label">{en ? "Sensor simulation:" : "IoT 模拟："}</span>
            <button type="button" aria-label={en ? "Simulate normal temperature" : "模拟正常温度"} onClick={() => simulateIot("normal")} disabled={busy || iotBusy}>{en ? "Normal" : "正常温度"}</button>
            <button type="button" aria-label={en ? "Simulate cold-chain gap" : "模拟冷链异常"} onClick={() => simulateIot("cold_chain_gap")} disabled={busy || iotBusy}>{en ? "Cold-chain gap" : "冷链异常"}</button>
            <button type="button" aria-label={en ? "Simulate offline device" : "模拟设备离线"} onClick={() => simulateIot("device_offline")} disabled={busy || iotBusy}>{en ? "Offline" : "设备离线"}</button>
          </div>
        )}
        {sensorRun && (
          <div className="sensor-transfer-card" aria-live="polite">
            <div className="sensor-transfer-head"><div><span className="chat-quick-label">{en ? "Server sensor replay" : "服务器模拟传感"}</span><strong>{sensorRun.mode === "normal" ? (en ? "Temperature normal" : "温控正常") : sensorRun.mode === "cold_chain_gap" ? (en ? "Cold-chain gap" : "冷链异常") : (en ? "Device offline" : "设备离线")}</strong></div><span className={`sensor-check-pill ${sensorRun.verification?.status === "accepted" ? "pass" : "review"}`}>{sensorRun.verification?.status === "accepted" ? (en ? "Verified" : "校验通过") : (en ? "Needs review" : "进入复核")}</span></div>
            <div className="sensor-transfer-steps">{sensorRun.pipeline.map((step, index) => <span key={step} className={index === sensorRun.pipeline.length - 1 ? "done" : ""}><b>{index + 1}</b>{step}{index < sensorRun.pipeline.length - 1 && <i>→</i>}</span>)}</div>
            <p>{sensorRun.message}</p>
            <small>证据编号 {sensorRun.evidenceId} · payload 已生成摘要 · {sensorRun.verification?.status ?? "待校验"}</small>
          </div>
        )}
      </div>

      <form className="chat-input" onSubmit={submit}>
        <button
          type="button"
          className={listening ? "voice-btn listening" : "voice-btn"}
          onClick={toggleVoice}
          aria-label={listening ? (en ? "Stop voice input" : "停止语音输入") : (en ? "Start voice input" : "开始语音输入")}
          disabled={busy}
        >
          {listening ? "⏺" : "🎤"}
        </button>
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={listening ? (en ? "Listening…" : "正在聆听，请说话…") : (en ? "Ask about a product or batch, e.g. fish oil / FO-2026-001" : "输入商品名或批次号，例如：鱼油 / FO-2026-001")}
          autoComplete="off"
          disabled={busy}
          aria-label={en ? "Agent question" : "Agent 问题输入框"}
        />
        <button type="submit" aria-label={en ? "Send question" : "发送问题"} disabled={busy}>
          ➤
        </button>
      </form>
    </aside>
  );
}
