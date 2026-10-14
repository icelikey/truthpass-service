import assert from "node:assert/strict";
import test from "node:test";
import type { Pool } from "pg";
import { applyChatEvent, loadChatTask, upsertChatTask, type ChatTaskRow } from "../src/data/chat-persistence.js";

interface Recorded {
  sql: string;
  params?: unknown[];
}

function fakePool(queries: Recorded[], rows: Record<string, unknown>[] = []): Pool {
  return {
    query: async (sql: string, params?: unknown[]) => {
      queries.push({ sql, params });
      if (sql.includes("from truthpass_chat_tasks")) return { rows, rowCount: rows.length };
      return { rows: [], rowCount: 0 };
    },
  } as unknown as Pool;
}

function emptyRow(): Omit<ChatTaskRow, "updatedAt"> {
  return { taskId: "11111111-2222-3333-4444-555555555555", batchId: "FO-2026-001", question: "q", status: "running", intent: null, finishReason: null, degraded: false, lines: [], error: null, seq: 0 };
}

test("applyChatEvent 推进 seq 并按类别收集事件", () => {
  const row = emptyRow();
  applyChatEvent(row, { kind: "begin", intent: "consumer_evidence" });
  applyChatEvent(row, { kind: "line", cls: "cmd", text: "读取中" });
  applyChatEvent(row, { kind: "line", cls: "plain", text: "事实行也入快照" });
  applyChatEvent(row, { kind: "phase", stage: "production_done" });
  applyChatEvent(row, { kind: "done", finishReason: "completed", degraded: true });
  assert.equal(row.seq, 5);
  assert.equal(row.status, "completed");
  assert.equal(row.finishReason, "completed");
  assert.equal(row.degraded, true);
  assert.equal(row.intent, "consumer_evidence");
  // line 全量入持久化流，恢复时快照保真
  assert.deepEqual(row.lines.map((line) => line.seq), [0, 1, 2, 3, 4]);
});

test("applyChatEvent 错误只记第一条且 stale 语义留给读取侧", () => {
  const row = emptyRow();
  applyChatEvent(row, { kind: "error", code: "a", retryable: true, message: "m1" });
  applyChatEvent(row, { kind: "error", code: "b", retryable: false, message: "m2" });
  assert.deepEqual(row.error, { code: "a", retryable: true, message: "m1" });
});

test("upsertChatTask 走参数绑定与幂等 upsert", async () => {
  const queries: Recorded[] = [];
  process.env.DATA_BACKEND = "postgres";
  process.env.DATABASE_URL = "postgres://fake";
  try {
    await upsertChatTask(emptyRow(), fakePool(queries));
    const insert = queries.find((q) => q.sql.includes("insert into truthpass_chat_tasks"));
    assert.ok(insert, "应执行 insert");
    assert.ok(insert.sql.includes("on conflict (task_id) do update"), "必须幂等 upsert");
    assert.equal(insert.params?.length, 10);
    assert.ok(queries.every((q) => q.sql.includes("create table if not exists") || q.sql.includes("insert into truthpass_chat_tasks")));
  } finally {
    delete process.env.DATA_BACKEND;
    delete process.env.DATABASE_URL;
  }
});

test("loadChatTask 按 fromSeq 增量返回并映射行", async () => {
  const queries: Recorded[] = [];
  process.env.DATA_BACKEND = "postgres";
  process.env.DATABASE_URL = "postgres://fake";
  try {
    const lines = [
      { seq: 0, event: { kind: "begin", intent: "consumer_evidence" } },
      { seq: 1, event: { kind: "line", cls: "cmd", text: "读取中" } },
      { seq: 2, event: { kind: "done", finishReason: "completed" } },
    ];
    const pool = fakePool(queries, [{
      task_id: "11111111-2222-3333-4444-555555555555", batch_id: "FO-2026-001", status: "completed",
      intent: "consumer_evidence", finish_reason: "completed", degraded: false,
      lines, error: null, seq: 3, idle_seconds: 10,
    }]);
    const stored = await loadChatTask("11111111-2222-3333-4444-555555555555", 1, pool);
    assert.ok(stored);
    assert.equal(stored.status, "completed");
    assert.equal(stored.stale, false);
    assert.deepEqual(stored.events.map((event) => event.seq), [2]);
    const select = queries.find((q) => q.sql.includes("from truthpass_chat_tasks"));
    assert.deepEqual(select?.params, ["11111111-2222-3333-4444-555555555555"]);
  } finally {
    delete process.env.DATA_BACKEND;
    delete process.env.DATABASE_URL;
  }
});

test("loadChatTask 对久无更新的 running 判定为 stale", async () => {
  process.env.DATA_BACKEND = "postgres";
  process.env.DATABASE_URL = "postgres://fake";
  try {
    const pool = fakePool([], [{
      task_id: "11111111-2222-3333-4444-555555555555", batch_id: "", status: "running",
      intent: null, finish_reason: null, degraded: false, lines: [], error: null, seq: 1, idle_seconds: 999,
    }] as unknown as Record<string, unknown>[]);
    const stored = await loadChatTask("11111111-2222-3333-4444-555555555555", 0, pool);
    assert.equal(stored?.stale, true);
    assert.equal(stored?.status, "error");
    assert.equal(stored?.finishReason, "error");
  } finally {
    delete process.env.DATA_BACKEND;
    delete process.env.DATABASE_URL;
  }
});

test("无 DATABASE_URL 时读写双双静默降级", async () => {
  const saved = { backend: process.env.DATA_BACKEND, url: process.env.DATABASE_URL };
  delete process.env.DATA_BACKEND;
  delete process.env.DATABASE_URL;
  try {
    await upsertChatTask(emptyRow(), fakePool([]));
    assert.equal(await loadChatTask("x", 0, fakePool([])), null);
  } finally {
    if (saved.backend !== undefined) process.env.DATA_BACKEND = saved.backend;
    if (saved.url !== undefined) process.env.DATABASE_URL = saved.url;
  }
});
