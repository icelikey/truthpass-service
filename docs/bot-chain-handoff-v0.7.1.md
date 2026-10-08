# TruthPass BOT Chain 合约交接说明

> 文档版本：v0.7.1  
> 状态：当前交接草案；合约已写入仓库，尚未部署  
> 最近修改：2026-10-07  
> 修改摘要：新增 `TruthPassEvidenceAnchor.sol` 的最小可审计证据锚定合约、测试网部署流程和队友交接清单。  
> 影响范围：BOT Chain、证据锚定、生产/成品质检 Agent、消费者 Agent、CLI、网页观察台  
> 队友下一步：在 Bohr Testnet 编译、部署、授予最小角色并回读交易；完成后再接入 CLI 和网页，不能把本地部署当成链上已完成。

## 1. 这次交付了什么

新增合约：[`contracts/TruthPassEvidenceAnchor.sol`](../contracts/TruthPassEvidenceAnchor.sol)

它是一个独立的、最小化的证据锚定合约，暂时不替换队友维护的 [`TrustRegistry.sol`](../contracts/TrustRegistry.sol)。合约只保存承诺值、哈希、状态和事件，不保存以下内容：

- 实验室报告全文、谱图和设备原始时序；
- ERP/MES/LIMS 导出原文、配方和商业机密；
- 姓名、手机号、地址、订单全文和健康数据；
- JEV Prompt、API Key 或模型原始输出。

链上记录只能回答“哪个被授权的写入者，在指定链和合约域中，提交了哪个证据承诺以及哪个流程状态”。它不能单独证明现实世界的测量结果真实，也不能替代实验室资质、样品封存、设备校准或监管检查。

## 2. 与现有架构的关系

```text
ERP / MES / LIMS / IoT / 实验室
              ↓  链下 EvidenceEnvelope
生产 Agent / 成品 Agent
              ↓
JEV（缺口、冲突和路由；不能直接授予通过）
              ↓
Deterministic Verifier（决定 accepted/review/rejected）
              ↓
TruthPassEvidenceAnchor（只锚定根哈希和状态）
              ↓
BOT Chain 事件 → CLI / 网页 / 其他消费者 Agent 查询
```

合约的写入者是受角色控制的钱包或后端服务。JEV 本身不应被授予 `VERIFIER_ROLE`；只有完成确定性规则验收的服务才可以写入 `recordVerification`。

## 3. 合约接口

### 3.1 角色

| 角色 | 权限 | 生产建议 |
| --- | --- | --- |
| `DEFAULT_ADMIN_ROLE` | 授予/撤销角色 | 多签或冷钱包，不用于日常写入 |
| `EVIDENCE_WRITER_ROLE` | `anchorEvidence` | 生产 Agent / 成品实验室适配器 |
| `VERIFIER_ROLE` | `recordVerification` | 确定性 Verifier 服务 |
| `PURCHASE_WRITER_ROLE` | `recordPurchase` | 消费者签名网关或订单证明适配器 |
| `CONTRIBUTION_WRITER_ROLE` | `recordContribution` | 消费者 Agent 反馈网关 |
| `DISPUTE_ROLE` | `raiseDispute` | 复检/争议服务 |
| `REVOKER_ROLE` | `revokeOrSupersede` | 受控治理或复核服务 |

部署者初始只有 `DEFAULT_ADMIN_ROLE`。必须显式授予其他角色；不要让 JEV API Key、浏览器前端或普通网页钱包成为管理员。

### 3.2 Evidence 锚定

```solidity
anchorEvidence(
  requestId,
  evidenceRoot,
  subjectHash,
  schemaHash,
  sourceHash,
  state,
  chainId,
  domainSeparator
)
```

- `requestId`：本次写入的幂等键；重复提交同一内容返回 `false`，内容不同则回滚；
- `evidenceRoot`：排序后的 EvidenceEnvelope 图根，不是原文；同一个根不能绑定两个请求；
- `subjectHash`：鱼油批次或样品的承诺值；
- `schemaHash`：例如 `fish-oil-process-v1` 的版本化 schema 哈希；
- `sourceHash`：来源主体/Agent/设备集合的承诺值；
- `state`：`accepted`、`review`、`rejected` 或 `disputed`；
- `chainId` 和 `domainSeparator`：必须分别等于当前部署链和当前合约的域，防止跨链/跨合约误写。

