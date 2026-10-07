# TruthPass Agent 架构与白客威胁审计

> 文档版本：v0.6.0  
> 状态：当前审计与修复基线  
> 最近修改：2026-10-07  
> 修改摘要：依据仓库 HEAD `6c0cd40`，把生产环节质检、成品质检、消费者 Agent、JEV、确定性验收器和链上权益放到同一套 Agent 架构中，并补充攻击面、白客修复优先级与安全门禁。  
> 影响范围：Agent 架构、鱼油 Demo、证据接入、JEV、合约、消费者权益、网页演示  
> 代码状态：本次不修改 `src/`、`contracts/`、`test/`、`web-demo/`；文档中的生产能力均为待实现方案，不能当作已上线能力。

## 1. 结论先行

当前仓库已经可以演示“发现服务、探测可用性、确定性验收、消费者反馈”这一条最小链路，但还不是能够认证现实鱼油生产数据的生产系统。最关键的事实是：

- `ExecutionEvidence.signatureValid` 目前只是调用方传入的布尔值，不是密码学签名验证；
- 当前没有运行时 `EvidenceEnvelope`、设备公钥、密钥轮换、序列号、样品交接和报告吊销机制；
- `TrustRegistry.sol` 允许未授权地址写入服务反馈、购买和消费者贡献，消费者贡献也没有存储和一次性约束；
- `ConsumerParticipationRegistry` 只检查“存在授权”，没有按 scope 检查购买或质量反馈，也没有真实钱包/订单证明绑定；
- 网页中的 JEV、链上锚定和设备签名是演示状态，不能向评委或消费者表述为真实认证已经完成。

因此，TruthPass 的可信边界应这样表达：

> Agent 负责发现、关联、筛选和解释；JEV 负责结构化缺口与路由；确定性 Verifier 负责最终通过或拒绝；区块链负责留下可复核的提交指纹和履约记录。现实真实性还需要设备、实验室、样品交接、复检和争议机制共同承担。

## 2. 当前代码对应的 Agent 角色

仓库当前实现的是“服务可靠性 Demo”，生产环节和成品环节的 Agent 仍需要按下表拆开。这样可以避免让一个拥有厂家权限的 Agent 同时负责采集、筛选和裁判。

| 角色 | 当前仓库对应物 | 目标职责 | 当前状态 |
| --- | --- | --- | --- |
| 消费者 Agent | `ConsumerParticipationRegistry` 的链下模型、网页 CLI 文案 | 接收消费者意图、授权最小范围、查询证据卡、提交购买后反馈 | 购买/反馈模型已演示，钱包和真实订单证明未实现 |
| TruthPass Orchestrator | `ServiceRegistry.evaluate` | 编排发现、探测、证据标准化、JEV、Verifier 和公共记录 | 内存级服务编排已实现 |
| 生产过程 Agent | 尚无独立运行时代码 | 读取 ERP/MES/SCADA/LIMS 导出，按批次形成过程证据，不修改原始数据 | 方案阶段 |
| 成品检测 Agent | `ServiceAdapter.execute` 的抽象 | 接收实验室报告或检测服务响应，验证报告来源、样品和方法 | 只有模拟适配器 |
| IoT/Edge Agent | 尚无运行时代码 | 从已有温度记录器、设备导出或网关读取数据，完成签名和批次绑定 | 方案阶段 |
| JEV Gate | `docs/jev-integration-v0.5.md` | 结构化判断缺口、冲突和下一步路由 | 适配器未实现 |
| Deterministic Verifier | `src/verifier.ts` | 按版本化 policy 做最终验收和证据哈希 | 已实现 Demo 规则，生产级证据校验未实现 |
| Chain Adapter | `TrustRegistry.sol` 草案 | 以角色权限写入锚定、反馈、撤销、争议和消费者权益事件 | 合约草案，未部署、未回放 |
| Reputation/Dispute Agent | `recordFeedback` 的内存记录 | 聚合履约、处理撤销和复检，不允许单一主体抹除负面记录 | 未实现 |

## 3. 推荐的整体 Agent 架构

