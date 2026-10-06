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

function runVerification() {
  if (state.verifying) return;
  state.verifying = true;
  const button = $("#run-verification");
  const terminal = $("#terminal-body");
  button.disabled = true;
  button.innerHTML = '<span class="button-icon">◌</span> Agent 正在验证…';
  $("#decision-label").textContent = "正在验证证据";
  $("#decision-copy").textContent = "正在探测服务并执行 fish-oil-freshness-v1，网页只是同一条 CLI 链路的观察台。";
  const lines = [
    ["⌁", "探测 lab-a：在线，但返回批次不一致"],
    ["⌁", "探测 lab-b：当前离线，跳过调用"],
    ["✓", "JEV：固定类型判别为 route_to_rule_verifier · confidence 0.94"],
    ["✓", "选择 lab-c：签名、指标和冷链证据可验收"],
    ["✓", "生成证据根哈希，等待消费者共建授权"],
  ];
  lines.forEach(([icon, text], index) => {
    window.setTimeout(() => {
      const line = document.createElement("div");
      line.className = "cli-line";
      line.innerHTML = `<span class="${icon === "✓" ? "check" : "waiting"}">${icon}</span>${text}`;
      terminal.insertBefore(line, $("#agent-answer"));
      terminal.scrollTop = terminal.scrollHeight;
    }, 380 * (index + 1));
  });
  window.setTimeout(() => {
    state.verifying = false;
    button.disabled = false;
    button.innerHTML = '<span class="button-icon">✦</span> 再运行一次验证';
    $("#decision-label").textContent = "按当前规则通过";
    $("#decision-copy").textContent = "基于第三方检测、冷链记录和链上证据锚定，当前未发现规则范围内的异常。";
    toast("验证完成：lab-c 进入公共履约记录");
  }, 2300);
}

function copyCommand() {
  const command = "zhenyan verify batch FO-2026-001 --policy freshness-v1 --json";
  if (navigator.clipboard) navigator.clipboard.writeText(command);
  toast("CLI 命令已复制");
}

function submitFeedback() {
  if (!state.consent || state.tags.size === 0) return;
  $("#submit-feedback").disabled = true;
  $("#submit-feedback").textContent = "反馈已提交 · 共建积分 +14";
  toast("反馈已绑定 FO-2026-001，并生成公共证据哈希");
}

function updateFeedbackButton() {
  const button = $("#submit-feedback");
  button.disabled = !state.consent || state.tags.size === 0;
  button.textContent = state.tags.size ? `提交反馈，获得 14 点共建积分（${state.tags.size}）` : "提交反馈，获得 14 点共建积分";
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
