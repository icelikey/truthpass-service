# TruthPass Agent 协作验收向量 v1.5.0

## 必须通过

- 正确批次返回 `accepted` 或 `accepted_with_scope`；
- 错批次、缺失证据、重复 nonce 和撤销机构证书失败关闭；
- 生产、检测和消费者 Agent 输入不能跨角色或跨批次；
- 模型输出包含 `score`、`verdict` 或未登记来源时被合同校验拒绝；
- 消费者 Agent 只能返回证据卡中的 `selectedFactIds`；
- 确定性 Verifier 是唯一质量结论来源；
- 没有真实 receipt 时不能返回 `mainnet_receipt_verified`；
- 不同租户不能互相读取注册记录和证据。

## 当前自动化验证

```powershell
npm run typecheck
npm test
```

当前结果：163 项测试通过。
