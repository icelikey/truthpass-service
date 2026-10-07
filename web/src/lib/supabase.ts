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
