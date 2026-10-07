# TruthPass 队友接入交接

## 1. 当前主网状态

- 网络：BOT Chain Mainnet
- Chain ID：`677`
- RPC：`https://rpc.botchain.ai`
- 浏览器：`https://scan.botchain.ai`
- TruthPass 合约：`0x0033462bee153cb9DF12b5c447b9C282DbfbE877`
- 部署交易：`https://scan.botchain.ai/tx/0xbc9bfe2b4a78fbf95d7795a5a67f14402cb9b8e0c6cf406d7ab39be3a65442b6`
- EvidenceAnchored：`https://scan.botchain.ai/tx/0xcd497f3fba8d299eac28d984e35189249d9c3ba9de7810d855c72a79a8692c13`
- VerificationRecorded：`https://scan.botchain.ai/tx/0x78564f072f18f317c4a60e87d75203e08ec09821d12637022e3ba1e31348b737`

不要重新部署同一合约，也不要把主网私钥提交到 Git。公开部署元数据在 `config/bot-chain-mainnet.deployed.json`，角色回执在 `config/bot-chain-mainnet.roles.json`。

## 2. 本地准备

```powershell
git clone https://github.com/icelikey/truthpass-service.git
Set-Location truthpass-service
git switch codex/botchain-mainnet-deployment
npm ci
```

在仓库根目录创建 `.env.local`。私钥由钱包持有人通过密码管理器、KMS 或现场安全交接提供，只填本机，不通过聊天传输：

```dotenv
TRUTHPASS_DEPLOYER_ADDRESS=0x2eBd8467735EE3534be6add92f3D7231BA693c08
TRUTHPASS_DEPLOYER_PRIVATE_KEY=由钱包持有人安全写入
TRUTHPASS_CONTRACT_ADDRESS=0x0033462bee153cb9DF12b5c447b9C282DbfbE877
```

网络受本机 Clash 代理影响时，只在当前 PowerShell 会话设置：

```powershell
$env:HTTP_PROXY="http://127.0.0.1:7897"
$env:HTTPS_PROXY="http://127.0.0.1:7897"
$env:ALL_PROXY="http://127.0.0.1:7897"
$env:NODE_USE_ENV_PROXY="1"
```

验证安装：

```powershell
npm run typecheck
npm test
```

## 3. 设备和实验室接入

启动统一协议服务器：

```powershell
npm run protocol:server
```

默认监听 `http://localhost:8787`。远程工厂通过 HTTPS 网关访问以下接口：

### 注册设备/实验室公钥

`POST /v1/issuers`

```json
{
  "issuerId": "lab-c",
  "keyId": "lab-key-2026-01",
  "publicKey": "Ed25519 公钥 PEM 或原始公钥"
}
```

### 提交检测证据

`POST /v1/evidence`

请求包含签名的 `EvidenceEnvelope` 和可选原始 payload。服务器会检查签名、批次、`eventId`、`nonce`、`sequence`、`previousEventHash` 和 payload hash。只有返回 `202 accepted` 才进入验证队列。

### 获取验证结果

`POST /v1/verify`

请求包含 `task` 和结构化 `evidence`。返回 JEV 路由、确定性验证结果，以及下一步是 `prepare_anchor_and_verification` 还是 `hold_for_review`。

## 4. Relayer 接入

启动只接收外部签名交易的 Relayer：

```powershell
$env:TRUTHPASS_CONTRACT_ADDRESS="0x0033462bee153cb9DF12b5c447b9C282DbfbE877"
npm run relayer:server
```

默认监听 `http://localhost:8790`，接口为：

`POST /v1/relay`

```json
{
  "rawTransaction": "0x外部钱包签名后的原始交易"
}
```

Relayer 会校验 Chain ID `677`、交易目标合约和交易大小，然后调用 `eth_sendRawTransaction`。它不持有私钥；Agent 只能准备 calldata，不能绕过外部钱包签名。

## 5. 交接后的业务链路

```text
传感器/实验室
  → Protocol Server 验签与批次绑定
  → JEV 路由
  → 确定性 Verifier
  → 外部钱包签名 rawTransaction
  → Relayer
  → BOT Chain anchorEvidence / recordVerification
  → receipt 和事件回读
  → 用户 Agent 生成可解释报告
```

当前 Demo 使用模拟鱼油数据。接入真实产线时，先为每个设备或实验室注册独立 Ed25519 公钥，再把原始报告放入链下数据库/对象存储，链上只写入哈希、状态、批次和验证结果。

## 6. 生产环境待办

- 把 JSONL 演示存储替换为 PostgreSQL 或其他带唯一约束的数据库；
- Relayer 前增加 mTLS、服务身份、限流、nonce 管理和 receipt 重试；
- 将主网角色从单钱包 Demo 模式拆成独立 Evidence、Verifier、Purchase 等地址；
- 使用 KMS/HSM 或外部钱包服务管理签名；
- 为每个工厂、设备和实验室建立密钥轮换与吊销流程。
