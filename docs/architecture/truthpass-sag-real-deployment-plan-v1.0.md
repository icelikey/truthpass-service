# TruthPass + SAG 真实落地开发方案 v1.0

> 状态：实施基线
> 目标：完成一个真实批次从生产、检测、冷链、消费者购买、反馈到厂家改进的可核验闭环。
> 首个真实验收：1 家生产方 + 1 家检测机构 + 1 个物流/冷链设备 + 1 个真实批次。
> 仓库内置 FO-2026-001 继续作为 demo/synthetic 回归批次，不作为真实生产验收。

## 1. 结论

SAG 值得接入，但只放在 TruthPass 的检索与知识层：

~~~text
TruthPass Evidence Contract
  → SAG scoped retrieval / source traceability
  → TruthPass Verifier
  → TruthPass JEV decision routing
  → Agent explanation
  → PayPal or wallet payment
  → BOT Chain receipt and event verification
~~~

SAG 负责文档、附件、来源的导入和结构化，event/entity 检索，多跳关联，原文回溯，带引用问答，REST/OpenAI 兼容/MCP，以及 PostgreSQL/pgvector 生产路径。

SAG 不负责证明工厂数据真实、判断指标是否通过、替代实验室资质或样品交接、替代 TruthPass JEV、替代支付回调或 Chain 677 receipt，也不能把记录改成“已认证”。

SAG 的 JEV 精排能力与 TruthPass 的 JEV 决策路由必须分开。前者改善检索排序，后者决定补证、复核、继续展示或拒绝。

## 2. 对 Get 笔记区块链内容的吸收边界

本地 Get 笔记中关于区块链、RWA、稳定币的内容可以提炼出三个有用判断：

1. 区块链的核心价值是公共记账、时间顺序和跨主体可回查，不是把所有原始资料直接塞进链上。
2. 现实资产上链必须先解决来源、托管、机构责任和法律关系；上链本身不能把现实资料变成真实资产或质量认证。
3. 区块链改变的是协作和结算关系。TruthPass 可以连接生产方、检测机构、物流方和消费者的责任事件，但首个产品不需要把鱼油或用户反馈代币化。

所以首个真实闭环采用：

- 产品与反馈不发行 RWA 代币；
- 不要求普通消费者持有稳定币；
- 支付与证据链分离，消费者可使用 PayPal 等法币支付；
- BOT Chain 只保存证据承诺、机构签名摘要、验证结果、购买绑定和反馈贡献事件；
- 原始报告、原始评论、订单详情、个人信息和健康信息留在加密链下存储。

## 3. 目标产品架构

~~~text
手机 / ERP / MES / LIMS / IoT / 物流
          ↓
Connector + Edge Gateway
          ↓
EvidenceEnvelope（统一合同、签名、Hash、批次绑定）
          ↓
链下 Evidence Store + SAG Knowledge Store
          ↓
Scoped Retrieval（只查询当前 tenant/product/batch）
          ↓
Deterministic Verifier
          ↓
TruthPass JEV（补证 / 复核 / 继续 / 拒绝）
          ↓
Consumer Agent（只解释已验证事实）
          ↓
PayPal / 钱包签名
          ↓
Receipt Verification
          ↓
Purchase Binding
          ↓
Consumer Feedback + Contribution Receipt
          ↓
Merchant Improvement Report
~~~

关键原则：

- SAG 只接收经过租户和批次绑定的检索投影；
- Verifier 直接读取规范化证据，不依赖模型或检索排序作判定；
- Agent 只能解释 Verifier/JEV 已产生的结果；
- 任何写操作都需要用户或机构外部确认；
- 链上状态和商品质量状态始终分栏展示。

## 4. 统一数据合同

### 4.1 EvidenceEnvelope

所有来源最终转换为同一合同：

~~~json
{
  "envelopeVersion": "evidence.v1",
  "eventId": "evt-01...",
  "tenantId": "tenant-fish-oil-demo",
  "productId": "fish-oil",
  "batchId": "FO-REAL-001",
  "eventType": "production_step | lab_report | cold_chain_reading | handoff | purchase | feedback",
  "stage": "raw_material | production | inspection | cold_chain | shipment | purchase | feedback",
  "issuer": {"type": "factory | lab | logistics | device | inspector | consumer", "id": "issuer-...", "keyId": "key-..."},
  "occurredAt": "2026-11-06T10:20:00Z",
  "capturedAt": "2026-11-06T10:20:02Z",
  "sequence": 1842,
  "previousEventHash": "0x...",
  "payloadHash": "0x...",
  "mediaHash": "0x...",
  "schemaHash": "0x...",
  "policyId": "food-quality-v1",
  "attestationLevel": "supplier-declared | device-signed | lab-signed | inspector-reviewed",
  "visibility": "public_summary | partner | restricted | private",
  "signature": "0x...",
  "dataMode": "live"
}
~~~

服务端顺序固定为：

~~~text
schema → tenant/product/batch binding → timestamp and unit normalization
→ duplicate/replay check → signature and key status → relationship check
→ Verifier → JEV route
~~~

### 4.2 参数结果

