#!/usr/bin/env node
// Component: Vocab-Load-Port-Existence-Gate（词表装载入口存在制断言——ADR-016 §六-1 判据1／SPEC-044 C3）
// @responsible: 全仓（JS＋Python）词表文件读取路径 ⊆ server/shared/vocab-load-port.cjs 的存在制执法。
//   不是登记制（不靠人登记合法读者后对账），是存在制（端口外出现即红）：
//   ① JS 面（生产代码）：五件 basename 与读取调用（readFileSync／readFile(／createReadStream／
//      fs.open(）同行共现即红；existsSync 存在性探测不算内容读取（theschema-root 解析阶梯合法探测面）。
//      已知限制（WP-053 V-C 收窄）：跨行间接读由词法追踪 lite 面拦截（单文件变量→读取调用）；
//      跨文件传递路径仍不拦（全程序分析不作——如实标注）。
//      测试面（__tests__/ 目录与 *.test.* 文件）不在此面——与 ADR-016 §一「9 处硬读旁路」同口径
//      （该基线本就不含 JS 测试 fixture 自读者）；后续批随端口测试工具统一收敛。
//   ② Python 面（生产＋测试）：.py 中五件 basename 出现即红——裁决目标态（Master 2026-10-31）
//      Python 不持有词表文件知识：数据经版本化信封进入，代码里连文件名都不该出现（含文案串与
//      存在性探测）；豁免只进基线。
//   ③ realpath 归一：scripts/vault-runtime ↔ server/vault-runtime 的 A 类 symlink 指向同一物理文件，
//      只按物理身份计一次；vault 侧封存归档副本不在仓内，天然不进扫描面（不误红）。
//   判据可一键复算：node scripts/quality/check-vocab-load-port.mjs（--collect 列全部命中供基线核对）；
//   代理指标（如只数 import 数、只数端口调用量）不得充当基线。
//   扫描范围：仓内 .js/.cjs/.mjs/.py（排除 node_modules/.git/dist/docs/.zcode）；
//   relations／subjects／article_associations 等其余 TheSchema 件不属五件判据
//   （ADR-016 第一切片范围；第二期文档装载扩面另核）。
// @inputs: 本仓文件面（无外部依赖）
// @outputs: stdout vocab_load_port=ok|FAIL（ok 附基线余量与失效日期）；非零退出＝端口外读取路径出现
// @context: Sync（CI 可跑）
//
// 豁免基线（ADR-016 §六-1：带失效日期，只减不增）：
//   · 键＝仓内相对路径，值＝该文件允许的命中数上限；命中数超上限＝红，低于上限＝合法收敛
//     （收敛后必须同批收紧数值，只减不增）。
//   · 起点＝2026-10-31 实测（--collect 复算核对）：JS 生产 5 文件 8 点＝ADR §一 9 点基线的 JS 部分
//     （第 9 点 pipeline-smoke.py 在 Python 面）；Python 生产 17 文件（14 内容读取文件〔实证清单 §四〕
//     ＋pipeline-runner 存在性/文案×4＋kb_paths 存在性探测×2＋_vault_ledger 文档串×1）＋测试 13 文件。
//   · 失效日期已过且基线仍有余量＝红（逼收敛，不许基线无限期滞留）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.VOCAB_GATE_ROOT
  ? path.resolve(process.env.VOCAB_GATE_ROOT)
  : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const VOCAB_BASENAMES = ["enums.yaml", "fields.yaml", "versions.yaml", "ontology.yaml", "dependencies.yaml"];
// 失效日期随基线走（contracts/vocab-load-baseline.json 的 expiresAt），此处不再手抄一份

// JS 面合法持有者：端口实现（读取只许发生在此）与执法面自身（检查器/测试自含词表字面量）
// PR-208 清债第二批：自身与配对测试件路径计算（此前手抄三行字面量——runtime-scope violations[].file 与 quality-gates testFiles 里的同串即因此处手抄）
// 模块物理位置自算仓根（不依赖 VOCAB_GATE_ROOT——沙箱改 ROOT 时名单仍指真实自身）
const MODULE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SELF_REL = path.relative(MODULE_ROOT, fileURLToPath(import.meta.url)).split(path.sep).join("/");
const PORT_REL = "server/shared/vocab-load-port.cjs";
const JS_ALLOWED_FILES = new Set([
  PORT_REL,
  SELF_REL,
  SELF_REL.replace("check-vocab-load-port.mjs", "__tests__/check-vocab-load-port.test.mjs"),
]);

