#!/usr/bin/env node

/**
 * 最小消费者 Agent 适配示例。
 *
 * 用户自己的 Agent 不需要知道 TruthPass 的内部模块，只需要调用稳定的
 * JSON CLI 合同，再把结果翻译成用户能理解的建议。示例默认查询演示批次；
 * 生产环境应由 Agent 的意图解析层提供真实 batchId，并在下单前取得用户同意。
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(root, "bin", "truthpass.mjs");

function callTruthPass(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`truthpass ${args[0]} failed (${code}): ${stderr || stdout}`));
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (error) {
        reject(new Error(`truthpass returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  });
}

const batchId = process.argv[2] ?? "FO-2026-001";
const inspection = await callTruthPass(["inspect", "--batch", batchId, "--json"]);
const verification = inspection.verification ?? {};
const chain = inspection.chain ?? {};

console.log(JSON.stringify({
  userMessage: verification.status === "accepted"
    ? `${inspection.product?.name ?? "该商品"} ${batchId} 已通过当前公开验收规则。`
    : `${inspection.product?.name ?? "该商品"} ${batchId} 暂不建议购买，请先查看缺失证据。`,
  verificationStatus: verification.status ?? "unknown",
  score: verification.score ?? null,
  chainLifecycle: chain.lifecycle ?? "unknown",
  anchored: chain.anchored ?? false,
  nextAction: verification.status === "accepted" ? "show_evidence_then_ask_consent" : "request_more_evidence",
}, null, 2));
