import { useMemo, useState } from "react";
import { useWallet, WALLET_ROLE_LABELS, type WalletRole } from "./WalletContext";
import { shortHex } from "../lib/wallet";

type ReviewAction = "inspection" | "review" | "arbitration";

const ACTIONS: Array<{ id: ReviewAction; role: WalletRole; title: string; detail: string; next: string }> = [
  { id: "inspection", role: "inspection", title: "确认检测资料", detail: "核对报告、样品号和批次号是否一致。", next: "检测机构钱包签名后，留下不可静默删除的确认记录。" },
  { id: "review", role: "review", title: "提交审核意见", detail: "查看确定性检查和 Agent 引用，决定是否进入下一步。", next: "审核机构确认后，生命周期会更新为已复核或待补证。" },
  { id: "arbitration", role: "arbitration", title: "处理争议", detail: "对冲突资料给出处理意见，保留双方证据。", next: "仲裁结果追加到批次记录，不会覆盖原始争议。" },
];

export function InstitutionReviewPanel() {
  const { address, chainId, walletName, walletRole, bindingStatus, setWalletModalOpen, bindWalletRole } = useWallet();
  const [active, setActive] = useState<ReviewAction>("inspection");
  const [message, setMessage] = useState("");
  const action = useMemo(() => ACTIONS.find((item) => item.id === active) ?? ACTIONS[0], [active]);
  const walletReady = Boolean(address && chainId === 677 && bindingStatus === "bound_verified");

  const bind = async () => {
    const ok = await bindWalletRole(action.role, "demo");
    setMessage(ok ? `已绑定${WALLET_ROLE_LABELS[action.role]}身份；下一次签名会带上批次和角色。` : "身份绑定未完成。真实机构需要管理员邀请令牌，不能自行声明角色。");
  };

  return (
    <main className="institution-shell">
      <header className="institution-header">
        <a href="/" className="institution-brand">TRUTH<span>PASS</span></a>
        <div><span className="eyebrow">INSTITUTION REVIEW</span><h1>一批一查，出了问题找得到。</h1><p>检测、审核、仲裁各自留下记录。Agent 只整理依据，最终确认由对应钱包完成。</p></div>
        <button type="button" className="merchant-secondary" onClick={() => setWalletModalOpen(true)}>{address ? `${walletName ?? "钱包"} · ${shortHex(address)}` : "打开机构钱包"}</button>
      </header>

      <section className="institution-status-card" aria-label="机构钱包状态">
        <div><span className="eyebrow">当前连接</span><strong>{address ? shortHex(address) : "尚未连接"}</strong><small>{chainId === 677 ? "BOT Chain 677" : "需要 Chain 677"} · {bindingStatus === "bound_verified" ? "身份已绑定" : "身份待绑定"}</small></div>
        <div><span className="eyebrow">当前批次</span><strong>FO-2026-001</strong><small>海蓝营养 · 深海鱼油软胶囊</small></div>
        <div><span className="eyebrow">资料模式</span><strong>DEMO / SYNTHETIC</strong><small>不能替代真实认证，签名只留下责任记录。</small></div>
      </section>

      <section className="institution-grid">
        <div className="institution-action-list" aria-label="机构操作选择">
          {ACTIONS.map((item) => <button key={item.id} type="button" className={item.id === active ? "institution-action active" : "institution-action"} onClick={() => { setActive(item.id); setMessage(""); }}><span>{item.id === "inspection" ? "检" : item.id === "review" ? "审" : "仲"}</span><div><strong>{item.title}</strong><small>{WALLET_ROLE_LABELS[item.role]} · {item.detail}</small></div></button>)}
        </div>
        <article className="institution-detail-card">
          <span className="eyebrow">待签名操作</span>
          <h2>{action.title}</h2>
          <p>{action.detail}</p>
          <dl><div><dt>需要身份</dt><dd>{WALLET_ROLE_LABELS[action.role]}</dd></div><div><dt>会留下什么</dt><dd>{action.next}</dd></div><div><dt>不会发生什么</dt><dd>Agent 不会替你签名，也不会自动改变质量结论。</dd></div></dl>
          <div className="institution-detail-actions"><button type="button" className="merchant-primary" onClick={() => void bind()}>{walletRole === action.role ? "身份已绑定" : `绑定${WALLET_ROLE_LABELS[action.role]}`}</button><button type="button" className="merchant-secondary" onClick={() => setWalletModalOpen(true)}>确认钱包操作</button></div>
          {!walletReady && <small className="institution-hint">先连接钱包并绑定对应身份；未安装插件时，钱包弹窗会直接给出安装入口。</small>}
          {message && <div className="institution-message" role="status">{message}</div>}
        </article>
      </section>

      <section className="institution-timeline"><div><span className="eyebrow">生命周期</span><h2>这次确认会回到同一条批次时间线</h2></div><div className="institution-timeline-track">{["生产记录", "检测报告", "冷链记录", "出货记录", "机构复核", "消费者反馈"].map((label, index) => <div key={label} className={index < 3 ? "done" : ""}><b>{index < 3 ? "✓" : index + 1}</b><span>{label}</span></div>)}</div></section>
    </main>
  );
}
