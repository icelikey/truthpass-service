# TruthPass 钱包发现与真实交易安全收敛

> 文档版本：v1.2.1
> 状态：当前生效
> 最近修改：2026-10-15
> 修改摘要：移植队友提交 4d550ac 的 EIP-6963 钱包发现修复，区分选中与真实连接状态，禁止演示钱包和伪造交易回退。
> 影响范围：前端钱包连接、BOT Chain 交易入口、主网验收
> 队友下一步：使用非部署钱包完成一笔真实 BOT Chain Mainnet 交易并回填 Hash 与 Explorer 链接。

## 来源与兼容边界

本版本以 `codex/integrate-teammate-v1.2.0` 为基线，移植队友分支提交：

```text
4d550ac fix(web): update wallet selection highlight immediately on click and fix provider discovery
```

只移植 EIP-6963 provider discovery 和钱包选择状态修复，不覆盖以下现有能力：

- Vercel `vercel.json` 和 Serverless API 入口；
- 本机 CLI、BFF 和 `/web-demo` 回滚入口；
- Consumer Gateway、Audit Escrow 和 BOT Chain 配置；
- receipt 状态、目标合约和业务事件校验。

## 钱包行为

```text
点击钱包卡片
  → 立即显示“已选中”
  → 请求对应 EIP-1193 provider
  → 获取账户并切换 Chain ID 677
  → 连接成功后才显示“当前已连接”
```

MetaMask、OKX Wallet 和 Binance Wallet 只绑定各自通过 EIP-6963 或厂商标识发现的 provider。通用 `window.ethereum` 仅用于“其他 EVM 钱包”，不能冒充指定钱包。

未检测到插件、授权失败或请求超时：

- 不写入钱包地址；
- 不创建演示钱包；
- 不生成演示交易 Hash；
- 不允许交易按钮执行；
- 页面显示安装或授权错误。

## 真实交易门禁

消费者交易只能经过：

```text
真实钱包 provider
→ Chain ID 677
→ eth_sendTransaction
→ eth_getTransactionReceipt
→ receipt.status == 1
→ receipt.to 匹配预期合约
→ 业务事件和业务 ID 匹配
```

没有真实 receipt 和匹配事件时，页面不得显示“上链已确认”。`personal_sign` 只能用于身份授权，不能替代主网交易。

本版本明确不允许以下回退：

```text
connectDemoWallet
fallbackMap
wallet_signed_relayed
mainnet_verified_anchor 演示回退
```

## 验收状态

- EIP-6963 多钱包发现：已加入自动化回归测试；
- 演示钱包和伪造回执路径：已加入静态安全门禁；
- TypeScript、单元测试、Vite 构建：以本次提交验证结果为准；
- 普通非部署钱包真实主网交易：仍需现场完成并记录交易 Hash、区块号和 Explorer 链接；
- 仓库内历史回放和鱼油数据：继续标记为 `demo/synthetic`。

\n