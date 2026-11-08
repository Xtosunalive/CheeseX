#!/usr/bin/env node
// Component: Theme-Contract（结构审计合并批 2026-10-20）
// @responsible: 视觉主题契约单门禁——token 卫生＋词表消费两面一台（原 theme-token-hygiene 与
//               theme-vocab 同守 docs/design/theme-contract.md 一份契约，两台合一减密度，覆盖不减）。
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
// 三消费者 retired 语义对齐（WP-145 波4）：theme-token-hygiene/theme-vocab 两注册表行 retired 后
// 其 npm 别名按账物分离删除，包装面改直连物理脚本（与 check-navigation 包装 action-routing 同形态）。
const subs = ["theme-token-faces.mjs", "theme-vocab-faces.mjs"];
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
let failed = null;
for (const cmd of subs) {
  const r = spawnSync(process.execPath, [path.join(scriptDir, cmd)], { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0 && !failed) failed = cmd;
}
if (failed) { console.error(`theme_contract=FAIL（${failed} 面）`); process.exit(1); }
console.log("theme_contract=ok faces=2（token 卫生＋词表消费——原两台合一）");
