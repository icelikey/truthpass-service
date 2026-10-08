import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL || "";
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";

export const supabase = url && anonKey ? createClient(url, anonKey) : null;

export interface VerificationMetric {
  label: string;
  value: string;
  status: string;
}

export interface VerificationRuleItem {
  name: string;
  passed: boolean;
}

export interface VerificationDetails {
  origin?: string;
  productionDate?: string;
  verdict?: string;
  score?: number;
  evidenceHash?: string;
  metrics?: VerificationMetric[];
  rules?: VerificationRuleItem[];
}

export interface VerificationRecordInput {
  batchId: string;
  productName: string;
  status: string;
  details?: VerificationDetails;
}

export async function saveVerificationRecord(input: VerificationRecordInput): Promise<void> {
  if (!supabase) return;
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return;
  const base = {
    user_id: user.user.id,
    batch_id: input.batchId,
    product_name: input.productName,
    status: input.status,
  };
  if (input.details) {
    const { error } = await supabase
      .from("verification_history")
      .insert({ ...base, details: input.details });
    if (!error) return;
  }
  // 兼容旧表结构：没有 details 列时，降级为只写入基础字段。
  await supabase.from("verification_history").insert(base);
}

export interface VerificationHistoryRecord {
  id: string;
  batch_id: string;
  product_name: string;
  status: string;
  created_at: string;
  details?: VerificationDetails | null;
}

export async function fetchVerificationRecords(): Promise<VerificationHistoryRecord[]> {
  if (!supabase) return [];
  const { data } = await supabase
    .from("verification_history")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);
  return ((data ?? []) as Array<Record<string, unknown>>).map((row) => {
    let details: VerificationDetails | null | undefined;
    if (row.details) {
      try {
        details =
          typeof row.details === "string"
            ? (JSON.parse(row.details) as VerificationDetails)
            : (row.details as VerificationDetails);
      } catch {
        details = null;
      }
    }
    return {
      id: String(row.id),
      batch_id: String(row.batch_id ?? ""),
      product_name: String(row.product_name ?? ""),
      status: String(row.status ?? ""),
      created_at: String(row.created_at ?? ""),
      details,
    };
  });
}

export async function clearVerificationRecords(): Promise<boolean> {
  if (!supabase) return false;
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return false;
  const { error } = await supabase
    .from("verification_history")
    .delete()
    .eq("user_id", user.user.id);
  return !error;
}

export interface OrderRecord {
  id: string;
  order_id: string;
  batch_id: string;
  product_name: string;
  image_url?: string | null;
  quantity: number;
  status: string;
  created_at: string;
}

export async function saveOrderRecord(input: {
  orderId: string;
  batchId: string;
  productName: string;
  imageUrl?: string;
  quantity: number;
  status: string;
}): Promise<boolean> {
  if (!supabase) return false;
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return false;
  const { error } = await supabase.from("orders").insert({
    user_id: user.user.id,
    order_id: input.orderId,
    batch_id: input.batchId,
    product_name: input.productName,
    image_url: input.imageUrl ?? null,
    quantity: input.quantity,
    status: input.status,
  });
  return !error;
}

export async function fetchOrderRecords(): Promise<OrderRecord[]> {
  if (!supabase) return [];
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return [];
  const { data } = await supabase
    .from("orders")
    .select("id, order_id, batch_id, product_name, image_url, quantity, status, created_at")
    .eq("user_id", user.user.id)
    .order("created_at", { ascending: false })
    .limit(50);
  return (data ?? []) as OrderRecord[];
}

export async function clearOrderRecords(): Promise<boolean> {
  if (!supabase) return false;
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return false;
  const { error } = await supabase.from("orders").delete().eq("user_id", user.user.id);
  return !error;
}