用户和 Agent 不再看到笼统的“指标未达到标准”，而是看到实测值、规则范围、差值、来源和下一步：

~~~json
{
  "key": "peroxide_value",
  "observed": 6.8,
  "unit": "meq/kg",
  "policy": "<= 5.0 meq/kg",
  "difference": 1.8,
  "status": "outside_range",
  "evidenceIds": ["ev-lab-001"],
  "measuredAt": "2026-11-05T12:00:00Z",
  "source": "lab-c"
}
~~~

状态固定为 within_range、outside_range、missing、conflict、expired、revoked、review。

## 5. SAG 集成方案

### 5.1 部署

第一阶段采用 sidecar：

~~~text
truthpass-api
truthpass-worker
sag-api
postgres
object-storage
redis / queue
~~~

SAG 保存可检索投影、文档版本和来源映射；TruthPass 继续维护 EvidenceEnvelope、Verifier、JEV 审计、支付与购买、链上 receipt、反馈和租户权限。不要把 SAG 数据库直接当作 TruthPass 事实数据库。

### 5.2 source 映射

每个 SAG source 固定映射到：

~~~text
sagSourceId ↔ tenantId + productId + batchId + sourceKind
~~~

最小划分：

- production:{tenant}:{product}:{batch}
- inspection:{tenant}:{product}:{batch}
- coldchain:{tenant}:{product}:{batch}
- consumer-feedback:{tenant}:{product}:{batch}

适配器使用 SAG 官方 source/document/search/read/agent/MCP API。调用前检查 source 作用域，返回后将 evidenceRef 反查 TruthPass evidenceId；未知引用、跨批次或跨租户引用直接丢弃并进入 fallback。

### 5.3 检索返回合同

~~~json
{
  "query": "这批鱼油的氧化指标如何？",
  "batchId": "FO-REAL-001",
  "retrieval": {"requestedStrategy": "multi", "effectiveStrategy": "multi", "fallbackUsed": false},
  "evidences": [
    {
      "evidenceRef": "sag://...",
      "evidenceId": "ev-lab-001",
      "tenantId": "tenant-a",
      "productId": "fish-oil",
      "batchId": "FO-REAL-001",
      "sourceKind": "lab_report",
      "excerpt": "过氧化值 2.1 meq/kg",
      "contentHash": "0x...",
      "rank": 1
    }
  ]
}
~~~

SAG 只帮助找到资料，不能直接产生推荐状态。推荐状态必须来自 TruthPass Verifier：recommend_with_scope、review_before_recommendation、do_not_recommend。

## 6. 真实数据接入

### 6.1 生产方

第一阶段不改造产线：ERP/MES 导出 CSV/Excel/JSON，生产人员手机扫码关联批次，工艺节点拍照或上传签名记录，再由 Connector 生成生产步骤事件。后续再接 ERP API 和设备网关。

最小字段：原料批次、工单、工艺版本、开始/结束时间、设备、操作主体、产量、损耗、包装批次。

### 6.2 检测机构

实验室提交 COA/PDF + 结构化 JSON，包括 sampleId、reportId、batchId、检测方法和单位、EPA+DHA、过氧化值/p-Anisidine/TOTOX、Pb/Hg/Cd/As、有效期、样品交接 Hash、实验室签名、公钥和资质声明。

实验室签名必须覆盖规范化 JSON，而不是只签 PDF 文件名。

### 6.3 冷链和物流

先接一个真实设备：MQTT/HTTPS webhook，设备 ID、密钥 ID、采样时间、温度、湿度、定位、序列号、前一事件 Hash、一次性 nonce、运输单号和交接点。

没有设备签名时允许进入 supplier_declared，但不能进入“机构确认推荐”。

### 6.4 手机采集

~~~text
扫码 / 拍照 / 语音说明
→ OCR/二维码识别
→ Agent 补全最少字段
→ 用户确认批次和来源
→ 生成待签名 EvidenceEnvelope
~~~

图片只能证明可观察事实，不能单独证明化学或微生物指标。

## 7. Verifier、JEV 和 Agent

Verifier 执行批次/租户绑定、签名、公钥、样品交接、时间和单位、重复冲突、过期、数值 policy、数量守恒等确定性检查。

TruthPass JEV 决定补证、复核、继续解释或禁止推荐；不能写链、付款或把自然语言改成 accepted。

Agent 只负责把问题转成当前批次查询，调用 SAG 取证据，解释实测值/范围/差值/缺口并给出下一步。模型输出必须通过四段契约、引用白名单、跨批次拦截和交易成功词拦截。

## 8. 区块链设计

### 8.1 链上承诺

对规范化证据集合排序后形成：

~~~text
evidenceRoot = MerkleRoot(sort(eventId, payloadHash))
verificationCommitment =
H(tenantId, productId, batchId, evidenceRoot, policyHash,
  verificationResultHash, issuerSignatures, nonce)
~~~

链上只写批次承诺、evidenceRoot、policyHash、resultHash、机构/设备身份摘要、事件类型、版本、nonce、撤销/复检/争议和交易回执。原文永不上链。

### 8.2 Chain 677 验收

