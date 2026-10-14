// 静态文件路径守卫：把 URL pathname 解析到 webRoot 内的绝对路径；越界返回 null。
// 必须用 relative() 判定而不是 startsWith 前缀匹配——前缀匹配可被兄弟目录绕过
// （如 WEB 为 .../web 时，.../web-evil/x 也能通过前缀检查）。
import { isAbsolute, join, normalize, relative, resolve } from "node:path";

export function resolveStaticFilePath(webRoot: string, pathname: string): string | null {
  const filePath = resolve(pathname === "/" ? join(webRoot, "index.html") : join(webRoot, normalize(pathname)));
  const rel = relative(webRoot, filePath);
  if (rel.startsWith("..") || isAbsolute(rel)) return null;
  return filePath;
}
