# TruthPass Consumer Agent 示例

> 文档版本：v1.2.2
> 状态：当前生效
> 最近修改：2026-10-15
> 修改摘要：新增与 CoinCall Consumer Agent 对照的 TruthPass 宿主侧示例和脱敏日志。
> 影响范围：消费者 CLI/API、JEV/确定性验收、BOT Chain 查询、用户钱包交易准备
> 队友下一步：将示例 API 地址替换为正式部署地址，并用非部署钱包完成一笔现场交易回执验收。

## 示例文件

```text
examples/truthpass_consumer_agent_v1.py
examples/truthpass-consumer-agent.log
```

运行只读查询：

```powershell
python examples/truthpass_consumer_agent_v1.py FO-2026-001
```

运行交易准备：

```powershell
python examples/truthpass_consumer_agent_v1.py FO-2026-001 `
  --prepare purchase `
  --wallet 0xYourConsumerWallet
```

也可以指定线上 API：

```powershell
$env:TRUTHPASS_BASE_URL = "https://truthpass-service.vercel.app"
python examples/truthpass_consumer_agent_v1.py FO-2026-001 --json
```

## 与 CoinCall 示例的对应关系

| CoinCall Consumer Agent v2 | TruthPass Consumer Agent v1 |
| --- | --- |
| 宿主读取 `.env` | 宿主读取 `TRUTHPASS_BASE_URL`，不读取私钥 |
| MCP `wallet_status` | `/api/agent/manifest`、`/api/chain/status` |
| 服务目录/报价/付费调用 | `/api/cli/inspect`、`/api/jev/detection`、`/api/wallet/prepare` |
| 平台支付授权 | 用户钱包 `eth_sendTransaction` |
| spend report | receipt、业务事件和 Explorer 链接 |

TruthPass 的 Consumer Agent 先读取批次证据，再读取 JEV/规则路由，最后读取 BOT Chain
状态。Agent 只能引用 API 返回的事实并转译给用户，不能凭模型回答替代验收。

## 钱包边界

示例只接收公开钱包地址，用来绑定 `purchaseId`、`contributionId` 或 `challengeId`。
它不会读取 `TRUTHPASS_WALLET_KEY`，不会生成本地签名，也不会把私钥发送给 API。

交易状态应按以下顺序推进：

```text
agent_readonly_query
  → wallet_tx_prepared
  → wallet_signed
  → wallet_broadcast
  → mainnet_receipt_verified
```

只有用户钱包返回真实交易 Hash，并且 `/api/chain/tx-confirm` 同时校验
`receipt.status`、`receipt.to` 和业务事件后，才能对用户显示交易成功。

## 数据和演示边界

- `FO-2026-001` 当前返回的是 `demo/synthetic` 示例数据；
- JEV 响应中的 `routeDecision` 和 `confidence` 用于解释路由，不代表模型单独宣布产品合格；
- 日志中的 `EvidenceAnchored` Hash 是公开历史回放，只用于说明链上证据锚定格式；
- 示例没有实现自动付款，也没有把 `personal_sign` 当作主网交易。
