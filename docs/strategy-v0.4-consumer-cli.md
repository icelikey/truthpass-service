# 真验 v0.4：消费者 CLI 与生产共建战略框架

> 文档版本：v0.4.0  
> 状态：当前生效  
> 最近修改：2026-10-06  
> 修改摘要：将主入口从厂家网页调整为消费者 Agent + CLI，并补齐数据、链上、权益和评委展示框架。  
> 影响范围：战略架构、CLI 合同、合约权限、前端叙事、商业模式  
> 队友下一步：按本文实现 CLI JSON 合同、角色权限和网页观察台，不把计划写成已完成。

## 0. 战略修正

当前仓库的早期页面更像“厂家质量后台”，容易让评委把真验理解为一个把生产记录放到链上的溯源系统。这个方向需要修正：

> **真验的主入口是消费者自己的 Agent，通过 CLI 调用；网页只是黑客松现场的观察台。**

消费者不需要理解 EPA+DHA、设备签名、Merkle Root 或合约事件。他只需要问自己的 Agent：“这批鱼油能不能买？证据哪里不足？”Agent 调用真验 CLI，真验完成服务发现、证据验收、风险解释和公共信誉查询，再把简明结论返回给消费者。

网页的任务是向评委展示这句话背后的机制：采集了什么、哪个 Agent 负责、证据如何关联、规则如何判断、哈希如何锚定、消费者如何把一次购买变成下一次选择可以使用的公共信息。

## 1. 三个用户视角

### 1.1 消费者视角：默认视图

```text
消费者：帮我判断 FO-2026-001，重点看新鲜度、含量和冷链。
消费者 Agent → 真验 CLI
真验 CLI → 返回证据卡、风险、数据缺口和下一步建议
消费者 Agent → 用自然语言解释“可以买 / 暂缓 / 需要复检”
```

消费者看到的是结论和证据来源，不是厂家生产控制台。

### 1.2 评委视角：观察台

网页提供一个“查看系统如何得出结论”的入口，展示：

```text
IoT/报告采集 → Agent 身份关联 → 证据标准化 → 规则验收
      → 证据哈希 → 链上锚定 → 公共信誉 → 消费者 Agent 复用
```

### 1.3 生产方视角：被验证的一方

生产方只能看到自己的批次、证据状态、待补材料和争议处理，不拥有修改公共验收结论的权限。厂家可以补充证据、申请复检和响应争议，但不能自行把“自报”变成“第三方已验证”。

## 2. CLI 作为真实产品入口

CLI 是给 Agent 和开发者用的稳定接口；网页调用同一套 CLI/API，不维护第二套演示逻辑。

### 2.1 建议命令

```bash
truthpass discover --category fish-oil --batch FO-2026-001 --json
truthpass probe service lab-c --capability fish-oil-batch-quality-check --json
truthpass verify batch FO-2026-001 --policy fish-oil-freshness-v1 --json
truthpass explain verification <verification-id> --audience consumer --json
truthpass reputation service lab-c --include-revocations --json
truthpass consent grant --batch FO-2026-001 --scope quality-feedback --json
truthpass purchase bind --batch FO-2026-001 --proof-hash <hash> --json
truthpass feedback submit --purchase <purchase-id> --json
truthpass anchor evidence <evidence-hash> --network bot-chain --json
```

### 2.2 两种输出

`--json` 是 Agent 合同，字段稳定、无营销语言；`--human` 或默认输出是给人看的解释。两者必须来自同一个 `VerificationResult`，不能让网页展示一套结果、CLI 返回另一套结果。

```json
{
  "verificationId": "ver-FO-2026-001-001",
  "batchId": "FO-2026-001",
  "decision": "accepted_with_scope",
  "decisionLabel": "按当前规则通过，仍有一项数据未覆盖",
  "confidence": "medium",
  "checks": {
    "epaDha": { "value": 78, "threshold": 70, "status": "pass" },
    "peroxide": { "value": 2.1, "threshold": 5, "status": "pass" },
    "coldChain": { "gapHours": 2, "threshold": 6, "status": "pass" },
    "heavyMetals": { "status": "missing" }
  },
  "sources": [
    { "kind": "third-party-lab", "agentId": "lab-c", "evidenceHash": "0x..." },
    { "kind": "cold-chain-device", "agentId": "device-cold-07", "evidenceHash": "0x..." }
  ],
  "nextAction": "如需覆盖重金属，再调用一个独立检测服务",
  "dataClass": "demo/synthetic"
}
```

`accepted_with_scope` 比简单的“真/假”更诚实：它表示“在声明的规则和证据范围内通过”，不暗示区块链或 Agent 对现实世界作了绝对保证。

## 3. 数据采集与 Agent 关联

### 3.1 事件信封

每一次设备观察、报告提交和消费者反馈都先变成统一的 `EvidenceEnvelope`：

