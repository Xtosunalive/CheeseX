#!/usr/bin/env node
// Component: Fields-Dictionary-Gate（字段字典卫生门禁）
// @responsible: PR-156 刀四——字典是必填轴与值域的单一事实源（SPEC-020/023），却无机器卫生规则：
//   同名跨域重载（status 实体/文章两义）合法但同域重复必须拦；空值域（title 此前无 value_domain）
//   让字典页显示空白、补齐表单无选项；enum 类型指 free 属于声明矛盾。
// 检查面：
//   ① 类内 name 唯一（WP-195 v2 类属主——身份＝(类,name)；跨类同名合法且是两个独立属性，同类重复红）
//   ② 每属性必有 value_domain.source（free 合法且须显式——空值域即红）
//   ③ type=enum 必须非 free source（enum 却无闭合来源=声明矛盾）
//   ④ required ∈ {是, 否, 建议}
//   ⑤ display 绑定声明：非空且 ≤40 字符（BKN DisplayName 惯例）；keys 段三键闭合于类属性集；
//      value_domain.source 引用闭合（free/versions 或 enums.yaml 顶层段名——被引用段删除保护）
//   ⑥ 白名单字面量表禁入 server/src 面（WP-138 R2／PR-250）——EDITABLE 命名＋new Set([字段名字面量…])
//      形状即红；唯一持有方＝server/shared/field-policy.cjs（谓词派生，登记在下方豁免位）。
//      判据双保险：形状要求「数组字面量元素」，派生式（Object.keys/spread 展开入 Set）天然不命中。
// @inputs: data/theschema/fields.yaml（仓内主源，SPEC-023）＋ server/ 与 src/ 源码面（面⑥）
// @outputs: stdout fields_dictionary=ok|FAIL；非零退出 = 违规
// @context: Sync（CI 可跑）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import YAML from "yaml";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const FIELDS_PATH = path.join(ROOT, "data", "theschema", "fields.yaml");

// ── 面⑥ 豁免登记位 ──
// 白名单谓词的声明模块自身就是字段的合法声明处（它的存在正是为了消灭抄本），
// 以仓库相对路径登记；其余任何文件出现白名单字面量表形状即红。
// 豁免须附理由（登记处即理由），摘除豁免＝该文件不再持有声明（届时同步摘行）。
const WHITELIST_LITERAL_EXEMPTS = new Set([
  "server/shared/field-policy.cjs", // 字段白名单谓词单点（WP-138 R2）——诊断/写门/渲染三 view 的声明处本身
]);

const violations = [];
function fail() {
  console.log(`fields_dictionary=FAIL violations=${violations.length}`);
  for (const v of violations.slice(0, 20)) console.log(`  ${v}`);
  process.exit(1);
}

if (!fs.existsSync(FIELDS_PATH)) {
  console.log("fields_dictionary=FAIL violations=1");
  console.log("  [结构] data/theschema/fields.yaml 不存在（仓内主源缺失，SPEC-023）");
  process.exit(1);
}
// WP-053 V-A：fields 经装载端口（raw 同旧裸 parse；缺件 fail-closed 面——上方 existsSync 已先拒）
const doc = createRequire(import.meta.url)("../../server/shared/vocab-load-port.cjs").readVocabDoc(path.dirname(FIELDS_PATH), "fields", null) || {};
const classes = (doc && typeof doc.classes === "object" && doc.classes) || null;
if (!classes || !Array.isArray(classes.entity?.properties) || !Array.isArray(classes.article?.properties)) {
  console.log("fields_dictionary=FAIL violations=1");
  console.log("  [结构] fields.yaml 非 v2 类属主形态（缺 classes.entity/article.properties）");
  process.exit(1);
}

// value_domain.source 引用闭合的合法来源集（free/versions＋enums.yaml 顶层段名——被引用段删除保护由此挂账）
const enumsTop = createRequire(import.meta.url)("../../server/shared/vocab-load-port.cjs").readVocabDoc(path.dirname(FIELDS_PATH), "enums", null) || {};
const legalSources = new Set(["free", "versions", ...Object.keys(enumsTop && typeof enumsTop === "object" ? enumsTop : {})]);