最小事件：EvidenceAnchored、VerificationRecorded、PurchaseRecorded、PaymentReceived、ContributionRecorded、DisputeOpened、EvidenceRevoked/EvidenceSuperseded。

服务端必须检查：

~~~text
chainId == 677
target == configuredContract
from == expectedSigner
status == 1
event.batchId == requestedBatchId
event.requestId == idempotencyKey
event.dataMode == live
~~~

replay_verified、anchor_pending 和 mainnet_receipt_verified 永远是不同状态。

### 8.3 数学不变量

所有操作绑定：

~~~text
K = (tenantId, productId, batchId, requestId, evidenceRoot, policyHash)
~~~

必须保持：

1. 作用域不变量：返回证据的三元组等于请求上下文；
2. 单调状态：pending → verified 可以前进，回放或失败不能跳到成功；
3. 购买不变量：没有匹配 receipt 和 PurchaseRecorded，purchaseId 不存在；
4. 反馈不变量：一个 purchaseId 最多一个有效反馈；
5. 不可静默覆盖：纠错使用 supersede/revoke 追加事件；
6. 幂等不变量：相同 requestId 重试不会产生第二笔业务事件。

用属性测试、跨租户 fuzz、重放测试和数据库唯一约束验证这些不变量。

## 9. 购买和反馈

首个真实商业闭环采用 PayPal 先行，BOT Chain 不作为消费者必须使用的支付工具：

~~~text
PayPal create-order → 用户确认 → capture → Webhook 验签
→ orderId / batchId / amount 绑定 → purchaseId
→ 可选：购买承诺锚定 Chain 677
~~~

若后续启用 BOT 原生支付，必须单独验收 Chain ID、目标合约、金额、发送者、PurchaseRecorded、PaymentReceived 和 receipt。

反馈流程：

~~~text
真实 purchaseId → feedback/prepare → feedbackHash
→ 用户或贡献钱包签名 → Contribution receipt
→ 聚合反馈 → 企业改进报告
~~~

## 10. 分阶段实施

### P0 合同冻结（1 周）

EvidenceEnvelope v1、policy snapshot、事件状态机、SAG source 映射、Chain 677 ABI/事件清单、真实/演示/回放分离。放行条件：跨批次、跨租户、产品 ID 漂移测试通过。

### P1 SAG sidecar（1–2 周）

部署 SAG + PostgreSQL/pgvector，完成 TruthPass adapter、source/document/search/read 映射、evidenceRef 反查、版本和权限映射。放行条件：同一问题只能返回当前批次证据；SAG 失效时仍可确定性回答。

### P2 真实资料接入（2–4 周）

生产 Connector、实验室签名 COA、1 个冷链设备、手机扫码/OCR、Edge Gateway nonce/序列/验签。放行条件：1 个真实批次的资料可读回，且每条证据可追溯到签发主体。

### P3 机构确认和链上锚定（1–2 周）

厂家质检员钱包、实验室机构声明、Verifier/JEV 审计、EvidenceAnchored/VerificationRecorded receipt、撤销/复检/争议。放行条件：机构确认前只能 review_before_recommendation。

### P4 购买和反馈（2–3 周）

PayPal Sandbox → Live、订单与 purchaseId 绑定、webhook 幂等、PurchaseRecorded（可选）、Contribution receipt、企业改进报告。放行条件：没有支付回读不显示购买成功，同一购买不能重复反馈。

### P5 生产发布（1–2 周）

Postgres/Supabase、RLS、密钥轮换、备份恢复、监控、HTTPS、云主机与 Vercel 一致性。放行条件：重启读回、跨租户安全、十并发、错误回退和回滚通过。

## 11. 完成证据

必须保留：三类真实主体和公钥登记；原始资料 Hash/签名/批次绑定；Verifier/JEV JSON 和 traceId；SAG evidenceRef 到 TruthPass evidenceId 的映射；链上锚定/验证 receipt；PayPal capture 与 webhook 验签；purchaseId 与 batchId 读回；feedbackHash 与 Contribution receipt；企业改进报告；数据库重启读回；错批次、跨租户、重复交易拒绝结果。

以下都不能单独作为完成证明：SAG 已部署、文档可搜索、模型返回 200、代码存在、历史回放交易、anchor_pending、钱包弹窗出现、PayPal order 创建成功但没有 capture/webhook。

## 12. 第一条真正可验收的线路

~~~text
真实批次 FO-REAL-001
→ 生产方签名生产资料
→ 实验室签名 COA + 样品交接
→ 冷链设备签名遥测
→ Verifier 输出实测值/范围/差值/缺口
→ 机构确认
→ Chain 677 锚定并回读 receipt
→ Agent 给出有范围推荐
→ PayPal capture + webhook
→ purchaseId 绑定批次
→ 消费者反馈
→ Contribution receipt
→ 企业确认改进任务
~~~

只有这条线全部读回，TruthPass 才能对外宣称“真实闭环已跑通”。在此之前，对外口径必须继续区分：Agent 可运行、SAG 是检索与来源层、FO-2026-001 是 demo/synthetic、链记录的是摘要/签名/事件/receipt，真实商品认证和真实支付仍在验收中。
