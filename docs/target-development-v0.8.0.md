# TruthPass 完整目标开发合同

> 文档版本：v0.8.0
> 状态：当前实施目标
> 最近修改：2026-10-07
> 修改摘要：将证据、JEV、确定性验收、BOT Chain、消费者贡献和本地回放收敛为一套可验收目标。
> 影响范围：证据模型、验证器、BOT Chain、CLI、消费者闭环、网页观察台
> 队友下一步：完成测试网部署并将真实合约地址、交易哈希和角色地址回填到环境配置。

## 1. 目标

TruthPass 的比赛目标是让消费者 Agent 能针对一个鱼油批次完成：

```text
发现可靠检测服务 → 获取并关联证据 → JEV 结构化路由
→ 确定性规则验收 → 生成证据根 → BOT Chain 锚定
→ 绑定购买 → 提交一次消费者贡献 → 支持争议和撤销
```

网页是 CLI 和验证结果的观察台。它不能自行生成结论，也不能在没有交易 receipt 和事件确认时显示“已上链”。

## 2. 完成标准

### 本地完成

- EvidenceEnvelope 能规范化、哈希并验证签名；
- JEV 只输出固定枚举路由，超时、冲突和低置信度进入复核；
- Deterministic Verifier 输出 `accepted`、`accepted_with_scope`、`review` 或 `rejected`；
- Chain Adapter 能构造并校验证据、验证、购买、贡献、争议和撤销请求；
- CLI 能输出稳定 JSON，并完成本地端到端回放；
- 旧记录不会删除，撤销和替代使用追加事件；
- 21 个既有测试和新增测试全部通过。

### 测试网完成

- 部署 `TruthPassEvidenceAnchor` 到 Bohr Testnet（Chain ID 968）；
- 配置合约地址并确认 `eth_getCode`、`DOMAIN_SEPARATOR` 和角色；
- 回放 `evidence → verification → purchase → contribution → dispute → revoke/supersede`；
- 保存交易哈希、receipt、区块号、事件和区块浏览器链接；
- 网页和 CLI 只显示真实的 `anchored`、`anchor_pending` 或 `anchor_failed`。

### 生产化门禁

真实部署前仍需完成设备/实验室密钥生命周期、样品交接、检测方法和资质绑定、JEV 服务端密钥管理、独立复检、隐私和合约审计。

## 3. 链上边界

链上只保存主体和证据承诺、规则/模型/验证器版本哈希、状态、时间、写入者以及购买、贡献、争议和撤销事件。原始报告、设备时序、个人信息和商业机密保留在链下证据仓。

区块链证明的是授权写入者提交过某个承诺；它不单独证明现实世界数据真实。现实真实性由设备签名、实验室资质、样品交接、确定性规则和复检共同承担。

## 4. 角色边界

- IoT/实验室网关：采集、签名、批次绑定和原文留存；
- Agent：发现服务、关联证据、调用 JEV、按授权最小披露；
- JEV：识别缺口、冲突和下一步路由；不能直接授予通过；
- Deterministic Verifier：唯一负责最终通过、范围通过、复核和拒绝；
- Chain Adapter：校验网络和合约域，提交已签名交易并核对 receipt/事件；
- 消费者 Agent：绑定购买、提交一次贡献并查询公共结果。

## 5. 当前已知外部门禁

本地代码不能替代真实钱包和测试网部署。没有合约地址、部署交易、角色地址和真实 receipt 时，状态必须保持为 `prepared_offline_not_submitted` 或 `anchor_pending`，不能对外宣称“鱼油已经完成链上认证”。
