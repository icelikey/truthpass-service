# 真验 v0.9.0：消费者 Agent 主网交付方案

> 文档版本：v0.9.0
> 状态：当前交付说明（主网业务回放已确认；真实厂家数据接入仍是下一阶段）
> 最近修改：2026-10-08
> 修改摘要：把最新网页、消费者 CLI、JEV/确定性验收、BOT Chain 主网业务 receipt 和订单适配边界统一为一条交付链路。
> 影响范围：消费者 Agent、CLI、网页观察台、BOT Chain、鱼油 Demo、订单适配器
> 队友下一步：把 `demo/synthetic` 数据替换为带签名的厂家/实验室/设备 EvidenceEnvelope，并为购买与反馈接入独立角色钱包。

## 交付形态

真验的产品入口是消费者自己的 Agent，或者我们提供的消费者 Agent。Agent 安装 `truthpass` CLI 后，可以用结构化 JSON 调用真验：

```text
用户提出“帮我找值得信赖的鱼油”
        ↓
消费者 Agent 调用 truthpass verify / recommend
        ↓
真验探测检测服务，调用 JEV 做结构化路由
        ↓
确定性 Verifier 验收批次、报告签名、EPA+DHA、氧化和冷链
        ↓
Agent 向用户解释证据、缺口、范围和链上回执
        ↓
用户同意后调用 truthpass order
        ↓
商家 Checkout Adapter 完成价格、地址、支付和配送
        ↓
消费者 Agent 将购买承诺和后续反馈提交到真验公共信誉流程
```

网页只承担黑客松现场的观察台职责。它调用同一个 BFF，不能把静态页面文案当作生产结论。

## CLI 合同

### 查询与推荐

```powershell
truthpass verify --batch FO-2026-001 --json
truthpass recommend --batch FO-2026-001 --json
```

`verify` 返回批次、规则版本、候选服务排序、确定性验收结果和证据哈希。`recommend` 只在验收通过且存在当前可用服务时返回 `recommend`。JEV 只能决定路由、缺口和下一步动作，不能直接把自然语言输出当成通过。

### 下单

```powershell
truthpass order --batch FO-2026-001 --json
```

`order` 返回 `prepared_pending_checkout` 时，表示真验已经完成证据解释并准备购买承诺；它还没有替用户付款或填写收货地址。消费者 Agent 需要把结构化结果交给商家的 Checkout Adapter。适配器完成支付后，再由独立钱包签名 `recordPurchase`，不能由 LLM 或网页直接持有私钥。

当前仓库不伪造订单成功状态。无法通过验收时，状态是 `blocked_by_verification`，不会继续下单。

## BOT Chain 主网关系

当前主网唯一真实公链配置：

| 项目 | 已确认值 |
| --- | --- |
| Chain ID | `677` |
| RPC | `https://rpc.botchain.ai` |
| TruthPass 合约 | `0x0033462bee153cb9DF12b5c447b9C282DbfbE877` |
| Explorer | `https://scan.botchain.ai` |
| Domain Separator | `0xb0843104b533c579fb232c23f6c5a3d900ec0e507e85dec8d99be2cba9a2a8eb` |

主网业务回放已写入并等待至少 2 个确认：

```text
evidence → EvidenceAnchored
verification → VerificationRecorded
purchase → PurchaseRecorded
contribution → ContributionRecorded
```

公开回执清单见 [`config/bot-chain-mainnet.replay.json`](../config/bot-chain-mainnet.replay.json)。清单只保存交易哈希、区块号、事件名、业务 ID 和哈希，不保存私钥、原始报告、消费者身份或地址。网页 BFF 只有在读取到该清单并确认合约可达时才显示 `anchored`。

## 现实数据的生产边界

当前主网回放的 `dataClass` 仍是 `demo/synthetic`，因此它证明的是合约接口、事件顺序、receipt 校验和网页回读已经跑通，不等于厂家产线或实验室报告已经被现实认证。正式业务接入必须把以下数据经过签名和批次绑定后再进入同一流程：

- 厂家 ERP/MES/LIMS 导出的批次和检测摘要；
- 实验室报告、资质和样品交接记录；
- 冷链设备的温度事件和设备身份；
- 消费者授权、匿名购买承诺和一次性反馈。

原文、图片、传感器明细和个人信息留在链下证据仓；BOT Chain 只保存可复核的承诺、哈希、状态和修正事件。

## 主网写入安全边界

- 私钥只在受控运维脚本或外部钱包中使用，不进入网页、BFF、JEV 或 Relayer；
- `TRUTHPASS_HTTPS_PROXY` 只用于本机网络环境，生产服务器应使用可审计的直接出口或受管代理；
- 主网脚本必须显式传入 `--confirm` 和确认串；
- 业务 ID 固定后可以安全重试，合约按相同内容幂等；
- 六类角色当前仍由一个演示地址持有，生产必须拆成最小权限的钱包或 KMS 服务账户；
- `eth_getLogs` 不作为唯一历史索引来源，生产应接第三方索引或受控 WebSocket，并保留 receipt 回读。

## 已验证与未完成

已验证：

- `npm run typecheck`；
- `npm test`（38/38）；
- 本地网页 → BFF → JEV/确定性 Verifier → 主网状态回读；
- 主网四类业务 receipt 和 manifest 回读；
- CLI `verify`、`recommend`、`order` JSON 合同。

仍需生产化：

- 厂家、实验室、设备的真实签名 EvidenceEnvelope；
- 角色钱包隔离、KMS/mTLS、nonce 和 receipt 轮询持久化；
- 商家 Checkout Adapter、支付/配送回调和退款争议；
- 真实消费者 Agent 的授权、隐私和反女巫策略；
- 把 `demo/synthetic` 批次替换成有来源、有复检和争议 SLA 的真实批次。
