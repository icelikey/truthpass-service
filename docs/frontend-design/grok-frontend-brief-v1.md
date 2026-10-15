# TruthPass 前端改造 Brief v1

## 工作分支

```text
codex/frontend-grok-v1.5.0
```

Grok 只修改前端范围：

```text
web/src/**
web/styles.css
web/index.html
web/public/assets/**（需要新增视觉资产时）
```

不要修改 `api-server.ts`、`src/**`、合约、数据库迁移或现有 `web/public/legacy/**`。

## 视觉参考

预览图：[`truthpass-ui-direction-v1.png`](./truthpass-ui-direction-v1.png)（英文/结构参考）
中文预览图：[`truthpass-ui-direction-zh-v1.png`](./truthpass-ui-direction-zh-v1.png)
中文文案基线：[`frontend-copy-zh-v1.md`](./frontend-copy-zh-v1.md)

方向关键词：

- 深海藏蓝背景；
- 青绿色证据高亮；
- 少量琥珀色 review 状态；
- 企业证据控制台与消费者批次页共用一套视觉语言；
- 信息层级清楚，避免赛博朋克和区块链炒作视觉；
- 首屏首先讲清“白牌商品证据 + Agent 客服”，鱼油只是当前 Demo。

## 页面结构

1. **Hero**：说明 TruthPass 为白牌品牌提供批次证据、Agent 客服和售后基础设施。
2. **CLI Reference**：保留协议、商品、批次、验证、购买准备和售后能力展示。
3. **商家证据工作区**：证据完整度、缺口、来源、签名状态、review 队列。
4. **消费者批次页**：证据卡、事实来源、不确定项、下一步动作。
5. **Agent 客服**：显示 `model_assisted` 或 `deterministic_fallback`，并显示 `demo/synthetic`。
6. **技术详情**：默认折叠，展开后显示 Verifier、Evidence Envelope、链状态和 receipt 语义。

## 现有组件映射

- `Hero.tsx`：重写首屏文案和 CTA 层级；
- `CliReferencePanel.tsx`：保留为协议能力区，但减少技术密度；
- `ProductPanel.tsx`：改造成商家/消费者共同可理解的批次摘要；
- `EvidencePanel.tsx`：突出证据缺口和来源，不显示伪造主网完成语句；
- `ChatPanel.tsx`：保留 SSE 交互，强化来源、数据模式和人工转接入口；
- `TopBar.tsx`：保留钱包、观察台和登录能力，降低首屏按钮噪音；
- `styles.css`：统一状态色、卡片层级、响应式断点和键盘焦点。

## 不可违反的产品语义

- `demo/synthetic` 不能写成真实商品认证；
- `replay_verified` 不能写成当前用户交易完成；
- `anchor_pending` 不能写成已上链完成；
- 模型客服不能被视觉包装成质量判定器；
- 不生成假的交易 Hash、价格、库存、订单或健康疗效；
- Agent 回答必须让用户看到来源、数据模式、不确定项和下一步动作。

## 前端验收

- `npm run build` 通过；
- 桌面宽度 1440、平板宽度 1024、移动宽度 390 均可用；
- 所有主要按钮有键盘焦点和可读的 aria-label；
- Chat SSE 的 loading、fallback、provider unavailable、rate limited 状态可区分；
- 批次号、证据状态和数据模式在视觉上不会混淆；
- 现有 API 路径和响应字段保持兼容；
- 每个前端改动单独提交，并在提交说明中写明截图或页面验证结果。
