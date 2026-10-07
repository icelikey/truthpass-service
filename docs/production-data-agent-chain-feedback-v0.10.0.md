# 生产数据、Agent 与 BOT Chain 实时反馈实现交接方案

> 文档版本：v0.10.0
> 状态：当前交接方案
> 最近修改：2026-10-08
> 修改摘要：明确生产数据采集、Agent/JEV 分析、确定性验收、BOT Chain 锚定和链上事件回读之间的运行时关系。
> 影响范围：生产数据接入、Agent、JEV、Verifier、BOT Chain、网页 BFF、消费者 CLI、消费者钱包
> 队友下一步：实现 Evidence Ingest、Anchor Worker、Chain Indexer，并把网页订单动作接入真实签名与 receipt 回读。

## 1. 结论与当前边界

BOT Chain 不负责采集原始生产数据，也不负责运行 Agent 或 JEV。生产数据、检测报告和传感器明细先在链下接入、验签、规范化和分析；BOT Chain 负责记录证据承诺、验收结果、购买绑定和消费者贡献的哈希与状态。

当前仓库已经具备：

- `contracts/TruthPassEvidenceAnchor.sol` 中的证据、验收、购买和贡献事件；
- `src/chain.ts` 中的 BOT Chain 网络检查、calldata 构造、预签名交易提交和 receipt 校验；
- `config/bot-chain-mainnet.replay.json` 中的主网历史 receipt；
- CLI 的 JEV 决策门、确定性 Verifier 和消费者查询结果。

当前尚未完成：

- 生产服务器持续推送数据的接入服务；
- Agent 分析结束后自动触发链上锚定；
- 链上事件监听、状态回写和 Agent 查询反馈；
- 网页订单动作与真实钱包签名、交易提交和余额快照的连接。

仓库中的 `demo/synthetic` 数据和历史 replay receipt 只能用于演示和联调，不能写成现实厂家产线已经接入。

## 2. 最终运行时链路

```text
生产服务器 / ERP / MES / LIMS / IoT / 物流系统
                |
                v
        Evidence Ingest Service
        验签、批次绑定、幂等、规范化
                |
                v
       Off-chain Evidence Store
       原始文件、传感器明细、报告和审计日志
                |
                v
         Agent / JEV Worker
         缺失项、冲突项、服务路由
                |
                v
       Deterministic Verifier
       固定规则决定 accepted / partial / rejected
                |
                +----------------------+
                |                      |
                v                      v
          Anchor Worker          Consumer Agent
          写入 BOT Chain          解释和推荐
                |
                v
       BOT Chain Event Indexer
       监听事件并更新只读状态
                |
                v
        Agent / Web BFF 回读链上结果
```

Agent 不能直接写数据库、直接写合约或自行生成最终通过结论。所有模型输出都必须经过 Schema 校验和确定性规则。

## 3. 鱼油最小数据采集点

每个采集点生成一个版本化 `EvidenceEnvelope`。原始内容保留在链下，链上只保存内容承诺。

| 采集点 | `kind` | 最小字段 | 建议写链时机 |
|---|---|---|---|
| 原料接收 | `material_lot` | 原料批次、供应方、产地、接收时间、数量 | 原料批次确认后 |
| 生产过程 | `production_event` | 生产批次、设备、关键时间、工艺事件、操作方 | 生产批次完成后 |
| 第三方检测 | `inspection_report` | 报告号、样品号、批次、EPA+DHA、过氧化值、TOTOX、重金属、签发方 | 报告验签后 |
| 冷链监测 | `cold_chain` | 设备 ID、采样窗口、异常时长、数据根哈希 | 批次出厂或异常发生时 |
| 物流交接 | `shipment_event` | 订单/运单、交接时间、仓库、温控摘要 | 关键交接完成后 |
| 用户购买 | `purchase_record` | 购买承诺、批次承诺、授权哈希、订单证明 | 用户明确确认后 |
| 用户反馈 | `user_feedback` | 购买 ID、反馈证据哈希、评分、贡献哈希 | 反馈验权后 |

统一证据信封至少包含：

```json
{
  "schemaVersion": "truthpass.evidence.v1",
  "evidenceId": "ev-cold-chain-001",
  "batchId": "FO-2026-001",
  "kind": "cold_chain",
  "issuerId": "device-cold-07",
  "sourceKind": "iot",
  "capturedAt": "2026-10-08T10:00:00Z",
  "payloadUri": "off-chain://evidence/ev-cold-chain-001",
  "payloadHash": "0x...",
  "signature": "...",
  "status": "active"
}
```

`evidenceId + issuerId + sequence` 必须具备幂等约束，重复推送不能生成重复证据或重复交易。

## 4. Agent、JEV 和 Verifier 的职责

### 4.1 Agent

Agent 负责将用户问题转换成受限任务，例如查询批次、请求检测详情、确认购买或提交反馈。它可以选择工具和解释结果，但不能新增证据中的数字、哈希、检测机构或结论。

### 4.2 JEV

JEV 作为结构化决策门，输出固定枚举和引用：

```json
{
  "route": "route_to_rule_verifier",
  "confidence": 0.94,
  "missingEvidenceCodes": [],
  "conflictCodes": [],
  "inputHash": "0x...",
  "outputHash": "0x...",
  "mode": "live|deterministic_fallback"
}
```

