import { useMemo, useState } from "react";
import { useWallet, WALLET_ROLE_LABELS, type WalletRole } from "./WalletContext";
import { shortHex } from "../lib/wallet";

type ReviewAction = "inspection" | "review" | "arbitration";

const ACTIONS: Array<{ id: ReviewAction; role: WalletRole; title: string; detail: string; next: string }> = [
  { id: "inspection", role: "inspection", title: "确认检测资料", detail: "核对报告、样品号和批次号是否一致。", next: "检测机构钱包签名后，留下不可静默删除的确认记录。" },
  { id: "review", role: "review", title: "提交审核意见", detail: "查看确定性检查和 Agent 引用，决定是否进入下一步。", next: "审核机构确认后，生命周期会更新为已复核或待补证。" },
  { id: "arbitration", role: "arbitration", title: "处理争议", detail: "对冲突资料给出处理意见，保留双方证据。", next: "仲裁结果追加到批次记录，不会覆盖原始争议。" },
];

const EN_ACTIONS: Record<ReviewAction, { title: string; detail: string; next: string; role: string }> = {
  inspection: {
    title: "Confirm testing evidence",
    detail: "Match the report, sample ID, and batch ID.",
    next: "The inspection wallet signs a confirmation that remains in the batch record.",
    role: "Inspection institution",
  },
  review: {
    title: "Submit review decision",
    detail: "Review deterministic checks and cited evidence before deciding.",
    next: "The review institution marks the batch reviewed or asks for more evidence.",
    role: "Review institution",
  },
  arbitration: {
    title: "Handle a dispute",
    detail: "Record a decision on conflicting evidence and preserve both sides.",
    next: "The arbitration result is appended without replacing the original dispute.",
    role: "Arbitration panel",
  },
};

