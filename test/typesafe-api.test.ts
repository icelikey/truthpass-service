import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { TypesafeClient, type TypesafeRunRequest } from "../src/typesafe/api.js";

const request: TypesafeRunRequest = {
  state: { batchId: "FO-2026-001", epaDhaPercent: 78 },
  model: "jev-latest",
  questions: {
    batch_status: { type: "choice", instructions: "判断当前证据状态", criteria: { verified: "已验证", partial: "部分验证" } },
    explanation: { type: "noul", instructions: "解释判断依据" },
  },
};

test("keeps the API key as an environment placeholder", async () => {
  const client = new TypesafeClient({ apiKey: "" });
  await assert.rejects(() => client.run(request), /TYPESAFE_API_KEY 未配置/);
});

test("sends the documented request shape and bearer key", async () => {
  let received: { url: string; init: RequestInit } | undefined;
  // key 由运行时随机生成：测试只关心“头部必须携带传入的 key”，源码不出现凭据字面量
  const expectedKey = randomUUID();
  const client = new TypesafeClient({
    apiKey: expectedKey,
    baseUrl: "https://example.test",
    fetchImpl: async (url, init) => {
      received = { url: String(url), init: init ?? {} };
      return new Response(JSON.stringify({
        model: "jev-latest",
        answers: { batch_status: "verified" },
        usage: { input_tokens: 1, output_tokens: 1 },
      }), { status: 200 });
    },
  });

  const response = await client.run(request);

  assert.equal(received?.url, "https://example.test/v1/systemone");
  assert.equal(received?.init.headers && new Headers(received.init.headers).get("Authorization"), `Bearer ${expectedKey}`);
  assert.deepEqual(JSON.parse(String(received?.init.body)), request);
  assert.equal(response.answers.batch_status, "verified");
});