```text
消费者自然语言意图
        │
        ▼
消费者 Agent ──最小授权/购买证明──► TruthPass CLI/API
                                      │
                                      ▼
                              Orchestrator
                         ┌────────┼────────┐
                         ▼        ▼        ▼
                 生产过程 Agent  成品检测 Agent  冷链/物流 Agent
                         │        │        │
                         └────► EvidenceEnvelope ◄────┘
                                      │
                                      ▼
                             JEV 结构化决策门
                       缺口 / 冲突 / 路由 / 置信度
                                      │
                 ┌────────────────────┴───────────────────┐
                 ▼                                        ▼
        request_more_evidence / review          Deterministic Verifier
                                                           │
                                                           ▼
                                       accepted / accepted_with_scope /
                                       rejected / disputed
                                                           │
                         ┌─────────────────────────────────┴───────────────┐
                         ▼                                                 ▼
                 链下证据仓与报告原文                         BOT Chain 锚定摘要和事件
                         │                                                 │
                         └──────────────► 消费者 Agent 查询 ◄──────────────┘
```

### 3.1 两个质检环节必须分开

**生产过程质检**回答“这批鱼油是否按照声明的过程生产”。它主要读取生产方已有系统和设备的过程记录，关注批次连续性、关键工序、温度/时间、投料和产出平衡、设备状态、异常和放行记录。生产方可以提供数据，但不能自行把数据标成“第三方已证明”。

**成品质检**回答“交付给消费者的这批成品是否满足声明的检测范围”。它需要样品编号、样品交接、实验室身份、检测方法、单位、报告版本和报告哈希。专业机构或实验室 Agent 负责整理报告，Verifier 负责按 policy 判断，消费者 Agent 看到的是范围、证据来源、缺口和复检建议。

两者不能互相替代：生产过程记录完整，不等于成品指标合格；成品检测合格，也不等于整个生产过程没有被替换或调包。

## 4. 低改造数据接入与筛选规则

### 4.1 厂家不需要先改造整条产线

低成本接入的顺序应是“读已有数据，再逐步增加可信采集”：

```text
ERP / MES / LIMS / 温度记录器 / 实验室 PDF 或 CSV
                         │ 只读连接器
                         ▼
                 厂内 Edge Adapter
          CSV / JSON / HTTPS / MQTT / SFTP
                         │
                         ▼
               TruthPass Evidence API
                         │
                 批次绑定、签名、序列、哈希
                         ▼
               JEV → Verifier → Chain Adapter
```

- P0 比赛 Demo：使用 `demo/synthetic` 批次、检测摘要和冷链事件，不要求设备改造；
- P1 低改造试点：复用已有导出能力，只安装只读连接器和 Edge Adapter，不向产线写回；
- P2 智能工厂：再增加设备密钥、在线签名、校准记录、网关冗余和自动样品交接。

Agent 不能凭空拿到厂家没有提供的数据。实际接入需要厂家授予只读凭据、提供导出文件或开放接口，并明确数据覆盖范围、保留周期和撤销方式。

### 4.2 Agent/微层如何筛选数据

筛选必须由 policy 驱动，而不是由模型自由选择“看起来有利”的字段：

1. Orchestrator 根据消费者问题生成 `requestedChecks`，例如含量、氧化、冷链和重金属；
2. Connector 只读允许的数据源，保留原始 payload、来源、时间和批次引用；
3. JEV 读取代码生成的 `stateSummary`，只输出缺口码、冲突码和下一步路由；
4. Verifier 对原始证据引用和标准化数值做最终判定；
5. 对消费者做最小披露，但结果必须同时列出 `missing`、`restricted`、`failed` 和 `not_covered`；
6. 被隐藏的商业字段要记录 `redactionReason`，不能把“未展示”变成“没有异常”。

建议统一使用以下覆盖状态：

```text
available    已有证据且通过完整性检查
missing      应有字段但未提供
restricted   有证据但当前消费者无权读取
failed       有证据且规则不通过
conflict     多来源互相矛盾，进入复检
not_covered  当前 policy 没有覆盖该项
```

## 5. 生产过程质检链路

```text
厂家已有系统/设备
   → 只读 Connector
   → Production Agent 规范化
   → EvidenceEnvelope（批次、工序、时间、来源、哈希）
   → JEV 检查缺口/冲突
   → Process Verifier 检查工序和批次连续性
   → 过程证据根哈希
   → 消费者 Agent 查询过程摘要
```

生产 Agent 可以做：批次图谱关联、字段单位转换、重复事件发现、过程异常提示、数据覆盖说明和复检任务编排。它不能做：凭空补写缺失值、把厂家自报改成实验室证明、删除不利事件、把异常标成“可忽略”或直接授予消费者权益。

