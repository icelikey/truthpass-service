const state = {
  verifying: false,
  consent: false,
  tags: new Set(),
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function toast(message) {
  const node = $("#toast");
  node.textContent = message;
  node.classList.add("show");
  window.clearTimeout(toast.timer);
  toast.timer = window.setTimeout(() => node.classList.remove("show"), 2800);
}

function openObserver() {
  $("#observer-drawer").classList.add("open");
  $("#drawer-scrim").classList.add("open");
  $("#observer-drawer").setAttribute("aria-hidden", "false");
}

function closeObserver() {
  $("#observer-drawer").classList.remove("open");
  $("#drawer-scrim").classList.remove("open");
  $("#observer-drawer").setAttribute("aria-hidden", "true");
}

async function runVerification() {
  if (state.verifying) return;
  state.verifying = true;
  const button = $("#run-verification");
  const terminal = $("#terminal-body");
  button.disabled = true;
  button.innerHTML = '<span class="button-icon">◌</span> Agent 正在验证…';
  $("#decision-label").textContent = "正在验证证据";
  $("#decision-copy").textContent = "正在调用同一条 CLI/BFF 验证链，网页只展示服务端返回的结果。";

  try {
    const response = await fetch("/api/verify?batchId=FO-2026-001", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`验证服务 HTTP ${response.status}`);
    const payload = await response.json();
    const verification = payload.verification ?? {};
    const chain = payload.chain ?? {};
    const ranking = Array.isArray(verification.ranking) ? verification.ranking : [];
    const selected = ranking.find((item) => item.eligible);
    const lines = [
      ["⌁", selected ? `选择 ${selected.serviceId}：服务端验收通过` : "没有找到可履约的检测服务"],
      ["✓", `JEV：${verification.jevProvider ?? "deterministic-fallback"} 输出结构化路由`],
      ["✓", `规则验收：${verification.status ?? "unknown"} · evidence ${String(verification.evidenceHash ?? "pending").slice(0, 18)}…`],
      [chain.anchored ? "✓" : "◌", chain.anchored ? "主网 receipt 已回读，状态为 anchored" : "主网已部署，业务 receipt 尚未回读，保持 anchor_pending"],
    ];
    lines.forEach(([icon, text]) => {
      const line = document.createElement("div");
      line.className = "cli-line";
      line.innerHTML = `<span class="${icon === "✓" ? "check" : "waiting"}">${icon}</span>${text}`;
      terminal.insertBefore(line, $("#agent-answer"));
    });

    const accepted = verification.status === "accepted" || verification.status === "accepted_with_scope";
    $("#decision-label").textContent = accepted ? "按当前规则通过" : "需要补充证据";
    $("#decision-copy").textContent = chain.anchored
      ? "确定性 Verifier 通过，主网 receipt 已验证。"
      : "确定性 Verifier 通过，但主网业务 receipt 尚未确认；页面不会把部署元数据写成已上链。";
    $("#agent-answer").textContent = chain.anchored
      ? "这批鱼油按当前公开规则通过，主网业务回执已找到。"
      : "这批鱼油按当前公开规则通过；主网合约可达，但本次业务锚定仍等待真实 receipt。";
    renderChainStatus(chain);
    toast("验证完成：结果来自服务端 CLI 链路");
  } catch (error) {
    $("#decision-label").textContent = "服务暂不可用";
    $("#decision-copy").textContent = error instanceof Error ? error.message : String(error);
    $("#agent-answer").textContent = "当前无法读取服务端验证结果，请稍后重试。";
    toast("验证服务暂不可用");
  } finally {
    state.verifying = false;
    button.disabled = false;
    button.innerHTML = '<span class="button-icon">✦</span> 再运行一次验证';
  }
}

function copyCommand() {
  const command = "zhenyan verify batch FO-2026-001 --policy freshness-v1 --json";
  if (navigator.clipboard) navigator.clipboard.writeText(command);
  toast("CLI 命令已复制");
}

async function submitFeedback() {
  if (!state.consent || state.tags.size === 0) return;
  const button = $("#submit-feedback");
  button.disabled = true;
  button.textContent = "正在写入公共反馈…";
  try {
    const response = await fetch("/api/feedback", {
      method: "POST",
      headers: { "content-type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ batchId: "FO-2026-001", rating: 5, categories: [...state.tags], consent: true, purchaseConfirmed: true }),
    });
    if (!response.ok) throw new Error(`反馈服务 HTTP ${response.status}`);
    const result = await response.json();
    button.textContent = `反馈已提交 · 共建积分 +${result.contributionPoints ?? 0}`;
    toast("反馈已绑定购买记录，并生成公共证据哈希");
  } catch (error) {
    button.disabled = false;
    button.textContent = "提交反馈失败 · 重试";
    toast(error instanceof Error ? error.message : "反馈服务暂不可用");
  }
}

function updateFeedbackButton() {
  const button = $("#submit-feedback");
  button.disabled = !state.consent || state.tags.size === 0;
  const points = 5 + state.tags.size * 3;
  button.textContent = state.tags.size ? `提交反馈，获得 ${points} 点共建积分（${state.tags.size}）` : "提交反馈，获得 5 点共建积分";
}

function renderChainStatus(chain) {
  const status = chain.anchored ? "已锚定 · receipt 已验证" : chain.status === "reachable" ? "主网可达 · 业务待锚定" : "主网状态不可用";
  document.querySelectorAll("[data-chain-status]").forEach((node) => {
    node.textContent = status;
    node.classList.toggle("green-text", Boolean(chain.anchored));
    node.classList.toggle("amber-text", !chain.anchored);
  });
  const chip = $("[data-runtime-status]");
  if (chip) chip.textContent = chain.anchored ? "MAINNET / ANCHORED" : "MAINNET / PENDING";
  const hash = $("[data-evidence-hash]");
  const evidenceRoot = chain.replayManifest?.ids?.evidenceRoot;
  if (hash) hash.textContent = evidenceRoot ? `${evidenceRoot.slice(0, 10)}…${evidenceRoot.slice(-6)}` : "等待业务回执";
}

async function loadRuntimeStatus() {
  try {
    const response = await fetch("/api/chain/status", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error(`链状态 HTTP ${response.status}`);
    renderChainStatus(await response.json());
  } catch {
    renderChainStatus({ status: "unreachable", anchored: false });
  }
}

$("#run-verification").addEventListener("click", runVerification);
$("#copy-command").addEventListener("click", copyCommand);
$("#jump-chain").addEventListener("click", () => $("#journey").scrollIntoView({ behavior: "smooth" }));
$("#view-sources").addEventListener("click", openObserver);
$("#open-observer").addEventListener("click", openObserver);
$("#close-observer").addEventListener("click", closeObserver);
$("#drawer-scrim").addEventListener("click", closeObserver);
$("#toggle-detail").addEventListener("click", (event) => {
  const detail = $("#technical-detail");
  const hidden = detail.hasAttribute("hidden");
  detail.toggleAttribute("hidden", !hidden);
  event.currentTarget.innerHTML = hidden ? "收起技术细节 <span>－</span>" : "展开技术细节 <span>＋</span>";
});
$("#consent-toggle").addEventListener("change", (event) => {
  state.consent = event.target.checked;
  toast(state.consent ? "已授权本批次的最小质量反馈范围" : "已撤销本批次反馈授权");
  updateFeedbackButton();
});
$$('.feedback-tag').forEach((tag) => tag.addEventListener("click", () => {
  const value = tag.dataset.tag;
  if (state.tags.has(value)) { state.tags.delete(value); tag.classList.remove("selected"); }
  else { state.tags.add(value); tag.classList.add("selected"); }
  updateFeedbackButton();
}));
$("#submit-feedback").addEventListener("click", submitFeedback);
loadRuntimeStatus();
