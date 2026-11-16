# TruthPass 专家 Agent 内核 v1.0

## 本次已落地

- 鱼油公共 KnowledgePack：参数、冷链、购买边界、反馈闭环。
- 公共/租户私有知识分离，私有知识按租户检索。
- `EvidenceEnvelope`、`ConsumerNeed`、`InteractionEvent`、`ProductSpec`、`BrandProposal` 的 TypeScript 合同。
- SAG scoped adapter：先检索，再由 TruthPass 负责来源范围和验证边界。
- Agent 查询把专家知识命中、批次证据、Verifier/JEV 和模型状态放在同一 `traceId` 下。
- 消费者需求可以在匿名授权后聚合为商家待审核的产品规格和品牌提案。
- 配置数据库后，知识包、需求、交互事件、产品规格和品牌提案落入 Postgres；数据库表启用 RLS，浏览器不能直接读取。

## 新接口

```text
GET  /api/agent/knowledge/search?batchId=&productId=&q=
POST /api/consumer/needs
GET  /api/tenants/{tenantId}/knowledge-packs
POST /api/tenants/{tenantId}/knowledge-packs
GET  /api/tenants/{tenantId}/product-specs
POST /api/tenants/{tenantId}/product-specs
GET  /api/tenants/{tenantId}/brand-proposals
POST /api/tenants/{tenantId}/brand-proposals
GET  /api/tenants/{tenantId}/improvement-report?batchId=
```

## 当前边界

- `FO-2026-001` 仍是 `demo/synthetic`，不代表真实商品认证。
- 公开 Agent 只检索公共知识；租户私有 KnowledgePack 需要企业租户授权。
- SAG 只负责检索，不能改变 Verifier/JEV 结果。
- ProductSpec 和 BrandProposal 只能进入 `merchant_review`，不能自动创建生产任务。
- 真实检测机构签名、真实支付、当前会话 receipt、移动端和云主机生产部署仍需后续验收。
