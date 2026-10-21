# 外部 Agent 接入 TruthPass

TruthPass 对外提供两种接入方式：只读 REST API 和 MCP JSON-RPC。外部 Codex、OpenCode 或企业 Agent 可以查询同一份批次证据；涉及写入、购买、反馈或上链时，服务只返回 `pending_confirmation`，最终签名必须由对应的外部钱包完成。

## MCP

服务地址：

```text
https://truthpass-service.vercel.app/mcp
```

Codex CLI 配置示例：

```toml
[mcp_servers.truthpass]
url = "https://truthpass-service.vercel.app/mcp"
bearer_token_env_var = "TRUTHPASS_AGENT_GATEWAY_TOKEN"
```

环境变量只放在调用方机器或受保护的服务端，不写入仓库、网页或 Agent 提示词。

只读工具：

```text
truthpass.manifest
truthpass.inspect_batch
truthpass.explain_batch
truthpass.lifecycle
```

示例：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "truthpass.inspect_batch",
    "arguments": { "batchId": "FO-2026-001" }
  }
}
```

推荐提问：

```text
检查 FO-2026-001 的检测、冷链和当前缺口。
解释这批为什么还不能确认完整。
告诉我下一步由谁处理。
```

## REST

```text
GET /api/public/batches/FO-2026-001/overview
GET /api/products/FO-2026-001/lifecycle
GET /api/jev/detection?batchId=FO-2026-001
GET /api/chain/status
```

所有结果都必须读取并展示 `dataMode`、`verificationStatus`、`chainContext` 和证据引用。`demo/synthetic`、`replay_verified`、`anchor_pending` 都不能当作真实商品认证或当前用户交易成功。

## 扫码

包装二维码指向：

```text
https://truthpass-service.vercel.app/sites/fish-oil-demo?batch=FO-2026-001
```

二维码只负责带出企业站点和批次上下文，不包含原始报告、个人信息或私钥。

