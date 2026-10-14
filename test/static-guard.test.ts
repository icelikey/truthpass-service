import assert from "node:assert/strict";
import test from "node:test";
import { resolveStaticFilePath } from "../src/static-path.js";
import { join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

// webRoot 必须是绝对路径：守卫内部 resolve 产出绝对路径，relative 比较才有意义
const WEB = resolve(tmpdir(), "static-guard-web");
const INSIDE = (result: string | null): boolean =>
  result !== null && (result === join(WEB, "index.html") || result.startsWith(WEB + sep));

// 安全不变量：任何 pathname 的解析结果，要么 null（拒绝），要么严格落在 webRoot 内（可服务）。
// 不对 normalize 的根级 ".." 收敛行为做具体断言——那属于实现细节，安全性质不依赖它。

test("安全不变量：全部穿越向量不逃逸出 webRoot", () => {
  const vectors = [
    "/../../package.json",
    "/..\\..\\package.json",
    "/../sibling-web/package.json",
    "/a/../../secret.txt",
    "/index.html\\..\\..\\server.mjs",
    "/assets/../../server.mjs",
    decodeURIComponent("/%2e%2e/%2e%2e/package.json"),
  ];
  for (const vector of vectors) {
    const result = resolveStaticFilePath(WEB, vector);
    assert.ok(
      result === null || INSIDE(result),
      "穿越逃逸: " + vector + " -> " + String(result),
    );
  }
});

test("无害路径正常解析", () => {
  for (const pathname of ["/", "/index.html", "/assets/app.css", "/assets/css/theme.css"]) {
    const result = resolveStaticFilePath(WEB, pathname);
    assert.ok(result !== null && INSIDE(result), "误拒: " + pathname);
  }
});

test("根路径解析为 index.html", () => {
  const result = resolveStaticFilePath(WEB, "/");
  assert.ok(result !== null && result.endsWith(join("web", "index.html")));
});

test("子目录深路径仍正常解析", () => {
  const result = resolveStaticFilePath(WEB, "/assets/css/theme.css");
  assert.ok(result !== null && result.includes(join("assets", "css", "theme.css")));
});
