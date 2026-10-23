# TruthPass 生产只读探针（2026-10-24）

## 探针地址

```text
https://truthpass-service.vercel.app
```

## 结果

```text
GET /api/agent/status → 200
GET /api/public/batches/FO-2026-001/overview → 200
GET /api/public/batches/RC-2026-001/overview → 200
POST /api/agent/chat (FO-2026-001) → 200 SSE
```

生产批次：

```text
FO-2026-001 → tenant-fish-oil-demo → demo/synthetic → anchor_pending
RC-2026-001 → tenant-rice-demo → demo/synthetic → anchor_pending
```

生产 SSE 摘要：

```text
traceId: prod-probe-20261024-001
batchId: FO-2026-001
provider: deepseek
model: deepseek-chat
modelAssisted: true
validationStatus: accepted
fallbackApplied: false
dataMode: demo/synthetic
pipeline.deepseek.status: completed
current receipt: none
```

这证明线上 Agent 的真实模型解释链当前可调用，并且返回了当前批次范围内的安全回答；它不证明商品资料是真实认证资料，也不证明本次购买或上链已完成。

## 发现的配置漂移

```text
GET /api/agent/status:
  provider: opencode
  model: deepseek-v4.1-flash

同一实例的 /api/agent/chat meta:
  provider: deepseek
  model: deepseek-chat
```

状态接口与 SSE 实际 provider/model 不一致。下一次 Preview/Production 发布前必须统一：

1. 确认生产环境实际使用的 provider 和 model 变量；
2. 让 `/api/agent/status` 读取与 `/api/agent/chat` 相同的解析结果；
3. 重新执行 status、SSE、批次上下文和安全校验探针；
4. 保留 `traceId` 和 SSE 原文作为发布证据。

## 链和数据边界

当前线上公开批次仍为 `demo/synthetic`，链状态为 `anchor_pending`。本探针没有执行钱包签名、广播、付款或任何写入操作；不能把线上模型可用等同于真实商品认证或真实购买完成。
