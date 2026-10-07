# BOT Chain 部署交接记录

> 文档版本：v0.8.2  
> 状态：当前交接记录（部署阻塞）  
> 最近修改：2026-10-07  
> 修改摘要：新增 Bohr Testnet 安全部署脚本和实测结果；记录 Faucet 网络阻塞，不伪造合约地址或交易哈希。  
> 影响范围：部署、BOT Chain、CLI、配置交接  
> 队友下一步：为测试钱包领取 tBOT 后运行部署命令，回填公开部署元数据。

## 已完成

- 新增 `npm run deploy:bot-chain`，默认编译 `TruthPassEvidenceAnchor.sol`（solc `0.8.24`）。
- 部署前强制校验：显式确认、Chain ID `968`、测试网专用限制、余额和 gas 估算。
- 部署后强制回读：receipt 成功、`eth_getCode`、`DEPLOYED_CHAIN_ID`、`DOMAIN_SEPARATOR`。
- 输出只包含公开部署元数据，不输出或持久化私钥。
- `npm test`：35/35 通过；`npm run typecheck`：通过；脚本语法检查：通过。

## 当前实测阻塞

测试钱包公开地址为：

```text
0x2eBd8467735EE3534be6add92f3D7231BA693c08
```

本机通过 `https://rpc.bohr.life` 已确认 Chain ID `968`，但该地址余额为 `0`。运行部署命令会安全失败：

```text
[deploy-bot-chain] deployer 0x2eBd8467735EE3534be6add92f3D7231BA693c08 has zero native balance on chain 968
```

官方 Faucet `https://faucet.botchain.ai/basic` 在当前网络返回连接关闭/超时，尚未能进入人工验证页面。因此没有提交部署交易，也没有生成合约地址、部署交易哈希或 receipt。

## 领取后部署

领取测试币后，在本机执行（私钥只从被 Git 忽略的 `.env.local` 注入）：

```powershell
$line = Get-Content .env.local | Where-Object { $_ -match '^TRUTHPASS_DEPLOYER_PRIVATE_KEY=' } | Select-Object -First 1
$env:TRUTHPASS_DEPLOYER_PRIVATE_KEY = ($line -split '=', 2)[1]
npm run deploy:bot-chain -- --confirm
```

部署输出中的 `contractAddress`、`deploymentTxHash`、`deploymentBlockNumber`、`domainSeparator` 和浏览器链接，必须经过 RPC 二次读取后再回填 `config/bot-chain-testnet.example.json`。私钥、助记词和 API Key 不得写入仓库。

## 状态边界

在 Faucet 资金和真实 receipt 尚未确认前，TruthPass 仍保持 `not_deployed`、`offline_plan_only` 或 `anchor_pending`。本地 Ganache 回放只能证明合约字节码和生命周期接口可用，不能替代 Bohr Testnet 的真实部署证明。
