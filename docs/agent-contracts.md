# 三类业务 Agent JSON 合同 v1

本文件描述 Agent 层的输入/输出协议。生产、检测和消费者 Agent 已通过兼容接口接入 StepFun；合同和运行时校验以 `src/agents/contracts.ts` 为唯一实现来源。

## 输入

- 生产 Agent：仅接收 `production` JEV view。
- 检测 Agent：接收 `inspection` JEV view 和完整、已批准的 `PolicySnapshot`。
- 消费者 Agent：接收确定性证据卡、生产/检测 Agent 的结构化辅助线索和消费者问题，只返回证据卡中的 `selectedFactIds`。

所有输入携带 `schemaVersion: agent.input.v1`、role 和 batch 视图。

## 输出

- 生产/检测 Agent 输出带 `sourceIds` 的 findings，属于待复核辅助线索。
- 消费者 Agent 不输出自由文本事实，只返回证据卡中的 `selectedFactIds`。
- 最终消费者说明由确定性代码从证据卡生成，不能由模型新增事实。
- 不允许输出 `score`、`verdict`、`riskLevel` 等最终判断字段。
- 每条 finding 必须引用至少一个输入来源；缺失证据由确定性代码判断，不让模型自行填报。

## 权威边界

这些输出是有来源的候选解释，不是验证结论。只有确定性规则引擎能产生服务验收、批次质量、风险和信誉结果。合同校验只保证结构、角色、批次和来源 ID 一致，不能证明自然语言摘要语义上完全正确。

## 验收命令

```bash
npm run verify
npm run testbench:tools
```

本地合同面板路径为 `/agent-contracts`；只使用 `demo/synthetic` 数据，不需要 StepFun API Key。

## 浏览器验收记录（2026-10-07）

- 生产、检测、消费者反馈三种合法样例分别通过页面按钮调用的真实 HTTP 校验器。
- 伪造来源 ID、额外 `score` 字段、非法 JSON 分别被拒绝；重新载入样例后恢复正常。
- 正常交互期间未捕获页面脚本错误；已检查页面截图。
- 已修正页面状态消息三元表达式的引号错误；`test/testbench.test.ts` 对内联脚本做语法回归检查，纳入 `npm run verify`。这条测试不替代真实浏览器交互验收。
- Tabbit 旧标签附着失败后，通过默认新任务页恢复连接。继续操作时使用任务当前页或重新查询库存确认的标签 ID，不复用旧任务中的标签 ID；修改 HTML 后刷新合同页。
