# 真验文档版本规范

> 文档版本：v0.8.1
> 状态：当前生效
> 最近修改：2026-10-07
> 修改摘要：补充 Bohr Testnet 安全配置模板和部署回填字段，明确未部署前的状态边界。
> 影响范围：BOT Chain、ERC-8004、Agent 架构、鱼油 Demo、证据接入、JEV、合约、消费者权益、网页演示和代码评审
> 队友下一步：每次修改先更新元信息和变更日志，再提交代码或页面。

## 目的

战略设计、接口合同、代码实现和现场素材由不同队友同步维护。每次更新必须留下版本号和修改说明，避免队友把历史方案误当成当前方案，也避免把“计划完成”误写成“代码完成”。

## 版本格式

```text
v<主版本>.<次版本>.<修订号>
```

- **主版本**：产品范式、用户入口或链上边界发生改变；
- **次版本**：新增一个完整模块、接口合同或演示流程；
- **修订号**：文字、示例、链接、阈值说明或排版修正，不改变合同。

当前主线：**v0.8.1 本地完整回放 + BOT Chain 测试网配置交接基线**。

## 每次更新必须写什么

每个受维护文档顶部使用以下元信息：

```markdown
> 文档版本：v0.4.0
> 状态：当前生效 / 历史参考 / 草案
> 最近修改：2026-10-06
> 修改摘要：一句话说明本次改变
> 影响范围：代码 / CLI 合同 / 前端 / 链上 / 路演
> 队友下一步：需要实现或确认的事项
```

文档更新同时追加到本文件的变更日志，并使用带版本号的提交信息，例如：

```text
docs(v0.4.0): move product entry to consumer CLI
docs(v0.4.1): clarify evidence envelope fields
```

## 当前版本地图

| 版本 | 状态 | 核心内容 |
| --- | --- | --- |
| v0.1.x | 历史 | 服务注册、探测、履约验收最小骨架 |
| v0.2.x | 历史参考 | 燕窝场景架构讨论 |
| v0.3.0 | 当前实现基线 | 鱼油指标验收、消费者授权反馈、合约事件草案 |
| v0.4.0 | 历史战略 | 消费者 CLI 主入口、五层链上结构、共建权益和评委展示 |
| v0.5.0 | 历史战略与网页 | JEV 结构化决策门、消费者优先网页和安全降级合同 |
| v0.6.0 | 历史审计基线 | 生产/成品质检 Agent 分层、低改造数据接入、攻击面与白客修复门禁 |
| v0.7.0 | 当前链上接入基线 | BOT Chain 网络、ERC-8004 身份/验证、证据锚定、消费者贡献和测试网到主网方案 |
| v0.7.1 | 当前交接版本 | TruthPassEvidenceAnchor 合约、角色/幂等/域校验、Chain Adapter ABI 对齐和队友回放清单 |
| v0.8.0 | 当前完整目标实现 | EvidenceEnvelope、Ed25519 验签、JEV 安全决策门、完整 Chain Adapter、本地六事件回放和统一锚定状态 |
| v0.8.1 | 当前配置交接版本 | Bohr Testnet 参数、部署回填模板、角色和 receipt 验收门禁 |

## 变更日志

### v0.4.0 — 2026-10-06

- **修改文档**：新增 `strategy-v0.4-consumer-cli.md`、`cli-contract.md`；更新 README 的产品入口说明；
- **修改方向**：从厂家质量后台改为消费者 Agent + CLI，网页定位为现场观察台；
- **架构影响**：增加 EvidenceEnvelope、设备/Agent 关联、身份/证据/验收/信誉/权益五层链上模型；
- **商业影响**：比赛版本采用共建者权益和会员/采购合同，暂不使用股权、分红或可交易代币；
- **前端影响**：默认页面以“这批鱼油，为什么值得我信？”为主叙事，新增消费者 CLI 证据故事视觉稿；
- **队友待办**：CLI 命令与 JSON schema、角色权限合约、设备签名适配器、网页调用同一条验证链；
- **兼容性**：v0.3 鱼油验收字段继续可用，但网页和 README 的主入口描述以 v0.4 为准。

