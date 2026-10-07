# TruthPass 配置与测试网交接

> 文档版本：v0.8.1  
> 状态：历史配置模板
> 最近修改：2026-10-07  
> 修改摘要：补充 Bohr Testnet 的安全配置模板和部署回填字段；不写入任何秘密或未确认地址。  
> 影响范围：BOT Chain、CLI 交接、部署验收、JEV 本地配置  
> 队友下一步：部署合约后回填地址、部署交易、域分隔符、角色地址和首条生命周期 receipt。

## 已确认的测试网参数

| 字段 | 当前值 |
| --- | --- |
| 网络 | `bohr-testnet` |
| Chain ID | `968` |
| Chain ID Hex | `0x3c8` |
| RPC | `https://rpc.bohr.life` |
| 浏览器 | `https://scan.bohr.life` |
| 合约 | `TruthPassEvidenceAnchor` |

部署前的公开模板位于 [`config/bot-chain-testnet.example.json`](../config/bot-chain-testnet.example.json)；真实测试网验收结果位于 [`config/bot-chain-testnet.deployed.json`](../config/bot-chain-testnet.deployed.json)。

## 当前未配置的字段

以下字段必须来自真实部署或受控钱包，不能由 Demo 推算：

- `contract.address`
- `contract.deploymentTxHash`
- `contract.domainSeparator`
- `roles.defaultAdmin`
- `roles.evidenceWriter`
- `roles.verifier`
- `roles.purchaseWriter`
- `roles.contributionWriter`
- `roles.dispute`
- `roles.revoker`
- `verification.firstLifecycleReceipt`

这些字段为空时，系统必须保持 `offline_plan_only`、`prepared_offline_not_submitted` 或 `anchor_pending`，不能显示 `anchored`。

## 回填顺序

1. 在 Bohr Testnet 部署 `contracts/TruthPassEvidenceAnchor.sol`。
2. 通过 RPC 读取并确认 `eth_chainId = 0x3c8`。
3. 读取合约代码、`DOMAIN_SEPARATOR()` 和部署交易 receipt。
4. 使用管理员钱包授予六类业务角色，并回读 `hasRole`。
5. 将公开地址和交易哈希回填到配置模板；私钥只放在本地密钥管理器或受控环境变量中。
6. 回放 `evidence → verification → purchase → contribution → dispute → revoke/supersede`，保存每笔 receipt、事件、区块号和浏览器链接。
7. 只有 receipt 成功、目标地址匹配、事件主题匹配且确认数达到要求后，CLI 和网页才可显示 `anchored`。

## JEV 配置边界

JEV 的运行配置仍只放在被 Git 忽略的 `.env.local` 或部署环境中：

- `TRUTHPASS_LIVE_API`
- `JEV_API_KEY` / `JEV_BASE_URL` / `JEV_MODEL`
- 或 `DEEPSEEK_API_KEY` / `DEEPSEEK_BASE_URL` / `DEEPSEEK_MODEL`

当前 JEV 即使配置可用，也只负责结构化路由；最终结果仍由确定性 Verifier 产生。JEV Key 不得写入仓库、网页代码、截图或路演材料。

## 当前状态口径

本版本只完成安全配置模板和交接字段整理，不代表已经完成真实测试网部署。鱼油 Demo 的本地回放仍属于 `demo/synthetic`，链上状态仍为 `anchor_pending`。
