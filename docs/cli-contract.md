# 真验 CLI 合同

> 文档版本：v0.9.1
> 状态：当前生效
> 最近修改：2026-10-08
> 修改摘要：补充面向消费者 Agent 的 `inspect` 综合查询合同，并对齐主网回执 manifest。
> 影响范围：CLI、消费者 Agent、主网回执、网页观察台、自动化测试
> 队友下一步：将 `demo/synthetic` 批次替换为带来源签名的现实 EvidenceEnvelope。

## 目标

CLI 是 Agent 接入真验的第一接口。它必须可脚本化、可审计、可离线回放，并与网页使用同一套任务、验收和证据模型。

## 命令分组

```text
discover        找商品、批次和候选服务
probe           探测服务当前可用性和能力
verify          执行确定性验收
explain         按受众解释验收结果
inspect         汇总商品、证据、验收、JEV 和主网回执
reputation      查询服务履约历史和撤销
consent         管理消费者最小授权
purchase        绑定购买证明和批次
feedback        提交一次性消费者反馈
anchor          将证据或结果哈希锚定到链上
```

消费者 Agent 的推荐调用顺序是：

```text
truthpass inspect --batch FO-2026-001 --json
truthpass recommend --batch FO-2026-001 --json
truthpass order --batch FO-2026-001 --json
```

`inspect` 是只读总览接口。它把 `verify` 的确定性结论和公开主网 manifest 合并成一个机器可读对象，便于 Agent 在一次调用中回答“这是什么、为什么可信、哪些信息已经上链、下一步能做什么”。它不会读取私钥，也不会发起链上写入。

`inspect` 的 `chain` 字段只引用公开回执元数据：Chain ID、合约地址、生命周期、四类业务交易哈希和 Explorer 链接。报告全文、图片、传感器明细和个人信息仍然不通过 CLI 默认输出。

最小输出结构如下：

```json
{
  "schemaVersion": "truthpass.cli.inspection.v1",
  "command": "inspect",
  "dataClass": "demo/synthetic",
  "product": { "name": "高浓度鱼油软胶囊" },
  "batch": { "id": "FO-2026-001", "batchId": "FO-2026-001" },
  "verification": { "status": "accepted", "verifierVersion": "deterministic-verifier-v1" },
  "evidence": { "evidenceHash": "0x...", "hash": "0x...", "mode": "demo/synthetic", "sourceMode": "demo/synthetic" },
  "jev": { "provider": "none", "route": "route_to_rule_verifier", "mode": "deterministic_fallback" },
  "chain": {
    "network": "bot-mainnet",
    "chainId": 677,
    "lifecycle": "anchored",
    "receipts": { "evidence": { "txHash": "0x..." } }
  },
  "publicDataBoundary": { "rawReports": "off_chain", "personalData": "off_chain", "privateKeys": "off_chain", "notes": ["链上只公开批次标识、证据哈希、验证结论和交易回执元数据", "原始检测文件、消费者身份和私钥不通过 CLI 输出", "demo/synthetic 不替代真实产线证明"] }
}
```

## 退出码

```text
0  accepted / accepted_with_scope
10 rejected
20 partial / missing_evidence
30 service_offline / timeout
40 invalid_input / schema_error
50 consent_or_purchase_required
60 chain_anchor_failed（链下结果仍保留）
70 internal_error
```

退出码只反映机器可判断的状态，详细原因放在 JSON 的 `reasons` 和 `nextAction`。

## 安全要求

- 所有写操作支持 `--request-id` 幂等重试；
- CLI 默认不打印个人信息、原始订单和完整报告；
- 设备/服务签名在工具层验证后才能进入验收器；
- CLI 不接受模型生成的“通过”作为可信结果；
- 网络或链上失败时保留可审计的链下结果，不静默重试造成重复事件；
- JSON 输出必须带 `schemaVersion`、`policyHash` 和 `dataClass`。

## 网页如何使用 CLI

网页只做三件事：发起预设命令、展示事件流、展开证据和链上记录。网页不能另写一套规则，也不能让前端直接把结果写入合约。