const propCount = { entity: 0, article: 0 };
for (const cls of ["entity", "article"]) {
  const seen = new Map(); // name → display（类内唯一）
  for (const f of classes[cls].properties) {
    const name = f?.name || "(无名)";
    propCount[cls] += 1;
    if (seen.has(name)) violations.push(`[同类重复] ${cls}.${name} 出现两次（此前 display：${seen.get(name)}）——类内唯一（OpenBKN Name 形态）；跨类同名合法`);
    else seen.set(name, f?.display || "");
    const display = f?.display;
    if (typeof display !== "string" || !display.trim()) violations.push(`[缺绑定] ${cls}.${name} display 缺失——中文绑定声明是 schema 层显式承诺（WP-195），非 UI 装饰`);
    else if (display.length > 40) violations.push(`[超长绑定] ${cls}.${name} display ${display.length} 字符 >40（BKN DisplayName 惯例）`);
    const src = f?.value_domain?.source;
    if (!src) violations.push(`[空值域] ${cls}.${name} 无 value_domain.source（free 合法但须显式——字典页空白/补齐表单无选项的根）`);
    else {
      if (!legalSources.has(src)) violations.push(`[引用悬空] ${cls}.${name} value_domain.source='${src}' 不在 enums.yaml 顶层段/free/versions（引用闭合）`);
      if (f?.type === "enum" && src === "free" && !f?.value_domain?.note) {
        violations.push(`[声明矛盾] ${cls}.${name} type=enum 却 source=free 且无注记（enum 须闭合来源；确属外部机制自有值集时以 note 记据豁免）`);
      }
    }
    if (!["是", "否", "建议"].includes(f?.required)) violations.push(`[必填枚举] ${cls}.${name} required='${f?.required}' 不在 {{是,否,建议}}`);
  }
  // keys 段闭合（三键 ∈ 类属性集）
  const names = new Set(seen.keys());
  const k = (doc.keys && doc.keys[cls]) || {};
  for (const slot of ["primary", "display"]) {
    if (!k[slot]) violations.push(`[keys 缺槽] ${cls}.${slot} 未声明（BKN Keys 小节——primary/display 必备）`);
    else if (!names.has(k[slot])) violations.push(`[keys 悬空] ${cls}.${slot}='${k[slot]}' 不在 ${cls} 类属性集`);
  }
  if (k.incremental && !names.has(k.incremental)) violations.push(`[keys 悬空] ${cls}.incremental='${k.incremental}' 不在 ${cls} 类属性集`);
}

// ── 面⑥：白名单字面量表禁入 server/src 面（WP-138 R2／PR-250）──
// 形状判据：EDITABLE 命名的赋值 + `new Set([`（数组字面量开头）→ 收集到闭合 `])` 为止，
// 块内含 ≥1 个字符串字面量元素即判「白名单字面量表」。派生式（new Set(Object.keys(...))／
// new Set([...spread])）无数组字面量元素，天然不命中；豁免位见 WHITELIST_LITERAL_EXEMPTS。
const WHITELIST_SCAN_DIRS = ["server", "src"];
const WHITELIST_SCAN_EXT = new Set([".cjs", ".js", ".mjs", ".ts", ".tsx", ".jsx"]);
const WHITELIST_SKIP_DIRS = new Set(["node_modules", "dist", "coverage", ".git"]);
const ASSIGN_SHAPE = /[\w$]*EDITABLE[\w$]*\s*=\s*new\s+Set\(\s*\[/;

function collectSources(dir, out) {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (_e) { return; }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (WHITELIST_SKIP_DIRS.has(ent.name)) continue;
      collectSources(full, out);
    } else if (WHITELIST_SCAN_EXT.has(path.extname(ent.name))) {
      out.push(full);
    }
  }
}

const scanRoots = WHITELIST_SCAN_DIRS.map((dir) => path.join(ROOT, dir));
const sourceFiles = [];
for (const root of scanRoots) collectSources(root, sourceFiles);
for (const file of sourceFiles) {
  const rel = path.relative(ROOT, file).split(path.sep).join("/");
  if (WHITELIST_LITERAL_EXEMPTS.has(rel)) continue;
  let lines = [];
  try { lines = fs.readFileSync(file, "utf8").split("\n"); } catch (_e) { continue; }
  for (let i = 0; i < lines.length; i++) {
    if (!ASSIGN_SHAPE.test(lines[i])) continue;
    // 收集赋值块至闭合 `])`（上限 80 行防跑飞）；块内字符串字面量元素即字段名清单
    const chunk = [];
    for (let j = i; j < Math.min(i + 80, lines.length); j++) {
      chunk.push(lines[j]);
      if (j > i && /\]\s*\)/.test(lines[j])) break;
    }
    const literals = [...chunk.join("\n").matchAll(/["'`]([\w$][\w$/-]*)["'`]/g)].map((m) => m[1]);
    if (literals.length > 0) {
      violations.push(
        `[白名单字面量表] ${rel}:${i + 1} EDITABLE 命名＋new Set([字段名字面量…])（${literals.length} 项）——` +
        `字段白名单唯一持有方＝server/shared/field-policy.cjs，消费方一律调谓词（WP-138 R2）；` +
        `派生式写法（如 new Set(Object.keys(...))）不受此限`
      );
    }
  }
}

if (violations.length === 0) {
  console.log(`fields_dictionary=ok entity=${propCount.entity} article=${propCount.article}（类内唯一＋display 绑定≤40＋值域引用闭合＋enum 闭合＋必填枚举合法＋keys 闭合＋白名单字面量表禁入 server/src）`);
} else fail();
