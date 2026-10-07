# TruthPass BOT Chain 接入方案

> 文档版本：v0.7.0  
> 状态：BOT Chain 接入设计与实施基线，不代表合约已经部署  
> 最近修改：2026-10-07  
> 修改摘要：定义 TruthPass 在 BOT Chain 上的网络选择、Agent 身份、鱼油证据锚定、验证结果、消费者购买绑定、公共信誉和分阶段上线方案。  
> 影响范围：BOT Chain、ERC-8004、`TrustRegistry.sol`、Agent、CLI、网页观察台、消费者权益  
> 当前代码状态：本次只新增方案文档，不修改 `contracts/`、`src/`、`test/`、`web-demo/`。

## 1. 接入结论

TruthPass 不应把鱼油的全部生产数据直接写入链上。正确的接入方式是：

```text
ERP / MES / LIMS / IoT / 物流
          ↓
链下 EvidenceEnvelope 与批次图
          ↓
JEV 缺口/冲突路由
          ↓
确定性 Verifier
          ↓
BOT Chain 锚定 evidenceRoot、policyHash、结果和责任主体
          ↓
消费者 Agent 查询可复核证据卡
```

区块链在这里承担四件事：

1. 记录哪个 Agent 或主体在什么时间提交了哪个证据承诺；
2. 记录验收使用的 policy、Verifier 版本和结果范围；
3. 让撤销、复检、争议和消费者贡献成为追加事件，而不是覆盖旧记录；
4. 为其他消费者 Agent 提供公共、可回查的履约信息。

它不承担实验室测量、设备校准、样品封存或现实真实性判断。

## 2. 网络选择与官方参数

| 环境 | Chain ID | RPC | 区块浏览器 | 用途 |
| --- | ---: | --- | --- | --- |
| Bohr Testnet | `968` | `https://rpc.bohr.life` | `https://scan.bohr.life` | 开发、合约联调、现场验收 |
| BOT Chain Mainnet | `677` | `https://rpc.botchain.ai` | `https://scan.botchain.ai` | 稳定后进行主网能力演示 |

BOT 是交易 Gas 资产。测试网和主网的 Agent ID、合约地址、余额和状态不互通。应用启动时必须读取 RPC 的 `eth_chainId` 并与配置严格比较，错误网络直接停止写入。

官方参考：

