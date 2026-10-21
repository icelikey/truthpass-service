export type PaymentProvider = "alipay" | "paypal";
export type PaymentOrderStatus = "created" | "approved" | "captured" | "failed" | "pending";

export interface PaymentOrderInput {
  orderId: string;
  batchId: string;
  productId: string;
  amount: string;
  currency: string;
  subject: string;
  returnUrl: string;
  cancelUrl?: string;
  notifyUrl?: string;
}

export interface PaymentOrder {
  provider: PaymentProvider;
  providerOrderId: string;
  orderId: string;
  status: PaymentOrderStatus;
  amount: string;
  currency: string;
  approvalUrl?: string;
  formHtml?: string;
  raw?: Record<string, unknown>;
}

export interface PaymentProviderStatus {
  provider: PaymentProvider;
  configured: boolean;
  mode: "sandbox" | "live" | "production" | "unconfigured";
  missing: string[];
}
