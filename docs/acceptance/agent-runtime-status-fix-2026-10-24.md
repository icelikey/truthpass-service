# TruthPass Agent runtime 状态修复与本地验收（2026-10-24）

## 本次变更

提交：`1a2a7b1 fix(agent): align runtime provider status with successful calls`

- `/api/agent/status` 增加 `configuredProvider/configuredModel`，并区分 `lastSuccessfulProvider/lastSuccessfulModel`。
- 同一服务实例有成功模型调用时，公开 provider/model 使用最近一次真实成功调用；新实例仍回退到配置候选。
- SSE 在 deterministic fallback 或 provider 不可用时固定返回 `provider=deterministic`、`model=deterministic-fallback`，不会复用旧模型名称。
- 回归测试覆盖无 provider 配置时的状态字段。

## 本地质量门槛

在 `E:\黑客松` 顺序执行：

```text
npm test
npm run typecheck
npm run build
git diff --check
```

结果：

```text
npm test: 205/205 passed
npm run typecheck: passed
npm run build: passed
web build verified
git diff --check: passed
```

## 本地现场探针

服务：`http://127.0.0.1:4173`

### Agent status

```text
GET /api/agent/status → 200
status: degraded
agentMode: deterministic_fallback
providerConfigured: false
provider: deterministic
model: deterministic-fallback
configuredProvider: deterministic
configuredModel: deterministic-fallback
lastSuccessfulProvider: null
lastSuccessfulModel: null
dataMode: demo/synthetic
```

### Agent SSE

请求：

```text
POST /api/agent/chat
x-truthpass-request-id: runtime-check-001
batchId: FO-2026-001
question: 查看这批商品的链上状态
```

事件顺序：

```text
begin
reading_batch(active)
verifier_checked(active)
jev_routed(active)
model_started(active)
reading_batch(completed)
verifier_checked(completed: review)
jev_routed(completed: request_more_evidence)
model_started(fallback)
model_completed(fallback: provider_not_configured)
meta
line
done
```

`meta` 核验：

```text
traceId: runtime-check-001
batchId: FO-2026-001
evidenceIds: ev-production-001, ev-inspection-001, ev-cold-chain-001, ev-production-002, ev-test-report-001
provider: deterministic
model: deterministic-fallback
modelAssisted: false
validationStatus: fallback
fallbackApplied: true
chainContext.chainId: 677
chainContext.anchorStatus: anchor_pending
chainContext.transaction: null
dataMode: demo/synthetic
```

### 批次总览

```text
GET /api/public/batches/FO-2026-001/overview → 200
tenantId: tenant-fish-oil-demo
productId: fish-oil
batchId: FO-2026-001
verification.status: review
verification.reasons: 生产阶段浓缩、脱臭、灌装、包装、仓储资料未覆盖
purchasePolicy.walletRequired: true
purchasePolicy.status: prepared_pending_checkout
feedbackSummary.count: 0
chainContext.anchorStatus: anchor_pending
```

## 当前仍不能宣称完成

- 本地未配置 `AGENT_API_KEY` 或 `OPENCODE_API_KEY`，以上是安全回退证据，不是真实模型调用证据。
- 线上已知版本需要重新部署本次修复；GitHub 推送受当前 TLS/网络握手失败阻塞。
- BOT Chain 677 没有本次会话的真实钱包签名、广播、receipt 和业务事件。
- 资料仍为 `demo/synthetic`，不能作为真实商品认证。
- 没有真实购买 `purchaseId`、真实反馈 contribution receipt 或企业改进闭环。

## 下一步验证顺序

```text
1. 在 Vercel 加密环境配置 provider 变量，并重新部署；
2. 生产探针同时保存 /api/agent/status 与 /api/agent/chat SSE 原文，确认 provider/model/traceId 一致；
3. 浏览器连接外部钱包，切换 Chain 677，先执行 prepare，再由用户明确确认 0.001 BOT 测试交易；
4. 服务端读取 receipt，校验 sender、target、chainId、value、PurchaseRecorded/PaymentReceived、batchId；
5. 只在 receipt 通过后生成 purchaseId；
6. 反馈 prepare/confirm 必须绑定同一 purchaseId 和 purchaseTxHash，并核验 contribution receipt；
7. 保存页面截图、SSE 原文、txHash、receipt、数据库读回和十并发结果后，才可进入 Production 回归。
```
