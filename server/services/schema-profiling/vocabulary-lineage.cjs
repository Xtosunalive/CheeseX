// Component: vocabulary-lineage（ADR-007 波5 方案 B：词表来源血缘——蓝图词 vs 生长词）
// @responsible: 记录并读取「哪些词是经发现通道（discovery absorb）晋升的」——区分 origin。
//               蓝图单方声明的词 origin=blueprint（默认，缺省即蓝图）；经人裁定晋升的 origin=grown。
// @inputs: <TheSchema 目录>/vocabulary-lineage.json（resolveTheSchemaDir 解析——与 enums/fields 同域同权；
//          缺省=全蓝图，读取零失败——文件不存在返空账本）
// @outputs: readLineage(vaultPath) → { [dimension]: { [word]: { route, at } } }
//           recordGrowth(vaultPath, { dimension, word, route }) → 账本（追加式）
// @context: 仓库服务层。方案 B 只标注不删——删属 Master 内容裁定区。
// 语义边界：血缘是**记录**不是裁决——蓝图词本身不劣（规划词有意义），只是可区分展示。
// A1（数据域治理批）：原硬编码 vault 相对路径会在 vault 册外重建 知识库/TheSchema 目录
// （埋下 resolver 翻回 vault 主源的引线）——归位唯一解析点，写通道对齐 repo-schema-io。

const fs = require("node:fs");
const path = require("node:path");
const { resolveTheSchemaDir } = require("../../shared/theschema-root.cjs");
const { replaceTheSchemaFile } = require("../../shared/theschema-write.cjs"); // WP-079 唯一门：TheSchema 写通道由咽喉按落点选，服务侧禁自判


const LINEAGE_BASENAME = "vocabulary-lineage.json";
const DIMENSIONS = require("./profile-dimensions.cjs").map((dimension) => dimension.key); // SPEC-020 波 2：键集从维度单一定义派生

// 契约层字段名（discoveryEdit 的 field 值）→ 画像维度 key
const FIELD_TO_DIMENSION = {
  layers: "layer",
  categories: "category",
  subdomains: "subdomain",
  tags: "tag",
};

function lineagePath(vaultPath) {
  return path.join(resolveTheSchemaDir(vaultPath), LINEAGE_BASENAME);
}

// 读取血缘账本：文件缺失/损坏均返空账本（血缘是增强信息，不阻断读路径）。
function readLineage(vaultPath) {
  try {
    const raw = fs.readFileSync(lineagePath(vaultPath), "utf8");
    const parsed = JSON.parse(raw);
    const entries = parsed && typeof parsed.entries === "object" && parsed.entries !== null ? parsed.entries : {};
    const out = {};
    for (const dim of DIMENSIONS) out[dim] = {};
    for (const dim of Object.keys(entries)) {
      if (!DIMENSIONS.includes(dim)) continue; // 未知维度忽略（账本向前兼容）
      const rows = entries[dim];
      if (!rows || typeof rows !== "object") continue;
      out[dim] = { ...out[dim], ...rows };
    }
    return out;
  } catch (_error) {
    return Object.fromEntries(DIMENSIONS.map((dim) => [dim, {}]));
  }
}

// 记录生长词：幂等（同词重复晋升刷新时间戳，不追加垃圾行）。
// route: discovery-absorb（发现通道晋升）| manual-edit（人工直接编辑词表——不记，非通道行为）
function recordGrowth(vaultPath, input) {
  const dimension = String(input.dimension || "");
  const word = typeof input.word === "string" ? input.word.trim() : "";
  const route = typeof input.route === "string" ? input.route.trim() : "";
  if (!DIMENSIONS.includes(dimension)) throw new Error(`未知词表维度：${dimension}`);
  if (!word) throw new Error("血缘登记需要非空词值");
  if (!route) throw new Error("血缘登记需要 route");
  const lineage = readLineage(vaultPath);
  lineage[dimension][word] = { route, at: new Date().toISOString() };
  const payload = {
    schema_version: 1,
    _comment: "ADR-007 波5 方案B：origin 血缘账本——grown=经发现通道晋升，blueprint=蓝图单方声明（缺省）。只标注不删。",
    entries: lineage,
  };
  const target = lineagePath(vaultPath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  replaceTheSchemaFile(target, `${JSON.stringify(payload, null, 2)}\n`, { summary: "词表谱系（发现通道晋升登记）" }); // A1＋SPEC-023 波 3：血缘账本由发现通道全权再生成（只标注不删），落 TheSchema 仓内主源（git 即账）
  return { path: LINEAGE_BASENAME, dimension, word, route };
}

// join 到画像词对象：命中血缘 → origin=grown；未命中 → blueprint。
function withOrigin(words, lineageRows) {
  // WP-050 D1：血缘行表 null 原型——内容词条名（constructor 族）直取不可表达，回落 blueprint
  const rows = lineageRows && typeof lineageRows === "object" ? Object.assign(Object.create(null), lineageRows) : Object.create(null);
  return words.map((word) => {
    const record = rows[word.word];
    return record
      ? { ...word, origin: "grown", route: record.route, grownAt: record.at }
      : { ...word, origin: "blueprint" };
  });
}

module.exports = { LINEAGE_BASENAME, DIMENSIONS, FIELD_TO_DIMENSION, readLineage, recordGrowth, withOrigin };