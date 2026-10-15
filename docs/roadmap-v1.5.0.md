# TruthPass v1.5.0 路线与文件规划

> 文档版本：v1.5.0
> 状态：规划稿，与 v1.4.0 集成基线对齐
> 最近修改：2026-10-15
> 前置基线：[integration-v1.4.0.md](integration-v1.4.0.md)
> 风险基线：[risk-assessment-v1.4.0.md](risk-assessment-v1.4.0.md)

## 1. v1.5.0 目标

把 v1.4.0 的公共协议、钱包交互和演示能力推进到第一个真实企业试点。首个试点仍采用低改造接入：优先读取企业已有 ERP、LIMS、WMS、物流导出或 API，不要求一开始重做整条产线。

## 2. 计划文件

```text
docs/
├── roadmap-v1.5.0.md
├── enterprise-pilot-v1.5.0.md
├── evidence-governance-v1.5.0.md
├── institution-signing-v1.5.0.md
├── tenant-and-policy-governance-v1.5.0.md
├── checkout-and-order-flow-v1.5.0.md
├── audit-and-dispute-v1.5.0.md
└── deployment-acceptance-v1.5.0.md

src/
├── persistence/
├── adapters/erp/
├── adapters/lims/
├── adapters/wms/
├── adapters/logistics/
├── evidence/
├── institution-registry/
├── tenant/
└── checkout/

scripts/
├── replay-real-batch.mjs
├── verify-institution-signature.mjs
├── verify-evidence-envelope.mjs
└── acceptance-v1.5.0.mjs

config/
├── institution-registry.example.json
├── tenant-policy.example.json
└── audit-roles-v1.5.0.example.json
```

这些是 v1.5.0 的目标文件，不代表当前已经全部存在或完成。

## 3. 本次增量已落地

- \`POST /api/agent/v1/collaborate\` 已接入生产、检测和消费者三类 Agent 合同。
- 无模型配置时使用 \`deterministic_fallback\`，模型失败时回退，不改写 Verifier 结论。
- Agent 注册支持 Bearer 保护、租户字段和可选 Postgres 持久化。
- 演示历史回放统一标记为 \`replay_verified\`，不再对外显示为现场 \`mainnet_receipt_verified\`。
- 认证边界、接口访问和验收向量见 [certification-and-agent-access-v1.5.0.md](certification-and-agent-access-v1.5.0.md)。

## 4. 四个实施阶段

### 阶段一：Demo 收敛，约 2 周

```text
商家发布商品
→ 导入生产、检测、物流和第三方证据
→ Agent 查询
→ 错批次失败
→ 生成证据卡
→ 用户购买
→ 用户反馈
→ 用户质疑
→ 查看链上状态
```

门禁：所有演示数据标记为 `demo/synthetic`；通过和拒绝都能演示；不生成伪造交易 Hash；购买、反馈、质疑和批次严格绑定。

### 阶段二：真实商家试点，约 4–8 周

试点范围：一个品牌、一个品类、1–3 个 SKU、一家工厂、一家检测机构和一条物流链路。

交付：字段映射、证据适配器、机构签名、企业审核台、消费者批次页、Agent Manifest、真实异常回放、运维和审计手册。

### 阶段三：真实交易与售后，约 4 周

补齐 Checkout Adapter、支付和配送回调、购买确认、反馈授权、争议复检、receipt 回读和售后 Agent 时间线。

### 阶段四：开放协议发布，约 4–6 周

发布 Evidence Envelope、JSON Schema、TypeScript 参考实现、CLI、Docker Compose、示例适配器、多语言客户端、自托管文档以及可替换链和存储接口。

## 5. P0 门禁

- 真实机构签名、公钥注册、轮换、吊销和 nonce 防重放；
- 企业、工厂、实验室和物流的多租户隔离；
- ProductPolicy 持久化、审批、版本冻结和回滚；
- 证据仓访问权限、保留期限和审计日志；
- 至少一个真实批次、真实第三方报告和真实物流记录；
- 错批次、重复报告、证书撤销和缺失证据测试；
- 真实普通钱包交易的 receipt、目标地址和业务事件校验。

## 6. P1 与 P2

### P1：形成可交付的企业产品

企业后台、异常队列、证据缺口、复检状态、角色权限、争议仲裁、企业 SLA、告警、数据导出和 API 使用统计。

### P2：跨品类和规模化

蜂蜜、乳制品、化妆品等品类模板；设备网关和边缘签名；多工厂、多国家、多语言；供应商公共信誉；行业标准映射和第三方审核市场。

## 7. 版本状态词

所有页面、API、CLI 和文档统一使用：

```text
demo/synthetic
wallet_signed
wallet_broadcast
mainnet_receipt_verified
anchor_pending
review
rejected
revoked
not_covered
```

合约部署、角色授权和历史回放不能直接写成“真实生产数据已认证”或“真实消费者交易已完成”。

## 8. v1.4.0 到 v1.5.0 的差距

| 能力 | v1.4.0 | v1.5.0 目标 |
| --- | --- | --- |
| 商品与批次 | 鱼油/蜂蜜演示政策 | 真实企业商品和批次 |
| 数据来源 | 模拟数据和协议 | ERP/LIMS/WMS/物流适配器 |
| 签名 | 协议边界和兼容字段 | 机构、设备和密钥治理 |
| 存储 | 进程内注册表为主 | Supabase/Postgres 多租户持久化 |
| 钱包 | 交易准备和安全校验 | 普通钱包主网现场闭环 |
| 质疑 | Audit Escrow 已部署 | 独立 Agent/Verifier/Arbiter/Treasury |
| 交易 | 订单准备与链上登记分离 | Checkout、支付、库存、配送和退款回调 |
| 规模 | 单一 Demo | 第一个企业试点和可复用协议 |