### 3.3 确定性验收

```solidity
recordVerification(
  requestId,
  evidenceRoot,
  taskHash,
  policyHash,
  verifierVersionHash,
  resultHash,
  state,
  scope,
  chainId,
  domainSeparator
)
```

该函数要求 `evidenceRoot` 已经锚定。`resultHash` 应来自可回放的规则验收结果，`policyHash` 和 `verifierVersionHash` 让其他 Agent 知道使用了哪一套标准和代码版本。JEV 的自由文本、置信度或建议不能直接作为通过结果。

### 3.4 消费者购买和贡献

```solidity
recordPurchase(
  purchaseId,
  consumerCommitment,
  batchCommitment,
  purchaseProofHash,
  consentHash,
  chainId,
  domainSeparator
)

recordContribution(
  contributionId,
  purchaseId,
  evidenceHash,
  contributionHash,
  score,
  chainId,
  domainSeparator
)
```

这些字段都应是伪名化承诺或哈希。每个 `purchaseId` 最多记录一个有效贡献；同一贡献重试必须复用相同的 `contributionId` 和字段，避免网络重试造成刷分。合约只控制写入角色和幂等性，不负责核验电商订单真实性；订单签名、支付回执和消费者授权需要在链下网关完成后再写入哈希。

### 3.5 争议、撤销和替代

```solidity
raiseDispute(disputeId, targetKind, targetId, reasonHash, chainId, domainSeparator)
revokeOrSupersede(targetKind, targetId, replacementId, reasonHash, chainId, domainSeparator)
```

`targetKind` 可为：

| 值 | 目标 |
| ---: | --- |
| `1` | evidence anchor |
| `2` | verification |
| `3` | purchase |
| `4` | contribution |

撤销/替代只追加 `Revision` 记录并更新状态，不删除原记录。`replacementId = 0x00…00` 表示撤销；非零表示存在替代记录。替代记录可以稍后写入，但交接服务必须在展示前确认它确实存在。

## 4. 幂等和防跨链设计

合约在构造时固定：

```text
DEPLOYED_CHAIN_ID = block.chainid
DOMAIN_SEPARATOR = EIP-712(TruthPassEvidenceAnchor, 1, chainId, contractAddress)
```

每个写入接口同时检查：

1. `block.chainid` 仍等于部署链；
2. 调用方传入的 `chainId` 等于部署链；
3. 调用方传入的 `domainSeparator` 等于当前合约域；
4. `requestId`/ID 不为零；
5. 相同幂等键重试时所有内容必须完全一致；
6. 一个 `evidenceRoot` 不能被两个请求占用。

客户端不要在失败后随机生成新 ID。网络超时后，应先用原 ID 查询状态，再决定是否重试。跨测试网和主网时必须使用不同部署地址、不同 ID 命名空间和不同环境变量。

## 5. Bohr Testnet 部署步骤

现有接入基线将 Bohr Testnet 作为开发环境：

```text
Chain ID: 968
RPC:      https://rpc.bohr.life
Explorer: https://scan.bohr.life
```

BOT Chain 主网参数在 [`bot-chain-integration-v0.7.0.md`](bot-chain-integration-v0.7.0.md) 中记录为 Chain ID `677`，但部署前仍必须调用 `eth_chainId` 并以官方当前文档为准。不得因为 RPC 失败而自动 fallback 到另一条链。

### 5.1 编译

使用 Solidity `0.8.24` 编译 `contracts/TruthPassEvidenceAnchor.sol`。交接时至少保存：

- 编译器版本和优化器配置；
- ABI 和字节码的 SHA-256；
- 源码版本（Git commit）；
- 部署网络和 RPC 配置名称。

本仓库当前只提交源码，不提交临时生成的 `.abi`/`.bin` 文件。

### 5.2 部署与角色授予

部署完成后，立刻读取并记录：

```text
contractAddress
deploymentTxHash
DEPLOYED_CHAIN_ID
DOMAIN_SEPARATOR
deployerAddress
```

