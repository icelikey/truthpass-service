# 真验 v1.0.0：传感器、服务器与第三方认证上链架构

> 文档版本：v1.0.0
> 状态：当前战略与接入协议；企业生产能力仍需按本文件分阶段实施
> 最近修改：2026-10-10
> 修改摘要：统一企业部署、传感器服务器取证、第三方认证、质检员钱包、消费者 Agent 与 BOT Chain 主网之间的逻辑和协议边界。
> 影响范围：生产数据接入、Agent/JEV、确定性 Verifier、质检员钱包、BOT Chain、消费者 CLI、隐私和企业交付
> 队友下一步：先实现 L0 低改造接入和真实钱包交互，再接入固定摄像头、实验室适配器和设备签名。

## 1. 先说结论

真验不是把所有生产数据直接写进区块链，而是增加一层可验证的质量证据：

```text
已有 ERP / LIMS / Excel / COA / 摄像头 / 手持设备
                         ↓
                  Edge Gateway
          批次绑定、去重、时间、随机挑战、签名
                         ↓
                  链下证据仓
       图片、视频、报告和原始遥测加密保存
                         ↓
                    Agent + JEV
        结构化、缺口识别、异常路由和最小披露
                         ↓
              确定性 Deterministic Verifier
          检查批次、时间、签名、规则和证据完整性
                         ↓
                   质检员钱包确认
                         ↓
                   BOT Chain 锚定
                         ↓
              消费者 Agent / CLI / 网页观察台
```

区块链证明的是“哪个主体在什么时间提交了什么承诺”，不能单独证明厂家原始数据一定真实。现实可信度来自设备或实验室来源、样品交接、签名、人工复核、确定性规则、争议和复检共同组成的证据链。

## 2. 各层职责边界

| 层 | 主要职责 | 是否可以决定放行 |
| --- | --- | --- |
| 传感器/摄像头 | 产生温度、时间、批次、包装、封签和现场观察 | 否 |
| Edge Gateway | 接收设备数据、绑定批次、加时间和随机数、去重、上传 | 否 |
| 生产 Agent | 调用 ERP/LIMS/设备接口，形成 EvidenceEnvelope | 否 |
| JEV | 识别缺口、冲突、服务可用性和下一步路由 | 否 |
| Deterministic Verifier | 按产品策略检查字段、签名、时间、阈值和状态 | 生成规则结果 |
| 质检员 | 复核证据并用个人钱包承担人工确认责任 | 是，人工放行门槛 |
| 第三方实验室 | 对化学、微生物、重金属等专业指标提供签名报告 | 对报告范围负责 |
| BOT Chain | 固化承诺、状态、撤销、争议和交易回执 | 不判断现实数据真假 |
| 消费者 Agent | 查询、解释、推荐、发起质疑和绑定购买 | 不改写质量结果 |

JEV 没有 `VERIFIER_ROLE`。模型输出只能是结构化路由和缺口，不能直接把自然语言变成 `accepted`。

## 3. 传感器到服务器的取证协议

### 3.1 传输方式

企业可以先使用已有设备和记录，不要求改造产线。接入层按能力支持：

- HTTPS/JSON：ERP、LIMS、手机表单和摄像头网关；
- MQTT/HTTPS webhook：温度、湿度和冷链设备；
- CSV/Excel/PDF：企业暂时没有 API 时的批量导入；
- RTSP/USB 摄像头：首期只截取关键帧，不持续上传整段视频。

所有入口最终统一为 `EvidenceEnvelope`，上层 Agent 不直接消费各种厂商私有格式。

### 3.2 设备身份和防重放

每个设备或摄像头网关拥有独立 `deviceId` 和 `keyId`。设备私钥保存在受控设备或网关中，服务器保存公钥和密钥状态。服务器为每次采集下发一次性 `nonce`，事件至少包含：

