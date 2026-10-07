# 真验 Zhenyan：鱼油批次公共信誉 Demo

> 项目文档版本：v0.8.3
> 最近修改：2026-10-07
> 本次修改：完成 Bohr Testnet 合约部署、角色回读和鱼油七事件生命周期回放；不写入私钥。

真验（TruthPass）是一层面向消费者 Agent 的服务可靠性与公共信誉基础设施。鱼油只是演示品类，核心范式是：消费者 Agent 通过 CLI 调用真验，生产方、检测 Agent 和冷链 Agent 围绕同一个批次提交可验证证据，由确定性验收器完成判断，再把任务级履约结果和证据哈希沉淀为公共信誉。

## 解决的问题

消费者看到“高浓度鱼油”“深海原料”“无腥味”等宣传时，很难同时确认：标签含量是否兑现、鱼油是否氧化、冷链是否中断、报告是否对应当前批次、检测服务此刻是否可用。链上身份和历史评分也不能自动证明服务当前可用或数据真实。

真验把问题拆成四步：

1. **发现**：根据鱼油批次任务寻找检测和冷链服务；
2. **探测**：检查端点在线、能力匹配、返回格式和签名；
3. **验收**：用规则核对批次、时间、EPA+DHA、过氧化值、TOTOX、冷链和签名；
4. **沉淀**：记录服务履约反馈，消费者购买后提交经过授权的体验反馈，供后续 Agent 查询。

## Demo 闭环

```text
消费者 Agent 通过 CLI 查询 FO-2026-001
        ↓
真验发现三个实验室服务
        ↓
lab-a：在线但批次错、签名无效、指标不达标
lab-b：当前离线
lab-c：在线、签名有效、指标和冷链通过
        ↓
确定性 Verifier 选择 lab-c
        ↓
生成证据卡和任务履约反馈
        ↓
消费者授权 Agent 登记购买并提交“包装/气味/批次可查”反馈
        ↓
反馈哈希和贡献事件可锚定到 BOT Chain
```

演示数据全部标记为 `demo/synthetic`，不能作为真实供应链证明。链上保存身份、任务哈希、结果和证据哈希；报告全文、图片、传感器明细和个人信息留在链下。

比赛网页只是现场观察台，不是产品主入口。完整的消费者 CLI、数据采集关联、链上分层、共建权益和评委展示叙事见 [docs/strategy-v0.4-consumer-cli.md](docs/strategy-v0.4-consumer-cli.md) 与 [docs/cli-contract.md](docs/cli-contract.md)。

## 质量规则示例

当前演示任务使用以下验收条件：

| 指标 | 示例门槛 |
| --- | ---: |
| EPA+DHA 总含量 | ≥ 70% |
| 过氧化值 | ≤ 5 |
| TOTOX | ≤ 20 |
| 冷链中断 | ≤ 6 小时 |
| 报告批次 | 必须等于商品批次 |
| 检测签名 | 必须有效 |

大模型只负责把自然语言采购意图拆成任务和解释结果；通过、拒绝、评分和防重复由代码规则决定。

## 运行

```bash
npm install
npm run demo
npm test
npm run typecheck
npm run truthpass -- replay --batch FO-2026-001 --json
```

## 目录

```text
src/types.ts                       通用任务、证据和服务类型
src/evidence.ts                    EvidenceEnvelope、规范化哈希和 Ed25519 验签
src/jev/model.ts                   JEV 输入输出合同
src/jev/context.ts                 JEV 安全决策门和确定性降级
src/verifier.ts                    确定性鱼油验收规则
src/registry.ts                    服务探测、排序和履约反馈
src/consumer.ts                    消费者授权、购买登记和反馈防刷
src/replay.ts                      验证到消费者贡献的本地完整回放
src/local-ledger.ts                可校验的本地追加账本（不是区块链替代品）
src/chain.ts                       BOT Chain RPC、ABI、receipt 和事件校验
src/demo.ts                        鱼油端到端演示
contracts/TruthPassEvidenceAnchor.sol 证据、验收、购买、贡献、争议和撤销合约
examples/fish-oil-batch-task.json  鱼油任务样例
test/                              验收和消费者参与测试
docs/fish-oil-development-plan.md  完整开发方案和分工
docs/architecture-v0.3-fish-oil.md 鱼油战略架构
docs/consumer-participation.md     消费者 Agent 参与规则
docs/fish-oil-demo-script.md       现场演示脚本
docs/frontend-visual-plan.md       前端页面和美工预案
docs/strategy-v0.4-consumer-cli.md 消费者 CLI、链上结构、商业与展示战略
docs/cli-contract.md               CLI 命令、JSON 输出和安全合同
docs/DOCUMENT-VERSIONING.md        文档版本、修改说明和协作规则
docs/jev-integration-v0.5.md       JEV 结构化决策门、类型合同和降级策略
docs/target-development-v0.8.0.md 完整目标、完成标准和部署门禁
docs/implementation-v0.8.0.md      本地完整回放和链上状态合同
docs/configuration-v0.8.1.md       Bohr Testnet 配置和部署回填说明
config/bot-chain-testnet.example.json 测试网公开配置模板
assets/fish-oil-evidence-dashboard.png 前端高保真方向图
assets/fish-oil-consumer-cli-journey.png 消费者 CLI 证据故事方向图
```

## 赛题对应

项目对应赛题一“Agent 公共信誉与服务验收”：

- 服务探测：`ServiceRegistry.evaluate`；
- 交付验收：`verifyExecution`；
- 履约记录：`FeedbackRecord`；
- 消费者参与：`ConsumerParticipationRegistry`；
- 链上锚定：`TruthPassEvidenceAnchor.sol` 和 `src/chain.ts`；
- 抗刷分基础：反馈绑定购买记录、任务哈希、服务身份和证据哈希。

ERC-8004 作为身份、信誉和验证模型的参考；当前仓库已具备 BOT Chain 的合约和交易适配器，但测试网合约地址与真实交易仍需部署门禁确认。

JEV 只用于结构化判别、缺口识别和服务路由；最终通过/拒绝仍由确定性 `Verifier` 决定。接入边界、失败关闭和回放要求见 [docs/jev-integration-v0.5.md](docs/jev-integration-v0.5.md)。
