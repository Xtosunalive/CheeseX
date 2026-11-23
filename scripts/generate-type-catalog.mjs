#!/usr/bin/env node
// generate-type-catalog.mjs — 种类总目录再生成（WP-228／SPEC-101 §4.1）
// 用法：node scripts/generate-type-catalog.mjs [--check]
//   默认：写 contracts/generated/type-catalog.json（确定性输出——禁手改，重建两遍逐字节一致）
//   --check：与在册文件逐字节比对，不一致退出 1（CI/门禁口径）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = path.join(ROOT, "contracts/generated/type-catalog.json");
const { loadTypeCatalog } = require("../server/shared/type-contract/index.cjs");

const { catalog, error } = loadTypeCatalog(ROOT);
if (error) {
  console.error(`type-catalog: 编译失败（缺类级中文显示名或其他源错误）——${error}`);
  process.exit(1);
}
const text = JSON.stringify(catalog, null, 2) + "\n";

if (process.argv.includes("--check")) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, "utf8") : null;
  if (current !== text) {
    console.error("type-catalog: 与在册文件不一致——请再生成（node scripts/generate-type-catalog.mjs）后提交");
    process.exit(1);
  }
  console.log(`type-catalog=ok entries=${catalog.entries.length} pending=${catalog.meta.pending_dictionary_entries.length}`);
  process.exit(0);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, text);
console.log(`type-catalog: 写 ${path.relative(ROOT, OUT)} entries=${catalog.entries.length} pending=${catalog.meta.pending_dictionary_entries.length}`);
