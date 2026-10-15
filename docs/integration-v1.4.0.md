# TruthPass v1.4.0 公共标准与消费者协议

> 文档版本：v1.4.0
> 状态：当前生效（基础模块）
> 最近修改：2026-10-15
> 修改摘要：合并 Agent/CLI/CFI 能力，增加受保护协作入口、确定性 Agent 兜底和持久化注册边界，并统一 Demo、回放与现场交易状态。
> 影响范围：协议类型、schema/hash、公共 API、消费者 Agent、跨品类政策注册
> 队友下一步：接入真实第三方机构签名、密钥注册与吊销检查，并把匿名反馈锚定到公开信誉回流流程。

> 连续性记录：风险基线见 [risk-assessment-v1.4.0.md](risk-assessment-v1.4.0.md)，下一版本路线见 [roadmap-v1.5.0.md](roadmap-v1.5.0.md)。这两份文档与本文件共同构成当前 v1.4.0 的项目事实和后续规划记录。

## 目标

v1.4.0 把 TruthPass 的公共入口从单一鱼油演示扩展为可发现、可核验、可跨品类注册的基础协议。鱼油规则继续保留，蜂蜜规则作为第二个公开样例，用于验证 ProductPolicy 不依赖单一品类。

## 已实现基础模块

- `src/standards/v1_4.ts` 提供 v1.4 schema 常量、RFC-8785 风格规范化 JSON 的 SHA-256 哈希、不可变读取的 ProductPolicyRegistry、公共标准文档和 CFI Manifest 构造器。
- `src/cli-reference/v1.ts` 提供 CLI 参考实现的商品、批次、验证、售后和订单准备 schema，以及可重复运行的鱼油演示注册表。
- 默认注册两条 active policy：`fish-oil-quality@v1` 和 `honey-quality@v1`。两者的 `dataMode` 仍为 `demo/synthetic`，不能当作真实认证。
- 匿名消费者凭证只保存 `subjectCommitment`、scope、时间和状态，不保存 nonce 或直接身份。反馈只接受批次号、评分、类别和证据哈希引用，并限制同一凭证对同一批次提交一次。
- 集成 API 新增：
  - `GET /api/cfi/manifest`
  - `GET /api/standards`
  - `GET /api/standards/policies`
  - `GET /api/standards/policies/{policyId}/{version}`
  - `POST /api/consumer/credentials`
  - `POST /api/consumer/feedback`
  - `GET /api/cli/explain?batchId={batchId}`
  - `POST /api/agent/v1/collaborate`（受保护的三类 Agent 协作入口）
  - `GET /api/cli/reference/manifest`
  - `GET /api/cli/reference/products`
  - `GET /api/cli/reference/products/{productId}`
  - `GET /api/cli/reference/batches/{batchId}`
  - `GET /api/cli/reference/batches/{batchId}/verification`
  - `GET /api/cli/reference/products/{productId}/assistant`
  - `POST /api/cli/reference/orders/prepare`

## CLI 参考实现 Demo 闭环

当前演示使用 HLN-FISH-OIL-001 商品和两个批次：

- FO-2026-001：四类证据摘要完整，返回 accepted_with_scope，订单状态为 prepared_pending_checkout；
- FO-2026-002：检测证据标记为无效，返回 rejected，不能进入购买准备。

订单准备只生成可交给 Checkout Adapter 的结构化请求，不代表支付、库存、配送或链上购买事件已经发生。链上状态保持 anchor_pending，只有真实钱包 receipt 和业务事件通过校验后才可升级。

## 公共结论边界

消费者 Agent 可以发现标准、解释证据和反馈协议，但不能自行宣布质量通过。最终状态仍来自确定性 Verifier、第三方机构以及人工或仲裁流程。CFI Manifest 只描述能力、schema、政策哈希和公共数据边界，不发布原始报告、个人信息或私钥。

## 哈希与幂等

- 公共对象使用递归排序的规范化 JSON 和 SHA-256，返回 `0x` 前缀十六进制哈希。
- `ProductPolicy` 以 `policyId:version` 作为注册键；同键内容改变会被拒绝。
- 匿名凭证由客户端 nonce 的承诺派生，服务端不保存 nonce；反馈由凭证、批次和反馈内容派生 `feedbackId`，同一凭证同一批次不能重复提交。

## 尚未完成

- 真实生产模式的第三方机构签名验证、密钥注册、nonce 防重放和吊销检查仍未替代演示兼容字段。
- 反馈的公共信誉回流、仲裁撤销和链上 receipt 尚未在本版本声称完成；当前 API 返回 `chainStatus: anchor_pending`。
- ProductPolicy 注册目前是进程内注册表，尚未接入持久化治理存储和多方审批；Agent 注册已支持可选 Postgres 持久化，但仍需企业租户、OIDC/mTLS 和权限审批。
- 匿名凭证、反馈和会话交易目前仍以进程内注册表为主；配置 Supabase/Postgres 后才能获得跨 Vercel 实例的持久化一致性。
- 真实非部署钱包的 `purchase → contribution → openChallenge` 主网现场交易仍需由评委钱包完成并回填 receipt。

## 验证

本地验收结果（2026-10-15）：

- `npm run typecheck`：通过；
- `npm test`：161 项通过；
- `npm run build`：通过，并确认 `web/dist/index.html`、`web/dist/legacy/index.html` 和旧观察台脚本均存在；
- 本机 `/`、`/web-demo`、CFI、标准、CLI explain、钱包准备和 Chain 677 状态接口：通过；
- 消费者钱包交易准备要求显式 wallet，purchase 指向 Consumer Gateway，dispute 指向 Audit Escrow 并携带最小质押值。

线上部署记录（2026-10-15）：Production 已发布到 [truthpass-service.vercel.app](https://truthpass-service.vercel.app/)，根页面和 `/web-demo` 均可访问。`/api/health`、`/api/agent/manifest`、`/api/cfi/manifest`、`/api/standards`、`/api/standards/policies`、`/api/cli/explain`、`/api/cli/reference/manifest`、`/api/chain/status` 和 `/api/wallet/prepare` 已通过线上探针；线上 API 返回版本 `1.4.0`、Chain ID `677`，钱包准备要求显式消费者地址。Preview 部署受 Vercel 登录保护，Production 作为公开验收入口。

线上交付边界：当前没有把任何历史回放或部署钱包交易当作新的普通钱包现场交易。`tx-confirm` 只有在真实 receipt、目标合约和业务事件全部匹配后才可返回 `mainnet_receipt_verified`；主网历史回放和当前样例证据仍标记为 `demo/synthetic`。真实非部署钱包的 `purchase → contribution → openChallenge` 主网现场交易仍需由评委钱包完成并回填 receipt。