### v0.5.0 — 2026-10-06

- **修改文档**：新增 `jev-integration-v0.5.md`；更新 README、前端视觉预案和网页说明；
- **修改方向**：在 Agent 关联和确定性 Verifier 之间加入 JEV 结构化决策门；
- **架构影响**：增加 JEV 输入/输出 schema、置信度、缺口码、冲突码、模型版本哈希和安全降级路径；
- **前端影响**：链路观察从四步扩展为“设备采集 → Agent 关联 → JEV 判别 → 规则验收 → 链上锚定”；
- **队友待办**：实现 adapter、校准数据集、失败关闭、DeterministicDecisionGate、CLI JSON 映射和回放测试；
- **状态边界**：网页中的 JEV 结果仍为 `demo/synthetic`，未连接供应商服务，不得写成真实模型已上线。

### v0.3.0 — 2026-10-06

- 鱼油批次 Demo、EPA+DHA/过氧化值/TOTOX/冷链规则；
- 消费者授权、购买登记、一次性反馈和贡献积分；
- `TrustRegistry.sol` 增加消费者购买和贡献事件草案；
- 新增鱼油开发方案、演示脚本和前端视觉预案。

## 队友协作规则

1. 修改战略或合同前先更新版本元信息；
2. 代码实现落后于文档时，在“队友下一步”明确写 `未实现`；
3. 阈值、合约权限、CLI 字段变更必须增加次版本，不直接覆盖旧说明；
4. 历史方案保留文件，但顶部必须标记“历史参考”；
5. 每次提交在 PR 或提交说明中引用对应文档版本；
6. 合并前运行 `npm test`、`npm run typecheck`，并检查 README 与当前版本一致。

### v0.5.1 — 2026-10-07

- **新增文档**：`architecture-audit-v0.5.1.md`、`architecture-remediation-plan-v0.5.1.md`；
- **修改方向**：对当前仓库 HEAD `6c0cd40` 做只读架构审计，明确“服务验收 Demo 已实现”与“现实数据认证尚未实现”的边界；
- **架构影响**：补充 EvidenceEnvelope、设备/Agent/Verifier/Chain Adapter 的责任边界，明确当前是一条 BOT Chain 公共锚定链加链下证据仓，而不是多链实现；
- **鱼油影响**：明确 P0 Demo 不要求整条产线数字化，厂家先提供批次、报告摘要和温度事件，生产化再接入设备网关；
- **代码状态**：本次未修改 `contracts/`、`src/`、`test/` 和 `web-demo/`；审计基于现有代码和测试结果；
- **待办**：补密码学签名验证、EvidenceEnvelope、角色权限、证据/验收锚定、JEV adapter、争议和复检机制。
- **新增专题文档**：`fish-oil-supply-chain-integration-analysis-v0.5.1.md`；补充 ERP/MES/LIMS/WMS/TMS/设备低改造接入、鱼油全流程证据目录、最小披露、EvidenceEnvelope、BOT Chain 锚定边界和 P0/P1/P2 实施门禁；明确其为分析建议，不代表生产能力已实现。

### v0.6.0 — 2026-10-07

- **新增文档**：`security-threat-model-v0.6.0.md`；
- **修改方向**：将生产过程质检、成品质检、消费者 Agent、JEV、确定性 Verifier 和链上权益放入同一套可审计架构；
- **安全影响**：列出批次替换、报告重放、设备替换、选择性披露、女巫刷分、合约越权、模型提示注入、隐私关联和拒绝服务等攻击路径；
- **数据接入影响**：确认 P0 使用合成数据，P1 复用 ERP/MES/LIMS/设备导出并只读接入，P2 再引入设备签名和智能工厂能力；
- **代码状态**：本次不修改 `src/`、`contracts/`、`test/` 和 `web-demo/`；文档中的生产能力均标记为待实现；
- **队友待办**：按 P0/P1/P2 修复优先级补齐签名、EvidenceEnvelope、角色权限、样品交接、JEV adapter、争议和复检机制。

### v0.7.0 — 2026-10-07

