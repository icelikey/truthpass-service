# TruthPass 鱼油标准包 v1

## 目的

这份标准包把鱼油厂家资料转换成 Agent 可以读取、Verifier 可以核对、商家可以补齐的字段集合。它描述信息是否完整、来源是否可核验和还需要谁补证，不直接宣布商品安全、疗效或官方认证。

## 固定批次范围

```text
tenantId
productId
batchId
issuerId
occurredAt
capturedAt
dataMode
evidenceId
payloadHash
signature
```

## 必填数据域

| 数据域 | 关键字段 | 主要来源 | 核对方式 |
| --- | --- | --- | --- |
| 批次身份 | 产品、批次、生产方、时间 | 厂家 | 租户、产品和批次绑定 |
| 原料批次 | 供应方、产地、数量、接收时间 | 厂家或供应方 | 原料批次与生产批次关联 |
| 生产工序 | 原料接收、精炼、浓缩、脱臭、灌装、包装、仓储 | 厂家 | 工序、时间、设备和责任人 |
| 检测报告 | EPA+DHA、过氧化值、TOTOX、重金属、样品号、检测方法 | 检测机构 | 公钥、签名、样品和批次绑定 |
| 冷链窗口 | 设备、时间、温度、湿度、异常区间 | IoT 或物流方 | 序列、设备签名和时间连续性 |
| 物流交接 | 运单、仓库、交接时间、责任方 | 物流方 | 交接、数量和批次一致性 |

购买和反馈属于批次后续事件。它们需要订单、购买凭证、授权范围和一次性约束，不能由 Agent 自行生成。

## 判断结果

```text
recommend_with_scope
review_before_recommendation
do_not_recommend
```

缺失、冲突、签名未核验或生产工序未覆盖时，状态进入 `review_before_recommendation`。超出已批准规则范围时，状态进入 `do_not_recommend`。指标在范围内只表示该项记录通过当前规则检查，不能扩展为商品安全或疗效结论。

## Agent 责任

Agent 可以读取当前批次、引用证据、解释实测值与规则范围、说明缺口和下一步。Agent 不得新增数字、型号、检测机构、支付状态或交易 Hash，也不能把历史回放写成当前购买成功。

## 厂家接入验收

- 同一批次的 CSV、PDF 和 API 导入生成相同的字段映射。
- 错批次、重复证据、吊销证据、未签名报告和时间冲突全部进入复核队列。
- 每条公开结论都能回到 `evidenceId`、`traceId` 和当前 policy 版本。
- 真实厂家接入前，演示批次继续标记为 `demo/synthetic`。

## 发布门禁

批次只有在以下条件全部满足后才能发布给消费者：

- 所有必需证据均为 `external`。
- 每条证据都有 `issuerId` 和 Ed25519 `attestation`。
- `production`、`inspection`、`cold_chain`、`shipment` 四类证据均已登记。
- 检测和冷链证据通过当前可信公钥注册表核验。
- 当前批次没有撤销证据、演示标记或跨批次引用。
- Verifier 状态为 `accepted_with_scope`。

服务端发布接口：

```text
POST /api/tenants/{tenantId}/batches/{batchId}/publish
GET  /api/tenants/{tenantId}/batches/{batchId}/publish
```

发布接口不会把 `demo/synthetic` 升级成正式资料。未满足门禁时返回 `PUBLISH_*` 错误，并保留批次在 `review` 状态。
