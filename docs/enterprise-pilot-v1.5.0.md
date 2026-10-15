# TruthPass 白牌食品托管试点 v1.5.0

## 交付边界

首个试点只交付批次证据、确定性验证、证据卡和商品客服。自动支付、退款、健康数据和多链治理不属于首期验收范围。

试点规模固定为一个品牌、一个品类、1–3 个 SKU、一个工厂、一个检测机构、一条物流链和 1–3 个真实批次。

## 部署配置

Production Secret 中配置：

```text
AGENT_API_KEY
AGENT_BASE_URL=https://api.deepseek.com
AGENT_MODEL=deepseek-chat
DATABASE_URL
DATABASE_CA_CERT=<optional PEM CA chain>
DATA_BACKEND=postgres
TRUTHPASS_AGENT_GATEWAY_TOKEN
TRUTHPASS_AGENT_REGISTRATION_TOKEN
TRUTHPASS_PUBLIC_URL
TRUTHPASS_TRUSTED_ISSUER_KEYS
```

不要把 API Key、私钥、数据库密码或机构私钥写入 Git、前端或日志。

执行 `db/migrations/001_truthpass_enterprise_pilot.sql`，或允许服务首次启动时创建同名表。生产部署应由数据库迁移工具执行并记录版本。

## 企业接口

所有企业接口都要求：

```text
Authorization: Bearer <gateway-token>
X-TruthPass-Tenant: <tenantId>
X-TruthPass-Request-Id: <requestId>
```

接口：

```text
POST /api/tenants/{tenantId}/evidence/import
POST /api/tenants/{tenantId}/evidence/validate
GET  /api/tenants/{tenantId}/batches/{batchId}/evidence-card
GET  /api/tenants/{tenantId}/audit/export
POST /api/tenants/{tenantId}/evidence/{evidenceId}/revoke
```

`tenantId` 以认证头和路径交集为准，不信任请求体中的租户字段。导入以 `tenantId + evidenceId` 幂等；内容哈希、批次或商品不同则失败关闭。

## 证据和验证语义

- `payload` 只进入链下数据库；对外导出只返回 `payloadHash` 和 `rawObjectRef`。
- `inspection`、`cold_chain` 等机构证据必须有已注册公钥才能进入 `accepted_with_scope`。
- 缺失证据或签名未核验返回 `review`。
- 已撤销证据返回 `rejected`。
- `accepted_with_scope` 只代表当前证据门禁通过，不代表政府商品质量认证。

## 上线验收

1. 一个真实批次可导入并生成证据卡；
2. 错批次、重复 `evidenceId`、撤销证据和缺失证据均失败关闭；
3. 不同租户无法读取、验证或导出彼此数据；
4. 客服回答包含 `dataMode`、来源和追踪 ID；
5. 模型不可用时回退到确定性客服；
6. 审计导出不包含原始报告、用户地址或健康数据；
7. 企业可导出证据摘要、哈希、政策版本和审计事件。
