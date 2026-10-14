# TruthPass v1.2.0 队友代码兼容合并与钱包审计交付

- 版本：v1.2.0
- 修改日期：2026-10-15
- 集成分支：`codex/integrate-teammate-v1.2.0`
- 队友功能来源：`39bf0549dcade0309cfe75fceec21572b8f8d4b8`
- 当前定位：代码已集成，本机回归通过，普通非部署钱包主网现场交易待验收

## 1. 这次合并解决的问题

队友分支带来了 React/Vite 前端、Agent 合同、JEV/TypeSafe、IoT 模拟、Supabase/PostgreSQL 持久化和多钱包组件；原仓库则已经有 Vercel `/api/*`、旧观察台、CLI、BOT Chain 适配器和历史 BFF。直接覆盖会丢失 Serverless 入口和旧页面。

本版本采用兼容合并：

```text
/                         新 React 前端
/web-demo                 旧观察台回滚入口
/api/*                    Vercel Serverless 与本机共用 API handler
api-server.ts             本机 HTTP 启动器 + API handler
TruthPassEvidenceAnchor  生产证据与确定性验收锚定
ConsumerGateway           普通消费者钱包入口
AuditEscrow               质疑质押、审计和结算入口
```

`vercel.json` 将 `/api/*` 指向 `api/[[...path]].ts`，根路径指向 `web/dist`，`/web-demo/*` 继续服务旧页面。Vercel 只处理请求和读链，不持有部署私钥；持续传感器上链必须由独立受控 Worker 或本机受控钱包完成。

## 2. 当前链上配置

| 项目 | 值 |
| --- | --- |
| 网络 | BOT Chain Mainnet |
| Chain ID | `677` (`0x2a5`) |
| RPC | `https://rpc.botchain.ai` |
| Explorer | `https://scan.botchain.ai` |
| Evidence Anchor | `0x0033462bee153cb9DF12b5c447b9C282DbfbE877` |
| Consumer Gateway | `0x5192484B107E51EADFda4DBF4c9fFa41C03453F1` |
| Audit Escrow | `0x722a4291C64B5BD3ED374AD457Ba6326681C2933` |

公开部署元数据位于：

- `config/bot-chain-mainnet.deployed.json`
- `config/bot-chain-mainnet.gateway.json`
- `config/bot-chain-mainnet.audit-escrow.json`

这些文件只包含公开地址、部署区块、交易 Hash 和 Explorer 链接；私钥、API Key、数据库凭据不得提交。

## 3. Agent、JEV 与 IoT 数据流

```text
传感器/ERP/实验室
  → schema 校验、批次绑定、签名检查
  → 证据哈希与链下明细持久化
  → Production Agent / Inspection Agent 整理可引用证据
  → JEV/TypeSafe 识别缺口、冲突和下一步路径
  → Deterministic Verifier 按批准规则判断
  → Anchor Worker 提交 Evidence Anchor
  → receipt + 业务事件回读
  → Consumer Agent 只获得面向用户的验证事实
```

职责边界保持不变：JEV 不直接决定质量通过；模型不能新增未经引用的事实；Agent 不修改原始质量事实；区块链只确认提交者、哈希、事件和顺序，不替代现实检测；资金结算不能由单个模型决定。

JEV 模式必须明确返回：

- `live`：配置了有效的 `TYPESAFE_API_KEY` 并通过 TypeSafe/JEV 响应校验；
- `deterministic_fallback`：未配置、请求失败或输出不符合合同，使用本地确定性规则。

前端和 API 必须显示实际模式，不能把 fallback 标成 live。

## 4. 钱包和合约交互

### 4.1 购买与反馈

消费者通过 EIP-1193/EIP-6963 连接 MetaMask、OKX Wallet 或 Binance Wallet。钱包连接后检查 Chain ID `677`，用户确认后由钱包执行 `eth_sendTransaction`：

```text
purchase      → ConsumerGateway.recordPurchase
contribution  → ConsumerGateway.recordContribution
```

消费者钱包不需要 Anchor 的业务角色。Gateway 在合约内部绑定 `purchaseId → msg.sender`，防止其他钱包代替购买者提交反馈。

### 4.2 质疑和审计

经济性质疑不再调用 Anchor 的普通记录接口，而是：

```text
openChallenge → AuditEscrow.openChallenge { value: stake }
```

质疑交易至少包含 `challengeId`、`targetKind`、`targetId`、`reasonHash`、`agentRunHash` 和真实质押金额。后续流程由审计 Agent、Verifier 和仲裁钱包共同完成：

```text
Consumer Agent 发现异常
  → 用户钱包 openChallenge（锁定质押）
  → Audit Agent submitAuditFinding（evidenceRoot、auditResultHash、verifierVersionHash）
  → Verifier approveAuditFinding
  → Arbiter resolveChallenge
  → 成功返还质押并支付奖励，失败扣除质押
```

