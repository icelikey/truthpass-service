# 真验 CLI 实现说明

> 文档版本：v0.5.0  
> 状态：本地 CLI 已实现；真实链上提交仍关闭  
> 最近修改：2026-10-07  
> 修改摘要：将 `docs/cli-contract.md` 的首批命令落地为 TypeScript CLI，复用现有 ServiceRegistry/Verifier，增加稳定 JSON、退出码、doctor 和 BOT Chain dry-run 锚定计划。  
> 影响范围：CLI、鱼油 Demo、网页后续接入、BOT Chain 交接

## 运行

```bash
npm install
npm run truthpass -- --help
npm run truthpass -- doctor --json
npm run truthpass -- verify --batch FO-2026-001 --json
npm run truthpass -- explain --batch FO-2026-001
npm run truthpass -- anchor --batch FO-2026-001 --dry-run --json
```

安装依赖后，也可以使用本地 bin wrapper：

```bash
npx truthpass doctor --json
```

## 当前命令

| 命令 | 作用 | 当前状态 |
| --- | --- | --- |
| `doctor` | 检查运行时、Fixture、JEV 和链状态 | 已实现 |
| `discover` | 列出鱼油 Demo 的候选服务 | 已实现，演示数据 |
| `verify` | 探测服务、执行验收并选择可接受服务 | 已实现，复用仓库 Verifier |
| `explain` | 将同一个 JSON 结果转成消费者可读说明 | 已实现 |
| `anchor --dry-run` | 生成幂等锚定计划 | 已实现，不发送交易 |
| `anchor` | 提交真实交易 | 刻意关闭，等待部署地址、角色和签名器 |

## JSON 合同

成功结果包含：

```text
schemaVersion
command
dataClass
batchId
status
score
ranking
evidenceHash
nextAction
```

当前 `dataClass` 为 `demo/synthetic`。CLI 不把合成数据、离线锚定计划或静态交易占位符描述成真实生产认证。

退出码沿用 CLI 合同：

```text
0  accepted / accepted_with_scope / doctor / dry-run
10 rejected
40 invalid_input / schema_error
60 chain_anchor_failed 或真实锚定未启用
70 internal_error
```

## 交接边界

CLI 当前直接复用 `ServiceRegistry` 和 `Verifier`，因此网页后续应消费 CLI/服务层产生的同一个 `VerificationResult`。接入真实 JEV 后，JEV 只能返回结构化路由；最终通过/拒绝仍由确定性 Verifier 决定。接入 BOT Chain 后，`anchor` 才能从 dry-run 扩展为预签名交易提交，并且必须回读 receipt 和事件后才显示 `anchored`。