最小证据字段应包括：

```json
{
  "eventId": "evt-...",
  "eventType": "production_step | material_receipt | release_check",
  "subject": { "type": "batch", "id": "FO-2026-001" },
  "issuer": { "type": "factory_system | device | lab", "id": "..." },
  "producedByAgent": "production-agent-...",
  "observedAt": "2026-10-06T08:00:00Z",
  "sequence": 1842,
  "previousEventHash": "0x...",
  "payloadHash": "0x...",
  "schemaVersion": "fish-oil-process-v1",
  "attestationLevel": "supplier-declared | device-signed | lab-signed",
  "signature": "0x..."
}
```

## 6. 成品质检链路

```text
成品抽样与封签
   → 样品编号/交接链
   → 专业实验室检测
   → Lab Agent 校验报告身份、方法、单位、批次和哈希
   → JEV 检查缺口/冲突/是否需要复检
   → Finished-Goods Verifier
   → 结果范围、报告根哈希和撤销状态
   → 消费者 Agent 返回证据卡
```

在当前 Demo 中，EPA+DHA、过氧化值、TOTOX、冷链和报告批次只是演示门槛。生产版还应根据产品声明和适用法规配置检测方法、单位、检测限、实验室资质、报告有效期和复检规则。Agent 只能解释检测结果，不能替代实验室或法规判断。

## 7. 攻击者视角：最现实的攻击路径

下表把“攻击动作”直接对应到当前代码或架构缺口。

| 攻击方向 | 攻击方式 | 影响 | 当前薄弱点 | 白客修复 |
| --- | --- | --- | --- | --- |
| 批次替换 | 把历史合格报告绑定到新批次，或只改一个 batch 字段 | 消费者看到假合格 | 只有字符串相等检查，没有样品交接、报告签名和重复使用检测 | 样品 ID、批次图、报告签名、一次性 nonce、报告唯一索引 |
| 报告重放 | 复制旧报告或旧设备事件再次提交 | 过期证据被当成当前证据 | 无事件序列、前一哈希、有效期和撤销状态 | `sequence`、`previousEventHash`、`expiresAt`、replay detector |
| 单位/方法欺骗 | 把 mg/份当成百分比，或用不同方法生成不可比数值 | 阈值判断失真 | `ExecutionEvidence` 没有单位、方法和标准版本 | 数值必须绑定 unit、methodId、policyVersion |
| 选择性披露 | 只提交好看的温度、报告或生产步骤 | 形成“部分真实”的假象 | 无覆盖率和负面事件完整性 | append-only 事件、覆盖状态、缺失/限制/失败显式展示 |
| 设备替换 | 用未注册温度计或离线脚本生成数据 | 冷链和工艺数据失真 | `signatureValid` 是布尔字段，未验公钥 | 设备注册、签名验证、密钥轮换、校准和吊销 |
| 生产方自报冒充第三方 | 厂家提交的 JSON 被标成实验室结果 | 证据等级被抬高 | `issuer`/`attestationLevel` 未进入运行时类型 | 强制来源类型和资质证明，来源等级不可由 Agent 修改 |
| 实验室串通 | 实验室提交假报告或重复样品 | 成品检测被污染 | 无样品封签、交接和独立复检 | 样品 custody、抽检复核、实验室声誉与撤销机制 |
| 服务女巫 | 创建大量服务 ID 和钱包刷高评分 | 路由器选到虚假服务 | `historicalScore` 可由注册卡直接提供 | 资格准入、成本/押金、独立任务、时间衰减和 Sybil 防护 |
| 反馈刷分 | 创建多个消费者和购买证明 | 公共信誉被操纵 | 购买证明未验证，贡献未上链存储 | 钱包签名、订单/批次绑定、速率限制、异常聚类、复检权重 |
| 负面记录抹除 | 服务所有者撤销所有不利反馈 | 公共信誉失真 | `revokeFeedback` 只允许服务 owner，缺少争议方和不可抹除历史 | 撤销只追加理由，原记录保留；引入仲裁/复检角色 |
| 合约越权写入 | 任意地址写入反馈、购买和贡献 | 链上公共记录不可信 | 合约没有角色权限和签名授权 | `AccessControl`/角色白名单、EIP-712 授权、事件状态机 |
| 伪造购买 | 传入任意 `consumerId`、`purchaseProofHash` | 获得共建权益或刷反馈 | `recordConsumerPurchase` 不验订单、不验 consent scope | 订单签名、nonce、过期时间、消费者钱包绑定、scope 检查 |
| 贡献重放 | 重复调用相同或新 contributionId | 重复获得权益 | `recordConsumerContribution` 不保存贡献 | 存储贡献状态、purchase 一次性计数、幂等 key |
| 模型提示注入 | 恶意报告文本诱导 JEV/LLM 忽略异常 | 模型跳过关键检查 | JEV adapter 尚未实现，原文与控制字段未隔离 | 原文只作证据，结构字段由代码生成；未知输出失败关闭 |
| 模型降级绕过 | JEV 超时或低置信度仍被当成通过 | 不完整证据进入公共信誉 | 当前没有运行时 gate | `review/request_more_evidence`，禁止降级为 accepted |
| Agent 工具越权 | 生产 Agent 取得写产线、写合约或读隐私数据权限 | 供应链和隐私同时受损 | 当前没有可执行的权限边界 | 只读 token、工具 allowlist、隔离运行、审计日志 |
| 拒绝服务 | 恶意服务让 `probe/execute` 长时间不返回 | 路由器阻塞、无法验收 | `ServiceRegistry.evaluate` 没有超时和熔断 | timeout、并发上限、熔断、候选切换、链下结果保留 |
| 哈希歧义 | 同一 JSON 改变字段顺序得到不同哈希 | 无法回放或产生分叉记录 | `JSON.stringify` 非规范化 | RFC 8785/JCS 或固定字段编码，明确编码和版本 |
| 隐私关联 | 链上公开哈希与购买、消费者 ID 长期关联 | 推断购买和健康偏好 | 合约直接写 `consumerId` 和 `batchId` | 伪名化、承诺/零知识选择性披露、最小公开字段 |

