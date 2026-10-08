# TruthPass（真验）

> 让真实被看见，让信任不再靠嘴说，而靠一条真正可验证的证据链。

TruthPass 正在构建一种新的生产与消费范式：消费者不再只是购买商品、被动接受结果，而是通过自己的 Agent，真正介入产品的生产、检测、交接与售后全过程。

当前以 **鱼油** 作为第一个 Demo 品类，跑通「AI 对话 → 推荐补货 → 溯源验证 → 链上锚定 → 消费者共建 → 检测报告」的完整闭环。未来可扩展到食品、保健品、农产品、药品与制造业等一切需要质量信任的供应链场景。

## 项目介绍

过去，生产者掌握数据，消费者只能相信品牌；当质量发生争议时，消费者既看不懂检测数据，也无法确认数据是否真实。

TruthPass 通过 **AI Agent + 物联网 + 区块链** 三重技术，把传感器、实验室、物流和消费者反馈连接成一条可验证的证据链：

- 设备产生真实数据；
- Agent 负责理解、验真与解释；
- 确定性规则负责质量判断；
- 区块链记录证据来源、批次关系、验证结果与责任交接。

消费者最终看到的，不再是一堆难以理解的检测指标，而是一份**可追溯、可复核、持续更新**的产品可信报告。

## 最终交付形态

一个自有 Agent 安装 CLI 后，即可完成「查询 → 推荐 → 下单」：

```text
truthpass inspect --batch FO-2026-001 --json
truthpass recommend --batch FO-2026-001 --json
truthpass order --batch FO-2026-001 --json
```

`inspect` 是只读总览接口，把确定性验收结论和公开主网回执合并成一个机器可读对象。网页观察台是这条能力链的可视化展示，与 CLI 共用同一套任务、验收与证据模型。

## 已实现能力

### 前端（`web/`）

- **TruthPass 鱼油助理**：接入 DeepSeek 上下文对话，支持语音输入与“思考中”提示。
- **全周期服务**：开场关心服用，用户说“补货/推荐/快吃完”时主动给出补货建议，卡片带专业知识，点击“补货”直接下单。
- **溯源验证**：初始只显示对话；触发批次查询后才展开三栏工作台（对话 + 产品卡 + 证据链路）。
- **多批次**：`FO-2026-001` 至 `010` 共 10 个批次，含未通过验收批次。
- **产品旅程与证据链路**：设备采集 → Agent 关联 → JEV 判别 → 规则验收 → 链上锚定，可展开技术详情。
- **CLI 技术观察台**：展示 `inspect` 命令视图、证据 Envelope、确定性验收 JSON 与链上锚定计划。
- **评委观察台**：服务排名、JEV、证据根哈希与链上状态。
- **检测报告**：一键导出 PDF。
- **消费者共建**：授权后的质量反馈。
- **账号与记录**：Supabase 登录注册；「我的记录」分开验证记录与补货记录，可一键清除。
- **IoT 模拟**：批次确定后可模拟正常温度 / 冷链异常 / 设备离线。

### CLI（`src/cli.ts`）

```text
discover  probe  verify  explain  inspect  recommend  order
reputation  consent  purchase  feedback  anchor  replay
```

CLI 可脚本化、可审计、可离线回放，是 Agent 接入真验的第一接口。

### 区块链（`contracts/` 与 `config/`）

- BOT Chain 主网接入与回执 manifest；
- 证据锚定合约与信誉/贡献事件合约；
- 链上只存批次标识、证据哈希、验证结论与交易回执元数据，原始报告与个人信息留在链下。

## 技术架构

| 层级 | 作用 |
| --- | --- |
| 物联网 / 设备 | 产生真实的温度、湿度、检测与物流数据 |
| AI Agent | 理解、验真、解释，把数据翻译成人话 |
| 确定性规则引擎 | 不掺水的质量判断，通过/拒绝由代码决定 |
| 区块链 | 记录证据来源、批次关系、验证结果与责任交接 |
| CLI | Agent 的第一接口，可脚本化、可审计 |
| Web 观察台 | 同一条验证链的可视化展示 |

## 核心规则

- 大模型只负责理解与解释；通过 / 拒绝、评分与防重复由确定性代码规则决定。
- 链上只存结果，不存隐私。
- 所有 `demo/synthetic` 数据仅用于路演与联调，不代表真实供应链证明。

## 运行

```bash
npm install
cp .env.example .env   # 配置 AGENT_*（DeepSeek 或 StepFun）、Supabase、SMTP 等

# 一键启动：构建前端 + 启动对接层，访问 http://localhost:4173
npm run start

# 开发模式：API（4173）+ Vite（5173，代理 /api -> 4173）
npm run api
npm run dev

# CLI
npm run cli -- inspect --batch FO-2026-001 --json

# 测试与类型检查
npm test
npm run typecheck
```

## 目录

```text
src/                  核心后端：verifier / registry / consumer / chain / cli / agents / data
api-server.ts          本地测试对接层：静态服务 + REST + 多批次演示数据 + DeepSeek 对话
bin/truthpass.mjs      CLI 入口
contracts/             链上合约
config/                BOT Chain 主网/测试网配置与回执
docs/                  架构、CLI 合同、部署与交接文档
web/                   前端（Vite + React + TypeScript）
web/src/components/    对话、产品、证据、共建、报告、账号等组件
web/public/assets/     图片素材与品牌 Logo
```

## 数据说明

演示数据标记为 `demo/synthetic`。缺证据代表暂时无法核实，不等同于产品不合格；模型提示也不替代确定性规则验收。
