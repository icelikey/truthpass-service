# 真验 JEV 决策门接入方案

> 文档版本：v0.5.0  
> 状态：当前战略扩展，JEV 适配器待由队友接入  
> 最近修改：2026-10-06  
> 修改摘要：将 JEV 放入 Agent 关联与确定性验收之间，用固定类型的判别结果降低大模型自由文本带来的幻觉和越权。  
> 影响范围：Agent、CLI、验收器、网页观察台、链上证据  
> 队友下一步：实现 JEV adapter、校准样本、超时降级和与 `VerificationResult` 的映射。

## 1. JEV 在真验里的定位

JEV（Jev）是面向机器决策的模型，公开资料强调预定义类型、概率和快速分类/路由，而不是生成长篇自由文本。真验把它当作**结构化决策门**，不把它当成现实世界的真相证明器，也不让它直接写入最终“通过”结论。

```text
消费者自然语言
      ↓
DeepSeek / 其他 LLM：拆解意图、生成解释草稿
      ↓
JEV：从证据状态中抽取固定字段、判断缺口、选择下一步路由
      ↓
确定性 Verifier：按 policy 和证据哈希计算 pass / reject / review
      ↓
链上锚定：保存任务、规则、结果和模型决策的可复核指纹
```

JEV 的价值是把“模型觉得大概可以”变成可检查的 `enum + number + reference`。它减少了自由文本幻觉，但无法防止设备造假、样品替换、实验室串通或错误的规则门槛；这些仍要靠多源证据、签名、复检和争议流程处理。

官方资料：<https://jevai.net/>。其中“zero hallucinations”等表述属于供应方产品主张，本项目不把它改写成绝对安全承诺。

## 2. 在鱼油任务中的职责边界

| 环节 | 组件 | 能做什么 | 明确不能做什么 |
| --- | --- | --- | --- |
| 意图理解 | 消费者 Agent + LLM | 把“看含量、新鲜度和冷链”映射为任务和 policy | 不生成检测事实 |
| 结构化判别 | JEV adapter | 判断证据是否完整、是否冲突、该调用哪个服务 | 不覆盖规则结果，不凭空补值 |
| 最终验收 | `Verifier` | 用 EPA+DHA、过氧化值、TOTOX、冷链和批次匹配规则计算结果 | 不接受 LLM/JEV 的自然语言改判 |
| 解释 | LLM + CLI formatter | 把已确定的结果翻译成消费者能理解的话 | 不新增结果、医疗效果或安全承诺 |
| 公共记录 | Chain adapter | 锚定输入/输出哈希、policy、结果和撤销状态 | 不证明链下事实天然真实 |

当前鱼油 Demo 的 70%、5、20 和 6 小时仍是演示门槛。JEV 只能帮助决定“证据够不够、下一步做什么”，不能把演示门槛包装成监管结论。

## 3. JEV 输入合同

JEV 不直接接收消费者个人信息，也不直接读取可变的数据库全表。CLI 先把证据标准化为摘要，并保留可回查的 `EvidenceEnvelope` 引用。

```json
{
  "taskId": "task-FO-2026-001-001",
  "batchId": "FO-2026-001",
  "policyId": "fish-oil-freshness-v1",
  "requestedChecks": ["epa_dha", "oxidation", "cold_chain"],
  "evidenceRefs": [
    { "eventId": "evt-lab-c-001", "kind": "third-party-lab", "payloadHash": "0x..." },
    { "eventId": "evt-cold-07-1842", "kind": "cold-chain-device", "payloadHash": "0x..." }
  ],
  "stateSummary": {
    "reportBatchMatches": true,
    "epaDhaPresent": true,
    "peroxidePresent": true,
    "totoxPresent": true,
    "coldChainPresent": true,
    "heavyMetalsPresent": false,
    "serviceOnline": true,
    "signatureValid": true
  },
  "inputHash": "0x...",
  "schemaVersion": "jev-truthpass-state-v1"
}
```

`stateSummary` 由代码生成，不能由 LLM 自由编写。原始报告、设备明细和消费者身份留在链下；JEV 只得到完成任务所需的最小状态。

## 4. JEV 输出合同

输出必须是可反序列化的固定类型。任何未知枚举、缺字段、签名错误或无法验证的输出都按 `review` 处理。

