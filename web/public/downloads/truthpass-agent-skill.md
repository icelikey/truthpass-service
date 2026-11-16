# TruthPass Agent Skill

这个 Skill 让你的 AI 助手直接查询 TruthPass 的商品批次资料，并把结果讲给用户听。

## 什么时候调用

当用户问到商品的生产、检测、冷链、运输、缺口、链上状态或购买前依据时：

1. 先确定 `batchId`。如果没有批次号，先让用户扫码或输入包装上的批次号。
2. 只读取这个批次的公开资料。
3. 先展示查找过程，再给四段回答：结论、依据、不确定、下一步。
4. 每个结论都带当前批次的来源；找不到的内容明确说“当前资料没有登记”。

## 推荐提问

```text
检查 FO-2026-001 的生产、检测、冷链和缺口。
解释这批鱼油的 EPA+DHA 实测值和来源。
历史链上记录能不能证明我这次购买成功？
当前还缺哪一份资料，由谁补？
```

## CLI

```bash
npx truthpass ask "检查 FO-2026-001 的检测、冷链和当前缺口" \
  --remote https://truthpass-service.vercel.app --stream

npx truthpass inspect \
  --remote https://truthpass-service.vercel.app --batch FO-2026-001
```

需要机器可读结果时加 `--json`。`--token` 只放在调用方环境变量中，不要放进网页或提示词。

### 用户自己的 Agent

登录 TruthPass 后，在商品助手的“我的 Agent”中创建个人授权。凭证只显示一次，授权范围可以限制到当前批次；泄露后在同一处撤销。

```bash
export TRUTHPASS_PERSONAL_AGENT_TOKEN="<PERSONAL_AGENT_TOKEN>"
npx truthpass account --remote http://106.52.107.169 --token "$TRUTHPASS_PERSONAL_AGENT_TOKEN" --json
npx truthpass purchases --remote http://106.52.107.169 --token "$TRUTHPASS_PERSONAL_AGENT_TOKEN" --json
npx truthpass updates --remote http://106.52.107.169 --token "$TRUTHPASS_PERSONAL_AGENT_TOKEN" --batch FO-2026-001 --json
npx truthpass guidance --remote http://106.52.107.169 --token "$TRUTHPASS_PERSONAL_AGENT_TOKEN" --batch FO-2026-001 --json
npx truthpass ask "这批鱼油最近有什么更新？日常保存要注意什么？" \
  --remote http://106.52.107.169 --token "$TRUTHPASS_PERSONAL_AGENT_TOKEN" --batch FO-2026-001
```

个人 Token 只能读取当前用户自己的购买记录、已授权批次更新，并在授权范围内提问；它不能读取其他用户数据，不能代替用户付款、签名或写链。CLI 不要使用 Supabase 密码或 access token。

## MCP

只读入口：

```text
https://truthpass-service.vercel.app/mcp
```

优先使用：

```text
truthpass.manifest
truthpass.inspect_batch
truthpass.explain_batch
truthpass.lifecycle
```

## 回答边界

- 只引用当前 `tenantId/productId/batchId` 范围内的证据。
- 不猜型号、灯号、检测数字或设备状态。
- `demo/synthetic` 只能说明演示资料，不能说成真实认证。
- `replay_verified` 或 `anchor_pending` 不能说成当前购买成功。
- 没有当前 receipt 时，不输出“已支付”“已购买”。
- Agent 不能替用户签名、付款或写链；受保护操作必须返回待确认状态。

## 对用户的表达

先说“我正在读取这批资料、找到相关来源、核对规则和缺口”，再给结论。模型只负责解释已经读取并通过校验的事实；没有来源就明确说不知道。