// 豁免基线：值＝命中数上限（只减不增；收敛后同批降数/删行）
// L3（WP-049，2026-10-31）：Python 生产读面归零——schema_loader 换信封（下游 API 不动）、
// validate_graph 手抄回落删除、extract_graph 指纹折稳定指纹件、其余 14 生产文件全迁移；
// 117→31。余量三类＋测试 fixture 供数面：
//   · build-e2e-vault.mjs（夹具构建器，ADR-016 §一定性「性质另判」）
//   · archive-enums-legacy.py（lane=paused 多主体预留，Master 2026-10-17 裁决挂起非废弃——
//     复活须按新装载架构重设计，读写均走 Node 客户端）
  //   · kb_paths.py 探测已中性化（WP-052 T3：任一 yaml 探测——基线行退役，33→31）
//   · 测试面：fixture 写者（测试供数，非被测读面）——随测试面深化继续收敛
// ↓ 这份清单此前是本门禁文件里的手抄 map——PR-208 所记「执法清单是人工抄件」的一处，WP-084 消灭：
//   基线现住 contracts/vocab-load-baseline.json（生成物，--write 重算，禁手改）。
//   迁移只并源不并语义：文件→命中数上限、只减不增、低于上限须同批收紧、过期即红——判据一条未改，数值逐条保留。
const BASELINE_FILE = "contracts/vocab-load-baseline.json";

/** 读基线：夹具根（VOCAB_GATE_ROOT）无该文件时按空基线处理——任何端口外读取即红，比在册更严，不静默放行。 */
export function loadBaseline(root) {
  const abs = path.join(root, BASELINE_FILE);
  if (!fs.existsSync(abs)) return { entries: {}, expiresAt: null, source: "∅（无基线文件＝全严）" };
  const doc = JSON.parse(fs.readFileSync(abs, "utf8"));
  if (!doc || typeof doc.entries !== "object" || doc.entries === null) throw new Error(BASELINE_FILE + " 缺 entries 字段——生成物坏了，跑 --write 重算");
  return { entries: doc.entries, expiresAt: doc.expiresAt || null, source: BASELINE_FILE };
}