```json
{
  "eventId": "evt-01J...",
  "eventType": "temperature_observed",
  "batchId": "FO-2026-001",
  "checkpointId": "cold-chain-arrival",
  "deviceId": "device-cold-07",
  "keyId": "device-cold-07-key-03",
  "observedAt": "2026-10-10T09:30:00Z",
  "serverReceivedAt": "2026-10-10T09:30:02Z",
  "sequence": 1842,
  "previousEventHash": "0x...",
  "nonce": "0x...",
  "payloadHash": "0x...",
  "mediaHash": "0x...",
  "schemaVersion": "evidence.v1",
  "signature": "0x..."
}
```

服务器在接收时检查：

1. `nonce` 是否已经使用；
2. `sequence` 是否连续；
3. `previousEventHash` 是否匹配当前批次事件链；
4. `observedAt` 是否合理，是否存在时间回拨；
5. 设备公钥是否有效、是否被吊销；
6. 签名是否覆盖同一份规范化 JSON；
7. 设备事件是否绑定到正确批次和检查点。

摄像头无法证明化学或微生物安全。它只产生“封签、标签、批次码、包装、现场动作、温度显示”等可观察事实；低置信度、遮挡、冲突和无法绑定批次的图像都进入 `hold`。

### 3.3 EvidenceEnvelope

进入 Agent 和 Verifier 的统一证据包建议使用以下字段：

```json
{
  "eventId": "evt-01J...",
  "eventType": "lab_report | device_observation | inspector_review | handoff",
  "subject": { "batchId": "FO-2026-001", "siteId": "factory-a" },
  "issuer": { "type": "device | supplier | lab | inspector", "id": "...", "keyId": "..." },
  "producedByAgent": "production-agent-a",
  "stage": "raw_material | production | packaging | delivery",
  "observedAt": "2026-10-10T09:30:00Z",
  "capturedAt": "2026-10-10T09:30:02Z",
  "sequence": 1842,
  "previousEventHash": "0x...",
  "payloadHash": "0x...",
  "mediaHash": "0x...",
  "schemaVersion": "evidence.v1",
  "policyId": "food-quality-v1",
  "attestationLevel": "device-signed | lab-signed | inspector-reviewed",
  "visibility": "public_summary | partner | restricted | private",
  "nonce": "0x...",
  "signature": "0x..."
}
```

原图、视频、PDF、设备连续遥测和员工/消费者信息进入加密链下存储。链上只需要这些内容的哈希或 Merkle root，不写原文。

## 4. 第三方实验室认证协议

第三方认证不是把 PDF 上传到链上，而是把“报告内容、样品来源、实验室身份和签名”绑定成一个可复核的认证声明。

### 4.1 实验室提交内容

```json
{
  "attestationId": "lab-att-2026-001-01",
  "batchId": "FO-2026-001",
  "sampleId": "sample-2026-001-03",
  "labId": "lab-c",
  "labKeyId": "lab-c-key-02",
  "reportHash": "0x...",
  "methodHash": "0x...",
  "accreditationHash": "0x...",
  "measurements": [
    { "name": "epa_dha_total", "value": 78, "unit": "percent", "range": "declared" },
    { "name": "peroxide_value", "value": 2.1, "unit": "meq_per_kg", "range": "declared" }
  ],
  "sampleHandoffHash": "0x...",
  "testedAt": "2026-10-09T12:00:00Z",
  "expiresAt": "2027-01-09T12:00:00Z",
  "signature": "0x..."
}
```

报告全文仍留在实验室或授权证据仓。消费者默认只看到指标是否覆盖、报告时间、实验室身份等级和结果范围。

### 4.2 Verifier 的认证检查

Verifier 按以下顺序检查：

1. 实验室公钥和资质状态；
2. 报告签名是否覆盖规范化声明；
3. `sampleId` 是否有完整交接链；
4. `sampleId` 是否属于当前 `batchId`；
5. 方法、单位和版本是否符合产品策略；
6. 报告是否过期或已经撤销；
7. 指标是否满足当前规则；
8. 是否存在重复报告、批次冲突或时间异常。

缺少关键报告时，输出 `missing` 或 `review`，不能静默把空字段当作通过。

### 4.3 质检员人工确认

质检员钱包签署的是人工审阅声明：

```text
我在指定时间按照 policyHash 审阅了 evidenceRoot 覆盖的证据，
并确认该批次在声明的范围内可以放行。
```

