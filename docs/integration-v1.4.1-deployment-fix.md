# TruthPass 部署入口修订 v1.4.1

> 文档版本：v1.4.1
> 状态：当前生效
> 最近修改：2026-10-15
> 修改摘要：修复 `/web-demo/` 尾斜杠入口，并明确 Preview 保护与 Production 公开验收边界。
> 影响范围：Vercel 路由、公开验收、旧观察台回滚入口
> 队友下一步：在 Production 重新部署后，验证根页面、`/web-demo/` 和普通钱包主网交易。

## 当前结论

- Vercel Preview 开启 Deployment Protection，未登录的外部请求会看到 Vercel 登录页；这是部署访问控制，不是 TruthPass 应用错误。
- Preview 仍可由已授权的 Vercel 会话用于内部验证，公开评委入口使用 Production。
- Production 的 `GET /api/health` 和 `GET /api/chain/status` 可公开访问；钱包准备接口必须使用 `POST /api/wallet/prepare`。
- `/web-demo` 已可访问，本次增加 `/web-demo/` 到旧观察台首页的显式重写，避免尾斜杠访问返回 404。

## 验收边界

```text
公开入口：Production
内部预览：受 Vercel Deployment Protection 保护的 Preview
钱包交易：必须由用户钱包签名，不能由 Agent 或 BFF 代签
数据状态：当前鱼油批次仍标记为 demo/synthetic
```

## 验证命令

```powershell
Invoke-WebRequest https://truthpass-service.vercel.app/api/health
Invoke-WebRequest https://truthpass-service.vercel.app/api/chain/status
Invoke-WebRequest https://truthpass-service.vercel.app/web-demo/
```

钱包准备需要 POST JSON，并提供消费者公开地址：

```powershell
Invoke-WebRequest `
  -Method Post `
  -Uri https://truthpass-service.vercel.app/api/wallet/prepare `
  -ContentType 'application/json' `
  -Body '{"action":"purchase","batchId":"FO-2026-001","wallet":"0x..."}'
```

## 安全说明

本次不关闭 Vercel Deployment Protection，也不把 Preview 绕过令牌写入仓库、前端或交付文档。评委和公众应使用 Production 链接；队友调试受保护 Preview 时使用已授权的 Vercel 身份。
