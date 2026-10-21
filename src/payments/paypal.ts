import { randomUUID } from "node:crypto";
import type { PaymentOrder, PaymentOrderInput, PaymentProviderStatus } from "./types.js";

function env(name: string): string { return process.env[name]?.trim() ?? ""; }

export function paypalStatus(envInput: NodeJS.ProcessEnv = process.env): PaymentProviderStatus {
  const missing = ["PAYPAL_CLIENT_ID", "PAYPAL_CLIENT_SECRET"].filter((key) => !envInput[key]?.trim());
  return { provider: "paypal", configured: missing.length === 0, mode: missing.length ? "unconfigured" : (envInput.PAYPAL_MODE?.trim() === "live" ? "live" : "sandbox"), missing };
}

function baseUrl(envInput: NodeJS.ProcessEnv = process.env): string {
  return envInput.PAYPAL_MODE?.trim() === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

async function accessToken(fetchImpl: typeof fetch = fetch, envInput: NodeJS.ProcessEnv = process.env): Promise<string> {
  const status = paypalStatus(envInput);
  if (!status.configured) throw new Error(`PAYPAL_NOT_CONFIGURED:${status.missing.join(",")}`);
  const response = await fetchImpl(`${baseUrl(envInput)}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${envInput.PAYPAL_CLIENT_ID}:${envInput.PAYPAL_CLIENT_SECRET}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials",
  });
  if (!response.ok) throw new Error(`PAYPAL_TOKEN_HTTP_${response.status}`);
  const body = await response.json() as { access_token?: string };
  if (!body.access_token) throw new Error("PAYPAL_TOKEN_MISSING");
  return body.access_token;
}

export async function createPayPalOrder(input: PaymentOrderInput, fetchImpl: typeof fetch = fetch, envInput: NodeJS.ProcessEnv = process.env): Promise<PaymentOrder> {
  const token = await accessToken(fetchImpl, envInput);
  const response = await fetchImpl(`${baseUrl(envInput)}/v2/checkout/orders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", "PayPal-Request-Id": randomUUID(), Prefer: "return=representation" },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{ reference_id: input.orderId, custom_id: `${input.productId}:${input.batchId}`, amount: { currency_code: input.currency.toUpperCase(), value: input.amount }, description: input.subject }],
      application_context: { return_url: input.returnUrl, cancel_url: input.cancelUrl ?? input.returnUrl, user_action: "PAY_NOW" },
    }),
  });
  if (!response.ok) throw new Error(`PAYPAL_CREATE_ORDER_HTTP_${response.status}`);
  const body = await response.json() as { id?: string; status?: string; links?: Array<{ rel?: string; href?: string }> };
  if (!body.id) throw new Error("PAYPAL_ORDER_ID_MISSING");
  const approvalUrl = body.links?.find((link) => link.rel === "approve")?.href;
  return { provider: "paypal", providerOrderId: body.id, orderId: input.orderId, status: "created", amount: input.amount, currency: input.currency, approvalUrl, raw: { status: body.status } };
}

export async function capturePayPalOrder(providerOrderId: string, fetchImpl: typeof fetch = fetch, envInput: NodeJS.ProcessEnv = process.env): Promise<Record<string, unknown>> {
  const token = await accessToken(fetchImpl, envInput);
  const response = await fetchImpl(`${baseUrl(envInput)}/v2/checkout/orders/${encodeURIComponent(providerOrderId)}/capture`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: "{}",
  });
  if (!response.ok) throw new Error(`PAYPAL_CAPTURE_HTTP_${response.status}`);
  return await response.json() as Record<string, unknown>;
}

export async function verifyPayPalWebhook(input: { transmissionId: string; transmissionTime: string; certUrl: string; authAlgo: string; transmissionSig: string; webhookId: string; webhookEvent: Record<string, unknown> }, fetchImpl: typeof fetch = fetch, envInput: NodeJS.ProcessEnv = process.env): Promise<boolean> {
  const token = await accessToken(fetchImpl, envInput);
  const response = await fetchImpl(`${baseUrl(envInput)}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ auth_algo: input.authAlgo, cert_url: input.certUrl, transmission_id: input.transmissionId, transmission_sig: input.transmissionSig, transmission_time: input.transmissionTime, webhook_id: input.webhookId || envInput.PAYPAL_WEBHOOK_ID, webhook_event: input.webhookEvent }),
  });
  if (!response.ok) return false;
  const body = await response.json() as { verification_status?: string };
  return body.verification_status === "SUCCESS";
}
