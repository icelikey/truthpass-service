import assert from "node:assert/strict";
import { generateKeyPairSync, createSign } from "node:crypto";
import test from "node:test";
import { createAlipayPagePayForm, verifyAlipayNotify } from "../src/payments/alipay.js";
import { createPayPalOrder, capturePayPalOrder, paypalStatus } from "../src/payments/paypal.js";

test("支付宝 page pay signs and verifies an RSA2 notification", () => {
  const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKey = keys.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const publicKey = keys.publicKey.export({ type: "spki", format: "pem" }).toString();
  const env = { ALIPAY_APP_ID: "app-test", ALIPAY_PRIVATE_KEY: privateKey, ALIPAY_PUBLIC_KEY: publicKey, ALIPAY_MODE: "sandbox" };
  const order = createAlipayPagePayForm({ orderId: "TP-ORDER-1", batchId: "FO-2026-001", productId: "fish-oil", amount: "0.001", currency: "CNY", subject: "TruthPass fish oil", returnUrl: "https://example.test/pay/return", notifyUrl: "https://example.test/pay/notify" }, env);
  assert.equal(order.provider, "alipay");
  assert.match(order.formHtml ?? "", /alipay\.com/);

  const params: Record<string, string> = { app_id: "app-test", out_trade_no: "TP-ORDER-1", trade_status: "TRADE_SUCCESS", total_amount: "0.001" };
  const canonical = Object.keys(params).sort().map((key) => `${key}=${params[key]}`).join("&");
  params.sign = createSign("RSA-SHA256").update(canonical).sign(privateKey, "base64");
  assert.deepEqual(verifyAlipayNotify(params, env), { ok: true, orderId: "TP-ORDER-1", status: "TRADE_SUCCESS", amount: "0.001" });
});

test("PayPal adapter uses server-side Orders v2 create and capture", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/v1/oauth2/token")) return new Response(JSON.stringify({ access_token: "token-test" }), { status: 200 });
    if (url.endsWith("/v2/checkout/orders")) return new Response(JSON.stringify({ id: "PAYPAL-ORDER-1", status: "CREATED", links: [{ rel: "approve", href: "https://paypal.test/approve" }] }), { status: 201 });
    if (url.includes("/capture")) return new Response(JSON.stringify({ id: "PAYPAL-ORDER-1", status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: "CAP-1", status: "COMPLETED", amount: { currency_code: "USD", value: "1.00" } }] } }] }), { status: 201 });
    return new Response("not found", { status: 404 });
  };
  const env = { PAYPAL_CLIENT_ID: "client-test", PAYPAL_CLIENT_SECRET: "secret-test", PAYPAL_MODE: "sandbox" };
  assert.equal(paypalStatus(env).configured, true);
  const order = await createPayPalOrder({ orderId: "TP-ORDER-2", batchId: "FO-2026-001", productId: "fish-oil", amount: "1.00", currency: "USD", subject: "TruthPass fish oil", returnUrl: "https://example.test/paypal/return" }, fakeFetch, env);
  assert.equal(order.providerOrderId, "PAYPAL-ORDER-1");
  assert.equal(order.approvalUrl, "https://paypal.test/approve");
  const capture = await capturePayPalOrder(order.providerOrderId, fakeFetch, env);
  assert.equal(capture.status, "COMPLETED");
  assert.equal(calls.filter((call) => call.url.endsWith("/v1/oauth2/token")).length, 2);
});