JEV 只判断证据是否足够、是否冲突以及下一步路由，不直接决定产品是否通过。实时 JEV 不可用时必须明确标记 `deterministic_fallback`，不能把降级结果写成 live 模型结果。

### 4.3 Deterministic Verifier

Verifier 根据已批准的 `PolicySnapshot` 计算最终状态。鱼油演示门槛包括 EPA+DHA、过氧化值、TOTOX、冷链和批次绑定等检查。Verifier 输出：

```text
accepted / partial / rejected
policyId
policyHash
checks
resultHash
```

只有 Verifier 的结果可以进入链上 `VerificationRecorded`，Agent 和 JEV 不能改写该结果。

## 5. BOT Chain 的四类写入

当前主网合约为 `TruthPassEvidenceAnchor`，网络 Chain ID 为 `677`。写入边界如下：

| 链上事件 | 写入时机 | 关键字段 |
|---|---|---|
| `EvidenceAnchored` | 一批证据完成规范化，或关键异常需要立即留痕 | `evidenceRoot`、`subjectHash`、`schemaHash`、`sourceHash` |
| `VerificationRecorded` | Verifier 完成确定性验收 | `evidenceRoot`、`taskHash`、`policyHash`、`verifierVersionHash`、`resultHash` |
| `PurchaseRecorded` | 用户明确授权并确认购买 | `consumerCommitment`、`batchCommitment`、`purchaseProofHash`、`consentHash` |
| `ContributionRecorded` | 购买成立后提交消费者反馈或贡献 | `purchaseId`、`evidenceHash`、`contributionHash`、`score` |

原始报告和 IoT 明细不直接写链。普通遥测数据按时间窗口或事件窗口聚合成 Merkle Root；原料入库、检测完成、冷链异常和出厂等关键事件可以立即锚定。

## 6. 链上反馈如何回到 Agent

区块链不会主动调用 Agent。需要增加 `Chain Indexer` 或 `Event Watcher`：

```text
EvidenceAnchored / VerificationRecorded / PurchaseRecorded
                |
                v
          Chain Indexer
                |
                v
       只读链上状态表 / cache
                |
                v
    ConsumerInspectionManifest
                |
                v
        Agent 和网页查询结果
```

每次请求都必须保留一条可回放关联：

```text
traceId
  -> evidenceIds
  -> evidenceRoot
  -> jevInputHash / jevOutputHash
  -> policyHash / resultHash
  -> txHash / blockNumber / eventName
  -> walletAddress / nonce / balance snapshot
```

这样 Agent 才能回答“这次分析对应哪批数据、哪次验收、哪笔链上交易”。

## 7. 钱包和用户动作

普通查询必须保持只读。只有用户明确确认“购买并加入共建”时，才触发钱包签名和链上写入。

建议流程：

```text
Agent 查询批次
  -> 展示证据和验收结果
  -> 用户确认购买/共建
  -> 读取钱包地址、余额和 nonce
  -> 钱包签名 PurchaseRecorded
  -> 等待 receipt
  -> 可选提交 ContributionRecorded
  -> 读取余额、nonce、事件和合约状态
  -> Agent 转译结果
```

如果使用 Relayer，变化的是 Relayer 钱包；如果要展示消费者钱包变化，必须由消费者钱包签名。演示应使用专用钱包，私钥不得进入前端、`.env` 提交内容或 Git 历史。

## 8. 需要队友实现的模块

### P0：运行时闭环

- `Evidence Ingest Service`：接收生产服务器、IoT、实验室和物流证据；
- `EvidenceEnvelope` 验签、批次绑定、幂等和过期检查；
- `Anchor Worker`：将证据根和验收结果写入 BOT Chain；
- `Chain Indexer`：监听四类事件并更新只读状态；
- 统一 `ConsumerInspectionManifest v1`，供 CLI、API 和网页复用。

### P1：网页和消费者 Agent

- `/api/agent/verify`：只读验证；
- `/api/agent/purchase-confirm`：用户确认后的购买动作；
- `/api/chain/status/:batchId`：读取链上事件和 receipt；
- `/api/wallet/:address/snapshot`：读取余额、nonce 和 Gas 前后快照；
- 网页展示 Agent Trace、Evidence ID、交易哈希、区块号和浏览器链接。

### P2：生产化能力

- ERP/MES/LIMS/WMS/TMS 只读适配器；
- 设备签名和密钥轮换；
- 证据撤销、复检和争议事件；
- 生产、检测、购买和贡献角色的钱包拆分；
- 真实厂家和第三方实验室数据替换 `demo/synthetic`。

## 9. 验收标准

实现后必须同时满足：

1. 输入同一批次号时，CLI、网页和用户 Agent 返回同一份 `ConsumerInspectionManifest`；
2. Agent 查询不产生交易；
3. 用户确认购买后，至少出现一笔真实交易和一个对应合约事件；
4. 交易 receipt、事件和合约状态可以通过 RPC 回读；
5. 页面能显示 Chain ID、钱包地址、余额前后差异、交易哈希和区块号；
6. receipt 不完整或事件回读失败时，不能显示 `anchored`；
7. JEV 不可用时显示 `deterministic_fallback`，不能伪装成 live；
8. 重复推送同一证据或重复购买不会产生重复业务记录；
9. `npm test`、`npm run typecheck`、`npm run build` 全部通过；
10. 演示数据、真实数据、原始报告和个人信息的边界在页面和 Agent 输出中明确标注。
