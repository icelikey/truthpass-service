# TruthPass 链上组合与鱼油真实测试网回放

> 文档版本：v0.8.3  
> 状态：当前架构说明与测试网验收记录  
> 最近修改：2026-10-07  
> 修改摘要：解释生产数据、Agent、链下证据仓和 BOT Chain 公共锚定层的关系，并记录真实七事件回放。  
> 影响范围：Agent、证据接入、BOT Chain、消费者 CLI、鱼油 Demo  
> 队友下一步：把本文件中的公开配置接入 CLI/网页读取路径，再按角色分离替换演示钱包。

## 先回答“这条链管什么”

BOT Chain 不是生产管理系统，也不能直接证明一桶鱼油在现实世界里一定合格。它是公开、可复核的承诺和流程账本，记录：

- 哪个授权 Agent 提交了哪个批次的证据根；
- 使用了哪个数据模式、来源和验收规则；
- 确定性 Verifier 得出了什么状态和范围；
- 哪个消费者承诺购买了哪个批次，以及一次经过授权的贡献；
- 后续是否出现争议、撤销或替代记录。

因此，“链上已记录”与“现实世界一定真实”是两个不同命题。现实真实性由来源签名、样品交接、检测资质、设备校验、时间一致性和多方复核共同支撑，公链负责让这些承诺不可静默改写，并让其他 Agent 可以复核历史。

## 五层组合关系

```text
生产现场 / ERP / MES / LIMS / 冷链设备 / 实验室报告
        │ 只读接入、签名、样品和批次绑定
        ▼
EvidenceEnvelope（链下证据仓，保存原文、图片、遥测、隐私数据）
        │ 规范化 + hash + Ed25519 验签
        ▼
Agent 层（厂家、实验室、设备、冷链、消费者 Agent）
        │ 发现/探测/履约反馈；JEV 只做结构化路由
        ▼
确定性 Verifier（鱼油规则、批次一致性、阈值、冷链、签名）
        │ 生成 evidenceRoot、resultHash、policyHash、verifierVersionHash
        ▼
BOT Chain TruthPassEvidenceAnchor（公共锚定层）
        │ 事件：evidence → verification → purchase → contribution → dispute → supersede
        ▼
消费者 Agent / 其他服务 Agent 查询公开状态并给出可解释结论
```

当前项目只有一条真实公链：BOT Chain Bohr Testnet（Chain ID `968`）。所谓“生产链”在当前版本是链下数据和 Agent 证据层，不是另一条已经部署的区块链。未来如果厂家需要隐私隔离，可以增加联盟链或数据库账本，但它应把批次根、规则哈希和争议结果锚定到 BOT Chain，而不是与公共链平行产生无法对账的两套事实。

## Agent 与权限的关系

Agent 本身不直接改合约状态。Agent 先调用数据适配器和确定性 Verifier，随后由受授权的钱包/服务提交交易。合约角色对应写入责任：

| 角色 | 允许写入 | 生产含义 |
| --- | --- | --- |
| `EVIDENCE_WRITER_ROLE` | 原始证据承诺 | 生产、实验室、设备或冷链证据代理 |
| `VERIFIER_ROLE` | 验收结果 | 规则 Verifier，不是 JEV 自由输出 |
| `PURCHASE_WRITER_ROLE` | 购买承诺 | 消费者 Agent 的匿名绑定 |
| `CONTRIBUTION_WRITER_ROLE` | 反馈贡献 | 一次购买对应一次贡献 |
| `DISPUTE_ROLE` | 争议 | 复核或仲裁流程 |
| `REVOKER_ROLE` | 撤销/替代 | 发现错批次或报告更新后的历史修正 |

测试网回放暂时让一个测试地址持有这些角色，方便验证流程；这不能直接复制到生产。生产应使用独立服务账户、硬件签名或托管密钥，并给每个角色单独的最小权限。

## 已完成的真实测试网效果

部署配置和七笔 receipt 位于 [`config/bot-chain-testnet.deployed.json`](../config/bot-chain-testnet.deployed.json)。已完成：

1. 部署 `TruthPassEvidenceAnchor`，回读代码、Chain ID `968` 和 `DOMAIN_SEPARATOR`；
2. 回读六类业务角色均已授权；
3. 按鱼油批次演示回放 `evidence → verification → purchase → contribution → dispute → replacement evidence → supersede`；
4. 每笔交易均等待至少一个确认，并校验目标合约、交易成功状态和事件主题；
5. 消费者和其他 Agent 可以用公开交易哈希重放事件，链下再按 evidenceRoot 查询原始证据。

## 当前仍不能宣称的内容

- 当前七笔事件使用的是公开资料约束下的演示数据，不是厂家真实产线数据；
- 测试钱包同持所有角色，尚未达到生产密钥隔离；
- 设备硬件签名、样品交接、实验室资质核验、隐私授权和争议 SLA 仍需生产化；
- 当前网页可以展示链路，但不能把链上事件自动表述成政府或第三方机构的法律认证。