建议采用两方或三方放行：

```text
厂家质检员 + 独立实验室
```

高风险批次可以增加：

```text
厂家质检员 + 独立实验室 + 复核/仲裁方
```

JEV 或普通 Agent 不得替代这些人工责任主体。

## 5. BOT Chain 上链协议

### 5.1 网络和合约

```text
Network: bot-mainnet
Chain ID: 677
RPC: https://rpc.botchain.ai
Contract: 0x0033462bee153cb9DF12b5c447b9C282DbfbE877
Explorer: https://scan.botchain.ai
```

### 5.2 证据锚定顺序

```text
Observation / Lab Attestation
        ↓
EvidenceEnvelope 规范化、签名和哈希
        ↓
evidenceRoot / subjectHash / schemaHash / sourceHash
        ↓
anchorEvidence(...)
        ↓ EvidenceAnchored receipt
recordVerification(...)
        ↓ VerificationRecorded receipt
消费者查询和解释
```

在 `TruthPassEvidenceAnchor` 中，关键写入函数与事件是：

| 业务动作 | 合约函数 | 事件 | 写入角色 |
| --- | --- | --- | --- |
| 证据锚定 | `anchorEvidence` | `EvidenceAnchored` | `EVIDENCE_WRITER_ROLE` |
| 规则验收 | `recordVerification` | `VerificationRecorded` | `VERIFIER_ROLE` |
| 购买登记 | `recordPurchase` | `PurchaseRecorded` | `PURCHASE_WRITER_ROLE` |
| 消费反馈 | `recordContribution` | `ContributionRecorded` | `CONTRIBUTION_WRITER_ROLE` |
| 提出质疑 | `raiseDispute` | `DisputeRaised` | `DISPUTE_ROLE` |
| 撤销/替代 | `revokeOrSupersede` | `RecordRevokedOrSuperseded` | `REVOKER_ROLE` |

链上状态采用追加事件，不删除历史：

```text
pending
  → evidence_anchored
  → verification_recorded
  → accepted / accepted_with_scope
  → purchase_recorded
  → contribution_recorded
```

异常状态包括：

```text
review → disputed → revoked / superseded
```

只有 receipt 和事件回读成功后，前端才显示 `anchored`。RPC 不可用、交易待确认或事件校验失败时，页面必须显示 `anchor_pending` 或 `anchor_failed`。

### 5.3 传感器为什么不直接写链

传感器不直接调用 BOT Chain，原因是：

- 传感器不能安全保管 Gas 和合约角色；
- 温度、图片和连续遥测频率过高；
- 设备离线时需要本地缓存和重试；
- 设备数据必须先绑定批次、校验签名和过滤隐私；
- 真实上链需要幂等、receipt 回读和失败补投。

所以正确方式是：

```text
设备签名 → Edge Gateway → Evidence Store → Agent/Verifier → Anchor Relayer → BOT Chain
```

Anchor Relayer 只负责提交已经由规则和人工确认的摘要，不能修改原始数据，也不能替设备补造观测。

## 6. 钱包角色和消费者 Agent

### 6.1 钱包拆分

生产环境至少拆分：

```text
厂商钱包          生产声明
设备/网关密钥      设备来源签名
质检员钱包        人工检查和放行
实验室钱包        第三方认证
Verifier 钱包     确定性验收
Anchor Relayer    BOT Chain 交易提交
消费者钱包        购买、反馈和质疑意图
仲裁/撤销钱包     争议处理和状态纠正
```

当前仓库的主网角色仍是演示单钱包模式，生产前必须拆分并回读每个角色的授权 receipt。

### 6.2 消费者 Agent 的调用流程

```text
truthpass inspect FO-2026-001
        ↓
读取证据摘要、VerificationRecorded 和状态
        ↓
Agent 翻译“已覆盖 / 缺失 / 待复核 / 已撤销”
        ↓
用户确认后签署购买或质疑意图
        ↓
Relayer 或授权钱包提交链上交易
        ↓
Agent 返回 txHash、区块号和浏览器链接
```

