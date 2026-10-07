# IoT 与质检统一协议服务器

## 作用

协议服务器把摄像头、传感器、实验室设备和物流网关的输出统一为 `EvidenceEnvelope`。设备可以使用 HTTPS Webhook、MQTT 网关或厂商 API；设备侧适配器只负责转成统一 JSON，服务器负责验签、批次绑定、去重、顺序校验和路由。

服务器不保存私钥，也不直接让 LLM 决定质量。流程是：

```text
设备/实验室 → POST /v1/evidence → 验签与幂等 → POST /v1/verify
                                           ↓
                                  JEV 路由 + 确定性验证器
                                           ↓
                                  Relayer 准备链上交易
```

## 接口

- `GET /health`：健康检查和协议版本。
- `POST /v1/issuers`：注册设备或实验室的 Ed25519 公钥。
- `POST /v1/evidence`：提交签名的 `EvidenceEnvelope` 和可选原始 payload。成功返回 `202`，拒绝返回 `422`。
- `POST /v1/verify`：提交任务与结构化检测结果，返回 JEV 决策、确定性验证结果和链上下一步动作。
- `GET /v1/batches/:batchId/evidence`：读取该批次已接收的证据摘要。

默认演示存储是追加式 JSONL，可通过 `TRUTHPASS_PROTOCOL_STORE` 指向持久卷。生产部署应替换为带唯一约束的数据库适配器，并把原始文件放到对象存储；链上只保存哈希和状态。

## 本地运行

```powershell
npm run protocol:server
```

默认监听 `0.0.0.0:8787`。通过 `TRUTHPASS_PROTOCOL_PORT` 修改端口，通过 `TRUTHPASS_PROTOCOL_STORE` 修改事件文件路径。远程工厂只需要访问 HTTPS 网关，不需要运行区块链节点；链上写入由受控 Relayer 单独完成。

## 安全边界

- 每台设备、实验室或工厂网关使用独立 `keyId`，吊销只影响该来源。
- `eventId`、`nonce`、`sequence` 和 `previousEventHash` 防止重放、乱序和断链。
- JEV 只能路由到补证据、复检或规则验证；最终通过/拒绝由确定性验证器产生。
- Relayer 私钥只能放在 KMS/HSM 或独立签名服务中，不能放在协议服务器请求体、Git 或前端。