## 8. 当前实现中的重点代码问题

### 8.1 `src/verifier.ts`

- `signatureValid` 由调用方直接传入，服务可以自己声称“签名有效”；
- `reportTime >= productionTime` 是字符串比较，没有统一时区、时间源、时间回拨和有效期；
- `productionTime`、`serviceId`、检测方法、单位、标准版本和报告签发主体没有完整绑定；
- 负数物流间隔可能通过，缺少范围和异常值检查；
- `logisticsWithinLimit` 和报告时间检查不是硬失败条件，业务层如果把 `partial` 当作“可以买”会产生安全漏洞；
- 结果没有 `policyId/policyHash`、证据来源等级、缺口集合和撤销状态；
- 哈希依赖 `JSON.stringify`，生产版不可直接用于跨语言回放。

### 8.2 `src/registry.ts`

- `register` 可以覆盖同 ID 服务，服务身份、公钥和能力没有不可变注册流程；
- `endpoint` 和 `signer` 没有验证，`historicalScore` 是服务卡直接提供的可篡改输入；
- 探测和执行没有超时、并发上限、重试预算或熔断；
- 服务结果没有证据根、样品链、报告签发方和撤销查询；
- 反馈只存在内存，重启即丢失，无法形成公共信誉。

### 8.3 `src/consumer.ts`

- `grantConsent` 可被同一键覆盖，代码没有撤销接口和授权版本；
- `recordPurchase` 只检查授权存在，不检查授权是否包含 `purchase` scope；
- `recordFeedback` 不检查 `quality-feedback` scope，也没有验证调用方是否就是 `consumerId`；
- `purchaseProofHash` 是调用者自报，不能证明真实购买；
- 反馈证据没有来源签名、时间窗口、批次状态和争议状态；
- 贡献积分由类别数量直接计算，容易通过堆类别刷取。

### 8.4 `contracts/TrustRegistry.sol`

- `recordFeedback`、`recordConsumerPurchase` 和 `recordConsumerContribution` 没有角色或签名授权，任意地址可写入；
- `recordConsumerContribution` 只发事件，不保存贡献记录，无法防重、撤销或查询；
- `revokeFeedback` 只允许服务 owner，可能成为单方删负面记录的入口；
- 服务注册是先到先得，缺少资质、密钥、公钥、能力 schema 和吊销状态；
- 购买记录不验证消费者签名、订单证明、consent scope、nonce 或过期时间；
- 合约没有暂停、应急、争议、最终性和升级治理设计；
- 直接写入可关联的 `consumerId` 和 `batchId`，存在长期隐私关联风险。

## 9. 消费者购买后的“合约权益”如何安全表达

