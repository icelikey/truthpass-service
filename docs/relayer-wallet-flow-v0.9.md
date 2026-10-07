# 钱包与 Relayer 流程

协议服务器、Agent 和钱包分工如下：

```text
设备 → Protocol Server → Agent/JEV/规则验证器
                         ↓ 生成 calldata
外部钱包签名 rawTransaction
                         ↓
Relayer /v1/relay → BOT Chain RPC → receipt/event
```

Relayer 只接受已经签名的 `rawTransaction`，并在提交前检查：

- Chain ID 必须是 `677`；
- 交易目标必须是配置的 TruthPass 合约；
- 原始交易大小必须在限制内；
- RPC 返回交易哈希后才返回 `202`。

Relayer 不持有私钥，因此设备 Agent 或 LLM 无法越权签名。生产环境还应在 API 网关增加 mTLS、设备/服务身份、请求额度、nonce 管理、receipt 轮询和审计日志。钱包中的 BOT 只用于支付部署、授权和业务写入 Gas；`recordPurchase` 当前仍是购买承诺存证，不会自动转移商品款或 BOT。

本地启动：

```powershell
$env:TRUTHPASS_CONTRACT_ADDRESS="0x0033462bee153cb9DF12b5c447b9C282DbfbE877"
npm run relayer:server
```

默认监听 `0.0.0.0:8790`。不要把私钥放入 Relayer 环境变量或请求体。
