#!/usr/bin/env node
// wp-derive.mjs — 工作包合同义务派生器＋对账器（ADR-013：合同先于写入、义务派生不枚举）。
// @responsible: 三模式 CLI——
//   ① wp-derive.mjs <package_id> [--write]  对单合同重派生＋对账（--write 合并新义务进实例）
//   ② wp-derive.mjs --check-all             全量对账（check:work-packages 门禁调用；schema/禁手写/终态/
//                                          登记册一致性＋与 diff 无关的义务〔R1 入册、R8 证据〕在册）。
//                                          不读工作树 diff：diff 触发的义务归属只能由暂存集与合同范围的
//                                          交集决定（③），全局 diff 会跨包串红。
//   ③ wp-derive.mjs --pre-commit            增量：Git 暂存区 → 相关合同 → 派生对账；
//                                          observe 默认（只报 would-deny 退出 0），WP_ENFORCE=1 转 deny
//   ④ wp-derive.mjs <package_id> --plan     预览：把合同声明的 in_scope_paths 当伪暂存喂入同一套
//                                          规则引擎，开工即得全量义务预览（考前划重点）——预览不写账
//                                          （声明范围≠必触；R5 路由退役需 diff，预览模式标注 N/A）。
//                                          来源：WP-003 红队发现①（2026-10-24）——派生此前只键在暂存面，
//                                          合同期只见 R1，「③ 输出该走的流程」承诺超前于实现
// @inputs: contracts/work-package.schema.json、docs/work-packages/*.json（合同实例）、
//   两域表（reuse-domains/data-domains——zone 词表与治理路径动态 join，零硬编码域清单）、
//   contracts/quality-gates.json、contracts/retired-routes.json、git 暂存面（模式 ③）
// @outputs: 派生义务（R1-R9，单调累积：派生只增不减）＋对账结果（JSON / 门禁退出码）
// @context: 规则表单源＝docs/plans/施工流程对象化设计稿 §三（本脚本与其同步修订，规则号 1-9 对应）。
//   覆盖缺口（observe 上线期、--no-verify 绕过、语义质量不入执法面）见 ADR-013 coverage 节。
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Ajv 2020 构造（先例＝dev-log-ledger.loadAjv）：work-package.schema 声明 2020-12
function makeAjv() {
  const AjvCtor = require("ajv/dist/2020.js").default ?? require("ajv/dist/2020.js");
  return new AjvCtor({ strict: false, allErrors: true });
}
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
const WP_DIR = path.join(ROOT, "docs/work-packages");

// ── 固定 extras zones（域表 id 之外的非数据域辖区；词表另一半由两域表动态读）──
const EXTRA_ZONES = {
  openapi: ["contracts/http-api.openapi.json"],
  "retired-routes": ["contracts/retired-routes.json"],
  "quality-gates": ["contracts/quality-gates.json", "scripts/quality/check-*.mjs"],
  "contracts-core": ["contracts/*.schema.json", "contracts/object-meta-model.json", "contracts/object-dictionary.json"],
  hooks: [".githooks/"],
  ci: [".github/workflows/"],
};

const TEST_FILE_RE = /\.test\.(mjs|cjs|ts|tsx|js|py)$/;
const ROUTE_CALL_RE = /registerRoute\(\s*"([A-Z]+)"\s*,\s*"([^"]+)"/g;

const defaultReadText = (p) => fs.readFileSync(path.join(ROOT, p), "utf8");

// ── 登记册装载（对账失败即门禁红——读不了事实源＝无法判定，宁拦勿漏）──
export function loadRegistries(root = ROOT, readText = (p) => fs.readFileSync(path.join(root, p), "utf8")) {
  const read = (p) => JSON.parse(readText(p));
  const dataDomains = read("contracts/data-domains.json");
  const reuseDomains = read("contracts/reuse-domains.json");
  const gates = read("contracts/quality-gates.json");
  let retiredRoutes;
  try {
    retiredRoutes = read("contracts/retired-routes.json");
  } catch {
    retiredRoutes = { retired: [] };
  }
  let testBaseline;
  try {
    testBaseline = read("contracts/test-coverage-baseline.json");
  } catch {
    testBaseline = { unclaimed: {} };
  }
  // R7 的注册判据要把门禁条目的 npm 别名解析回脚本路径（条目多半只登记 command）
  let scripts = {};
  try {
    scripts = read("package.json").scripts || {};
  } catch {
    scripts = {};
  }
  return { dataDomains, reuseDomains, gates, retiredRoutes, testBaseline, scripts };
}

/** zone 词表＝两域表 id ∪ EXTRA_ZONES（动态，新域落表即自动进词表）。 */
export function zoneVocabulary(registries) {
  return new Set([
    ...registries.dataDomains.domains.map((d) => d.id),
    ...registries.reuseDomains.domains.map((d) => d.id),
    ...Object.keys(EXTRA_ZONES),
  ]);
}

/** zone → 该辖区的治理物理路径/前缀集（域：contract 文件＋writers 路径＋store 抽出的库/文件；extras：固定表）。 */
export function zonePaths(zone, registries) {
  if (EXTRA_ZONES[zone]) return EXTRA_ZONES[zone];
  const dom =
    registries.dataDomains.domains.find((d) => d.id === zone) ||
    registries.reuseDomains.domains.find((d) => d.id === zone);
  if (!dom) return [];
  const out = [];
  if (dom.contract) out.push(dom.contract.split("#")[0]);
  for (const w of dom.writers || []) out.push(w.split(/:\d+/)[0].split("（")[0]);
  if (dom.store) for (const m of String(dom.store).matchAll(/[A-Za-z0-9_\/.-]+\.(?:db|yaml|json|md)/g)) out.push(m[0]);
  return out.filter(Boolean);
}