消费者钱包不能调用审计结算方法。所有阶段产生链上事件：`ChallengeOpened`、`AuditFindingSubmitted`、`AuditVerifierApproved`、`ChallengeResolved`、`ChallengeRewardPaid` 或 `ChallengeStakeSlashed`。

### 4.3 交易成功判定

页面只有在以下条件全部满足时才显示成功：

```text
receipt.status == 1
receipt.to == 预期 Gateway 或 Audit Escrow 地址
存在预期业务事件
事件中的 batchId / purchaseId / challengeId 与本次请求一致
```

`personal_sign` 仅用于身份授权，不能替代主网交易。取消、回滚、错误链、receipt 未确认或事件不匹配都必须显示失败/待验证。

## 5. API 和 CLI 验收面

本机与 Vercel 共用以下 API：

```text
GET  /api/health
GET  /api/chain/status
GET  /api/agent/manifest
GET  /api/jev/detection?batchId=FO-2026-001
GET  /api/cli/inspect?batchId=FO-2026-001
POST /api/wallet/prepare
POST /api/chain/tx-confirm
```

`POST /api/wallet/prepare` 的动作与目标地址：

| action | 目标 | value |
| --- | --- | --- |
| `purchase` | Consumer Gateway | `0x0` |
| `contribution` | Consumer Gateway | `0x0` |
| `dispute` | Audit Escrow | 最小质押或用户指定质押 |
| `evidence` | Evidence Anchor | `0x0`，仅证据角色 |
| `verification` | Evidence Anchor | `0x0`，仅验证角色 |

CLI 保持只读/准备交易边界：`inspect`、`verify`、`explain` 不广播交易；真正广播必须由用户钱包或明确受控的 Anchor Worker 完成。

## 6. 已完成、仅演示和待验收

### 已完成并验证

- React/Vite 前端和旧 `/web-demo` 入口共存；
- Vercel Serverless handler 与本机 API handler 共用路由；
- Consumer Gateway、Audit Escrow calldata、selector、事件 topic 和质押 value 编码；
- 未连接钱包时只读，不自动生成钱包或演示 Hash；
- receipt 级 status、to、业务事件和业务 ID 校验；
- Agent 合同、JEV/TypeSafe、IoT 模拟和持久化模块兼容接入；
- `npm run typecheck` 通过；
- `npm test`：147 项通过；
- `npm run build` 通过；
- 本机 `/`、`/web-demo`、关键 API 可访问；
- `purchase` 已指向 Consumer Gateway，`dispute` 已指向 Audit Escrow 并携带非零 value。

### 仅演示/公开回放

- 仓库内置鱼油批次、传感器和历史主网回放仍为 `demo/synthetic`；
- Anchor/Gateway/Audit Escrow 部署元数据是公开链上信息，不等于本次现场消费者交易；
- 未配置 TypeSafe/JEV 密钥时使用 `deterministic_fallback`；
- Vercel 不负责持续传感器上链和私钥托管。

### 待现场验收

必须用一个非部署钱包完成并回填新的交易 Hash：

```text
Connect Wallet
→ 切换 BOT Chain 677
→ purchase
→ contribution
→ openChallenge（真实质押）
→ receipt.status == 1
→ 业务事件匹配
→ 打开 BOT Chain Explorer
```

在这笔普通钱包交易完成前，交付状态只能写“代码已集成、主网现场验收待完成”，不能写成“六项主办方钱包验收已完成”。

## 7. 环境变量和部署

本机 `.env.local` 或 Vercel Secret 设置，仓库只保留 `.env.example`：

```text
TRUTHPASS_MAINNET_RPC_URL
TRUTHPASS_CONSUMER_GATEWAY_ADDRESS
TRUTHPASS_AUDIT_ESCROW_ADDRESS
TYPESAFE_API_KEY
TYPESAFE_BASE_URL
TYPESAFE_MODEL
DATABASE_URL
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

不要把 `TRUTHPASS_DEPLOYER_PRIVATE_KEY`、任何 API Key 或数据库密码写入 Git。部署前检查 `npm run typecheck`、`npm test`、`npm run build`，然后在 Vercel 配置公开 RPC、合约地址和 JEV/数据库等必要 Secret。若 Vercel 环境异常，可暂时回滚到 `/web-demo`；代码回滚应使用前一版本提交，不要 force push。

## 8. 交接清单

1. 队友从 `codex/integrate-teammate-v1.2.0` 合并，不覆盖 `api/[[...path]].ts`、`vercel.json` 和 `/web-demo` 回滚入口。
2. 先配置 Vercel 环境变量，再验证 `/api/health` 和 `/api/chain/status`。
3. 用测试钱包验证 `purchase` 交易目标为 Gateway，用质疑流程验证目标为 Audit Escrow 且 `value > 0`。
4. 完成一笔普通钱包真实主网交易后，将 Hash、区块号和 Explorer URL 追加到部署交接记录；历史回放继续标为 `demo/synthetic`。
5. 生产上线前增加真实产线、实验室和设备签名，配置独立 Anchor Worker、审计角色多签和资金池策略。
