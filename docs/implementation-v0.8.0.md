# TruthPass 本地完整回放实现说明

> 文档版本：v0.8.0  
> 状态：本地回放已实现；真实链上提交仍关闭  
> 最近修改：2026-10-07  
> 修改摘要：增加 `replay` 命令、可验证的本地追加账本和统一 `VerificationResult` 传递，串起验证、锚定计划、购买、贡献、争议和替代事件。  
> 影响范围：CLI、本地演示、网页接入、测试与后续 BOT Chain 交接

## 目标

本版本将一条鱼油演示流程做成可重复的本地回放：

```text
EvidenceEnvelope（实验室 + 冷链）
  → verify
  → evidence anchor plan
  → purchase
  → contribution
  → dispute
  → supersede
```

回放先生成两条带 Ed25519 签名的鱼油证据事件，验证批次、payload hash、key registry、sequence 和 previousEventHash；然后让 JEV 确定性降级门输出 `route_to_rule_verifier`，再使用 `ServiceRegistry` 和确定性 `Verifier` 产生同一个 `VerificationResult`。`evidenceRoot` 来自证据事件集合，而不是前端临时拼接。后续网页或 API 不应另写一套质量判断规则。

## 运行

```bash
npm run truthpass -- replay --batch FO-2026-001 --json
npm run truthpass -- replay --batch FO-2026-001
npm run truthpass -- replay --batch FO-2026-001 --network testnet --json
```

示例输出的关键字段：

```json
{
  "schemaVersion": "truthpass.cli.replay.v1",
  "status": "anchor_pending",
  "verificationResult": { "status": "accepted", "score": 100 },
  "jev": { "decision": "route_to_rule_verifier", "modelAssisted": false },
  "anchor": {
    "status": "anchor_pending",
    "submitted": false,
    "txHash": null
  },
  "stages": {
    "verification": "accepted",
    "evidenceAnchor": "anchor_pending",
    "purchase": "created",
    "contribution": "created",
    "dispute": "raised",
    "supersede": "recorded"
  }
}
```

## 本地账本

`src/local-ledger.ts` 是演示用的内存追加账本，不是区块链替代品。每个事件包含：

- `sequence`：严格递增的事件序号；
- `previousEventHash`：前一事件哈希；
- `eventHash`：当前事件内容、前序哈希和时间的 SHA-256；
- `requestId`：与同一次锚定计划关联；
- `data`：该事件的最小业务承诺。

`verify()` 会重新计算每个事件的哈希和前序关系，并返回 `ledgerRoot`。如果任意事件被篡改，验证应失败。当前 `list()` 返回防御性拷贝，调用方无法绕过账本接口修改内部状态。

EvidenceEnvelope 另外通过 `src/evidence.ts` 进行规范化 JSON、payload hash、Ed25519 签名、key 状态、批次、时间、nonce 和顺序校验；它产生的 `evidenceRoot` 是后续 BOT Chain `anchorEvidence` 的输入。

## `anchor_pending`、`anchored`、`failed`

- `anchor_pending`：已完成链下验证并生成交易计划，但没有发送真实交易；本地回放和 `anchor --dry-run` 都属于此状态。
- `anchored`：只允许在真实交易 receipt 成功、目标合约和事件字段匹配、达到确认数后返回。
- `failed`：本地账本校验失败，或真实交易失败。链下验证结果仍应保留，不能静默丢弃。

本版本默认不会发送交易，也不会把本地 `ledgerRoot` 当作区块哈希。真实链适配由 `src/chain.ts` 和部署后的合约负责。

## 交接给链层和网页

链层需要将 `anchor` 对象中的计划转换成真实交易，并在 receipt 验证完成后回写：

```text
anchor.status = "anchored"
anchor.txHash = receipt.transactionHash
submitted = true
```

网页只消费 `replay` 或服务 API 的 JSON，至少展示：

1. `verificationResult` 的结论、分数和失败原因；
2. `anchor.status` 和交易哈希；
3. 本地/链上事件顺序；
4. 争议和替代记录，不删除原记录。

## 验证

```bash
npx tsx --test test/cli.test.ts test/e2e-replay.test.ts
npm run typecheck
npm test
```

CLI 与回放测试通过；当前完整测试为 31/31，`npm run typecheck` 通过，合约使用 solc 0.8.24 编译通过。