function pathMatches(file, patterns) {
  return patterns.some((p) => {
    if (p.endsWith("/")) return file.startsWith(p);
    if (!p.includes("*")) return file === p;
    // glob（中间/尾 *）：段内通配 [^/]*，跨段不吃 /
    const re = new RegExp("^" + p.split("*").map((seg) => seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*") + "$");
    return re.test(file);
  });
}

/** 认领集＝域表 tests ∪ 门禁 testFiles（R3 对**新增**测试文件的认领判据；基线目录不算免检——新增仍须认领或更新基线计数与理由，棘轮同 check:domain-registry 面⑦）。 */
export function claimedTests(registries) {
  const set = new Set();
  for (const t of [registries.dataDomains, registries.reuseDomains]) {
    for (const d of t.domains) for (const f of d.tests || []) set.add(f);
  }
  for (const g of registries.gates.gates) for (const f of g.testFiles || []) set.add(f);
  return set;
}

// 注销项仍是已登记工具；说明文字不构成执行注册。
export function registeredCheckers(registries) {
  const out = new Set();
  const scripts = registries.scripts || {};
  const collect = (text) => {
    for (const m of String(text || "").matchAll(/(?:^|[\s;&|])node\s+(["']?)(?:\.\/)?(scripts\/quality\/check-[\w.-]+\.mjs)\1(?=$|[\s;&|])/g)) out.add(m[2]);
  };
  for (const g of registries.gates.gates || []) {
    collect(g.command);
    // WP-143 波4b 账物分离：retired 行的 keptHelpers＝实物转 test:node 载体继续执法（R2 口径）——认领不判未注册
    for (const h of g.keptHelpers || []) out.add(h);
    for (const alias of String(g.command || "").matchAll(/(?:^|[\s;&|])npm\s+run(?:-script)?\s+([\w:.-]+)(?=$|[\s;&|])/g)) {
      if (Object.hasOwn(scripts, alias[1])) collect(scripts[alias[1]]);
    }
  }
  return out;
}

/** 合同声明范围过滤：合同自身文件、in_scope_paths（精确/前缀）、in_scope_zones 的治理路径命中者。
 *  R2/R3/R4/R5/R6 的触发面都锚在「本合同范围」——不先过滤，别的包或他人未提交的改动会串进本合同派生
 *  （zone 路径跨包重叠时必然假红：同一文件可同属多个包的声明范围，归属只能由提交者本人认领）。 */
export function relevantScopeFiles(contract, files, registries) {
  const scopePatterns = contract.in_scope_paths || [];
  const zonePatterns = (contract.in_scope_zones || []).flatMap((z) => zonePaths(z, registries));
  const self = ["docs/work-packages", `${contract.package_id}.json`].join("/");
  return (files || []).filter((f) =>
    f === self ||
    pathMatches(f, scopePatterns) ||
    pathMatches(f, zonePatterns)
  );
}

function makeObId(rule, seed) {
  const slug = String(seed).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  return `R${rule}-${slug}`;
}
function ob(id, rule, trigger, duty, check) {
  return { id, rule, trigger, duty, check, status: "pending" };
}

/**
 * 派生义务（规则表 §三 1-8）。输入：合同＋登记册＋暂存面＋暂存 diff 统计。
 * 单调累积语义由调用方保证：派生结果「并入」实例 obligations（同 id 不重复、历史保留）。
 */
export function deriveObligations({ contract, registries, staged = [], batchFiles = staged, newTestFiles = [], routeRemovals = [], readText = defaultReadText, fileExists = null }) {
  const out = [];
  const stagedSet = new Set(staged);
  const vocabulary = zoneVocabulary(registries);

  // R1 新包落地：合同实例入册 → 开树＋双闸字段齐（开树由「文件已在树内」物理自证；wiring 由 schema 必填执法）
  out.push(ob(makeObId(1, contract.package_id), 1, "合同实例入册（docs/work-packages/）",
    "开树＋接线四问/复用域对照齐备后才进 building",
    "工作树存在（文件在树内即物理自证）＋wiring 四键与 domain_mapping 非空（gated 前置，wp-derive 对账）"));

  // R2 域治理路径触及：store/writers/contract 被碰 → 扩域三处同步
  for (const zone of contract.in_scope_zones) {
    if (!vocabulary.has(zone) || EXTRA_ZONES[zone]) continue;
    const pats = zonePaths(zone, registries);
    if (staged.some((f) => pathMatches(f, pats))) {
      const dom = registries.dataDomains.domains.find((d) => d.id === zone);
      out.push(ob(makeObId(2, zone), 2, `触及域治理路径（${zone}：store/writers/contract）`,
        "扩域三处同步：SPEC 族节＋域行（description/write_protocol/tests）＋事实源地图核对",
        `同批暂存含 contracts/data-domains.json 或 contracts/reuse-domains.json${dom && dom.contract ? ` 且 ${dom.contract.split("#")[0]}` : "（域行更新）"}`));
    }
  }

  // R3 新增测试文件（diff-filter=A；修改既有测试不触发——无新注册义务）：须域/门禁认领或同批更新基线
  // 认领判据与 check:domain-registry 面⑦同口径：目录前缀（尾 /）与 glob 均算认领（此前精确字串匹配——
  // 域表按目录认领的测试文件被误判「未认领」，WP-011 实录）
  const claimed = [...claimedTests(registries)];
  for (const f of newTestFiles) {
    if (!pathMatches(f, claimed)) {
      out.push(ob(makeObId(3, path.basename(f)), 3, `新增测试文件未被认领：${f}`,
        "C14 注册：入所属域 tests 字段或门禁条目 testFiles；落基线目录的走基线条目计数与理由更新（膨胀即红同款，check:domain-registry 面⑦）",
        `路径 ∈ 域表 tests ∪ 门禁 testFiles，或同批暂存含 contracts/test-coverage-baseline.json`));
    }
  }

  // R4 openapi 变更：生成类型同批
  if (stagedSet.has("contracts/http-api.openapi.json") && !batchFiles.includes("src/lib/generated/api-types.ts")) {
    out.push(ob(makeObId(4, "openapi"), 4, "触及 contracts/http-api.openapi.json",
      "契约同步：npm run gen:api-types 同批重生成",
      "同批暂存含 src/lib/generated/api-types.ts"));
  }

  // R5 路由退役：registerRoute 调用消失 → retired-routes 四件套
  const retiredKeys = new Set((registries.retiredRoutes.retired || []).map((r) => `${r.method} ${r.path}`));
  for (const { method, route, file } of routeRemovals) {
    if (!retiredKeys.has(`${method} ${route}`)) {
      out.push(ob(makeObId(5, `${method}-${route}`).replace(/[^A-Za-z0-9-]/g, "-").replace(/-{2,}/g, "-"), 5,
        `路由删除未被退役登记：${method} ${route}（${file}）`,
        "C13 四件套：retired-routes.json 行＋依赖清点＋测试下线＋openapi 移除（或 non_goals 显式豁免）",
        `${method} ${route} ∈ contracts/retired-routes.json，或本合同 non_goals 显式含该路径`));
    }
  }

  // R6 契约/存储形态（新包）：追踪矩阵入 SPEC——触发面＝contracts/*.json 全族
  // （PR-137：原只认 contracts-core 三模式，http-api 与域实例契约〔article-lifecycle.json 族〕漏网——WP-026 实录）
  // PR-265（2026-11-06 接管裁决）：登记簿锚定施工前合同（spec 全为 problem-register#PR-N 锚）无 SPEC
  //   文件可载矩阵——R6 跳过派生（矩阵的家＝登记簿条目自身的验收标准；合同取得真 SPEC 后 R6 自然
  //   恢复派生），否则义务对这类合同构造性不可满足＝T4 enforce 激活被锁死（WP-096 实录）。
  const specEntries = contract.upstream.spec || [];
  const registerAnchored = specEntries.length > 0 && specEntries.every((s) => /^docs\/plans\/problem-register\.md#PR-\d+/.test(s));
  if (!registerAnchored && staged.some((f) => pathMatches(f, ["contracts/*.json"]))) {
    // PR-265 后续缝②（2026-11-06）：spec 条目惯带内嵌注记（「SPEC-022-….md（波 C 退役范围＝…）」）
    //   ——注记随路径送 readText 必失败→恒派生。剥尾注记后按真路径核对；真路径不存在仍 false（fail-closed）。
    const specOk = contract.upstream.spec.some((s) => {
      const fp = s.replace(/（[^）]*）\s*$/, "").trim();
      try { return /追踪矩阵/.test(readText(fp)); } catch { return false; }
    });
    if (!specOk) {
      out.push(ob(makeObId(6, "matrix"), 6, "触及 contracts/ 契约或存储形态",
        "追踪矩阵入 upstream.spec（约束条款→小节→模块→测试→证据）",
        "upstream.spec 任一文件含「追踪矩阵」表头"));
    }
  }

  // R7 新检查器：门禁注册三处。判据是「该脚本未被任何门禁条目引用」——按文件名判「新」会把
  // 改既有检查器（含 retired 注销项）误报成新检查器（data-chain 2026-10-19 注销后仍被要求注册）。
  const registered = registeredCheckers(registries);
  for (const f of staged) {
    if (!/^scripts\/quality\/check-[^/]+\.mjs$/.test(f)) continue;
    // WP-129 退役即删豁免：暂存态已删除的文件不可能是「新检查器」——退役删除＋注册行同批删除时，
    // 该文件不在盘上也不被任何条目引用，按旧判据会被误派 R7 注册义务（合法退役被 enforce 拦截）。
    // 实测：WP-129 批 1 删 check-layer-ssot/register-coverage/wave0 时 R7 全数误派（本树实录）。
    // fileExists 由调用方注入（main＝真实 fs 判定）；不注入保持旧行为，纯函数测试用假路径不受影响。
    if (fileExists && !fileExists(f)) continue;
    if (registered.has(f)) continue;
    out.push(ob(makeObId(7, path.basename(f, ".mjs")), 7, `新检查器未注册：${f}`,
      "门禁注册：quality-gates.json 条目＋package.json script（CI 由 run-ci-gates 注册表驱动自动拾取）",
      "quality-gates.json 的 command 直接引用脚本或经 package.json 的 npm 别名解析到脚本"));
  }

  // R8 终态：证据列清零＋验收条款在场
  if (["accepted", "merged"].includes(contract.status)) {
    const specPending = contract.upstream.spec.some((s) => {
      // 占位格＝表格证据列以「待回填」开头的单元格；规则自述行（含该词的正文/判据描述）不咬——observe 期校准②
      try { return /\|\s*待回填/.test(readText(s)); } catch { return false; }
    });
    if (specPending) {
      out.push(ob(makeObId(8, "evidence"), 8, `status=${contract.status} 但 SPEC 证据列有待回填`,
        "收官证据回填：矩阵证据列清零＋（涉外部/边界时）audit 包或独立复核记录",
        "upstream.spec 文件无「待回填」"));
    }
  }

  // R9 立法落笔前本体对账（WP-114：PR-254 处置·AGENTS「立法落笔前本体对账」的开工面执法）。
  // 触及立法面 → 与元模型契约对账一次（该维度六层有无座次）。触发面＝PR-254 处置口径三件：
  // data/theschema 字段说明（fields.yaml）、field-rule-declarations 声明族、ADR·SPEC（前缀命中——
  // 立法节 vs 纯进度回写的判断归人，豁免口径内嵌义务文案）。元模型无位置时两条合法出路：
  // 显式入模／立法节写明「不收编」理由，禁止默认沉默。
  const LEGISLATIVE_SURFACES = [
    "data/theschema/fields.yaml",
    "server/shared/field-rule-declarations.cjs",
    "docs/adr/",
    "docs/spec/",
  ];
  if (staged.some((f) => pathMatches(f, LEGISLATIVE_SURFACES))) {
    out.push(ob(makeObId(9, "legislative-meta-align"), 9,
      "触及立法面（data/theschema 字段说明／field-rule-declarations 声明族／ADR·SPEC）",
      "立法落笔前本体对账：与 contracts/object-meta-model.json 对一次账（该维度六层有无座次），结论随提交入账——有座次＝显式入模或引用；无座次＝立法节写明「不收编」理由，禁止默认沉默；纯进度回写（证据/状态回填）豁免，fulfilled 证据注一句即可",
      "提交含对账结论留痕（提交信息或同批立法节：座次引用／「不收编」理由／入模条目）；义务未了结卡终态"));
  }
  return out;
}

/** diff 文本 → registerRoute 删除集（纯函数，可测）：- 行出现且无对应 + 行的 method+path。 */
export function parseRouteRemovals(diffText) {
  const removedCalls = new Map();
  const addedCalls = new Set();
  let file = "";
  const removed = [];
  for (const line of String(diffText).split("\n")) {
    if (line.startsWith("+++ b/")) file = line.slice(6);
    for (const m of line.matchAll(ROUTE_CALL_RE)) {
      const key = `${m[1]} ${m[2]}`;
      if (line.startsWith("+") && !line.startsWith("+++")) addedCalls.add(key);
      else if (line.startsWith("-") && !line.startsWith("---")) removedCalls.set(key, { method: m[1], route: m[2], file });
    }
  }
  for (const [key, info] of removedCalls) if (!addedCalls.has(key)) removed.push(info);
  return removed;
}

/** 暂存 diff 中 registerRoute 调用的删除集（git 面包装，解析在 parseRouteRemovals）。 */
export function detectRouteRemovals(staged, root = ROOT) {
  const routeFiles = staged.filter((f) => /^server\/routes\//.test(f));
  if (routeFiles.length === 0) return [];
  const diff = execFileSync("git", ["diff", "--cached", "-U0", "--", ...routeFiles], {
    cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"],
  });
  return parseRouteRemovals(diff);
}

// ── PR-137 结构性承载：SPEC 骨架生成＋开域域行落表（--write 模式；生成优先、断言兜底）──

/** 契约触及判定（与 R6 同口径）：staged/声明范围含 contracts/*.json。 */
export function touchesContractFace(files) {
  return (files || []).some((f) => pathMatches(f, ["contracts/*.json"]));
}

/**
 * SPEC 骨架自动生成（PR-137）：契约触及且 upstream.spec 无 docs/spec/ 条目时，
 * 在 docs/spec/ 取号（max+1）生成五节模板骨架（含追踪矩阵表头——R6 由此自然满足），
 * 并把 upstream.spec 的占位项替换为生成路径。root/dir 可注入（单测防夹具污染真库）。
 */
export function ensureSpecSkeleton(contract, staged, { root = ROOT, dir = WP_DIR } = {}) {
  const hasSpec = (contract.upstream.spec || []).some((s) => s.startsWith("docs/spec/"));
  if (hasSpec || !touchesContractFace(staged)) return { created: null };
  const specDir = path.join(root, "docs/spec");
  fs.mkdirSync(specDir, { recursive: true });
  const nums = fs.readdirSync(specDir)
    .map((f) => /^SPEC-(\d+)/.exec(f))
    .filter(Boolean)
    .map((m) => Number(m[1]));
  const num = (nums.length ? Math.max(...nums) : 0) + 1;
  const numStr = String(num).padStart(3, "0");
  // 命名跟既有 38 份一致：编号-主题（标题去空格、破折号归一、路径非法字符转连字符），不用 package_id。
  const slug = String(contract.title || contract.package_id)
    .replace(/——/g, "-")
    .replace(/\s+/g, "")
    .replace(/[/\\:*?"<>|]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  const file = `SPEC-${numStr}-${slug}.md`;
  const rel = `docs/spec/${file}`;
  const today = new Date().toISOString().slice(0, 10);
  const skeleton = [
    `# SPEC-${numStr} ${contract.title}`,
    "",
    `> 立项：工作包 ${contract.package_id}（wp:derive --write 结构性生成——PR-137；触契约文件即矩阵强制）。`,
    `> 本件为骨架，内容人工填写；矩阵表头与验收门句式为门禁锚点，勿删。生成日期 ${today}。`,
    "",
    "## 一、目标态",
    "",
    "（待填：本 SPEC 达成后的目标形态）",
    "",
    "## 二、行为契约",
    "",
    "（待填：值域/转移/触发者/存储/闸门等约束条款——每条将进矩阵第一列）",
    "",
    "## 三、追踪矩阵",
    "",
    "| 约束条款 | SPEC 小节 | 实现模块 | 测试用例 | 实测证据 |",
    "|---|---|---|---|---|",
    "| （待填条款） | § | （待回填） | （待回填） | （待回填） |",
    "",
    "## 四、验收门",
    "",
    "（待填：可判定句式——……满足则验收通过）",
    "",
    "## 五、非目标",
    "",
    "（待填：明确不做的事）",
    "",
  ].join("\n");
  fs.writeFileSync(path.join(specDir, file), skeleton);
  contract.upstream.spec = [
    ...(contract.upstream.spec || []).filter((s) => !String(s).includes("待填")),
    rel,
  ];
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${contract.package_id}.json`), JSON.stringify(contract, null, 2) + "\n");
  return { created: rel };
}

/** domain_mapping.domain 字符串 → 域 id（首个 slug 段，如 "state-layering（本包新立）"→state-layering）。 */
export function domainIdOf(domainText) {
  const m = /^([a-z0-9][a-z0-9-]*)/.exec(String(domainText || "").trim());
  return m ? m[1] : null;
}

/**
 * 开域域行落表（PR-137，两处同开结构化）：action=open 且两域表无该 id → 自动落
 * reuse-domains 骨架行（人只填内容）；action=extend 无该 id → fail-closed 报错
 * （extend 语义＝扩既有域，id 写错即红）。registries 为 loadRegistries 返回值（就地修改＋写回）。
 */
export function ensureDomainRows(contract, registries, { root = ROOT } = {}) {
  const result = { added: [], errors: [] };
  for (const dm of contract.domain_mapping || []) {
    if (!["open", "extend"].includes(dm.action)) continue;
    const id = domainIdOf(dm.domain);
    if (!id) { result.errors.push(`domain_mapping 域名无法解析出 id：${dm.domain}`); continue; }
    const exists = [...registries.dataDomains.domains, ...registries.reuseDomains.domains].some((d) => d.id === id);
    if (exists) continue;
    if (dm.action === "extend") {
      result.errors.push(`domain_mapping action=extend 但域 ${id} 不在两域表（extend＝扩既有域；开新域用 open）`);
      continue;
    }
    registries.reuseDomains.domains.push({
      id,
      name: String(dm.domain).replace(/（[^）]*）/g, "").trim() || id,
      status: "candidate",
      authority: "（骨架行·wp:derive 落，待填）",
      contract: null,
      gate: null,
      tests: [],
      writers: [],
      description: `（骨架行——${contract.package_id} 声明开域自动落表，PR-137 两处同开结构化；内容待填）`,
      recipes: null,
      guide: null,
      register_entry: `docs/work-packages/${contract.package_id}.json`,
      verification_evidence: null,
      metrics: null,
      last_updated: new Date().toISOString().slice(0, 10),
      note: `wp:derive --write 自动落（${contract.package_id} action=open）——两处同开从人记忆变派生器行为`,
    });
    result.added.push(id);
  }
  if (result.added.length > 0) {
    fs.writeFileSync(path.join(root, "contracts/reuse-domains.json"),
      JSON.stringify(registries.reuseDomains, null, 2) + "\n");
  }
  return result;
}

// ── 对账（模式②全量）：schema 过＋zones 合法＋gated 前置＋终态义务全结＋派生并入 ──
export function reconcile(contract, registries, readText = defaultReadText) {
  const errors = [];
  const ajv = makeAjv();
  const schema = JSON.parse(readText("contracts/work-package.schema.json"));
  const validate = ajv.compile(schema);
  if (!validate(contract)) {
    errors.push(`schema 不过：${(validate.errors || []).map((e) => `${e.instancePath} ${e.message}`).join("; ")}`);
    return { errors };
  }
  const vocabulary = zoneVocabulary(registries);
  for (const z of contract.in_scope_zones) if (!vocabulary.has(z)) errors.push(`未知 zone：${z}（不在两域表 ∪ extras）`);
  if (["gated", "approved", "building", "accepted", "merged"].includes(contract.status)) {
    if ((contract.domain_mapping || []).length === 0) {
      errors.push("status≥gated 但 domain_mapping 为空——双闸第二闸（复用域对照）未过不得进 gated");
    }
    for (const [k, v] of Object.entries(contract.wiring || {})) {
      if (String(v).includes("待填")) errors.push(`status≥gated 但 wiring.${k} 仍是占位——双闸第一闸（接线四问）未过不得进 gated`);
    }
    if ((contract.deliverables || []).some((d) => String(d).includes("待填"))) {
      errors.push("status≥gated 但 deliverables 仍是占位");
    }
  }
  if (["accepted", "merged"].includes(contract.status)) {
    for (const o of contract.obligations || []) {
      if (o.status === "pending") errors.push(`终态包义务未了结：${o.id}（${o.duty}）`);
      if (o.status !== "pending" && !o.evidence) errors.push(`义务 ${o.id} ${o.status} 但缺 evidence`);
    }
  }
  for (const o of contract.obligations || []) {
    if (!/^R[1-9]-[a-z0-9-]+$/.test(o.id)) errors.push(`义务 id 形状非法（须派生器生成）：${o.id}`);
  }
  return { errors };
}

function loadContract(packageId) {
  const p = path.join(WP_DIR, `${packageId}.json`);
  if (!fs.existsSync(p)) throw new Error(`合同不存在：${p}（先 npm run wp:start -- ${packageId}）`);
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** 派生并入（单调累积）：同 id 不重复；dir 可注入（单测传临时目录，防夹具污染真实 docs/work-packages/）。 */
export function mergeObligations(contract, derived, dir = WP_DIR) {
  const existing = new Set((contract.obligations || []).map((o) => o.id));
  const added = derived.filter((o) => !existing.has(o.id));
  if (added.length > 0) {
    contract.obligations = [...(contract.obligations || []), ...added];
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${contract.package_id}.json`), JSON.stringify(contract, null, 2) + "\n");
  }
  return { added, merged: contract.obligations };
}

/** 需合同的触及面（PR-217 孤儿判据的分母）：沿用 touchesContractFace 的契约口径，外加执法件与钩子两类边界。
 *  窄分母是有意的——AGENTS §五 明文允许「证据齐全＋根因明确＋单辖区」的直接修复只走台账不走合同，
 *  把分母扩到全部提交会把那条合法路径堵死；登记簿／台账／SPEC 类改动各有其对账面。 */
export function needsContractFace(file, isNew) {
  if (touchesContractFace([file])) return true;
  if (file.startsWith(".githooks/")) return true;
  return Boolean(isNew) && /^scripts\/quality\/[\w.-]+\.mjs$/.test(file);
}

/**
 * 孤儿改动（PR-217）：合同制的两个执法面都以「已存在的合同实例」为循环主体——
 * --check-all 枚举 docs/work-packages 目录，--pre-commit 对每个在册合同算其范围交集。
 * 于是「该批根本没建合同」这件事不可见（WP-085 一批改了四份契约与一个 checker，账面零违例）。
 * 本判把循环主体换成暂存集：触及需合同之物、却不被任何**在途**合同范围覆盖者＝孤儿。
 * 只认在途合同（status ≠ merged）——已并入的历史合同是台账不是授权：docs/work-packages 里躺着几十个
 * 老包，其一声明过 `contracts-core` 就等于此后任何人改契约都算「有合同覆盖」，本判立刻变成永不红的空转（真树实测过）。
 * @param {string[]} staged @param {Array<object>} contractDocs @param {Set<string>} addedFiles
 * @param {{registries:object}} args @returns {string[]}
 */
export function orphanContractGaps(staged, contractDocs, addedFiles, { registries }) {
  const active = (contractDocs || []).filter((c) => c && c.status !== "merged");
  const covered = (file) => active.some((c) => relevantScopeFiles(c, [file], registries).length > 0);
  return (staged || []).filter((f) => needsContractFace(f, addedFiles?.has(f)) && !covered(f));
}

// 断链 / kit 内容缺失属于「挂载已损坏」，不是「未挂载」，更不是「空 kit」。
// 红队复核 F-1：lstatSync 不跟随链接，断链仍会被判成挂载态；若此时按空集合
// 跳过合同对账，门禁会静默假绿并声称「治理 kit 未挂载」，必须单独识别并拦住。
export function governanceMountBroken(root = ROOT) {
  const link = path.join(root, "docs");
  try {
    if (!fs.lstatSync(link).isSymbolicLink()) return false; // 真实目录＝未挂载（正常）
  } catch { return false; }                                 // docs 不存在＝未挂载（正常）
  try {
    if (!fs.statSync(link).isDirectory()) return true;      // 跟随链接：断链或指向文件
    return !fs.statSync(path.join(link, "work-packages")).isDirectory();
  } catch { return true; }
}

// 治理 kit 挂载态（docs 为符号链接）时，合同不在代码仓 git 索引里，改从挂载目录枚举。
// 返回 null 表示未挂载（调用方回退到 git 索引）；返回数组表示挂载态（可能为空数组）。
export function governanceContractFiles(root = ROOT) {
  try {
    if (!fs.lstatSync(path.join(root, "docs")).isSymbolicLink()) return null;
  } catch { return null; }
  const dir = path.join(root, "docs", "work-packages");
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((f) => /^[^/]+\.json$/.test(f))
    .map((f) => `docs/work-packages/${f}`)
    .sort();
}

function checkStagedContracts() {
  const enforce = process.env.WP_ENFORCE !== "0"; // T4（2026-11-06）正式激活：PR-265 机制缝隙修复（登记簿锚定合同跳过 R6 派生）＋休眠合同存量债清偿完成；WP_ENFORCE=0 临时降 observe 排查
  const mode = enforce ? "enforce" : "observe";
  let wouldDeny = 0;
  const report = (name, errors) => {
    if (errors.length === 0) return;
    wouldDeny++;
    console.log(`work-packages(${mode}): ${name} ${enforce ? "deny" : "would-deny"}——`);
    for (const error of errors) console.log(`  ${error}`);
  };
  if (governanceMountBroken()) {
    console.error("work-packages(pre-commit): 治理 kit 挂载已损坏（docs 是符号链接，但目标或合同目录不可用）——合同对账不可用，按 fail-closed 拦截提交。");
    console.error("  修复：重跑 npm run gov:setup <kit路径>；不需要治理层时运行 npm run gov:unlink 显式解除挂载。");
    return 1;
  }
  const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
  // 治理 kit 化后的合同来源：docs 挂成指向治理仓的符号链接时，代码仓 git 索引里
  // 没有治理件，合同要从挂载目录读；治理路径走文件系统，其余仍读暂存区版本。
  // 索引与磁盘都拿不到合同时显式跳过并给配置指引，不把「没有合同」误判成
  // 「所有改动都是孤儿」（假红，拦截正常提交）。
  const mountedFiles = governanceContractFiles();
  const docsIsMount = mountedFiles !== null;
  try {
    const staged = git("diff", "--cached", "--name-only", "-z").split("\0").filter(Boolean);
    if (staged.length === 0) return 0;
    const readIndex = (p) => git("show", `:${p}`);
    const readText = docsIsMount
      ? (p) => (p.startsWith("docs/") ? fs.readFileSync(path.join(ROOT, p), "utf8") : readIndex(p))
      : readIndex;
    const registries = loadRegistries(ROOT, readText);
    const files = docsIsMount
      ? mountedFiles
      : [...new Set(git("ls-files", "--cached", "-z", "--", "docs/work-packages/").split("\0"))]
        .filter((f) => /^docs\/work-packages\/[^/]+\.json$/.test(f));
    if (files.length === 0) {
      console.log("work-packages(pre-commit): 治理 kit 未挂载且索引无合同实例——本次跳过在途合同覆盖判定（不判孤儿）。出口：npm run gov:setup <kit路径>；公开仓贡献者无需 kit，由 CI 门禁兜底。");
      return 0;
    }
    const added = new Set(git("diff", "--cached", "--name-only", "--diff-filter=A", "-z").split("\0"));
    const contractDocs = [];
    for (const file of files) {
      try {
        const contract = JSON.parse(readText(file));
        contractDocs.push(contract);
        const scoped = relevantScopeFiles(contract, staged, registries);
        if (!staged.includes(file) && scoped.length === 0) continue;
        // PR-265 缝三（WP-132）：pre-commit 跳过已知合法的非执行态（merged 终态／draft 占位／paused
        //   挂起）——终态派生新义务＝僵尸债（REVIEW-STATUS-001/WP-102 实录），draft 双闸催办走
        //   wp:derive --plan 流不入提交拦截。用跳过名单而非在建白名单：未知状态串（拼写错等）不在
        //   名单即照常执法（fail-closed，「未知状态」夹具用例钉住）。存量债由 check-all 与登记簿管。
        if (["merged", "draft", "paused"].includes(contract.status)) continue;
        const { errors } = reconcile(contract, registries, readText);
        const derived = errors.length > 0 ? [] : deriveObligations({
          contract, registries, staged: scoped, batchFiles: staged, readText,
          newTestFiles: scoped.filter((f) => added.has(f) && TEST_FILE_RE.test(f)),
          routeRemovals: detectRouteRemovals(scoped),
          fileExists: (f) => fs.existsSync(path.join(ROOT, f)),
        });
        const missing = derived.filter((d) => !(contract.obligations || []).some((o) => o.id === d.id));
        const unfilled = Array.isArray(contract.obligations) ? contract.obligations.filter((o) => o?.status === "pending") : [];
        report(contract.package_id, [
          ...errors,
          ...missing.map((d) => `[未并入] ${d.id}：${d.duty}（判据：${d.check}）`),
          ...unfilled.map((o) => `[未了结] ${o.id}：${o.duty}`),
        ]);
      } catch (error) {
        // PR-168：对账工具自身不可加载（node_modules 缺失致 ajv 等依赖 require 失败）＝
        // 无法验证任何事——与①②层「事实源不可读同样拦」同语义 fail-closed，不受 observe 期豁免；
        // 其余子进程级故障（如 git diff 死亡）仍按既有「报告＋observe/enforce」语义（wp-derive.test.mjs :502 面）。
        if (error && (error.code === "MODULE_NOT_FOUND" || error.code === "ERR_MODULE_NOT_FOUND")) {
          console.error(`work-packages(pre-commit): 对账工具不可加载（fail-closed）——${error.message}`);
          console.error("  修复指引：npm install 后重试；本树为新工作树时先链接 node_modules。");
          return 1;
        }
        report(file, [`暂存对账失败：${error.message}`]);
      }
    }
    const orphans = orphanContractGaps(staged, contractDocs, added, { registries });
    report("孤儿改动（未建合同实例）", orphans.map((f) => `[wp_contract_missing] ${f} 触及契约或执法面，却不被任何在册合同的 in_scope_paths／辖区覆盖——出口：npm run wp:start -- <WP-NNN> --title … 先落合同实例；或并入既有合同的声明范围（扩范围须 change_request 经 Master）。分母＝contracts/ 契约／.githooks 钩子／新增 scripts/quality 执法件；登记簿·台账·SPEC 类不属本判（AGENTS §五 允许其走直接修复并随台账入账）`));
  } catch (error) {
    console.error(`work-packages(pre-commit): Git index 读取故障（fail-closed）——${error.message}`);
    return 1;
  }
  if (wouldDeny > 0 && enforce) {
    console.error("work-packages(enforce): 以上对账未通过，拦截提交（WP_ENFORCE=1）。");
    return 1;
  }
  return 0;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--pre-commit") {
    process.exitCode = checkStagedContracts();
    return process.exitCode;
  }
  let registries = loadRegistries();

  if (args[0] === "--check-all") {
    const ajv = makeAjv();
    const schema = JSON.parse(fs.readFileSync(path.join(ROOT, "contracts/work-package.schema.json"), "utf8"));
    const validate = ajv.compile(schema);
    const files = fs.existsSync(WP_DIR) ? fs.readdirSync(WP_DIR).filter((f) => f.endsWith(".json")) : [];
    if (files.length === 0) {
      console.log("work_packages=ok contracts=0（尚无合同实例——机制 observe 期，首例落地后本门禁开始实质执法）");
      return 0;
    }
    let fail = 0;
    for (const f of files) {
      const contract = JSON.parse(fs.readFileSync(path.join(WP_DIR, f), "utf8"));
      // 本门禁对账的是「当前磁盘全量合同账本」：schema／禁手写／终态／登记册一致性，外加与 diff 无关的
      // 义务（R1 入册、R8 终态证据）是否在册。不再拿工作树未提交 diff 派生 R2-R7：同一文件可同属多个
      // 包的声明范围（例：scripts/vault-py/graph/extract_graph.py 同时落在两个数据域的治理路径里），
      // 全局 diff 无法归属到某一包，会给无关包制造假红；且提交后 git diff HEAD 恒空，此面抓到的从来
      // 只是「尚未提交」的改动，增量归属由 --pre-commit（按 Git 暂存集与合同范围的交集）承担。
      const derived = deriveObligations({ contract, registries, staged: [], newTestFiles: [], routeRemovals: [] });
      const missing = derived.filter((d) => !(contract.obligations || []).some((o) => o.id === d.id));
      const { errors } = reconcile(contract, registries);
      const all = [...errors, ...missing.map((d) => `义务未并入：${d.id}（${d.duty}）——先 npm run wp:derive -- ${contract.package_id}`)];
      if (!validate(contract)) all.push(`schema 不过：${(ajv.errors || []).map((e) => e.instancePath).join(",")}`);
      if (all.length > 0) { fail++; console.log(`work_packages=FAIL ${contract.package_id}`); for (const e of all) console.log(`  - ${e}`); }
      else console.log(`work_packages=ok ${contract.package_id} status=${contract.status} obligations=${(contract.obligations || []).length}`);
    }
    if (fail > 0) process.exit(1);
    return 0;
  }

  const packageId = args[0];
  const write = args.includes("--write");
  const plan = args.includes("--plan");
  if (!packageId) { console.error("用法：wp-derive.mjs <package_id> [--write] [--plan] | --check-all | --pre-commit"); process.exit(2); }
  const contract = loadContract(packageId);
  if (plan) {
    // --plan（WP-003 红队①修复）：伪暂存＝合同声明的 in_scope_paths（原样作路径/前缀），同一套规则跑全量预览。
    // 不写账——义务并入仍以实际触及为准（声明≠必触，伪义务污染单调账本会卡终态）。
    const pseudo = [...new Set(contract.in_scope_paths || [])];
    const derived = deriveObligations({ contract, registries, staged: pseudo, newTestFiles: pseudo.filter((f) => TEST_FILE_RE.test(f)) });
    console.log(JSON.stringify({
      package_id: packageId,
      mode: "plan",
      note: "预览＝按声明范围（in_scope_paths）跑同一套规则的义务预演；不并入账本。实际义务仍按每次提交的暂存面派生并入（--write）。R5（路由退役）依赖提交 diff，预览恒 N/A。",
      preview_obligations: derived,
    }, null, 2));
    return 0;
  }
  // 工作树改动先按本合同声明范围归拢：别人的未提交改动/别包的辖区文件不派生成本包义务。
  const git = (...args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["pipe", "pipe", "pipe"] });
  let base = "HEAD";
  try { git("rev-parse", "--verify", "--quiet", "HEAD"); } catch (error) {
    if (error.status !== 1) throw error;
    base = execFileSync("git", ["hash-object", "-t", "tree", "--stdin"], { cwd: ROOT, encoding: "utf8", input: "" }).trim();
  }
  const untracked = git("ls-files", "--others", "--exclude-standard", "-z").split("\0").filter(Boolean);
  const treeChanges = [...new Set([...git("diff", "--name-only", "-z", base).split("\0").filter(Boolean), ...untracked])];
  const staged = relevantScopeFiles(contract, treeChanges, registries);
  const added = new Set([...git("diff", "--name-only", "--diff-filter=A", "-z", base).split("\0"), ...untracked]);
  const addedTests = staged.filter((f) => added.has(f) && TEST_FILE_RE.test(f));
  // PR-137 结构性承载（--write）：结构先于断言——SPEC 骨架＋开域域行落表后再派生对账
  // （生成后 R6 矩阵义务自然满足；--plan/--check-all/--pre-commit 只读模式不走此分支，断言仍兜底）
  let structural = null;
  if (write) {
    const spec = ensureSpecSkeleton(contract, staged);
    const domains = ensureDomainRows(contract, registries);
    if (domains.errors.length > 0) {
      console.log(JSON.stringify({ package_id: packageId, reconcile_errors: domains.errors, structural: { spec: spec.created, domainRows: domains.added } }, null, 2));
      process.exit(1);
    }
    if (domains.added.length > 0) registries = loadRegistries(); // 域表已落新行→重载（zone 词表随之含新域）
    structural = { spec: spec.created, domainRows: domains.added };
  }
  const derived = deriveObligations({ contract, registries, staged, batchFiles: treeChanges, newTestFiles: addedTests, routeRemovals: detectRouteRemovals(staged) });
  const { errors } = reconcile(contract, registries);
  if (write && errors.length === 0) {
    const { added } = mergeObligations(contract, derived);
    console.log(JSON.stringify({ package_id: packageId, structural, added: added.map((a) => a.id), obligations: contract.obligations.length }, null, 2));
  } else {
    console.log(JSON.stringify({ package_id: packageId, derived, reconcile_errors: errors }, null, 2));
    if (errors.length > 0) process.exit(1);
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  main();
}