- **新增文档**：`bot-chain-integration-v0.7.0.md`；
- **修改方向**：补充 BOT Chain 测试网/主网参数、ERC-8004 Agent 身份、ValidationRegistry、TruthPass 应用合约和鱼油证据锚定方案；
- **链上边界**：链上只保存身份、证据根、规则/模型/Verifier 哈希、结果状态、撤销/争议和消费者承诺，原始报告与个人信息留在链下；
- **安全影响**：增加 Chain ID 校验、角色权限、EIP-712、nonce、防跨链重放、receipt 回读和锚定失败状态；
- **JEV 状态**：真实 Key 的最小请求已验证可用，但 Key 未写入仓库，仍需由队友实现服务端 adapter 和密钥管理；
- **队友待办**：先在 Bohr Testnet 完成部署和回放，再决定是否使用 BOT Chain Mainnet，不得自动回退网络。
- **新增演示数据**：`examples/fish-oil-real-sourced-production-demo.json`、`src/real-sourced-demo.ts` 和 `test/real-sourced-demo.test.ts`；数据是公开资料约束下的模拟批次，覆盖通过、错批次、氧化失败、冷链失败和范围受限场景。
- 新增鱼油下单到交付闭环数据集：examples/fish-oil-order-to-delivery-demo.json、src/fish-oil-order-to-delivery-demo.ts、test/fish-oil-order-to-delivery.test.ts 和 docs/fish-oil-order-to-delivery-demo.md；覆盖模拟验收、上架、支付、履约、配送、购买绑定、反馈和离线锚定摘要。

### v0.7.1 — 2026-10-07

- **新增代码**：`contracts/TruthPassEvidenceAnchor.sol`、`src/chain-config.ts`、`src/chain.ts`、`test/chain.test.ts`；
- **新增交接文档**：`docs/bot-chain-handoff-v0.7.1.md`；
- **修改方向**：将客户端交易构造、RPC Chain ID 校验、预签名交易提交、receipt 回读和证据事件解析纳入 BOT Chain 接入；客户端 ABI 必须与 8 参数证据锚定合约一致；
- **安全边界**：默认 dry-run，不处理私钥，不把 JEV 直接当作 Verifier；合约地址、部署交易和角色地址在测试网部署完成前保持未确认；
- **队友下一步**：从远端最新主线集成本分支，编译合约并完成 Bohr Testnet 部署、角色授予和 evidence → verification → purchase → contribution 回放。

### v0.8.0 — 2026-10-07

- **新增代码**：`src/evidence.ts`、`src/jev/model.ts`、`src/jev/context.ts`、`src/local-ledger.ts`、`src/replay.ts` 和 `test/evidence.test.ts`、`test/jev.test.ts`、`test/e2e-replay.test.ts`；
- **链上实现**：补齐 TruthPassEvidenceAnchor 六类写入的 ABI 构造、预签名交易提交、receipt 目标/状态/事件校验和确认数等待；合约增加状态幂等、sourceHash、scope 和替代记录检查；
- **CLI 影响**：新增 `truthpass replay`，统一复用 `VerificationResult`，本地回放明确 `anchor_pending`，没有真实 receipt 不显示 `anchored`；
- **验证证据**：`npm test` 31/31 通过，`npm run typecheck` 通过；Solidity `TruthPassEvidenceAnchor.sol` 使用 solc 0.8.24 编译通过；
- **部署门禁**：仍需在 Bohr Testnet 配置真实合约地址、角色钱包和交易哈希，当前不把本地账本根当作区块哈希。

### v0.8.1 — 2026-10-07

- **新增配置**：`config/bot-chain-testnet.example.json`、`docs/configuration-v0.8.1.md`；
- **修改方向**：将已确认的 Bohr Testnet 参数和未确认的部署字段分开，形成可交接的公开模板；
- **安全边界**：模板不包含私钥、API Key、消费者数据、合约地址或虚构交易哈希；
- **状态边界**：真实部署完成前，CLI 和网页继续使用 `offline_plan_only`、`prepared_offline_not_submitted` 或 `anchor_pending`；
- **队友下一步**：完成部署、授予角色、回读域和 receipt，并把真实公开地址回填到模板。