用户 Agent 上链可以形成购买绑定、反馈资格、复检优先权、服务额度或批次共建积分，但比赛版本不应把它写成股权、分红、投资回报或可交易金融权益。原因有两点：

1. 技术上，购买证明、消费者身份和权益发放都尚未完成密码学绑定；
2. 经济上，把早期购买者承诺为原始股东或按利润分成，可能改变为受监管的金融安排，超出当前 Demo 的证明范围。

安全的最小闭环是：

```text
消费者钱包签名授权
  → 订单/批次证明带 nonce 和过期时间
  → 合约确认 purchase 状态
  → 一次性 feedback/contribution
  → 复检优先或服务额度
  → 撤销/争议仍保留历史事件
```

## 10. 白客修复优先级

### P0：比赛前必须修正的口径与门禁

- 页面、CLI 和路演统一标出 `demo/synthetic`、`待锚定`、`JEV adapter 未接入`；
- `accepted`、`partial`、`rejected`、`review` 不能用同一套“通过”文案；
- 所有关键证据增加来源等级、缺口、冲突、policy 版本和证据哈希；
- 将 `signatureValid` 明确标成 Demo 字段，生产入口禁止接受调用方布尔值；
- 为 `probe/execute` 增加超时和失败关闭说明，避免现场服务卡住；
- 网页、CLI 和观察台必须消费同一个 `VerificationResult`，不能由前端静态改写结论。

### P1：低改造试点必须补齐

- `EvidenceEnvelope` 运行时 schema、规范化哈希、批次图和重复事件检测；
- 厂家只读 Connector、设备/实验室公钥注册、密钥轮换、吊销和校准记录；
- 样品编号、封签、交接和报告签发主体绑定；
- 版本化 policy：阈值、单位、检测方法、有效期和适用产品都必须有 hash；
- 合约角色权限、EIP-712 授权、购买 nonce、消费者 scope 和贡献防重；
- 信誉记录支持撤销、争议、复检和时间衰减，服务 owner 不能直接抹除原始负面记录；
- JEV adapter 采用严格 schema、输入哈希、模型版本、超时、低置信度降级和回放测试。

### P2：生产化安全能力

- HSM/托管密钥、设备安全启动、远程证明和网关高可用；
- 多源交叉验证、随机抽检、独立复检和异常批次隔离；
- 合约形式化审计、权限多签、暂停机制、争议仲裁和安全升级流程；
- 隐私保护的选择性披露、承诺或零知识证明；
- 运行监控、告警、密钥泄露响应、审计日志保留和公开安全事件报告。

## 11. 安全验收门禁

队友提交下一版 Agent/合约时，至少要能通过以下反例：

1. 历史报告换批次：必须拒绝；
2. 重放同一设备事件：必须标记 replay；
3. 报告单位、方法或标准版本缺失：只能 `review`；
4. 生产方自报冒充第三方：来源等级不能升级；
5. JEV 输出“通过”但 Verifier 有硬失败：最终必须拒绝；
6. JEV 超时或模型版本未知：不能进入 `accepted`；
7. 同一购买重复反馈或重复贡献：必须幂等拒绝；
8. 服务 owner 撤销负面反馈：原始记录仍可查询；
9. 未授权地址写入合约：交易必须回滚；
10. 链上失败：链下结果保留，重试不能生成重复事件；
11. 网页和 CLI：同一输入必须返回同一 `VerificationResult`；
12. 所有“通过”都必须显示范围、来源和未覆盖项，而不是绝对真实性。

## 12. 当前决策

TruthPass 的核心不是“把厂家的数据自动搬上链”，而是把生产方、专业检测机构、设备和消费者 Agent 放到同一批次证据图上，并用不同权限的主体互相约束。低改造路线可以成立，但前提是明确：

- 厂家只需开放已有数据，不能绕过来源和权限模型；
- Agent 可以降低接入、解释和筛选成本，不能替代采样、检测和现实责任主体；
- JEV 可以减少自由文本幻觉，不能替代确定性验收；
- 区块链可以留下可复核的公共记录，不能单独证明提交内容真实；
- 消费者可以监督和共建公共信誉，比赛阶段先获得服务权益，不直接承诺金融收益。

本文件是 v0.6.0 的安全审计基线。后续任何 Agent、CLI、合约或网页改动，都应在变更说明中标记对应的攻击面是否已经关闭，并重新运行项目测试和反例验收。
