# BOT Chain Mainnet 部署交接

> 文档版本：v0.8.5
> 状态：主网部署脚本与交接方案
> 网络：BOT Chain Mainnet，Chain ID 677
> RPC：https://rpc.botchain.ai
> 浏览器：https://scan.botchain.ai

## 已确认的前置条件

当前部署钱包由仓库外的本地环境提供，公开地址为：

~~~text
0x2eBd8467735EE3534be6add92f3D7231BA693c08
~~~

该地址已在主网 RPC 上确认有 0.5 BOT，nonce 为 0。私钥不进入仓库、不进入工单、不写入部署配置；队友应通过本机 secret store、CI secret 或现场钱包签名提供。

## 本地只读预检

在仓库根目录执行：

~~~bash
node --env-file-if-exists=.env.local scripts/deploy-bot-chain-mainnet.mjs --dry-run
~~~

预检会验证：

- RPC 返回 Chain ID 677；
- 部署地址格式与私钥（若提供）一致；
- 合约能够用 Solidity 0.8.24 编译；
- 主网余额、部署字节码大小、估算 Gas 和估算成本；
- 不会发送交易，也不会写入私钥。

## 主网部署

由持有钱包的队友在确认预检输出后执行：

~~~bash
TRUTHPASS_DEPLOY_CONFIRM=DEPLOY_TO_BOTCHAIN_MAINNET node --env-file-if-exists=.env.local scripts/deploy-bot-chain-mainnet.mjs --confirm
~~~

脚本只接受 Chain ID 677，部署后必须回读：

- deployment receipt 成功；
- 合约地址存在字节码；
- DEPLOYED_CHAIN_ID 等于 677；
- DOMAIN_SEPARATOR 可读取；
- receipt 确认数达到配置值。

脚本生成的 config/bot-chain-mainnet.deployed.json 只包含公开部署元数据。该文件可在人工复核后提交，不得把 .env.local 或任何私钥一起提交。

## 角色授权

合约部署者初始只有 DEFAULT_ADMIN_ROLE。主网应为每个业务角色配置独立地址：

~~~text
TRUTHPASS_ROLE_EVIDENCE_WRITER_ROLE=
TRUTHPASS_ROLE_VERIFIER_ROLE=
TRUTHPASS_ROLE_PURCHASE_WRITER_ROLE=
TRUTHPASS_ROLE_CONTRIBUTION_WRITER_ROLE=
TRUTHPASS_ROLE_DISPUTE_ROLE=
TRUTHPASS_ROLE_REVOKER_ROLE=
~~~

先做只读回读：

~~~bash
node --env-file-if-exists=.env.local scripts/grant-bot-chain-mainnet-roles.mjs --dry-run
~~~

确认角色地址后，再由管理员执行：

~~~bash
TRUTHPASS_ROLE_CONFIRM=GRANT_ROLES_TO_BOTCHAIN_MAINNET node --env-file-if-exists=.env.local scripts/grant-bot-chain-mainnet-roles.mjs --confirm
~~~

脚本默认拒绝把所有角色授予同一个钱包。只有演示环境明确设置 TRUTHPASS_ALLOW_SINGLE_WALLET_MAINNET=true 才会允许单钱包模式。

## 接入现有 TruthPass 流程

主网合约地址回填后，Chain Adapter 使用显式主网配置：

~~~ts
const config = getBotChainConfig("mainnet", {
  contractAddress: process.env.TRUTHPASS_CONTRACT_ADDRESS,
});
const chain = new BotChainClient({ config, dryRun: true });
~~~

正确调用顺序仍然是：

~~~text
EvidenceEnvelope
  → Ed25519 验签 / nonce / sequence / batch 绑定
  → JEV 结构化路由
  → Deterministic Verifier
  → evidenceRoot / resultHash
  → Chain Adapter 生成交易
  → 外部钱包签名
  → receipt + event 回读
  → 页面和 Agent 才显示 anchored
~~~

当前 CLI 默认仍是 anchor_pending，不会把本地回放误报为主网已锚定。只有拿到真实 receipt 和匹配事件后，才能把状态更新为 anchored。

## 交接验收

队友需要回传以下公开材料：

1. config/bot-chain-mainnet.deployed.json；
2. 主网合约地址和部署交易浏览器链接；
3. 角色授权交易哈希及角色回读；
4. 至少一笔 EvidenceAnchored receipt；
5. 一笔 VerificationRecorded receipt；
6. 主网合约、规则版本和证据根之间的可复核映射。

这组材料齐全前，网页和 README 只能显示“主网部署待回读”，不能显示“已完成主网应用”。
