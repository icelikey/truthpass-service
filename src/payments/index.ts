export * from "./types.js";
export * from "./alipay.js";
export * from "./paypal.js";

import { alipayStatus } from "./alipay.js";
import { paypalStatus } from "./paypal.js";

export function paymentProviderStatus(env: NodeJS.ProcessEnv = process.env) {
  return { alipay: alipayStatus(env), paypal: paypalStatus(env) };
}
