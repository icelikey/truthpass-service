# TruthPass 外部 Evidence Agent 接口与抽检机制

> 文档版本：v0.7.0  
> 状态：P1 可运行骨架，生产连接器待接入  
> 最近修改：2026-10-07  
> 修改摘要：新增外部证据提交、批次查询、用户视图、轮询和风险加权随机抽检接口。  
> 影响范围：IoT、实验室、生产 Agent、用户 Agent、EvidenceEnvelope、审计调度

## 1. 目标边界

外部设备、实验室或厂家系统提交原始观察；Evidence Gateway 负责校验结构、哈希、签名、序列和重复；用户 Agent 只读取授权后的证据视图。

Agent 可以翻译、关联、提示缺口和安排复检。确定性 Verifier 才能给出规则结果。区块链只锚定证据根、规则版本、结果哈希和撤销状态，不能把未经确认的原始数据变成真实事实。

## 2. 对外接口

实现于 src/external-agent-api.ts：

    POST /v1/evidence/events
    GET  /v1/batches/{batchId}/evidence
    POST /v1/batches/{batchId}/consumer-report
    POST /v1/audits/random

设备或实验室事件使用 src/evidence.ts 的 EvidenceEnvelope。事件至少要绑定：

- eventId、eventType、schemaHash；
- batch/sample/device/equipment 引用；
- issuer、producedByAgent；
- observedAt、receivedAt、sequence；
- payloadHash、previousEventHash；
- attestationLevel、keyId、signature；
- methodId 和单位体系。

当前 P1 骨架用 HMAC-SHA256 做本地可运行的签名示例。生产环境应替换为设备或实验室的 Ed25519/ECDSA/受控签名适配器，并加入公钥注册、轮换和吊销。

## 3. 接收与验证顺序

    读取原始 payload
      → 计算规范化 payloadHash
      → 验证 schema、时间、单位和批次引用
      → 验证 issuer/key/signature
      → 检查 sequence/previousEventHash
      → 检查 eventId 和 payload 重放
      → 链下保存原文与验证结果
      → 形成批次 evidenceRoot
      → 交给 JEV 和 Deterministic Verifier

失败事件仍保留审计记录，但只能进入 review 或 rejected，不能被静默删除。相同 eventId 的相同请求可以幂等返回；相同 eventId 的不同内容必须冲突拒绝。

## 4. 用户视图

GET /v1/batches/{batchId}/evidence 默认只返回：

- 事件类型、批次、来源类别、attestationLevel；
- 时间、证据哈希、verified/review/failed 状态；
- 缺失、冲突、重放和签名原因。

原始 payload 需要额外授权，不应默认返回给消费者。即使隐藏具体数值，也必须显示 failed、missing、restricted 或 not_covered。

POST /v1/batches/{batchId}/consumer-report 生成：

- 当前声明范围；
- 每个规则检查的 pass/fail/review；
- 证据清单；
- 缺失和冲突；
- 下一步动作。

## 5. 轮询与随机抽检

固定轮询用于设备心跳、温度、实验室报告和厂家批次状态。超过 intervalMs 或从未观察过的目标进入 due 状态。

随机抽检使用：

    seedCommitment = SHA256(seed)
    score = SHA256(seed + ":" + candidateId) / riskWeight
    取 score 最小的候选

生产环境应先承诺随机种子，再揭示种子；候选集合、种子承诺、最终排序和入选样品都要留在审计记录中。风险权重可以提高接近阈值、历史异常、设备不稳定或运输风险批次的抽检概率，但不应把风险权重当成质量结论。

真正的生产策略应同时包含：

- 关键工序的全量规则校验；
- 风险加权的独立实验室复检；
- 设备离线、超温、签名异常和批次冲突的事件触发复检；
- 定期随机抽样，降低厂家只挑好样品的可能性。

随机抽检降低选择偏差，不能单独证明所有产品都合格。

## 6. 当前未覆盖内容

- 真实 ERP/MES/LIMS/SCADA/IoT 连接器；
- 实验室资质和检测方法数据库；
- 设备公钥、密钥轮换、校准和吊销服务；
- JEV 真实适配器与低置信度降级；
- EvidenceEnvelope 的跨语言规范化和 Merkle 证据根服务；
- 真实 BOT Chain 部署、角色授权和交易回读；
- 生产数据库、对象存储和访问审计。

这些内容应在 P1 试点阶段接入。当前实现是可测试的外部 Agent 接口骨架，不是已经接入真实设备的生产系统。