```json
{
  "taskId": "task-FO-2026-001-001",
  "decision": "route_to_rule_verifier",
  "confidence": 0.94,
  "evidenceScope": "quality_and_cold_chain",
  "missingEvidenceCodes": ["HEAVY_METALS_NOT_COVERED"],
  "conflictCodes": [],
  "selectedServiceIds": ["lab-c", "device-cold-07"],
  "nextAction": "run_deterministic_verifier",
  "modelId": "jev",
  "modelVersion": "adapter-version-recorded-by-team",
  "inputHash": "0x...",
  "outputHash": "0x...",
  "expiresAt": "2026-10-06T10:30:00Z"
}
```

建议只允许以下路由值：

- `route_to_rule_verifier`：证据结构完整且没有冲突，进入确定性验收；
- `request_more_evidence`：缺少关键字段，调用独立检测或让生产方补材料；
- `route_to_recheck`：证据冲突、签名异常、服务状态不稳定或置信度不足；
- `reject_evidence`：证据格式、批次或身份不满足最低门槛。

JEV 可以输出概率，但最终门禁由代码决定，例如：`confidence < 0.85`、`conflictCodes` 非空、输入哈希无法回放、模型版本未登记、输出过期或 adapter 超时，都不能进入 `accepted`。

## 5. 防幻觉与防越权门禁

1. **先取证，后判断**：JEV 输入只允许来自已签名、已关联批次的 `EvidenceEnvelope` 摘要。
2. **结构化输出**：不接受自然语言中的“看起来合格”“应该没问题”等判断。
3. **双重门**：JEV 只负责路由和缺口，`Verifier` 负责最终通过/拒绝。
4. **失败关闭**：超时、低置信度、未知字段、模型降级、链下证据不可回查时，结果为 `review` 或 `request_more_evidence`。
5. **可重放**：记录 `inputHash`、模型版本、schema、policy 和 `outputHash`，相同输入可以复现同一路由。
6. **不让模型发权益**：积分、购买绑定、公共信誉和链上写入只能由 CLI 服务和合约权限执行。
7. **解释与事实分离**：LLM 只能基于 `VerificationResult` 写解释，解释文本不能回流为证据或规则输入。

## 6. CLI 与代码接入形态

CLI 保持同一条验证链，网页只观察结果：

```text
truthpass verify batch FO-2026-001 --policy fish-oil-freshness-v1 --json
  ├─ discover / probe
  ├─ normalize EvidenceEnvelope
  ├─ jev decide --schema jev-truthpass-state-v1
  ├─ verifier evaluate --policy fish-oil-freshness-v1
  ├─ reputation record
  └─ anchor evidence --network bot-chain
```

队友实现时建议把 JEV 封装成替换式接口，不把供应商 SDK 直接散落在 CLI 和网页：

```ts
type JevRoute =
  | "route_to_rule_verifier"
  | "request_more_evidence"
  | "route_to_recheck"
  | "reject_evidence";

interface JevDecision {
  taskId: string;
  decision: JevRoute;
  confidence: number;
  missingEvidenceCodes: string[];
  conflictCodes: string[];
  selectedServiceIds: string[];
  modelId: string;
  modelVersion: string;
  inputHash: string;
  outputHash: string;
  expiresAt: string;
}

interface DecisionGate {
  decide(input: JevState): Promise<JevDecision>;
}
```

生产环境必须有 `DeterministicDecisionGate` 作为降级实现：JEV 不可用时仍能完成字段完整性、签名和规则检查，但应降低结果范围并标记 `modelAssisted: false`。

## 7. 链上记录边界

链上只锚定下面这些字段的哈希或枚举，不上传原始 prompt、个人信息、报告全文或模型密钥：

```text
taskHash
policyHash
evidenceRoot
jevSchemaHash
jevModelVersionHash
jevDecisionCode
confidenceBucket
verifierResult
createdAt
revokedAt / disputeId
```

这样评委可以看到“JEV 做了什么、规则如何接管、结果能否回放”，同时不会把模型供应商的内部材料或消费者数据公开到链上。

## 8. 评测和上线门槛

队友接入真实 JEV 前，至少准备一组带人工标签的合成样本和反例：批次错配、过期报告、重复事件、签名失效、冷链缺口、实验室离线、报告互相冲突。验收重点不是“JEV 说得像不像人”，而是：

- 关键缺口是否被稳定识别；
- 冲突是否必定进入复检；
- 低置信度是否不会被升级为通过；
- 相同输入是否可回放；
- JEV 故障时是否安全降级；
- 网页、CLI 和链上事件是否引用同一个 `VerificationResult`。

当前网页使用的是 `demo/synthetic` 的静态 JEV 结果，尚未连接供应商服务。完成 adapter、密钥管理、校准评测和回放测试后，才能把页面文案从“演示适配器”改成实际服务状态。
