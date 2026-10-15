# TruthPass 认证与 Agent 接入 v1.5.0

> 状态：实施基线
> 最近修改：2026-10-15
> 范围：Agent 访问、协议一致性、企业交付和演示状态

## 1. 认证边界

TruthPass 是开放商品证据与确定性验证协议，不是商品质量认证机构。TruthPass 负责：

- 统一 Manifest、Evidence Envelope、ProductPolicy 和反馈协议；
- 校验批次、来源、签名、时间、撤销和规则；
- 提供可解释的证据卡、审计记录和导出能力；
- 让外部 Agent 使用同一套公开规则。

商家、工厂和检测机构仍需承担主体资质、食品生产许可、产品备案/注册和检测报告责任。链上哈希只能证明提交内容未被替换，不能单独证明现实生产事实。

## 2. 五层交付认证

1. **协议一致性**：JSON Schema、Verifier、CLI、REST 和 SDK 使用同一组测试向量。
2. **软件安全**：密钥轮换和吊销、租户隔离、访问控制、审计日志、SBOM、灾备和渗透测试。
3. **数据与平台合规**：根据实际部署判断 ICP、公安备案、区块链信息服务备案、等级保护、个人信息和数据安全要求。
4. **参与方资质**：商家、工厂、实验室、物流方提供主体和行业资质，TruthPass 只做关联和核验。
5. **企业试点验收**：真实批次、真实第三方签名、错批次失败、撤销失败、回放和现场交易状态边界全部通过。

备案、测评和第三方技术评估不能被宣传成商品质量认证。

## 3. Agent 接入

### 公开只读接口

```text
GET  /api/agent/manifest
GET  /api/cli/inspect?batchId={batchId}
GET  /api/cli/explain?batchId={batchId}
GET  /api/jev/detection?batchId={batchId}
GET  /api/cfi/manifest
GET  /api/standards
```

### 需要用户确认的动作

```text
POST /api/wallet/prepare
POST /api/consumer/credentials
POST /api/consumer/feedback
POST /api/chain/tx-confirm
```

TruthPass 只返回待签名交易；用户钱包负责签名和广播。服务端不接收消费者私钥。

### 内部协作接口

```text
POST /api/agent/v1/collaborate
```

该接口执行生产、检测和消费者三类 Agent 合同。它返回 `agentMode`、`dataMode`、`verifierVersion`、`traceId`、证据卡、模型辅助线索和确定性验证结果。模型只能选择已有事实，不能创建 `score`、`verdict` 或新的质量结论。

设置 `TRUTHPASS_AGENT_GATEWAY_TOKEN` 后，接口要求：

```text
Authorization: Bearer <token>
X-TruthPass-Tenant: <tenantId>
X-TruthPass-Request-Id: <requestId>
```

未配置 Token 时仅视为本地演示模式，Manifest 会返回 `unconfigured_demo`。

## 4. 状态语义

```text
demo/synthetic             合成或演示数据
anchor_pending              只生成锚定计划，未完成现场回执
replay_verified             历史回放回执可校验，不能代表当前交易
mainnet_receipt_verified    当前用户交易 receipt、目标合约和业务事件均已校验
deterministic_fallback      未调用实时模型，使用确定性路由
model_assisted              调用了兼容模型，但最终结论仍由 Verifier 产生
```

页面和 API 不得把 `demo/synthetic`、历史回放或模型兜底写成真实商品认证。

## 5. Agent 注册

`POST /api/agent/register` 在演示模式下返回 `registered_local`。设置 `DATABASE_URL` 且 `DATA_BACKEND` 不是 `memory` 后，注册表写入 `truthpass_agent_registry`，返回 `registered_persistent`。生产环境必须配置 `TRUTHPASS_AGENT_REGISTRATION_TOKEN`，并为每个租户分配独立 Agent 身份和权限。

## 6. 智能客服上线门禁

- `GET /api/agent/status` 返回 `ready` 和 `model_assisted`，才表示模型客服可用；
- 未配置模型密钥时返回 `degraded`，客服仍可使用确定性兜底；
- `POST /api/agent/chat` 通过 SSE 返回 `begin`、`meta`、`line`、`done`；
- `meta` 必须包含 `agentMode`、`serviceStatus`、`dataMode`、`batchId` 和 `traceId`；
- 批次问题先经过证据卡和确定性验证，再交给模型组织语言；
- 客服接口使用 IP/会话限流，模型调用超时或失败时自动回退；
- 日志只记录事件、状态、批次和追踪 ID，不记录 API Key、私钥或用户原文。
