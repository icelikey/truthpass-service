#!/usr/bin/env node
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const tsx = join(root, "node_modules", "tsx", "dist", "cli.mjs");
if (!existsSync(tsx)) {
  console.error("未找到本地 tsx，请先运行 npm install。");
  process.exitCode = 70;
} else {
  const child = spawn(process.execPath, [tsx, join(root, "src", "cli.ts"), ...process.argv.slice(2)], { stdio: "inherit" });
  child.on("exit", (code, signal) => { process.exitCode = signal ? 70 : (code ?? 70); });
}

