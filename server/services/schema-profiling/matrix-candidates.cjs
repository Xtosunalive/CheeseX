// Component: Matrix-Candidates（PR-088 接线一·生长框架缺线）
// @responsible: 子域×类别组合候选——实体存量现算＋观察账本史（check-taxonomy-growth 落的
//               data/taxonomy-observations.jsonl）加持，供裁定通道（absorb field=policy）晋升进
//               subdomain_constraints。只收双方均为正式词（子域∈subdomains；类别∈声明表∪派生并集——
//               立契期孤儿词经配对入矩阵收敛）且尚未在矩阵 allow 的组合——野生新词先走词表晋升通道，
//               本模块只做「组合裁定」一层。
// @inputs: vaultPath＋enumsData（读侧规则单源 buildRuleSet 派生——矩阵配置期 archCategories=并集）
// @outputs: { stage: "observe"|"configured", candidates: [{subdomain, category, domainId, occurrences,
//            rounds, total, firstSeen, sampleFiles}] }（R2 响应即弃；按 total 降序）
// @context: ADR-006 生长序列②沉淀期「--audit 输出即候选矩阵原料」——原料经本模块进候选管线，
//           与野生 tag/子域同通道裁定；ADR-007 双通道（词表晋升＋组合裁定）正交分层。
const fs = require("node:fs");
const { makeId, idParts } = require("../../shared/identity-port.cjs"); // WP-051 身份入口
const path = require("node:path");
const { buildRuleSet } = require("../../shared/enums-loader.cjs");
const { scanEntities } = require("../entity-compliance/entity-source-scanner.cjs");

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function observationLedgerPath() {
  return process.env.TAXONOMY_OBSERVATIONS_FILE || path.join(REPO_ROOT, "data", "taxonomy-observations.jsonl");
}

/** 观察账本史（按 vault 归账）：key "sd|cat" -> {first, rounds, total}。账本缺失/损坏返空（增强信息非执法项）。 */
function readLedgerStats(vaultPath) {
  const stats = new Map();
  let rows;
  try {
    rows = fs.readFileSync(observationLedgerPath(), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch (_e) {
    return stats;
  }
  const vaultKey = path.resolve(vaultPath);
  for (const row of rows) {
    if (!row || !row.combos || (row.vault && path.resolve(row.vault) !== vaultKey && row.vault !== vaultPath)) continue;
    for (const [key, count] of Object.entries(row.combos)) {
      const s = stats.get(key) || { first: row.ts, rounds: 0, total: 0 };
      s.rounds += 1;
      s.total += count;
      stats.set(key, s);
    }
  }
  return stats;
}

/** 组合候选：实体 frontmatter（arch_subdomain×arch_category）现算＋账本史加持。 */
function buildMatrixCandidates({ vaultPath, enumsData }) {
  const rules = buildRuleSet(enumsData || {});
  // 正式类别＝声明词表 ∪ 派生并集（ADR-006：矩阵配置后派生=并集、声明表成影子——但孤儿词仍是
  // 「已晋升过的词」，给它配对入矩阵正是收敛孤儿/漂移的正道；观察期两者同源不重复）。
  const formalCategories = new Set([...(rules.archCategories || []), ...((enumsData && enumsData.arch_categories) || [])]);
  // 子域→所属域反查（写矩阵行 domain_id 用；词条双形态取 id）
  const subdomainDomain = new Map();
  for (const [domainId, entries] of Object.entries(enumsData && enumsData.subdomains ? enumsData.subdomains : {})) {
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      const id = typeof entry === "string" ? entry : entry && entry.id;
      if (id) subdomainDomain.set(String(id).trim(), domainId);
    }
  }
  const policies = (enumsData && enumsData.subdomain_constraints && typeof enumsData.subdomain_constraints === "object"
    ? enumsData.subdomain_constraints : {});
  const configured = Object.entries(policies).some(([, row]) => Array.isArray(row && row.allowed_categories) && row.allowed_categories.length > 0);

  // 现算：实体侧组合计数＋样例文件
  const combos = new Map(); // "sd|cat" -> {count, files[]}
  for (const entity of scanEntities(vaultPath)) {
    const fm = entity.frontmatter || {};
    const sd = String(fm.arch_subdomain || "").trim();
    const cat = String(fm.arch_category || "").trim();
    if (!sd || !cat) continue;
    const key = makeId("combo", [sd, cat]); // WP-051 I-B：长度前缀编码——含 | 的域/分类不再撞键（P2 实跑址 2）
    const row = combos.get(key) || { count: 0, files: [] };
    row.count += 1;
    if (row.files.length < 3) row.files.push(path.relative(vaultPath, entity.file).split(path.sep).join("/"));
    combos.set(key, row);
  }

  const ledger = readLedgerStats(vaultPath);
  const candidates = [];
  for (const [key, live] of combos) {
    const [subdomain, category] = idParts(key).parts; // WP-051 I2：拆段经公开端口（禁自行 split）
    if (!subdomainDomain.has(subdomain) || !formalCategories.has(category)) continue; // 野生词走词表晋升，不进组合裁定
    const allowed = policies[subdomain] && Array.isArray(policies[subdomain].allowed_categories) ? policies[subdomain].allowed_categories : [];
    if (allowed.includes(category)) continue; // 已在矩阵 allow——非候选
    // WP-051 I4：账本是持久化观察史（check-taxonomy-growth 落的 "sd|cat" 显示键——增强信息
    // 非执法项）。进程内身份已编码；账本联结按显示键（idParts 派生，禁自行 split）。历史行内
    // 含 | 的显示键撞面＝存量持久数据债（ADR-016 §七-3：入口让它显形，清数据另一个工程）。
    const history = ledger.get(idParts(key).parts.join("|"));
    candidates.push({
      subdomain,
      category,
      domainId: subdomainDomain.get(subdomain),
      occurrences: live.count,
      rounds: history ? history.rounds + 1 : 1,
      total: history ? history.total + live.count : live.count,
      firstSeen: history ? history.first : "本轮",
      sampleFiles: live.files,
    });
  }
  candidates.sort((a, b) => b.total - a.total || a.subdomain.localeCompare(b.subdomain) || a.category.localeCompare(b.category));
  return { stage: configured ? "configured" : "observe", candidates };
}

module.exports = { buildMatrixCandidates, readLedgerStats };
