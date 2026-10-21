# TruthPass 平台首页 v4 视觉基准

`01-platform-home-v4-generated.png` 是 2026-10-22 重新生成的平台首页封面基准，用来校准首页的第一屏层级：

- 左侧先说明“从生产到购买的一份商品记录”；
- 批次查询是第一个动作；
- 右侧只保留产品与生产、检测、运输、购买的证据路径；
- 使用墨黑、午夜蓝、宣纸色、朱砂和旧金；
- 不使用技术控制台、RPC、合约地址或 Hash 作为首屏信息。

图片只用于视觉验收。生产页面继续使用语义 React、CSS、可访问表单和真实路由，不把整张图片当作交互页面背景。

当前对外首页：`https://truthpass-service.vercel.app/`

当前批次查询入口：

- `FO-2026-001` → `/sites/fish-oil-demo/agent?batch=FO-2026-001`
- `RC-2026-001` → `/sites/rice-demo/agent?batch=RC-2026-001`
