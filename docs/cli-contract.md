# 真验 CLI 合同草案

> 文档版本：v0.4.0  
> 状态：草案，等待 Agent/后端实现  
> 最近修改：2026-10-06  
> 修改摘要：定义消费者 Agent 的 CLI 命令、JSON 输出、退出码和安全边界。  
> 影响范围：CLI、API、网页调用、自动化测试  
> 队友下一步：实现命令解析和 schema 校验，并补充一条 CLI 回放测试。

## 目标

CLI 是 Agent 接入真验的第一接口。它必须可脚本化、可审计、可离线回放，并与网页使用同一套任务、验收和证据模型。

## 命令分组

```text
discover        找商品、批次和候选服务
probe           探测服务当前可用性和能力
verify          执行确定性验收
explain         按受众解释验收结果
reputation      查询服务履约历史和撤销
consent         管理消费者最小授权
purchase        绑定购买证明和批次
feedback        提交一次性消费者反馈
anchor          将证据或结果哈希锚定到链上
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
