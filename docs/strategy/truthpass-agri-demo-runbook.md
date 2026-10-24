# TruthPass 助农 Demo 执行手册 v0.1

## Demo 目标

用 7 分钟证明一件事：消费者不需要先相信广告，可以通过自己的 Agent 看懂一批农产品的生产记录、检测依据、运输状态、缺口和反馈如何回到下一批改进。

首版明确标记：

```text
DEMO / SYNTHETIC
演示资料不能替代真实商品认证
```

## Demo 数据

```text
租户：rice-demo
产品：大米
批次：RC-2026-001
状态：demo/synthetic
链：BOT Chain 677（演示/待上链状态）
```

页面入口：

```text
/sites/rice-demo
/sites/rice-demo/agent?batch=RC-2026-001
/sites/rice-demo/wallet?batch=RC-2026-001
/sites/rice-demo/merchant?batch=RC-2026-001
/sites/rice-demo/institution?batch=RC-2026-001
```

## 7 分钟演示脚本

### 0:00–0:40 扫码和首屏

操作：打开站点或扫描二维码，确认页面显示企业、商品和 `RC-2026-001`。

要说：

> 这不是商品广告页，而是一份当前批次的可核验记录。今天看到的是演示资料。

验收：`tenantId/productId/batchId` 与 URL 和页面一致。

### 0:40–1:50 让商品 Agent 自己查

问题：

```text
请告诉我这批大米从种植到出货有哪些记录，哪些是已核对的，哪些还缺？
```

用户看到：

```text
正在读取这批资料
正在检查检测和运输
JEV 已决定下一步
回答已生成
```

验收：每个 SSE 事件带 `traceId`、`batchId`、`dataMode`；回答包含“依据、还不确定、下一步”。

### 1:50–2:40 展开回答依据

点击“回答依据”，查看：

```text
引用证据 ID
证据来源和时间
Verifier 规则结果
JEV 路由
模型是否参与
数据模式
缺失和冲突
```

要说：

> 代码校验能拒绝越界回答，但不能替来源证明事实；所以来源、签名、规则和回执分开显示。

### 2:40–3:40 看农产品生命周期

依次打开：

```text
种植/投入品
→ 采收
→ 加工和包装
→ 检测
→ 仓储和运输
→ 消费反馈
```

每个阶段显示：状态、来源、更新时间、验证方式、缺口和责任方。

验收：缺失冷链或检测资料时进入 `review`/`request_more_evidence`，不能被 Agent 说成“全部合格”。

### 3:40–4:30 问“为什么可以/不可以推荐”

问题：

```text
为什么你现在不能直接说这批大米绝对安全？下一步需要谁补什么？
```

正确回答方向：

```text
当前只能解释已登记和已核对的项目；缺少的项目保持未知；生产方/检测机构补齐后重新核验。
```

错误回答必须被拦截：

```text
绝对安全、官方认证、治病、已经真实上链、交易已经成功
```

### 4:30–5:20 模拟购买边界

打开钱包页，先展示：

```text
只读查看无需钱包
写入/购买需要外部钱包
当前是 demo/synthetic
anchor_pending 不是购买成功
```

Demo 可使用准备交易或本地模拟确认，但必须标记 `SIMULATED`，不能显示真实 receipt。

### 5:20–6:20 提交反馈

输入结构化反馈：

```text
包装是否完整
到货是否及时
煮饭体验
口感/香味
问题类别
```

Demo 中显示“待购买凭证绑定”或“模拟购买凭证”，不能凭勾选“我已购买”伪造真实购买。

### 6:20–7:00 企业看到改进建议

打开企业页，展示：

```text
样本量
问题类别聚合
证据 ID
建议改进方向
待企业确认的任务
```

结束语：

> 消费者贡献的是可核验的使用反馈，生产者确认后把它变成下一批的改进任务；Agent 负责解释和汇总，规则、机构和钱包负责确认事实。

## Demo API 验收清单

```text
GET  /api/public/batches/RC-2026-001/overview
GET  /api/recommendation?batchId=RC-2026-001
GET  /api/products/RC-2026-001/lifecycle
POST /api/agent/chat
GET  /api/public/batches/RC-2026-001/purchase-quote
GET  /api/feedback/summary?batchId=RC-2026-001
```

`POST /api/agent/chat` 的 SSE 至少检查：

```text
begin
reading_batch
verifier_checked
jev_routed
model_started
model_completed
meta
line
done
```

`meta` 至少检查：

```text
traceId
batchId
evidenceIds
pipeline.verifier
pipeline.jev
provider/model/modelAssisted
validationStatus
chainContext
 dataMode
```

## Demo 放行标准

### 必须通过

- 首页三秒内说明“看商品批次记录和依据”；
- URL 批次不会在 Agent、钱包和企业页丢失；
- 错批次不会回退到默认批次；
- Agent 能明确说出资料缺口；
- 回答依据可展开；
- `demo/synthetic` 和 `anchor_pending` 一直可见；
- 没有 receipt 时不出现“已购买/已上链”；
- 反馈不能绕过购买绑定；
- 企业改进报告只读本企业、本商品、本批次聚合数据。

### 不得作为 Demo 证明

```text
HTTP 200
单元测试通过
历史回放交易
钱包弹窗出现
静态页面存在
模型配置存在但没有 SSE 原文
```

## 从 Demo 到真实试点

```text
D0：合成大米演示和页面逻辑
D1：真实生产主体 + 一批真实资料
D2：检测机构签名和人工复核
D3：外部钱包小额测试支付
D4：真实购买凭证 + 反馈贡献 receipt
D5：下一批次改进前后对比
```

每个阶段都要保留：页面截图、API 请求/响应、测试输出、已知限制。

## 下一步工程拆分

1. 将 `rice-demo` 的演示字段替换为农业专用 `agri.production.v1`、`agri.inspection.v1`、`agri.logistics.v1`；
2. 在总览接口中增加地块、投入品、采收、仓储和检测方法的公开摘要；
3. 复用现有 Agent SSE 和安全契约，增加“农业证据类别”引用；
4. 接入一个真实检测机构的报告和签名；
5. 执行一次用户确认的 BOT Chain 677 小额交易；
6. 用真实 `purchaseId` 解锁反馈 prepare/confirm；
7. 输出第一版企业改进报告，再决定是否增加现金/优惠激励。
