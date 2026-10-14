// 聊天任务快照的 Postgres 持久化：内存 Map 为 L1，本模块为 L2（重启存活、多实例共享）。
// 约束与 persistence.ts 相同：全参数绑定（$1...），幂等 upsert，SQL 收口在本模块。
// 建表沿用 createPostgresReplayGuard 的先例——代码内 create table if not exists，无需手工贴 SQL。
import type { Pool } from "pg";
import { getDatabasePool, persistenceEnabled } from "./persistence.js";

export interface PersistedChatLine {
  seq: number;
  event: Record<string, unknown>;
}

export interface ChatTaskRow {
  taskId: string;
  batchId: string;
  question: string;
  status: "running" | "completed" | "error";
  intent: string | null;
  finishReason: "completed" | "error" | null;
  degraded: boolean;
  lines: PersistedChatLine[];
  error: { code: string; retryable: boolean; message: string } | null;
  seq: number;
  updatedAt: Date | null;
}

// 与内存快照同步的防抖窗口：终态事件绕过防抖立即落库
export const PERSIST_DEBOUNCE_MS = 400;
// running 且超过该秒数无更新 → 判定持有进程已死亡，不再等待
export const STALE_AFTER_SECONDS = 150;

let tableReady: Promise<void> | undefined;

function ensureTable(pool: Pool): Promise<void> {
  tableReady ??= pool.query("create table if not exists truthpass_chat_tasks (task_id uuid primary key, batch_id text not null default '', question text not null default '', status text not null default 'running', intent text, finish_reason text, degraded boolean not null default false, lines jsonb not null default '[]'::jsonb, error jsonb, seq integer not null default 0, created_at timestamptz not null default now(), updated_at timestamptz not null default now())").then(() => undefined);
  return tableReady;
}

export async function upsertChatTask(
  row: Omit<ChatTaskRow, "updatedAt">,
  pool: Pool = getDatabasePool(),
): Promise<void> {
  if (!persistenceEnabled()) return;
  try {
    await ensureTable(pool);
    await pool.query("insert into truthpass_chat_tasks (task_id, batch_id, question, status, intent, finish_reason, degraded, lines, error, seq, updated_at) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now()) on conflict (task_id) do update set status = excluded.status, intent = coalesce(excluded.intent, truthpass_chat_tasks.intent), finish_reason = excluded.finish_reason, degraded = excluded.degraded, lines = excluded.lines, error = excluded.error, seq = excluded.seq, updated_at = now()", [
      row.taskId, row.batchId, row.question, row.status, row.intent, row.finishReason,
      row.degraded, JSON.stringify(row.lines), row.error ? JSON.stringify(row.error) : null, row.seq,
    ]);
  } catch (error) {
    // 持久化失败不能打断聊天链路：内存快照继续服务本机恢复，仅降级掉跨进程能力
    console.error("[chat-store] 任务落库失败:", error instanceof Error ? error.message : String(error));
  }
}

function toPersistedLine(event: Record<string, unknown>, seq: number): PersistedChatLine {
  return { seq, event };
}

/** 把一条 SSE 事件合入持久化行（与内存快照共用同一套状态迁移规则）。 */
export function applyChatEvent(row: Omit<ChatTaskRow, "updatedAt">, event: Record<string, unknown>): void {
  const seq = row.seq++;
  // line 全量入持久化流（含 plain/disclaimer/citation），保证跨进程恢复时快照保真
  if (event.kind === "begin" || event.kind === "done" || event.kind === "error" || event.kind === "line" || event.kind === "phase") {
    row.lines.push(toPersistedLine(event, seq));
  }
  if (event.kind === "begin" && typeof event.intent === "string") row.intent = event.intent;
  if (event.kind === "error" && row.error === null && typeof event.code === "string") {
    row.error = { code: event.code, retryable: event.retryable === true, message: typeof event.message === "string" ? event.message : "任务异常终止" };
  }
  if (event.kind === "done") {
    row.finishReason = event.finishReason === "error" ? "error" : "completed";
    if (event.degraded === true) row.degraded = true;
    row.status = row.finishReason === "error" ? "error" : "completed";
  }
}

export interface LoadedChatTask {
  taskId: string;
  batchId: string;
  status: "running" | "completed" | "error";
  intent: string | null;
  finishReason: "completed" | "error" | null;
  degraded: boolean;
  events: Array<Record<string, unknown>>;
  error: { code: string; retryable: boolean; message: string } | null;
  seq: number;
  stale: boolean;
}

/** 从库中读取任务；fromSeq 之后的事件才返回（增量续传）。running 但久无更新视为持有进程死亡。 */
export async function loadChatTask(
  taskId: string,
  fromSeq: number,
  pool: Pool = getDatabasePool(),
): Promise<LoadedChatTask | null> {
  if (!persistenceEnabled()) return null;
  try {
    await ensureTable(pool);
    const result = await pool.query("select task_id, batch_id, status, intent, finish_reason, degraded, lines, error, seq, extract(epoch from (now() - updated_at)) as idle_seconds from truthpass_chat_tasks where task_id = $1", [taskId]);
    const row = result.rows[0];
    if (!row) return null;
    const idleSeconds = Number(row.idle_seconds ?? 0);
    const stale = row.status === "running" && idleSeconds > STALE_AFTER_SECONDS;
    const lines = (row.lines ?? []) as PersistedChatLine[];
    return {
      taskId: String(row.task_id),
      batchId: String(row.batch_id ?? ""),
      status: stale ? "error" : (row.status as LoadedChatTask["status"]),
      intent: row.intent ?? null,
      finishReason: stale ? "error" : (row.finish_reason ?? null),
      degraded: row.degraded === true,
      events: lines.filter((line) => line.seq > fromSeq).map((line) => ({ ...line.event, taskId: row.task_id, seq: line.seq })),
      error: row.error ?? null,
      seq: Number(row.seq ?? 0),
      stale,
    };
  } catch (error) {
    console.error("[chat-store] 任务读取失败:", error instanceof Error ? error.message : String(error));
    return null;
  }
}