消费者 Agent 不能持有消费者私钥。浏览器钱包或移动钱包负责最终确认；服务端只验证签名和广播受控交易。

## 7. 隐私和商业机密边界

### 链下保存

- 报告全文、原图、视频和传感器明细；
- 配方、生产工艺和供应商价格；
- 员工身份、脸部图像和设备位置；
- 消费者姓名、地址、订单和健康信息；
- 模型提示词和企业内部规则细节。

### 链上保存

- 批次和主体的承诺哈希；
- `evidenceRoot`、`resultHash`、`policyHash`；
- 签名主体、时间、状态和规则版本；
- 争议、撤销、替代和交易回执；
- 购买和反馈的匿名承诺。

消费者默认只获得：

```text
质量状态、覆盖范围、证据时间、来源类型、规则版本、链上 receipt
```

如果企业拒绝公开某项数据，也要返回 `restricted` 或 `missing`，Agent 不得静默过滤负面证据。

## 8. 分阶段企业部署

### L0：零产线改造

- 复用手机和现有摄像头；
- 通过 CSV、Excel、PDF、HTTP 接入；
- 使用二维码绑定批次；
- 质检员移动端人工签名；
- BOT Chain 只锚定摘要。

### L1：轻硬件接入

- 收货、封装、装箱位置增加固定摄像头；
- 接入温湿度或冷链传感器；
- 使用本地 Edge Gateway 批量上传；
- 保留人工抽检和第三方周期性检测。

### L2：生产系统连接

- 接入 MES、PLC、LIMS 和在线检测仪器；
- 实时采集、自动抽样和异常告警；
- 多厂家、多实验室共同维护联盟链；
- 定期将联盟链 checkpoint 锚定到 BOT Chain。

## 9. 当前仓库与本版本的关系

当前已有：

- `src/evidence.ts`：证据封装和哈希；
- `src/verifier.ts`：确定性质量验收；
- `src/chain.ts`：BOT Chain RPC、ABI、交易和 receipt 校验；
- `contracts/TruthPassEvidenceAnchor.sol`：证据、验收、购买、贡献、争议和撤销；
- `src/cli.ts`：消费者 Agent 的查询入口；
- `web-demo/`：网页观察台；
- `config/bot-chain-mainnet.deployed.json`：主网部署信息；
- `config/bot-chain-mainnet.replay.json`：公开业务回放清单。

仍需开发：

1. 浏览器钱包连接和 BOT Chain 自动切换；
2. MetaMask、OKX、Binance 的 EIP-1193 适配；
3. 传感器/摄像头 Edge Gateway；
4. 真实设备签名和 nonce 防重放；
5. 第三方实验室报告适配器；
6. 质检员钱包人工放行页面；
7. 购买、质疑和反馈的真实钱包交易；
8. 主网角色拆分和授权 receipt 回读；
9. Relayer outbox、失败重试和状态持久化；
10. 企业多租户、密钥托管、召回和争议流程。

## 10. 验收标准

企业试点和黑客松展示都应满足：

- 关键证据 100% 关联到批次、检查点和来源；
- 没有质检员确认的批次不能显示最终放行；
- 错批、旧照片、重复 nonce、无效签名和过期报告能够被阻断；
- 每个 `accepted` 结果都能回到 `EvidenceEnvelope`、证据根和主网 receipt；
- 原始报告、视频、配方和个人信息不上链；
- 链上交易失败时显示 `anchor_pending` 或 `anchor_failed`；
- 撤销、争议和召回追加新事件，不覆盖旧记录；
- 消费者 Agent 能返回状态、覆盖范围、限制和浏览器链接；
- 评委可以用 MetaMask、OKX 或 Binance 连接 Chain ID 677，并现场触发一笔真实产品交互交易。

## 11. 本版本的核心表达

> 传感器负责发现现场事实，服务器负责保存和校验证据，Agent 负责关联和解释，JEV 负责识别缺口，质检员钱包承担人工责任，确定性 Verifier 生成质量状态，BOT Chain 固化公开承诺，消费者 Agent 决定是否购买、质疑和反馈。
