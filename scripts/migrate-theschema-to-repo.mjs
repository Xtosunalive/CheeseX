#!/usr/bin/env node
// migrate-theschema-to-repo.mjs — SPEC-023 波 1 迁移件：vault TheSchema → repo data/theschema
// @responsible: 复制运行数据（排除 history/ 快照仪式区与系统噪音）＋产出逐文件 sha256 对账清单。
// @context: 窗口期 vault 仍为主源（resolver vault 优先）——本件只做「仓侧副本就位」，不做切换；
//           切换（移走 vault 副本）属波 2。重跑幂等（覆盖复制）。
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = process.argv[2] || path.join(process.env.VAULT_PATH || "", "知识库", "TheSchema");
const DEST = path.join(ROOT, "data", "theschema");
const MANIFEST = path.join(ROOT, "docs", "spec", "SPEC-023-波1-迁移对账清单.json");
const EXCLUDE_DIRS = new Set(["history"]); // 快照仪式区属 vault 遗产，波 2 封存——不入仓
const EXCLUDE_FILES = new Set([".DS_Store"]);

if (!fs.existsSync(path.join(SRC, "enums.yaml"))) {
  console.error(`源不存在或缺 enums.yaml：${SRC}（用法：node scripts/migrate-theschema-to-repo.mjs [srcDir]）`);
  process.exit(2);
}
const manifest = { source: SRC, destination: DEST, generatedAt: new Date().toISOString(), files: [] };
let copied = 0;
const walk = (dir, rel) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (EXCLUDE_FILES.has(e.name) || e.name.startsWith("._")) continue;
    const full = path.join(dir, e.name);
    const relPath = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(e.name)) continue;
      walk(full, relPath);
    } else {
      const dest = path.join(DEST, relPath);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const raw = fs.readFileSync(full);
      fs.writeFileSync(dest, raw);
      manifest.files.push({ path: relPath, sha256: crypto.createHash("sha256").update(raw).digest("hex"), bytes: raw.length });
      copied += 1;
    }
  }
};
walk(SRC, "");
manifest.files.sort((a, b) => (a.path < b.path ? -1 : 1));
fs.mkdirSync(path.dirname(MANIFEST), { recursive: true });
fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
// 零丢失自证：逐文件回读比对
const mismatch = manifest.files.filter((f) => {
  const again = crypto.createHash("sha256").update(fs.readFileSync(path.join(DEST, f.path))).digest("hex");
  return again !== f.sha256;
});
console.log(`迁移 ${copied} 文件 → data/theschema；对账清单 ${path.relative(ROOT, MANIFEST)}；回读不一致 ${mismatch.length}`);
process.exit(mismatch.length ? 1 : 0);