- [BOT Chain Quick Guide](https://dev-docs.botchain.ai/docs/Developers/quick-guide/)
- [BOT Chain 网络配置与验收](https://dev-docs.botchain.ai/docs/RWA/testnet-practice/)
- [BOT Chain Agent Identity 文档](https://dev-docs.botchain.ai/docs/Agent-OS/agent-identity/)

主网身份/信誉/验证注册表地址应以官方部署清单和链上代码检查为准。当前官方文档列出的主网地址为：

```text
IdentityRegistry    0xB43Edfb9C7609cF645e932B2fF20f26F0d4488dE
ReputationRegistry  0xB3f7061354193a424856Cc63028cE3556262dAc9
ValidationRegistry  0x85Bf081D1492393C3Fb2742b379b6ADbC7dbC79b
```

使用前必须再次检查 `eth_getCode`、ABI、版本和官方地址清单，不能只凭文档中的字符串部署。

## 3. 三类链上合约的分工

### 3.1 ERC-8004 IdentityRegistry：谁在提供服务

为以下主体建立链上身份或可验证的 Agent 记录：

- `truthpass-orchestrator`：负责编排和调用；
- `production-agent`：负责把厂家已有系统转换成生产证据；
- `lab-agent`：代表专业检测机构提交报告引用；
- `cold-chain-agent`：代表温度、仓储和物流证据；
- `consumer-agent`：代表消费者侧的查询、授权和反馈。

身份注册只证明“这个主体对应某个注册记录”，不证明能力真实。服务能力、端点、公钥、资质和撤销状态要放入版本化 metadata，并由 TruthPass 的探测和验收流程继续验证。

### 3.2 ValidationRegistry：一次任务是否完成验证

验证请求绑定：

```text
agentRegistry + agentId
batchCommitment
taskHash
policyHash
evidenceRoot
requestedChecks
```

验证响应绑定：

```text
verifierAgentId
decisionCode
resultScope
missingCodes
conflictCodes
verifierVersion
resultHash
```

ValidationRegistry 只记录验证请求和响应的公共指纹，原始实验室报告和设备明细继续留在链下。

### 3.3 TruthPass 应用合约：证据、信誉和消费者贡献

当前 `TrustRegistry.sol` 只是草案。正式版本建议拆成清晰的应用接口，至少包括：

```text
registerService(agentId, metadataHash, capabilityHash)
anchorEvidence(batchCommitment, evidenceRoot, schemaHash)
recordVerification(taskHash, policyHash, resultHash, status, scope)
recordFulfilment(serviceId, taskHash, evidenceRoot, score, status)
recordPurchase(purchaseCommitment, batchCommitment, consentCommitment)
recordContribution(purchaseCommitment, contributionCommitment, evidenceHash)
openDispute(targetId, reasonHash)
revokeOrSupersede(targetId, reasonHash, replacementId)
```

建议最终由一个合约管理公共事件，或拆成 `EvidenceAnchor`、`Reputation`、`ConsumerContribution` 三个合约。比赛 Demo 可以使用一个合约，但接口必须预留版本、角色和撤销状态。

## 4. 鱼油证据如何上链

### 4.1 生产过程质检

```text
厂家 ERP/MES/LIMS/设备导出
       ↓ 只读 Connector
Production Agent
       ↓ EvidenceEnvelope
批次/工单/设备/工艺步骤图
       ↓
JEV：缺口、冲突、下一步检测
       ↓
Process Verifier
       ↓
BOT Chain：evidenceRoot + resultHash + policyHash
```

链上锚定：

- 工厂 Agent 身份 ID；
- 原料批次、工单和成品批次的承诺值；
- 过程事件集合形成的 `evidenceRoot`；
- `fish-oil-process-v1` 的 schema hash；
- 生产过程 policy hash 和 Verifier 版本；
- `accepted / accepted_with_scope / review / rejected`；
- 缺失、冲突、撤销或争议事件。

链下保存：ERP/MES 原始导出、设备时间序列、操作者信息、配方、设备维护与校准记录。消费者只看到生产过程的公开范围和结论，不默认看到商业机密。

### 4.2 成品质检

```text
成品抽样与封签
       ↓
样品编号、交接、实验室报告
       ↓ Lab Agent
报告签名/资质/方法/单位/批次检查
       ↓
JEV：判断报告是否完整、是否冲突、是否要复检
       ↓
Finished-Goods Verifier
       ↓
BOT Chain：reportHash + sampleCommitment + resultHash
```

链上锚定：

- 实验室 Agent 身份和报告签发主体；
- 样品承诺值、报告哈希和批次承诺值；
- 检测方法、单位和 policy 的哈希；
- EPA+DHA、氧化、重金属等结果的状态摘要；
- 报告时间、有效期、复检、撤销和争议状态。

链下保存：完整 COA、谱图、原始数据、实验室资质、样品交接附件、精确测量值和个人信息。

## 5. EvidenceEnvelope 与链上承诺

统一证据事件建议至少包含：

```json
{
  "envelopeVersion": "evidence-envelope-v1",
  "eventId": "evt-...",
  "eventType": "lab_report | production_step | cold_chain_reading",
  "subjectRefs": [
    { "type": "batch", "id": "FO-2026-001" },
    { "type": "sample", "id": "S-2026-001-03" }
  ],
  "issuer": { "type": "lab | device | factory", "id": "..." },
  "producedByAgent": "lab-agent-...",
  "observedAt": "2026-10-06T10:20:00Z",
  "sequence": 1842,
  "previousEventHash": "0x...",
  "payloadHash": "0x...",
  "schemaHash": "0x...",
  "attestationLevel": "lab-signed | device-signed | supplier-declared",
  "keyId": "key-...",
  "signature": "0x...",
  "status": "valid | partial | invalid | revoked | disputed"
}
```

上链前执行：

1. 统一时区、数值单位、空值和 Unicode 规范；
2. 验签并检查公钥是否注册、有效和未吊销；
3. 检查批次、样品、设备、报告和工单关系；
4. 检查 `eventId`、`sequence`、`previousEventHash` 和 `requestId` 是否重放；
5. 对排序后的事件形成 `evidenceRoot`；
6. 由授权写入者发送锚定交易；
7. 等待 receipt，回读事件并保存 `txHash`、区块号和确认状态。

哈希必须使用版本化规范化编码，当前代码中的 `JSON.stringify` 只能用于 Demo，不能作为跨语言生产回放标准。

## 6. JEV 在 BOT Chain 流程中的位置

JEV 不直接写链，也不直接授予“通过”。正确顺序是：

```text
EvidenceEnvelope 摘要
       ↓
JEV
       ↓ 固定枚举
route_to_rule_verifier
request_more_evidence
route_to_recheck
reject_evidence
       ↓
Deterministic Verifier
       ↓
Chain Adapter
```

JEV 输出的 `inputHash`、`modelVersion`、`schemaHash`、`decisionCode` 和 `outputHash` 可以随验证结果一起锚定。JEV 超时、未知版本、低置信度、输出过期或输入不可回放时，最终结果只能进入 `review` 或 `request_more_evidence`。

JEV Key 只能放在服务器或本地后端环境变量中，不能放到 `web-demo/`、浏览器代码、截图、README 或 GitHub。当前 Key 的真实 smoke test 已返回结构化结果，但本项目尚未把该 Key 写入 adapter，也没有把它写入文档。

## 7. 合约权限与安全边界

建议使用角色控制：

| 角色 | 能做什么 | 不能做什么 |
| --- | --- | --- |
| `REGISTRAR_ROLE` | 注册/更新 Agent metadata | 修改历史证据和验收结果 |
| `EVIDENCE_WRITER_ROLE` | 写入证据根和来源摘要 | 自行升级为实验室身份 |
| `VERIFIER_ROLE` | 写入确定性验收结果 | 接受 JEV 自由文本改判 |
| `REPUTATION_ROLE` | 记录履约反馈、时间衰减和聚合索引 | 删除原始负面记录 |
| `DISPUTE_ROLE` | 标记争议、复检和替代关系 | 覆盖原始事件 |
| `PAUSER_ROLE` | 应急暂停写入 | 修改既有历史 |
| `CONSUMER_SIGNER` | 绑定购买证明和最小授权 | 代表其他消费者提交反馈 |

写入授权应使用 EIP-712 域分隔，绑定：

```text
chainId
verifyingContract
agentId / wallet
batchCommitment
taskHash
nonce
validUntil
```

这样可以防止跨链重放、跨合约重放和旧授权重复使用。服务 Owner 不应拥有删除负面履约记录的权限；撤销必须是追加事件并保留原记录。

## 8. 消费者 Agent 与新权益

购买流程建议为：

```text
消费者 Agent 生成最小授权
       ↓ 钱包签名
购买证明绑定商品批次承诺
       ↓
链上记录 purchaseCommitment
       ↓
消费者提交一次性质量反馈
       ↓
获得复检优先权、服务额度或共建积分
```

比赛版本不要把它写成股权、分红或投资回报。若未来要做收益分配，需要单独进行法律、税务和金融监管评估，并使用独立的受监管协议。BOT Chain 只负责记录授权、状态和事件，不能自动解决权益合法性。

消费者隐私采用承诺值或伪名化标识：链上不保存姓名、手机号、地址、健康数据和订单全文；消费者 Agent 只向链下服务授权本次判断所需的最小字段。

## 9. CLI、网页和 BOT Chain 的一致性

CLI 是真实入口，网页是观察台。三者必须引用同一个验证结果：

```text
truthpass verify batch FO-2026-001 --policy fish-oil-quality-v1 --json
      ↓
VerificationResult
      ├─ JEV decision hash
      ├─ verifier result hash
      ├─ evidenceRoot
      ├─ chain anchor txHash
      └─ consumer explanation
```

网页不能自行显示“已上链”；只有当链上交易 receipt 和事件被回读确认后，才显示 `anchored`。否则显示：

```text
anchor_pending
anchor_failed
chain_unavailable
```

链上失败时，链下验收结果仍保留；重试必须使用同一个幂等键，不能每次生成一条新反馈。

## 10. 分阶段实施

### P0：测试网最小闭环

1. 部署一个修订版 `TrustRegistry` 到 Bohr Testnet；
2. 写入三个 Demo Agent 身份：TruthPass、实验室、消费者；
3. 使用 `demo/synthetic` 鱼油证据生成 `evidenceRoot`；
4. 执行 JEV smoke test，但只把模型版本和决策哈希写入链上；
5. 写入 `recordVerification` 和 `recordFulfilment`；
6. 从 RPC 和区块浏览器回读 transaction receipt 和事件；
7. 网页显示真实 `txHash`，没有交易就显示未锚定。

P0 不做：真实厂家接入、真实消费者资产发行、复杂跨链、主网金融权益。

### P1：真实数据低改造试点

1. 接入 ERP/MES/LIMS/温度记录器的只读适配器；
2. 生成可签名 EvidenceEnvelope；
3. 接入实验室公钥、样品交接和报告撤销；
4. 将批次图、样品图和报告图的根哈希锚定；
5. 引入 JEV timeout、低置信度和冲突复检；
6. 增加合约角色、EIP-712、nonce、防重和争议事件；
7. 用真实测试批次在测试网上做端到端回放。

### P2：主网与规模化

1. 通过合约审计、密钥治理和灾备检查后再使用 Chain ID 677；
2. 使用 HSM/托管签名、冷热钱包和多签管理写入权限；
3. 建立多实验室、多工厂、多物流主体的信誉和复检机制；
4. 引入 ERC-4337 智能账户或受控 Paymaster，降低消费者 Gas 门槛；
5. 对公开证据做选择性披露，减少链上可关联隐私；
6. 运行链上事件索引、告警、争议和撤销服务。

## 11. 接入验收清单

### 网络与部署

- [ ] RPC 返回的 Chain ID 与配置一致；
- [ ] 目标合约 `eth_getCode` 非空，ABI 与版本匹配；
- [ ] 测试网和主网配置隔离，禁止自动 fallback；
- [ ] 部署地址、部署交易和源码验证记录入仓库；
- [ ] 写入钱包余额和 Gas 预算可追踪。

### 证据与验证

- [ ] 事件、样品、批次和设备关系可回放；
- [ ] 签名、公钥、密钥状态和撤销可验证；
- [ ] 旧报告、旧事件和旧授权重放会失败；
- [ ] JEV 不能覆盖 Verifier；
- [ ] `review`、`rejected`、`anchor_failed` 不得被前端显示为通过。

### 消费者与信誉

- [ ] 购买绑定必须有消费者签名和授权范围；
- [ ] 同一 purchase 只能产生一次有效贡献；
- [ ] 服务 Owner 不能抹除负面记录；
- [ ] 争议和复检事件追加保存；
- [ ] 链上不出现个人信息和完整订单。

BOT Chain 接入完成的标准不是“交易发送成功”，而是：同一批次、同一证据根、同一 policy 和同一 Verifier 结果可以在链下回放，并通过交易事件被其他 Agent 查询和复核。

