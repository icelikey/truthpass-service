# TruthPass Agent 耦合安全审计（2026-10-22）

## 结论

当前 Agent 解释链已经可以真实运行：批次读取、确定性 Verifier、JEV 分流、模型解释、引用契约和安全回退均有本地测试与线上 SSE 证据。

这不等于整套“Agent + 钱包 + 链 + 协议”已经安全闭合。安全性只能分层判断：

1. **模型解释层**：当前采用 fail-closed，越界引用、跨批次引用、无 receipt 的成功表述会被拒绝或回退。
2. **确定性核验层**：Verifier 和 JEV 的职责边界可测试，但不能证明来源资料本身真实。
3. **协议与链写入层**：仍存在需要修复的身份、证据根绑定、撤销证据过滤和交易计划重建问题。

## 形式化模型

对批次 `B` 定义：

```text
E_B = 当前批次允许引用的证据集合
V(B, E_B) = 确定性 Verifier 结果
J(B, V) = JEV 路由决定
M(B, V, J, E_B) = 模型解释
C = 链上摘要、签名、事件和 receipt
```

安全耦合应满足以下不变量：

```text
I1  每个消费者结论只能引用 E_B 或明确登记的公开来源；不得跨批次。
I2  外部证据只有在可信 issuer、签名、nonce、sequence 和未撤销条件同时满足时才进入 E_B。
I3  JEV 只能选择路由，不能把 V 的 rejected/review 升级为 accepted。
I4  没有匹配的真实 receipt，不能从 anchor_pending 推导购买成功或已上链。
I5  链上 C 必须绑定同一 batch、evidenceRoot、task、policy、verifier 版本和结果哈希。
I6  状态只能沿 planned → submitted → receipt_verified 单调前进；争议只能沿 open → finding → approved → resolved 前进。
I7  tenantId、productId、batchId、evidenceId 必须处于同一命名空间并在服务端重算。
I8  Provider、RPC、数据库或并发协调故障必须 fail-closed，不能以旧状态冒充当前成功。
```

若这些不变量成立，模型最多只能解释 `V` 和 `C` 已证明的范围；它不能证明商品质量、疗效、来源真实性或机构诚信。

## 已验证证据

- 本地 `npm run typecheck` 通过。
- 本地 `npm run build` 通过。
- `npm test`：190/190 通过。
- 线上生产部署提交：`8d1bbdb`，状态 `READY`。
- 线上 `/api/agent/status?diagnostics=true`：`ready`、`model_assisted`、provider 已配置，敏感诊断为空。
- 线上一次 Agent SSE 已返回：
  - `provider=deepseek`
  - `model=deepseek-chat`
  - `modelAssisted=true`
  - `validationStatus=accepted`
  - `pipelineDetail.verifier.status=accepted`
  - `pipelineDetail.jev.decision=route_to_rule`
  - 当前批次 `FO-2026-001`
  - 当前批次证据引用 `ev-cold-chain-001`、`ev-inspection-001`、`ev-production-001`、`ev-production-002`
  - `dataMode=demo/synthetic`

这证明的是一次模型解释和契约校验成功，不是现实商品认证，也不是一次真实购买 receipt。

## 当前高风险项

### R1：协议服务器的 issuer 注册和证据批次边界

`/v1/issuers` 当前缺少足够的管理认证；证据 envelope 的批次字段存在调用方自报和多 subjectRefs 未全量一致校验的风险。需要预注册 issuer 或管理员认证，并由服务端重建、校验完整 subjectRefs。

### R2：evidenceRoot 与 verification request 不是一一绑定

链合约需要保证同一个 evidence root 只能对应唯一的 verification request、task、policy 和 result。替代记录还必须与原记录保持同一 batch/root 域，不能只检查 replacementId 存在。

### R3：证据根算法存在分裂

协议、CLI 和 API 不能各自计算不同的 root。根至少应承诺 event、payload、subject、issuer、状态、sequence、签名和批次；服务端必须重算并拒绝客户端自报 root。

### R4：撤销证据进入 JEV/Agent 的风险

JEV 上下文和 Agent role view 必须先排除 `revoked` 证据，或者显式标记并禁止引用。撤销后的证据不能继续参与推荐或“已通过”解释。

### R5：钱包准备和 receipt 确认必须由服务端重建

交易计划中的 evidenceRoot、requestId、taskHash、policyHash、resultHash、batchId、目标合约和 calldata 不能信任调用方原样提交。服务端应从已登记的 deterministic assessment 和 purchase quote 重建计划；receipt 事件需要逐字段核对业务 data，而不是只检查状态、to 和少数 topic。

### R6：持久化与并发仍需云上证明

内存 ledger、appendFile 和多请求并发不能证明重启恢复、nonce/sequence 原子性和跨实例幂等。生产环境需要数据库唯一约束、事务/CAS 或队列租约，并补充重启和十并发验收。

## 风险等级和处置

```text
模型编造结论       高    当前通过契约、引用白名单、数字守卫和确定性 fallback 缓解
跨批次引用         高    当前 Agent 层有拦截；协议/钱包输入仍需服务端统一重算
撤销证据复用       中高  需在 JEV/Agent 上下文入口过滤
伪造 issuer        高    需管理认证或预注册密钥
错误 receipt 绑定  高    需完整解析事件 data 并与服务端生成的计划逐字段比较
重复/竞态写入      中高  需持久化唯一约束、CAS/租约和重启测试
来源资料本身造假   不可由 Agent 证明，必须依靠真实机构、设备和现场审计
```

## 当前可安全宣称的范围

可以宣称：

- Agent 会读取当前批次上下文，并显示 Verifier、JEV、模型参与和引用依据。
- 模型输出不满足契约时会回退，不向用户发布未经校验的原文。
- `demo/synthetic`、`replay_verified`、`anchor_pending` 和真实 receipt 状态有明确区分。

不能宣称：

- 代码校验通过就等于事实真实。
- demo/synthetic 等于真实商品认证。
- `replay_verified` 或 `anchor_pending` 等于当前购买成功。
- Agent 可以替代机构签名、钱包确认或现场审计。

## 下一道安全门槛

在真实支付和生产试点前，必须补齐 R1、R2、R3、R5，并以属性测试验证：跨 root replacement 拒绝、同 root 多 request 拒绝、撤销证据不可进入 Agent、并发 append 只有一个成功、重启后 sequence/nonce 连续。
