# TruthPass 架构整改与鱼油 Demo 落地方案

> 文档版本：v0.5.1  
> 状态：审计后的实施方案  
> 最近修改：2026-10-07  
> 修改摘要：将架构审计发现转成分阶段落地任务，明确鱼油 Demo 的厂家接入、设备/Agent/链上边界和验收门槛；本文件不替代伙伴的技术实现。  
> 影响范围：EvidenceEnvelope、签名、JEV、Verifier、BOT Chain、鱼油 Demo、网页观察台  
> 前置审计：[architecture-audit-v0.5.1.md](architecture-audit-v0.5.1.md)

## 1. 目标架构

```text
厂家 / 实验室 / 物流设备
          │
          │ 事件、报告、温度观察
          ▼
Edge Gateway / 服务适配器
  - 验证设备/服务签名
  - 绑定批次和序列
  - 生成 EvidenceEnvelope
          ▼
链下证据仓 + Evidence API
  - 原始文件、传感器明细、访问控制
  - 证据哈希、版本和撤销关系
          ▼
消费者 Agent → TruthPass CLI/API
          │
          ├── Probe：当前在线与能力
          ├── JEV：缺口、冲突和下一步路由
          ├── Verifier：确定性通过 / 拒绝 / 复检
          └── Reputation：履约记录和反馈
          ▼
Chain Adapter → BOT Chain
  - 主体/公钥
  - 证据承诺
  - 验收结果
  - 公共信誉
  - 撤销 / 争议
```

这里的“设备链、Agent 链、检测链、信誉链”都是业务链路或逻辑层，不是四条独立区块链。比赛版本用一条 BOT Chain 公共锚定链，加链下证据仓即可。

## 2. 鱼油 Demo 的接入分级

### P0：比赛演示

厂家不需要改造产线，使用合成批次数据和模拟签名事件：

- `FO-2026-001` 批次主记录；
- EPA+DHA、过氧化值、TOTOX、冷链中断摘要；
- 一个正确实验室、一个错批次实验室、一个离线实验室；
- 一组消费者购买绑定和反馈；
- 明确显示 `demo/synthetic`。

此阶段重点是验证 Agent 能否选择当前可靠服务，以及结果是否由规则生成。

### P1：小规模试点

不替换原有产线，接入最少的一条设备和一条检测报告通道：

- 设备或实验室输出 CSV/JSON/HTTPS/MQTT；
- 厂内网关负责批次绑定、签名、序列和重试；
- 实验室提供带签名的报告摘要；
- 物流温度记录器提供带时间和设备 ID 的事件；
- TruthPass 保存原文在链下，向 BOT Chain 锚定哈希。

### P2：生产化

再补齐：

- 设备密钥生命周期、校准和维护；
- 样品封存、交接和复检；
- 标准/检测方法/单位/实验室资质；
- 独立仲裁、撤销、争议和赔付流程；
- 多厂家、多实验室和多物流服务的 SLA。

## 3. 厂家最小提交合同

```json
{
  "batchId": "FO-2026-001",
  "productSpecHash": "0x...",
  "productionWindow": {
    "start": "2026-10-06T08:00:00Z",
    "end": "2026-10-06T12:00:00Z"
  },
  "evidenceRefs": [
    { "kind": "lab-report", "reportId": "lab-c-001", "payloadHash": "0x..." },
    { "kind": "cold-chain", "deviceId": "device-cold-07", "payloadHash": "0x..." }
  ],
  "declaredBy": "supplier-principal-id",
  "schemaVersion": "fish-oil-batch-v1",
  "signature": "..."
}
```

厂家不需要把全部商业资料公开，但必须明确：哪些字段是厂家自报、哪些字段来自第三方、哪些字段来自设备、哪些字段暂未覆盖。

## 4. 三种角色的正确边界

### 4.1 IoT / 设备网关

负责采集、签名、序列、时间、批次绑定和原始数据留存。设备不会直接决定商品“通过”。

### 4.2 Agent

负责发现服务、调用接口、关联证据、读取授权范围、让 JEV 识别缺口，并向消费者解释已经确定的结果。Agent 不能修改原始证据，也不能选择性隐藏负面证据而不留下 `missing / restricted` 状态。

### 4.3 Deterministic Verifier

负责批次匹配、时间、签名、字段完整性、指标阈值、冷链和规则版本。它是最终通过/拒绝的唯一来源。

## 5. 链上最小数据合同

### 5.1 主体注册

登记服务、实验室、设备、Agent 和验证器的主体 ID、公钥、能力、元数据和吊销状态。

### 5.2 证据锚定

```text
batchId
issuerId
payloadHash
schemaHash
observedAt
previousEventHash
attestationLevel
revocationState
```

### 5.3 验收记录

```text
taskHash
evidenceRoot
policyHash
verifierVersion
jevSchemaHash
jevDecisionCode
resultScope
resultStatus
createdAt
disputeId / revokedAt
```

### 5.4 消费者参与

链上只记录购买证明哈希、授权版本哈希、贡献事件、权益状态和撤销状态。原始订单、个人信息、健康信息和反馈原文留在链下。

## 6. P0 优先整改项

1. 把 `signatureValid: boolean` 替换成“签名、主体、公钥和验证结果”四元组；
2. 增加规范化 EvidenceEnvelope 和固定哈希规则；
3. 将 JEV adapter 的输出接到 `Verifier` 前，低置信度、冲突、过期和超时全部进入复检或降级；
4. 把服务排序拆成“可接受候选过滤 → 再排序”，不能从被拒绝结果中选最高分；
5. 合约增加角色、主体注册、证据锚定、验收记录、幂等键和吊销/争议事件；
6. 消费者购买和反馈必须验证来源、签名、nonce、授权状态和重复提交；
7. 网页、CLI 和链上事件全部引用同一个 `VerificationResult`，不允许前端自算结果。

## 7. 验收门槛

### 演示通过

- 正确服务通过；
- 错批次服务拒绝；
- 离线服务不执行正式任务；
- 缺失重金属数据显示 `missing` 或 `accepted_with_scope`；
- 消费者反馈必须绑定购买记录；
- 页面明确 `demo/synthetic`。

### 试点通过

- 任意输入都能回到原始证据哈希；
- 签名无效、密钥吊销、批次错配和重复事件必定失败；
- JEV 故障时规则仍能安全降级；
- 证据锚定失败时结果保留在链下并进入可重试状态；
- 撤销和争议不会删除历史，只追加新状态。

### 生产通过

- 设备、实验室、物流和网关都有密钥生命周期；
- 检测方法、单位、标准和资质进入 policy；
- 有独立复检、仲裁和责任追踪；
- 有隐私、数据保留、访问和审计策略；
- 生产方、检测方、物流方和平台的利益冲突被披露。

## 8. 现场解释顺序

1. 先说消费者问：“这批鱼油为什么值得我信？”；
2. 再展示 Agent 调用 CLI；
3. 展示三个服务的在线状态和异常；
4. 展示批次、指标、来源、缺口和规则版本；
5. 展示 JEV 只做结构化路由；
6. 展示 Verifier 给出最终范围化结论；
7. 展示链上只锚定哈希、时间和结果；
8. 最后展示消费者授权、购买绑定和反馈如何成为下一次公共信誉。

## 9. 商业模式边界

比赛版本只做批次共建者权益：复检优先、检测服务额度、售后优先和不可交易贡献积分。不要把“早期购买者”写成股东、投资人或利润分配者。

如果未来要做分润，应另行设计采购/会员合同；如果要做股权或可交易收益，则必须拆成独立合规项目，不能由商品购买、积分或 NFT 变相承载。

