import { useState } from "react";
import { postFeedback } from "../api";
import { FEEDBACK_TAGS } from "../data";
import { useWallet } from "./WalletContext";
import { shortHex } from "../lib/wallet";
import type { SessionChainTx } from "../types";

export function Community({ onToast, batchId }: { onToast: (msg: string) => void; batchId: string | null }) {
  const { address, chainId, walletName, txBusy, executeOnChainAction, setWalletModalOpen } = useWallet();
  const walletReady = Boolean(address && chainId === 677);
  const [consent, setConsent] = useState(false);
  const [purchaseConfirmed, setPurchaseConfirmed] = useState(false);
  const [anchorOnChain, setAnchorOnChain] = useState(true);
  const [tags, setTags] = useState<string[]>([]);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [latestFeedbackReceipt, setLatestFeedbackReceipt] = useState<{
    points: number;
    evidenceHash: string;
    chainTx?: SessionChainTx;
  } | null>(null);

  const toggleTag = (tag: string) =>
    setTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));

  const submit = async () => {
    if (!batchId || !consent || !purchaseConfirmed || submitting) return;
    setSubmitting(true);
    try {
      const result = await postFeedback(batchId, rating, tags, consent, purchaseConfirmed, comment.trim() || undefined);
      let chainTx: SessionChainTx | undefined;

      if (anchorOnChain && address) {
        try {
          chainTx = await executeOnChainAction({
            action: "contribution",
            batchId,
            purchaseId: result.purchaseId,
            points: result.contributionPoints,
          });
        } catch {
          // Wallet user rejected or failed; keep backend feedback result
        }
      }

      setLatestFeedbackReceipt({
        points: result.contributionPoints,
        evidenceHash: result.evidenceHash,
        chainTx,
      });

      onToast(
        chainTx
          ? `反馈已提交并锚定至 BOT Chain Mainnet (677) · 获得 ${result.contributionPoints} 点共建积分`
          : `已提交反馈${result.persisted ? "并已持久化" : ""}，获得 ${result.contributionPoints} 点共建积分 · 哈希 ${result.evidenceHash.slice(0, 10)}…`,
      );
      setConsent(false);
      setPurchaseConfirmed(false);
      setTags([]);
      setRating(0);
      setComment("");
    } catch {
      onToast("提交失败，请稍后重试");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDirectChainAction = async (action: "purchase" | "contribution" | "dispute") => {
    const target = batchId || "FO-2026-001";
    try {
      const tx = await executeOnChainAction({
        action,
        batchId: target,
        points: 20,
        reason: comment.trim() || `Consumer quality verification for ${target}`,
      });
      setLatestFeedbackReceipt({
        points: action === "contribution" ? 20 : 10,
        evidenceHash: tx.txHash,
        chainTx: tx,
      });
    } catch {
      // Handled by WalletProvider toast
    }
  };

  return (
    <>
      <section id="community" className="community">
        <div className="community-bar">
          <div className="community-head">
            <div className="community-emblem" aria-hidden="true">
              <img src="/assets/emblem-community.png" alt="" />
            </div>
            <div className="community-head-text">
              <h2>消费者共建 · BOT Chain Mainnet (677)</h2>
              <p>你的关注与链上签名反馈，让更好的食物和更透明的供应链成为可能。</p>
            </div>
          </div>

          <div className="community-items">
            <div className="community-item">
              <span className="ci-icon" aria-hidden="true">
                <img src="/assets/icon-sprout.png" alt="" />
              </span>
              <div>
                <h3>选择透明的产品</h3>
                <p>用消费支持可持续的供应链</p>
              </div>
            </div>
            <div className="community-item">
              <span className="ci-icon" aria-hidden="true">
                <img src="/assets/icon-camera.png" alt="" />
              </span>
              <div>
                <h3>分享体验</h3>
                <p>上传照片或使用感受</p>
              </div>
            </div>
            <div className="community-item">
              <span className="ci-icon" aria-hidden="true">
                <img src="/assets/icon-star.png" alt="" />
              </span>
              <div>
                <h3>链上共建与监督</h3>
                <p>连接 EVM 钱包将购买、反馈与争议写入 BOT Chain 主网</p>
              </div>
            </div>
          </div>

          <div className="co-build-panel">
            <div className="consent-row">
              <span className="consent-icon" aria-hidden="true">
                ◌
              </span>
              <div className="consent-text">
                <strong>{batchId ? `授权 ${batchId} 的质量反馈` : "暂无可反馈批次"}</strong>
                <small>{batchId ? "提交前需授权反馈用途，并确认已购买该批次；支持 EVM 钱包同步上链存证" : "请先在左侧完成一次批次验证"}</small>
              </div>
              <label className="switch">
                <input
                  type="checkbox"
                  checked={consent}
                  disabled={!batchId}
                  onChange={(e) => {
                    setConsent(e.target.checked);
                    if (!e.target.checked) setPurchaseConfirmed(false);
                  }}
                  aria-label="授权质量反馈"
                />
                <span />
              </label>
            </div>

            <label className="purchase-confirmation">
              <input type="checkbox" checked={purchaseConfirmed} disabled={!batchId || !consent} onChange={(e) => setPurchaseConfirmed(e.target.checked)} />
              <span>我确认已购买此批次（可选择通过连接钱包写入 BOT Chain Mainnet 合约）</span>
            </label>

            <label className="purchase-confirmation">
              <input
                type="checkbox"
                checked={anchorOnChain}
                onChange={(e) => setAnchorOnChain(e.target.checked)}
              />
              <span>
                ⛓️ 提交反馈时同步调用钱包 ({address ? `${walletName ?? "EVM"} ${shortHex(address)}` : "点击右侧连接 MetaMask / OKX / Binance"}) 在 BOT Chain Mainnet (677) 铸造共建积分
              </span>
              {!address && (
                <button type="button" className="inline-wallet-btn" onClick={() => setWalletModalOpen(true)}>
                  连接钱包
                </button>
              )}
            </label>

            <div className="tag-list">
              {FEEDBACK_TAGS.map((tag) => (
                <button
                  key={tag}
                  className={tags.includes(tag) ? "feedback-tag active" : "feedback-tag"}
                  type="button"
                  disabled={!batchId || !consent}
                  onClick={() => toggleTag(tag)}
                >
                  {tag}
                </button>
              ))}
            </div>

            <div className="rating-row">
              <span className="rating-label">质量评分</span>
              <div className="stars">
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    className={n <= rating ? "star active" : "star"}
                    type="button"
                    disabled={!batchId || !consent}
                    onClick={() => setRating(n)}
                    aria-label={`${n} 星`}
                  >
                    ★
                  </button>
                ))}
              </div>
            </div>

            <textarea
              className="feedback-input"
              value={comment}
              disabled={!batchId || !consent}
              onChange={(e) => setComment(e.target.value)}
              placeholder="补充你的体验反馈或争议原因（选填），例如：胶囊大小合适、无结块…"
              rows={2}
            />

            <button
              className="join-btn full"
              type="button"
              disabled={!batchId || !consent || !purchaseConfirmed || submitting || txBusy || rating === 0 || tags.length === 0}
              onClick={submit}
            >
              <span>{submitting || txBusy ? "提交并请求链上签名中…" : "提交反馈"}</span>
              <span>{address && anchorOnChain ? "获得共建积分 + BOT Chain 677 上链" : "获得共建积分"}</span>
            </button>

            <div className="community-chain-bar">
              <span>直接链上交互 (TruthPassConsumerGateway · 0x5192…53F1)：</span>
              <button type="button" disabled={!walletReady || txBusy} onClick={() => handleDirectChainAction("purchase")}>
                ⛓️ 链上登记购买 (ConsumerGateway.recordPurchase)
              </button>
              <button type="button" disabled={!walletReady || txBusy} onClick={() => handleDirectChainAction("contribution")}>
                🌟 链上铸造积分 (ConsumerGateway.recordContribution)
              </button>
              <button type="button" disabled={!walletReady || txBusy} onClick={() => handleDirectChainAction("dispute")}>
                ⚠️ 链上发起质疑 (AuditEscrow.openChallenge)
              </button>
            </div>

            {latestFeedbackReceipt && (
              <div className="wallet-receipt-box">
                <div>
                  <strong>
                    ✓ 已记录共建贡献 (+{latestFeedbackReceipt.points} 积分)
                    {latestFeedbackReceipt.chainTx ? ` · 链上事件 ${latestFeedbackReceipt.chainTx.event}` : ""}
                  </strong>
                  <span>
                    证据/交易哈希：
                    <code>
                      {latestFeedbackReceipt.chainTx
                        ? latestFeedbackReceipt.chainTx.txHash
                        : latestFeedbackReceipt.evidenceHash}
                    </code>
                  </span>
                </div>
                {latestFeedbackReceipt.chainTx ? (
                  <a
                    href={latestFeedbackReceipt.chainTx.explorerUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="explorer-link-btn"
                  >
                    在 BOT Chain 浏览器查看交易 ↗
                  </a>
                ) : (
                  <a
                    href="https://scan.botchain.ai/tx/0x3514623a2b24374ed8a4589a387745fbb15c4945e641daef52ffa1c7b5d89a8d"
                    target="_blank"
                    rel="noreferrer"
                    className="explorer-link-btn"
                  >
                    查看主网示范积分交易 ↗
                  </a>
                )}
              </div>
            )}

            <p className="consent-foot">这是消费服务权益，不代表股权、债权或投资回报。</p>
          </div>
        </div>
        <p className="community-note" aria-hidden="true">
          小小的参与，汇聚成更大的改变。
          <br />
          更好的选择
          <br />
          来自每一个认真的你
        </p>
      </section>

      <footer id="about" className="footer">
        <div className="brand">
          <span className="brand-zh">TruthPass</span>
        </div>
        <span className="footer-divider">|</span>
        <p>让真实被看见，让信任自然发生</p>
        <span className="footer-right">BOT Chain Mainnet (Chain ID 677) · scan.botchain.ai</span>
        <span className="photo-icon" aria-hidden="true">
          ◉
        </span>
      </footer>
    </>
  );
}