```json
{
  "eventId": "evt-01H...",
  "eventType": "cold_chain_reading",
  "subject": { "type": "batch", "id": "FO-2026-001" },
  "issuer": { "type": "device", "id": "device-cold-07" },
  "producedByAgent": "cold-chain-agent-c",
  "observedAt": "2026-10-06T10:20:00Z",
  "sequence": 1842,
  "previousEventHash": "0x...",
  "payloadUri": "object://evidence/evt-01H.json",
  "payloadHash": "0x...",
  "schemaVersion": "fish-oil-cold-chain-v1",
  "nonce": "...",
  "signature": "0x...",
  "attestationLevel": "device-signed"
}
```

### 3.2 关联图

```text
消费者 Agent ──调用──> 真验 CLI
                         │
                         ├──验证能力──> 检测 Agent
                         ├──验证能力──> 冷链 Agent
                         ├──读取观察──> 设备 DID / 公钥
                         └──查询历史──> 公共信誉

设备/报告 → 事件信封 → 批次 → 验收任务 → 验收结果 → 公共反馈
```

关键字段不是“哪个模型生成了这句话”，而是 `issuer`、`producedByAgent`、`subject.batchId`、`observedAt`、`payloadHash` 和 `signature`。这样可以回答：哪个设备观察的、哪个 Agent 负责转译的、它服务于哪个批次、是否被重复播放、是否能回到原始材料。

### 3.3 设备与 Agent 的信任边界

设备签名能降低“采集后被改写”的风险，但不能单独证明设备没有被替换、校准正确或安装在正确位置。因此生产版还需要：

- 设备注册、密钥轮换和吊销；
- 批次绑定和一次性 `nonce`；
- 单调递增序列或前一事件哈希；
- 时间源和时钟漂移检查；
- 校准证书和维护记录；
- 异常值、断点和设备替换的争议流程。

比赛 MVP 可以用模拟签名和序列字段展示这些接口，但必须把它标为 `demo/synthetic`。

## 4. 链上结构：五层而不是一张表

### 4.1 身份层

登记服务、Agent、设备和验证者的主体 ID、公钥、能力声明、元数据 URI、状态和吊销事件。身份表示“谁提交”，不表示“提交内容一定正确”。

### 4.2 证据锚定层

保存批次 ID、事件/报告哈希、来源 ID、schema 版本、时间、前一事件哈希、链下 URI 和撤销状态。大量原始数据留在链下。

### 4.3 验收层

保存任务哈希、规则集哈希、验证器 ID、证据集合根哈希、结果、范围、时间和争议状态。规则集必须可版本化，不能用“当前代码”这种不可追溯的描述。

### 4.4 信誉层

保存服务履约反馈、消费者反馈来源类型、评分、证据哈希、时间衰减信息和撤销事件。评分只是公共参考，不是产品安全保证。

### 4.5 权益层

比赛版本只登记消费者的购买证明哈希、同意哈希、贡献事件和服务权益状态。它不发行股权、不承诺利润、不把消费者的购买自动变成公司股份。

## 5. 合约设计建议

当前仓库的 `TrustRegistry.sol` 是演示草案，生产版必须把“任何地址都能提交消费者购买/贡献”收紧为角色和签名校验。

### 5.1 推荐合约边界

```solidity
interface ITruthPassRegistry {
    function registerPrincipal(bytes32 principalId, bytes32 metadataHash, bytes32 keyId) external;
    function anchorEvidence(bytes32 batchId, bytes32 evidenceHash, bytes32 issuerId, bytes32 schemaHash) external;
    function recordVerification(bytes32 taskHash, bytes32 evidenceRoot, bytes32 policyHash, uint8 status) external;
    function recordFeedback(bytes32 subjectId, bytes32 taskHash, uint8 score, bytes32 evidenceHash) external;
    function revokeRecord(bytes32 recordId, bytes32 reasonHash) external;
}
```

### 5.2 权限和安全

- `REGISTRAR_ROLE`：注册主体和公钥；
- `ATTESTOR_ROLE`：提交设备或检测报告锚点；
- `VERIFIER_ROLE`：提交规则验收结果；
- `ARBITER_ROLE`：发起或确认撤销/争议；
- `CONSUMER_GATEWAY_ROLE`：提交已经过购买证明和 EIP-712 签名验证的消费者事件。

合约还要考虑重放保护、幂等键、批次状态机、密钥吊销、暂停开关、链重组确认数、事件索引和升级权限。链上只做承诺和状态，不把复杂业务规则硬编码成无法修复的金融合约。

### 5.3 数据提交协议

建议使用 EIP-712 对“购买、授权和贡献”做结构化签名；消费者可以通过账户抽象或代付减少钱包摩擦。EIP-712 只证明签名者同意了一段结构化数据，不会自动证明消费者拥有商品或生产方数据真实，购买证明仍需由订单/平台/收货服务提供。

## 6. “早期购买者加入生产合约”的可行路径

### 6.1 比赛 MVP：共建者权益

把“原始股东”改成 **批次共建者 / 早期验证贡献者**，权益只包括：