由管理员逐个授予最小角色：

```text
grantRole(EVIDENCE_WRITER_ROLE, productionAgentWriter)
grantRole(EVIDENCE_WRITER_ROLE, labAgentWriter)
grantRole(VERIFIER_ROLE, deterministicVerifier)
grantRole(PURCHASE_WRITER_ROLE, consumerPurchaseGateway)
grantRole(CONTRIBUTION_WRITER_ROLE, consumerContributionGateway)
grantRole(DISPUTE_ROLE, disputeService)
grantRole(REVOKER_ROLE, governanceOrReviewService)
```

角色地址应写入不含私钥的部署清单；私钥、助记词、JEV Key 和 RPC 付费凭据只放在受控密钥管理器或本地环境变量中。

### 5.3 最小回放

用 `demo/synthetic` 鱼油批次执行以下顺序：

1. 对规范化 EvidenceEnvelope 排序并生成 `evidenceRoot`；
2. 使用 `anchorEvidence` 写入过程/成品根；
3. 用同一根调用 `recordVerification`；
4. 用伪名化 `consumerCommitment` 调用 `recordPurchase`；
5. 调用一次 `recordContribution`，然后重复同样请求确认幂等；
6. 用 `raiseDispute` 标记一次复核，并用 `revokeOrSupersede` 追加撤销或替代；
7. 从 RPC 回读存储和事件，保存每笔 `txHash`、区块号、确认数和最终状态。

“交易发送成功”不等于接入完成。必须能用同一批次、同一证据根、同一 policy 和同一 Verifier 版本从链下回放，并在浏览器或 RPC 中查到对应事件。

## 6. CLI 与网页交接约定

CLI 是产品入口，网页是现场观察台。两者必须调用同一个 Chain Adapter，不得各自拼接“已上链”文案：

```text
truthpass verify batch <batch> --json
  → evidenceRoot / resultHash / policyHash
  → anchor tx receipt
  → VerificationResult.chainStatus
```

建议状态：

```text
anchor_pending   已提交但尚未回读 receipt
anchored         receipt 与事件已确认
anchor_failed    交易回滚或写入失败
chain_unavailable RPC 不可用，不能宣称已上链
```

只有 `anchored` 才能在现场显示交易链接。`review`、`rejected`、`disputed`、`anchor_failed` 不得被前端渲染成“通过”。

## 7. 当前能力边界与后续工作

本合约已经提供：

- 角色权限和最小写入边界；
- request/根哈希幂等；
- 固定链 ID + EIP-712 域检查；
- 生产/成品验收、购买、贡献、争议和撤销/替代事件与存储；
- 追加式状态，不删除历史证据。

本合约尚未提供：

- 设备或实验室报告的密码学签名验证；
- 实验室资质、校准、样品封签和订单真实性验证；
- EIP-712 消费者授权签名的业务校验；
- ERC-8004 Registry 的自动注册和同步；
- 升级代理、多签治理、正式安全审计和主网部署。

这些能力必须由链下 Agent、Chain Adapter、身份/验证注册表或后续审计补齐。不要把新增合约描述为“区块链证明鱼油真实”，正确表述是“将可回放的证据承诺、验收版本和后续争议状态公开锚定，供其他 Agent 复核”。

## 8. 交接清单

- [ ] 队友编译 `TruthPassEvidenceAnchor.sol`，编译器固定为 `0.8.24`；
- [ ] 在 Bohr Testnet 读取 `eth_chainId = 968`，确认 RPC 未被代理到其他链；
- [ ] 部署并记录地址、部署交易、源码 commit、ABI/hash、域分隔符；
- [ ] 用管理员钱包逐个授予最小角色，角色地址进入部署清单；
- [ ] 完成 evidence → verification → purchase → contribution → dispute/revoke 回放；
- [ ] CLI/网页只消费 receipt 已确认的 `anchored` 状态；
- [ ] 不把任何私钥、JEV API Key、实验室原文或消费者信息提交到 GitHub；
- [ ] 主网部署前完成合约审计、密钥治理、回滚/暂停预案和第三方复核。


