import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const dist = join(root, "web", "dist");
const requiredFiles = [
  join(dist, "index.html"),
  join(dist, "legacy", "index.html"),
  join(dist, "legacy", "app.js"),
];

const missing = requiredFiles.filter((file) => !existsSync(file) || !statSync(file).isFile());
if (missing.length) {
  console.error("web build is missing required deployment artifacts:");
  for (const file of missing) console.error(`- ${file}`);
  process.exit(1);
}

console.log(`web build verified: ${dist}`);
