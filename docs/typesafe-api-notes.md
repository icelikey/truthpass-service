# TypeSafe API 接入说明

## 已确认

- API 入口：`POST https://api.typesafe.ai/v1/systemone`。
- 请求主体包含 `state`、`questions`，以及可选 `model`。
- question 类型包括 `noul`、`choice`、`score`；`choice` 使用 `criteria` 映射选项，`score` 使用按分数顺序排列的 `criteria` 数组。
- API key 通过 `Authorization: Bearer <API_KEY>` 发送。
- 默认模型为 `jev-latest`。

## 本地占位

真实密钥不写入仓库。复制 `.env.example` 为本地环境配置，并填写：

```text
TYPESAFE_API_KEY=
TYPESAFE_BASE_URL=https://api.typesafe.ai
TYPESAFE_MODEL=jev-latest
```

当前测试只验证请求结构和 key 位置，不发起真实网络请求；实际调用结果位于 `answers`。

## 与本项目 JEV 的关系

本项目的数据层/JEV Context 是业务事实上下文；TypeSafe 的 `state` 是把该上下文传给模型的请求字段。

生产、检测和消费者三个 Agent 后续分别生成自己的 `questions`，但不能让 TypeSafe 直接决定数据库写入、硬规则结果或信誉分。
