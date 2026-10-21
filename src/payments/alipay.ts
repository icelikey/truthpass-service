import { createSign, createVerify } from "node:crypto";
import type { PaymentOrder, PaymentOrderInput, PaymentProviderStatus } from "./types.js";

const DEFAULT_GATEWAY = "https://openapi.alipay.com/gateway.do";

function env(name: string): string { return process.env[name]?.trim() ?? ""; }

function normalizePem(value: string): string {
  return value.replace(/\\n/g, "\n").trim();
}

function signRsa2(text: string, privateKey: string): string {
  return createSign("RSA-SHA256").update(text, "utf8").sign(normalizePem(privateKey), "base64");
}

function canonicalParams(params: Record<string, string>): string {
  return Object.keys(params)
    .filter((key) => key !== "sign" && key !== "sign_type" && params[key] !== "" && params[key] !== undefined)
    .sort()
    .map((key) => `${key}=${params[key]}`)
    .join("&");
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char] ?? char));
}

export function alipayStatus(envInput: NodeJS.ProcessEnv = process.env): PaymentProviderStatus {
  const missing = ["ALIPAY_APP_ID", "ALIPAY_PRIVATE_KEY", "ALIPAY_PUBLIC_KEY"].filter((key) => !envInput[key]?.trim());
  return { provider: "alipay", configured: missing.length === 0, mode: missing.length ? "unconfigured" : (envInput.ALIPAY_MODE?.trim() === "sandbox" ? "sandbox" : "production"), missing };
}

export function createAlipayPagePayForm(input: PaymentOrderInput, envInput: NodeJS.ProcessEnv = process.env): PaymentOrder {
  const status = alipayStatus(envInput);
  if (!status.configured) throw new Error(`ALIPAY_NOT_CONFIGURED:${status.missing.join(",")}`);
  const outTradeNo = input.orderId;
  const params: Record<string, string> = {
    app_id: envInput.ALIPAY_APP_ID!.trim(),
    method: "alipay.trade.page.pay",
    format: "JSON",
    return_url: input.returnUrl,
    charset: "utf-8",
    sign_type: "RSA2",
    timestamp: new Date().toISOString().replace("T", " ").replace(/\.\d{3}Z$/, ""),
    version: "1.0",
    notify_url: input.notifyUrl ?? "",
    biz_content: JSON.stringify({
      out_trade_no: outTradeNo,
      product_code: "FAST_INSTANT_TRADE_PAY",
      total_amount: input.amount,
      subject: input.subject,
      body: `${input.productId}:${input.batchId}`,
    }),
  };
  params.sign = signRsa2(canonicalParams(params), envInput.ALIPAY_PRIVATE_KEY!);
  const gateway = (envInput.ALIPAY_GATEWAY_URL?.trim() || DEFAULT_GATEWAY).replace(/\/+$/, "");
  const formHtml = `<form id="truthpass-alipay" method="POST" action="${escapeHtml(gateway)}">${Object.entries(params).map(([key, value]) => `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}" />`).join("")}<button type="submit">继续支付宝支付</button></form>`;
  return { provider: "alipay", providerOrderId: outTradeNo, orderId: input.orderId, status: "created", amount: input.amount, currency: input.currency, formHtml, raw: { gateway, method: params.method } };
}

export function verifyAlipayNotify(params: Record<string, string>, envInput: NodeJS.ProcessEnv = process.env): { ok: boolean; orderId?: string; status?: string; amount?: string; reason?: string } {
  const status = alipayStatus(envInput);
  if (!status.configured) return { ok: false, reason: `ALIPAY_NOT_CONFIGURED:${status.missing.join(",")}` };
  const sign = params.sign;
  if (!sign) return { ok: false, reason: "missing_sign" };
  const valid = createVerify("RSA-SHA256").update(canonicalParams(params), "utf8").verify(normalizePem(envInput.ALIPAY_PUBLIC_KEY!), sign, "base64");
  if (!valid) return { ok: false, reason: "invalid_signature" };
  if (params.app_id !== envInput.ALIPAY_APP_ID?.trim()) return { ok: false, reason: "app_id_mismatch" };
  const tradeStatus = params.trade_status ?? params.alipay_trade_status ?? "";
  if (tradeStatus !== "TRADE_SUCCESS" && tradeStatus !== "TRADE_FINISHED") return { ok: false, status: tradeStatus, reason: "payment_not_successful" };
  return { ok: true, orderId: params.out_trade_no, status: tradeStatus, amount: params.total_amount };
}
