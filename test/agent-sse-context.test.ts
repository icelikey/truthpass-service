import assert from "node:assert/strict";
import test from "node:test";
import { createApiServer } from "../api-server.js";

type SseEvent = Record<string, any>;

async function withServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = createApiServer();
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

async function readEvents(baseUrl: string, requestId: string, body: Record<string, unknown>): Promise<SseEvent[]> {
  const response = await fetch(`${baseUrl}/api/agent/chat`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-truthpass-request-id": requestId },
    body: JSON.stringify(body),
  });
  assert.equal(response.status, 200);
  return (await response.text())
    .split(/\n\n/)
    .filter((chunk) => chunk.startsWith("data: "))
    .map((chunk) => JSON.parse(chunk.slice("data: ".length)) as SseEvent);
}

test("agent SSE keeps trace and batch context on every event", async () => {
  await withServer(async (baseUrl) => {
    const requestId = "sse-context-001";
    const events = await readEvents(baseUrl, requestId, {
      batchId: "FO-2026-009",
      messages: [{ role: "user", content: "请解释当前批次。" }],
    });
    const traceEvents = events.filter((event) => event.kind !== "meta" || event.traceId);
    assert.ok(traceEvents.length > 0);
    for (const event of traceEvents) {
      assert.equal(event.traceId, requestId);
      assert.equal(event.batchId, "FO-2026-009");
      assert.equal(event.dataMode, "demo/synthetic");
      assert.ok(Array.isArray(event.evidenceIds));
    }
    const completedRead = events.find((event) => event.kind === "stage" && event.stage === "reading_batch" && event.status === "completed");
    assert.ok((completedRead?.evidenceIds?.length ?? 0) >= 4);
    assert.ok(completedRead?.evidenceIds?.every((id: unknown) => typeof id === "string" && id.startsWith("FO-2026-009:")));
    const stages = events.filter((event) => event.kind === "stage").map((event) => event.stage);
    for (const stage of ["reading_batch", "verifier_checked", "jev_routed", "model_started", "model_completed"]) {
      assert.ok(stages.includes(stage), `missing stage: ${stage}`);
    }
    const finalStages = new Map(events.filter((event) => event.kind === "stage").map((event) => [event.stage, event]));
    assert.equal(finalStages.get("verifier_checked")?.status, "completed");
    assert.equal(finalStages.get("jev_routed")?.detail, "request_more_evidence");
    assert.equal(finalStages.get("model_completed")?.status, "fallback");
    const meta = events.find((event) => event.kind === "meta");
    assert.equal(meta?.modelAssisted, false);
    assert.equal(meta?.validationStatus, "fallback");
    assert.equal(meta?.pipelineDetail?.jev?.decision, "request_more_evidence");
  });
});

test("unknown batch SSE is explicit and cannot fall through to another batch", async () => {
  await withServer(async (baseUrl) => {
    const requestId = "sse-context-unknown-001";
    const events = await readEvents(baseUrl, requestId, {
      batchId: "FO-9999-999",
      messages: [{ role: "user", content: "查询这个批次。" }],
    });
    const meta = events.find((event) => event.kind === "meta");
    assert.equal(meta?.batchId, "FO-9999-999");
    assert.equal(meta?.pipelineDetail?.verifier?.status, "not_run");
    assert.equal(meta?.pipelineDetail?.jev?.decision, "request_more_evidence");
    assert.deepEqual(meta?.evidenceIds, []);
    assert.ok(events.some((event) => event.kind === "done" && event.traceId === requestId));
    assert.ok(!events.some((event) => typeof event.text === "string" && event.text.includes("FO-2026-001")));
  });
});

test("agent SSE keeps production coverage separate from parameter acceptance", async () => {
  await withServer(async (baseUrl) => {
    const events = await readEvents(baseUrl, "sse-production-gap-001", {
      batchId: "FO-2026-001",
      messages: [{ role: "user", content: "这批资料现在能不能下单？" }],
    });
    const meta = events.find((event) => event.kind === "meta");
    assert.equal(meta?.pipelineDetail?.verifier?.status, "review");
    assert.equal(meta?.pipelineDetail?.jev?.decision, "request_more_evidence");
    const answer = events.filter((event) => event.kind === "line").map((event) => event.text ?? "").join("");
    assert.match(answer, /2\/7|浓缩|生产资料仍需复核/);
  });
});

test("rice tenant Agent keeps rice facts instead of fish-oil metrics", async () => {
  await withServer(async (baseUrl) => {
    const events = await readEvents(baseUrl, "sse-rice-context-001", {
      batchId: "RC-2026-001",
      messages: [{ role: "user", content: "请解释这批大米的产地和检测资料。" }],
    });
    const meta = events.find((event) => event.kind === "meta");
    assert.equal(meta?.batchId, "RC-2026-001");
    assert.ok(meta?.evidenceIds?.every((id: unknown) => typeof id === "string" && id.startsWith("RC-2026-001:")));
    const answer = events.filter((event) => event.kind === "line").map((event) => event.text ?? "").join("");
    assert.match(answer, /北境稻作|产地|检测|demo\/synthetic/);
    assert.doesNotMatch(answer, /EPA\+DHA|过氧化值|冷链异常/);
  });
});

test("English Agent SSE preserves English answer labels and localized fallback facts", async () => {
  await withServer(async (baseUrl) => {
    const events = await readEvents(baseUrl, "sse-english-001", {
      batchId: "FO-2026-001",
      locale: "en",
      messages: [{ role: "user", content: "What is missing from this batch?" }],
    });
    const meta = events.find((event) => event.kind === "meta");
    assert.equal(meta?.batchId, "FO-2026-001");
    assert.equal(meta?.modelAssisted, false);
    assert.deepEqual(meta?.pipelineDetail?.verifier?.reasons, [
      "Production stage \"concentration\" is not covered.",
      "Production stage \"deodorization\" is not covered.",
      "Production stage \"filling\" is not covered.",
      "Production stage \"packaging\" is not covered.",
      "Production stage \"storage\" is not covered.",
    ]);
    const answer = events.filter((event) => event.kind === "line").map((event) => event.text ?? "").join("");
    assert.match(answer, /^Conclusion:/);
    assert.match(answer, /Evidence:/);
    assert.match(answer, /Uncertainty:/);
    assert.match(answer, /Next step:/);
    assert.match(answer, /concentration, deodorization, filling, packaging, storage/);
    assert.doesNotMatch(answer, /结论：|依据：|不确定：|下一步：/);
  });
});

