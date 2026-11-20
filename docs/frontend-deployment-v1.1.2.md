# TruthPass 前端部署与钱包交互记录

版本：`v1.1.2`  
修改日期：2026-10-14  
范围：React C 端前端接入本地 BFF、钱包入口和 BOT Chain 主网交易准备。

## 本次修改

- 将 `truthpass-frontend.zip` 中的构建产物纳入 `web-frontend/dist`。
- BFF 新增 React 前端静态入口：
  - `http://127.0.0.1:4173/`
  - `http://127.0.0.1:4173/frontend/`
- 保留原钱包验收页：`http://127.0.0.1:4173/web-demo/`。
- 新前端增加钱包浮层，复用 `TruthPassConsumerGateway` 交易路径：购买、反馈、质疑均由用户钱包签名。
- 交易仍由 MetaMask / OKX / Binance 等 EIP-1193 钱包确认，前端不保存私钥。

## 当前链上配置

```text
Network: BOT Chain Mainnet
Chain ID: 677
Evidence Anchor: 0x0033462bee153cb9DF12b5c447b9C282DbfbE877
Consumer Gateway: 0x5192484B107E51EADFda4DBF4c9fFa41C03453F1
```

## 本地启动

```powershell
npm run start
```

`npm run start` 会先构建当前 `web/dist`，再启动集成 API 与 React 根页面。`npm run web:server` 仍保留给旧的 `web-frontend/dist` 观察台兼容入口，云主机发布当前根页面时不要使用它。

打开根路径后，右下角应出现 `TruthPass 钱包` 浮层。点击 `Connect Wallet`，再由用户在钱包弹窗中确认网络、目标合约和 Gas。

## 钱包弹窗卡住的原因

本地页面使用 `HTTP 127.0.0.1`，MetaMask 会先显示来源提醒。该提醒不代表合约地址错误；它要求用户先查看风险提示，再进入最终确认页。当前截图中的目标地址和 Chain ID 已匹配。最终交易确认必须由用户本人完成。

## 验证边界

- `receipt.status == 1` 仍不足以单独判定成功；页面还会校验目标地址和业务事件。
- 当前产品数据仍标记为 `demo/synthetic`。
- 根路径 React 前端已纳入本地服务；云主机部署仍需要公网主机、SSH 用户、端口和密钥路径。