- 早期批次试用和优先购买；
- 第三方复检额度；
- 售后优先和服务费减免；
- 对下一批次的检测项目投票；
- 非现金、不可交易、可撤销的贡献积分。

购买时间只决定共建批次和权益等级，不代表股权、债权、保本或利润分配。权益应写入消费者合同、服务条款和退款规则，链上只存合同版本哈希和履约事件。

### 6.2 商业试点：采购/会员合同

如果生产方希望把消费者锁定为长期共建用户，可以采用“质量共建会员”或“批次预购协议”：消费者购买的是商品、检测服务和参与权，收益表现为折扣、复检服务、优先权或明确的固定返还规则。不得把未来公司利润、估值上涨或“投资回报”作为公开营销承诺。

这条路径更接近消费合同和服务合同，仍需处理预付款退款、商品质量、履约失败、个人信息和广告表述。

### 6.3 真实股权/利润分成：独立合规项目

如果未来确实要让公众获得公司股权、利润分成或可交易权益，必须把它从真验商品流程中拆成独立的融资项目，由合规主体、律师和持牌机构确认发行方式、投资者范围、信息披露、资金托管、税务和退出机制。不能用“积分”“NFT”“链上凭证”把公开募资换个名字。

当前资料显示，证监会曾明确整治未经批准的公开或变相公开发行股票、非法经营证券业务和以股权众筹名义募集基金；人民银行等部门也明确虚拟货币及相关业务活动的风险边界。因此比赛演示不应使用“原始股东、稳赚、分红、投资回报、可交易代币”等文案。

## 7. 还需要补上的关键问题

### 7.1 证据真实性

链上只能证明“某个主体在某个时间提交了某个哈希”。需要另外回答：设备是否可信、实验室是否独立、样品是否被替换、生产方是否与检测方串通。

### 7.2 规则责任

鱼油阈值必须绑定产品规格、适用标准、检测方法、实验室资质和规则版本。当前 Demo 的 70%、5、20 只是演示门槛，不能直接包装成普遍监管标准。

### 7.3 争议和纠错

必须设计复检、申诉、临时冻结、证据撤销、责任方通知和历史结果保留。删除链上记录不是纠错，正确做法是追加撤销和替代结果。

### 7.4 激励冲突

厂家付费、检测机构接单、消费者获得权益会造成利益冲突。需要公开付款关系、检测服务选择规则、重复反馈风控和独立复检入口。

### 7.5 隐私与数据治理

消费者购买证明、位置、设备信息和健康数据不能默认上传。只收集本次反馈必要字段；个人信息链下保存，链上只保存哈希、同意版本和撤销状态。

### 7.6 运营可靠性

还要处理 CLI 版本兼容、服务超时、密钥轮换、链上 RPC 故障、Gas 费用、离线重试、对象存储丢失、数据保留和审计日志。比赛现场必须有离线演示数据和链上失败降级。

## 8. 评委展示叙事

网页不要从“生产厂家仪表盘”开始，而从消费者问题开始：

1. **一句问题**：`这批鱼油，为什么值得我信？`；
2. **一次 CLI 调用**：展示消费者 Agent 发出的 `verify batch`；
3. **三个候选服务**：历史高分但离线、在线但批次错、在线且本次通过；
4. **一张证据卡**：指标、来源、数据缺口和规则版本；
5. **一条链路**：设备事件 → Agent 关联 → 验收结果 → 链上哈希；
6. **一次消费者参与**：授权、绑定购买、提交反馈、获得共建权益；
7. **一句边界**：链上保证可复核，不宣称凭空制造现实真实性。

评委最终应记住的不是“我们做了一个鱼油看板”，而是：

> 真验把生产端的质量证据翻译成消费者 Agent 能调用的公共判断，并让购买后的消费者反馈反过来影响下一次服务选择。

## 9. 战略结论

这套范式不是“给白牌商品贴区块链标签”，而是把消费关系改造成三方协作：生产方提供可审计证据，第三方和设备提供独立观察，消费者 Agent 以购买和反馈参与公共验收。白牌商品因此不再只能靠品牌广告建立信任，而可以靠持续的证据履约建立信任。

真正可持续的顺序是：

```text
先有可验证证据 → 再有公共信誉 → 再有消费者共建权益
→ 最后才讨论受监管的收益分配
```

不能反过来先发权益、再用链上记录为营销背书。

## 10. 参考的官方边界

- 中国证监会关于股权众筹风险的公开说明：<https://www.csrc.gov.cn/csrc/c100028/c1001658/content.shtml>
- 中国人民银行等部门关于虚拟货币交易炒作风险的通知：<https://www.pbc.gov.cn/tiaofasi/144941/3581332/4348658/index.html>
- 市场监管总局公布的消费者权益保护法文本：<https://www.samr.gov.cn/zw/zfxxgk/fdzdgknr/fgs/art/2023/art_0a323e046fba43f0b6e9e977f1e8d5fc.html>
- 国家网信办公布的个人信息保护法文本：<https://www.cac.gov.cn/2021-08/20/c_1631050028355286.htm>
