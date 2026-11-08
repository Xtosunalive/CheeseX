#!/usr/bin/env node
// Component: gen-readiness-required（required 段生成器——WP-132/ADR-015 对账变投影）
// @responsible: fields.yaml（语义源）→ contracts/entity-readiness-rules.json 的 article.required
//   段（消费契约的生成段；control/optionsKey 等手写元数据原样保留）。接线：pre-commit 钩子
//   theschema_touched 块（fields.yaml 改动即重算——与 entity-frontmatter-schema.md 同款纪律）；
//   新鲜度执法＝check-fields-registry 第五面（与生成器同谓词）。
// 用法：node scripts/quality/gen-readiness-required.mjs            # --check 语义（漂移 exit 1）
//       node scripts/quality/gen-readiness-required.mjs --write    # 重算入盘
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { computeRequiredSegment, applyRequiredToRules } from "./shared/readiness-required.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIELDS_DIR = path.join(ROOT, "data", "theschema");
const RULES = path.join(ROOT, "contracts", "entity-readiness-rules.json");

// ADR-016 §四-2：词表装载唯一宿主——fields.yaml 经 vocab-load-port 读（裸读即旁路，vocab-load-port 门禁红）
const require = createRequire(import.meta.url);
const { readVocabDoc } = require("../../server/shared/vocab-load-port.cjs");

const writeMode = process.argv.includes("--write");
const fieldsDoc = readVocabDoc(FIELDS_DIR, "fields", null) || {};
const required = computeRequiredSegment(fieldsDoc.fields);
const rules = JSON.parse(fs.readFileSync(RULES, "utf8"));
const { rules: next, changed } = applyRequiredToRules(rules, required);

if (!writeMode) {
  if (changed) {
    console.error(`readiness_required=DRIFT——article.required 与 fields.yaml 漂移（现值 ${JSON.stringify(rules.article?.required ?? null)} → 应为 ${JSON.stringify(required)}）。重跑 node scripts/quality/gen-readiness-required.mjs --write`);
    process.exit(1);
  }
  console.log(`readiness_required=ok required=${required.length}`);
  process.exit(0);
}
if (!changed) {
  console.log(`readiness_required=ok（已一致，未写）required=${required.length}`);
  process.exit(0);
}
fs.writeFileSync(RULES, JSON.stringify(next, null, 2) + "\n");
console.log(`readiness_required=written required=${required.length} → ${path.relative(ROOT, RULES)}`);