export function InstitutionReviewPanel({ locale = "zh" }: { locale?: "zh" | "en" }) {
  const { address, chainId, walletName, walletRole, bindingStatus, setWalletModalOpen, bindWalletRole } = useWallet();
  const [active, setActive] = useState<ReviewAction>("inspection");
  const [message, setMessage] = useState("");
  const action = useMemo(() => ACTIONS.find((item) => item.id === active) ?? ACTIONS[0], [active]);
  const walletReady = Boolean(address && chainId === 677 && bindingStatus === "bound_verified");
  const en = locale === "en";
  const localizedAction = en ? EN_ACTIONS[action.id] : { title: action.title, detail: action.detail, next: action.next, role: WALLET_ROLE_LABELS[action.role] };

  const bind = async () => {
    const ok = await bindWalletRole(action.role, "demo");
    setMessage(ok
      ? (en ? `Bound ${localizedAction.role}; the next signature will include the batch and role.` : `已绑定${WALLET_ROLE_LABELS[action.role]}身份；下一次签名会带上批次和角色。`)
      : (en ? "Identity binding is incomplete. A real institution needs an administrator invitation and cannot self-declare a role." : "身份绑定未完成。真实机构需要管理员邀请令牌，不能自行声明角色。"));
  };

  return (
    <main className="institution-shell">
      <header className="institution-header">
        <a href={en ? "/en" : "/"} className="institution-brand">TRUTH<span>PASS</span></a>
        <div><span className="eyebrow">INSTITUTION REVIEW</span><h1>{en ? "Review one batch. Keep every decision traceable." : "一批一查，出了问题找得到。"}</h1><p>{en ? "Inspection, review, and arbitration each leave a record. The agent organizes evidence; the assigned wallet confirms it." : "检测、审核、仲裁各自留下记录。Agent 只整理依据，最终确认由对应钱包完成。"}</p></div>
        <div className="institution-header-actions"><a className="institution-language" href={en ? "/institution" : "/en/institution"}>{en ? "中文" : "English"}</a><button type="button" className="merchant-secondary" onClick={() => setWalletModalOpen(true)}>{address ? `${walletName ?? (en ? "Wallet" : "钱包")} · ${shortHex(address)}` : (en ? "Open institution wallet" : "打开机构钱包")}</button></div>
      </header>

      <section className="institution-status-card" aria-label="机构钱包状态">
        <div><span className="eyebrow">{en ? "Connected wallet" : "当前连接"}</span><strong>{address ? shortHex(address) : (en ? "Not connected" : "尚未连接")}</strong><small>{chainId === 677 ? "BOT Chain 677" : (en ? "Chain 677 required" : "需要 Chain 677")} · {bindingStatus === "bound_verified" ? (en ? "Identity bound" : "身份已绑定") : (en ? "Identity not bound" : "身份待绑定")}</small></div>
        <div><span className="eyebrow">{en ? "Current batch" : "当前批次"}</span><strong>FO-2026-001</strong><small>{en ? "Hailan Nutrition · Deep Sea Fish Oil" : "海蓝营养 · 深海鱼油软胶囊"}</small></div>
        <div><span className="eyebrow">{en ? "Data mode" : "资料模式"}</span><strong>DEMO / SYNTHETIC</strong><small>{en ? "Demo data is not certification. A signature records responsibility only." : "不能替代真实认证，签名只留下责任记录。"}</small></div>
      </section>

      <section className="institution-grid">
        <div className="institution-action-list" aria-label={en ? "Institution actions" : "机构操作选择"}>
          {ACTIONS.map((item) => { const copy = en ? EN_ACTIONS[item.id] : { title: item.title, detail: item.detail, role: WALLET_ROLE_LABELS[item.role] }; return <button key={item.id} type="button" className={item.id === active ? "institution-action active" : "institution-action"} onClick={() => { setActive(item.id); setMessage(""); }}><span>{item.id === "inspection" ? (en ? "T" : "检") : item.id === "review" ? (en ? "R" : "审") : (en ? "A" : "仲")}</span><div><strong>{copy.title}</strong><small>{copy.role} · {copy.detail}</small></div></button>; })}
        </div>
        <article className="institution-detail-card">
          <span className="eyebrow">{en ? "Action awaiting signature" : "待签名操作"}</span>
          <h2>{localizedAction.title}</h2>
          <p>{localizedAction.detail}</p>
          <dl><div><dt>{en ? "Required identity" : "需要身份"}</dt><dd>{localizedAction.role}</dd></div><div><dt>{en ? "What remains" : "会留下什么"}</dt><dd>{localizedAction.next}</dd></div><div><dt>{en ? "What will not happen" : "不会发生什么"}</dt><dd>{en ? "The agent will not sign for you or change the quality conclusion." : "Agent 不会替你签名，也不会自动改变质量结论。"}</dd></div></dl>
          <div className="institution-detail-actions"><button type="button" className="merchant-primary" onClick={() => void bind()}>{walletRole === action.role ? (en ? "Identity bound" : "身份已绑定") : `${en ? "Bind " : "绑定"}${en ? ({ inspection: "inspection institution", review: "review institution", arbitration: "arbitration institution" }[action.id]) : WALLET_ROLE_LABELS[action.role]}`}</button><button type="button" className="merchant-secondary" onClick={() => setWalletModalOpen(true)}>{en ? "Confirm wallet action" : "确认钱包操作"}</button></div>
          {!walletReady && <small className="institution-hint">{en ? "Connect a wallet and bind the matching identity first." : "先连接钱包并绑定对应身份；未安装插件时，钱包弹窗会直接给出安装入口。"}</small>}
          {message && <div className="institution-message" role="status">{message}</div>}
        </article>
      </section>

      <section className="institution-records"><div className="institution-records-head"><div><span className="eyebrow">{en ? "Dispute / correction log" : "争议 / 更正记录"}</span><p>{en ? "Original facts and responsible parties remain visible." : "每条记录保留原始事实和责任方。"}</p></div></div><div className="institution-record-list"><article><span className="institution-record-type dispute">{en ? "Dispute" : "争议"}</span><div><strong>{en ? "Origin certificate needs supplement" : "原料产地证明待补充"}</strong><small>{en ? "Producer · 2h ago" : "生产方 · 2 小时前"}</small></div><b className="open">{en ? "Open" : "处理中"}</b></article><article><span className="institution-record-type correction">{en ? "Correction" : "更正"}</span><div><strong>{en ? "Testing report batch ID corrected" : "检测报告批次号已更正"}</strong><small>{en ? "Inspection institution · yesterday" : "检测机构 · 昨日"}</small></div><b>{en ? "Closed" : "已结案"}</b></article></div></section>
      <section className="institution-timeline"><div><span className="eyebrow">{en ? "Lifecycle" : "生命周期"}</span><h2>{en ? "This decision returns to the same batch timeline" : "这次确认会回到同一条批次时间线"}</h2></div><div className="institution-timeline-track">{(en ? ["Production", "Testing", "Cold chain", "Shipment", "Institution review", "Consumer feedback"] : ["生产记录", "检测报告", "冷链记录", "出货记录", "机构复核", "消费者反馈"]).map((label, index) => <div key={label} className={index < 3 ? "done" : ""}><b>{index < 3 ? "✓" : index + 1}</b><span>{label}</span></div>)}</div></section>
    </main>
  );
}