const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "docs", ".zcode"]);
const JS_READ_CALL = /readFileSync|readFile\(|createReadStream|fs\.open\(/;
const PY_EXTS = new Set([".py"]);
const JS_EXTS = new Set([".js", ".cjs", ".mjs"]);
const isJsTestFace = (rel) => rel.split("/").includes("__tests__") || /\.test\.(cjs|mjs|js)$/.test(rel);

function collectFiles() {
  const out = [];
  const realSeen = new Set();
  const walk = (absDir, relDir) => {
    let entries;
    try {
      entries = fs.readdirSync(absDir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") && entry.name !== ".") continue;
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        walk(path.join(absDir, entry.name), rel);
        continue;
      }
      if (!(JS_EXTS.has(path.extname(entry.name)) || PY_EXTS.has(path.extname(entry.name)))) continue;
      // realpath 归一：symlink（vault-runtime A 类）按物理身份去重
      let real;
      try {
        real = fs.realpathSync(path.join(absDir, entry.name));
      } catch {
        continue;
      }
      if (realSeen.has(real)) continue;
      realSeen.add(real);
      out.push({ rel, abs: path.join(absDir, entry.name) });
    }
  };
  walk(ROOT, "");
  return out;
}

/** WP-053 V-C 词法追踪 lite（单文件）：收集「变量＝含五件 basename 的路径表达式」赋值，
 *  之后该变量被读取调用引用即命中。跨文件传递路径仍不拦（全程序分析不作——限制如实标注头部）。 */
function trackVarReads(lines, rel) {
  const hits = [];
  const varSources = new Map(); // varName → basename
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) continue;
    // 赋值面：const/var/let X = <expr 含 basename>
    const assign = /(?:const|var|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?!=)/.exec(line);
    if (assign) {
      const found = VOCAB_BASENAMES.filter((basename) => line.includes(basename));
      if (found.length) varSources.set(assign[1], found[0]);
    }
    // 读取面：readFileSync(X)／readFile(X／createReadStream(X／fs.open(X
    const readCall = /readFileSync\s*\(\s*([A-Za-z_$][\w$]*)|readFile\s*\(\s*([A-Za-z_$][\w$]*)|createReadStream\s*\(\s*([A-Za-z_$][\w$]*)|fs\.open\s*\(\s*([A-Za-z_$][\w$]*)/.exec(line);
    if (readCall) {
      const varName = readCall.slice(1).find(Boolean);
      if (varName && varSources.has(varName) && !JS_ALLOWED_FILES.has(rel)) {
        hits.push({ where: `${rel}:${i + 1}`, found: [varSources.get(varName)], kind: "js-lexical" });
      }
    }
  }
  return hits;
}

function scan() {
  const hits = [];
  for (const file of collectFiles()) {
    const isPy = PY_EXTS.has(path.extname(file.abs));
    const isJs = JS_EXTS.has(path.extname(file.abs));
    if (isJs && isJsTestFace(file.rel)) continue; // JS 测试面不在执法面（与 §一 9 点口径一致）
    let text;
    try {
      text = fs.readFileSync(file.abs, "utf8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    if (isJs && !JS_ALLOWED_FILES.has(file.rel)) {
      hits.push(...trackVarReads(lines, file.rel)); // WP-053 V-C：词法追踪面（跨行旁路）
    }
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      const found = VOCAB_BASENAMES.filter((basename) => line.includes(basename));
      if (!found.length) continue;
      if (line.trim().startsWith("#")) continue; // 行注释不算（docstring 块算——文案也是知识）
      if (isJs) {
        if (JS_ALLOWED_FILES.has(file.rel)) continue;
        if (!JS_READ_CALL.test(line)) continue; // JS 只拦「basename×读取调用」共现
      }
      hits.push({ where: `${file.rel}:${i + 1}`, found, kind: isPy ? "py" : "js" });
    }
  }
  return hits;
}

function main() {
  const hits = scan();
  if (process.argv.includes("--collect")) {
    for (const hit of hits) console.log(`${hit.where}  [${hit.found.join(",")}]`);
    const files = new Set(hits.map((hit) => hit.where.split(":").slice(0, -1).join(":")));
    console.log(`total_files=${files.size} total_hits=${hits.length}`);
    return;
  }
  const byFile = new Map();
  for (const hit of hits) {
    const file = hit.where.split(":").slice(0, -1).join(":");
    byFile.set(file, (byFile.get(file) || 0) + 1);
  }
  // --write：以现场普查实算重算基线（生成物唯一合法产出路径，只在收账批用，CI 不带）。
  // 数值语义与手抄版一致：低于上限＝合法收敛，同批把上限收紧到实数（照本文件头部纪律）。
  if (process.argv.includes("--write")) {
    const prev = loadBaseline(ROOT);
    const doc = {
      generated_by: "npm run check:vocab-load-port -- --write",
      generator: SELF_REL, // PR-208：自路径计算
      schema_version: 1,
      expiresAt: prev.expiresAt || "2026-12-31",
      note: prev.source === "∅（无基线文件＝全严）"
        ? "词表装载存在制门禁的存量豁免基线（文件→命中数上限，只减不增；低于上限＝合法收敛须同批收紧）。生成物，禁手改。"
        : prev.note || "词表装载存量豁免基线（生成物，禁手改）。",
      entries: Object.fromEntries([...byFile.entries()].sort((a, b) => a[0].localeCompare(b[0]))),
    };
    fs.writeFileSync(path.join(ROOT, BASELINE_FILE), `${JSON.stringify(doc, null, 2)}\n`); // eslint-disable-line no-restricted-syntax -- 派生投影/工具产物（显式 --write 收账批；已在 runtime-scope write_primitive_allow 登记理由，同 check-ui-kit 先例）
    console.log(`vocab_load_port=baseline-written files=${byFile.size} hits=${[...byFile.values()].reduce((a, b) => a + b, 0)}`);
    return;
  }
  const { entries: BASELINE, expiresAt: BASELINE_EXPIRES } = loadBaseline(ROOT);
  const offenders = [];
  for (const [file, count] of byFile) {
    const cap = BASELINE[file];
    if (cap === undefined || count > cap) {
      for (const hit of hits.filter((h) => h.where.startsWith(`${file}:`))) {
        offenders.push(`${hit.where}（${hit.found.join(",")}）`);
      }
    }
  }
  if (offenders.length) {
    console.log(`vocab_load_port=FAIL violations=${offenders.length}`);
    for (const o of offenders.slice(0, 40)) console.log(`  ${o}`);
    console.log("  端口外词表读取路径出现（或超基线上限）——JS 收敛到 server/shared/vocab-load-port.cjs；Python 改吃信封（SPEC-044 C1/C2）");
    process.exit(1);
  }
  const expired = BASELINE_EXPIRES ? new Date(BASELINE_EXPIRES) < new Date() : false;
  const active = [...byFile].filter(([file, count]) => (BASELINE[file] ?? 0) >= count).length;
  if (expired && active > 0) {
    console.log(`vocab_load_port=FAIL baseline_expired=${BASELINE_EXPIRES} remaining_files=${active}（基线已过失效日期仍有余量——必须收敛）`);
    process.exit(1);
  }
  const used = [...byFile].reduce((sum, [, count]) => sum + count, 0);
  const total = Object.values(BASELINE).reduce((a, b) => a + b, 0);
  console.log(`vocab_load_port=ok baseline_remaining=${used}/${total} expires=${BASELINE_EXPIRES || "none（无基线文件＝全严）"}`);
}

main();
