// @tests: scripts/quality/wp-derive.mjs——派生 9 规则（正反例）＋对账＋单调累积（ADR-013/设计稿 §三追踪矩阵）。
// 层级：纯单元（登记册用最小夹具注入，不读真表；WP-001 真实例各测一条＝契约锚定）。
// 认领事实源：contracts/quality-gates.json 条目 work-packages.testFiles（R3 认领判据的自身闭环）。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../../..");
const wp = await import(pathToFileURL(path.join(ROOT, "scripts/quality/wp-derive.mjs")).href);

// 真件正反例/锚定用例依赖内部文档（docs/plans 设计稿、docs/work-packages 存档），不入公开仓：
// 缺席时明示跳过（vault=skip 同惯例），本地有真件时照常执法；纯夹具用例不受影响。
const DESIGN_DOC = path.join(ROOT, "docs/plans/施工流程对象化-工作包合同与义务派生-设计稿-2026-10-24.md");
const DESIGN_SKIP = fs.existsSync(DESIGN_DOC) ? false : "内部设计稿不在公开仓——真件正反例缺席跳过";
const WP001_SKIP = fs.existsSync(path.join(ROOT, "docs/work-packages/archive/WP-001.json"))
  ? false : "内部 WP-001 存档不在公开仓——锚定用例缺席跳过";

// ── 最小登记册夹具（形状对齐真表；域键用真表存在的 id 保证 zonePaths 走域分支）──
const registries = {
  dataDomains: { domains: [{
    id: "derived-index-data", contract: "docs/spec/SPEC-012-W12-持久层分层.md",
    writers: ["server/shared/persistence/derived-index-store.cjs"], store: "data/derived-index.db",
    tests: ["server/shared/__tests__/derived-index-store.test.cjs", "server/services/release-governance/__tests__/"], // 文件认领＋目录前缀认领（两形态同为合法）
  }] },
  reuseDomains: { domains: [] },
  gates: { gates: [{ id: "work-packages", testFiles: ["scripts/quality/__tests__/wp-derive.test.mjs"] }] },
  retiredRoutes: { retired: [{ method: "GET", path: "/api/sync/pull" }] },
};

function contract(overrides = {}) {
  return {
    $schema: "./work-package.schema.json", schema_version: 1, package_id: "TEST-001", title: "测试合同",
    kind: "mainline", status: "approved", phase: "",
    upstream: { adr: [], spec: ["docs/plans/施工流程对象化-工作包合同与义务派生-设计稿-2026-10-24.md"], proposal: [] },
    wiring: { trigger: "t", logging: "l", source: "s", sink: "k" },
    domain_mapping: [{ item: "i", domain: "d", action: "attach", reason: "r" }],
    in_scope_zones: ["derived-index-data"], in_scope_paths: [], non_goals: ["n"],
    deliverables: ["d"], acceptance: { criteria: ["满足则验收通过：x"], revision: 1 },
    pending_decisions: [], validation_commands: [], change_requests: [], scope_revision: 1,
    obligations: [], coverage: { gaps: ["语义质量不在执法面", "判断类归人"] },
    ...overrides,
  };
}
const ids = (obs) => obs.map((o) => o.rule);

test("R1 合同入册：恒派生开树＋双闸义务（新包第一笔）", () => {
  const obs = wp.deriveObligations({ contract: contract(), registries, staged: [] });
  assert.ok(obs.some((o) => o.rule === 1 && o.id.startsWith("R1-")), "R1 恒在");
});

test("R2 域治理路径触及→扩域义务；未触及→无（正反例）", () => {
  const hit = wp.deriveObligations({ contract: contract(), registries, staged: ["server/shared/persistence/derived-index-store.cjs"] });
  assert.ok(hit.some((o) => o.rule === 2), "触及域 writers → R2");
  const miss = wp.deriveObligations({ contract: contract(), registries, staged: ["src/App.tsx"] });
  assert.ok(!miss.some((o) => o.rule === 2), "未触及域路径 → 无 R2");
});

test("R3 新增测试文件未认领→义务；已认领（域 tests ∪ 门禁 testFiles）→无；修改既有测试→不触发（正反例）", () => {
  const unclaimed = wp.deriveObligations({ contract: contract(), registries, newTestFiles: ["src/test/new-thing.test.ts"] });
  assert.ok(unclaimed.some((o) => o.rule === 3), "新增未认领 → R3");
  const claimedByDomain = wp.deriveObligations({ contract: contract(), registries, newTestFiles: ["server/shared/__tests__/derived-index-store.test.cjs"] });
  assert.ok(!claimedByDomain.some((o) => o.rule === 3), "域 tests 在册 → 无 R3");
  const claimedByGate = wp.deriveObligations({ contract: contract(), registries, newTestFiles: ["scripts/quality/__tests__/wp-derive.test.mjs"] });
  assert.ok(!claimedByGate.some((o) => o.rule === 3), "门禁 testFiles 在册 → 无 R3");
  // 域表按目录前缀认领（尾 /）——与 check:domain-registry 面⑦同口径；此前精确字串匹配会把前缀认领误判未认领（WP-011 实录）
  const claimedByDirPrefix = wp.deriveObligations({ contract: contract(), registries, newTestFiles: ["server/services/release-governance/__tests__/brand-new-release.test.cjs"] });
  assert.ok(!claimedByDirPrefix.some((o) => o.rule === 3), "域 tests 目录前缀认领 → 无 R3");
  const modified = wp.deriveObligations({ contract: contract(), registries, staged: ["server/shared/__tests__/theschema-loader.test.cjs"], newTestFiles: [] });
  assert.ok(!modified.some((o) => o.rule === 3), "修改既有测试（非新增）→ 不触发（R3 收窄校准）");
});

test("R4 openapi 变更无生成类型同批→义务；同批有→无（正反例）", () => {
  const alone = wp.deriveObligations({ contract: contract(), registries, staged: ["contracts/http-api.openapi.json"] });
  assert.ok(alone.some((o) => o.rule === 4), "openapi 独改 → R4");
  const paired = wp.deriveObligations({ contract: contract(), registries, staged: ["contracts/http-api.openapi.json", "src/lib/generated/api-types.ts"] });
  assert.ok(!paired.some((o) => o.rule === 4), "生成类型同批 → 无 R4");
});

test("R5 路由删除未登记→义务；在 retired-routes→无；non_goals 豁免判据在文（正反例）", () => {
  const removals = [{ method: "GET", route: "/api/kg/query", file: "server/routes/kg-routes.cjs" }];
  const unregistered = wp.deriveObligations({ contract: contract(), registries, staged: ["server/routes/kg-routes.cjs"], routeRemovals: removals });
  assert.ok(unregistered.some((o) => o.rule === 5), "删除未登记路由 → R5");
  const registered = wp.deriveObligations({ contract: contract(), registries, staged: ["server/routes/sync-routes.cjs"], routeRemovals: [{ method: "GET", route: "/api/sync/pull", file: "server/routes/sync-routes.cjs" }] });
  assert.ok(!registered.some((o) => o.rule === 5), "删除在册退役路由 → 无 R5");
  assert.match(unregistered.find((o) => o.rule === 5).check, /non_goals/, "判据含豁免出口（non_goals 显式声明）");
});

test("parseRouteRemovals：-行删/+行增/改路径不误报", () => {
  const diff = [
    "+++ b/server/routes/kg-routes.cjs",
    "-  registerRoute(\"GET\", \"/api/kg/query\", h);",
    "+  registerRoute(\"GET\", \"/api/kg/query\", h2);",
    "-  registerRoute(\"POST\", \"/api/kg/old\", h);",
  ].join("\n");
  const removed = wp.parseRouteRemovals(diff);
  assert.deepEqual(removed.map((r) => `${r.method} ${r.route}`), ["POST /api/kg/old"], "改 handler 不算删；真删的在列");
});

test("R6 触及 contracts 契约且 upstream.spec 无矩阵→义务；设计稿真件含矩阵→无（正反例）", { skip: DESIGN_SKIP }, () => {
  const noMatrix = wp.deriveObligations({ contract: contract({ upstream: { adr: [], spec: ["README.md"], proposal: [] } }), registries, staged: ["contracts/work-package.schema.json"] });
  assert.ok(noMatrix.some((o) => o.rule === 6), "spec 无矩阵 → R6");
  const withMatrix = wp.deriveObligations({ contract: contract(), registries, staged: ["contracts/work-package.schema.json"] });
  assert.ok(!withMatrix.some((o) => o.rule === 6), "真设计稿含「追踪矩阵」→ 无 R6（本仓库实测）");
});

test("R7 未注册、只改登记文件或仅说明提及→义务；执行命令已注册（含 retired）→无", () => {
  const alone = wp.deriveObligations({ contract: contract(), registries, staged: ["scripts/quality/check-foo.mjs"] });
  assert.ok(alone.some((o) => o.rule === 7), "裸新检查器 → R7");
  const withReg = wp.deriveObligations({ contract: contract(), registries, staged: ["scripts/quality/check-foo.mjs", "contracts/quality-gates.json"] });
  assert.ok(withReg.some((o) => o.rule === 7), "只改登记文件但未登记脚本，仍派生 R7");
  const mentioned = { ...registries, gates: { gates: [{ id: "other", note: "scripts/quality/check-foo.mjs" }] } };
  assert.ok(!wp.registeredCheckers(mentioned).has("scripts/quality/check-foo.mjs"), "说明文字不是执行注册");
  // 已注册判据＝门禁条目引用该脚本路径（不是「文件是否新增」）：改既有检查器不是新检查器。
  // data-chain 实录：2026-10-19 注销（status: retired，脚本与别名保留为工具入口）后仍被判「未注册」。
  const withRegistered = {
    ...registries,
    scripts: { "check:data-chain": "node scripts/quality/check-data-chain.mjs" },
    gates: { gates: [
      { id: "work-packages", testFiles: ["scripts/quality/__tests__/wp-derive.test.mjs"] },
      { id: "data-chain", status: "retired", command: "npm run check:data-chain", authority: ["scripts/quality/check-data-chain.mjs（脚本头部注释）"] },
    ] },
  };
  assert.ok(wp.registeredCheckers(withRegistered).has("scripts/quality/check-data-chain.mjs"), "从门禁条目抽出已注册脚本路径");
  const retiredHit = wp.deriveObligations({ contract: contract(), registries: withRegistered, staged: ["scripts/quality/check-data-chain.mjs"] });
  assert.ok(!retiredHit.some((o) => o.rule === 7), "已注册（retired）→ 无 R7");
  const stillNew = wp.deriveObligations({ contract: contract(), registries: withRegistered, staged: ["scripts/quality/check-brand-new.mjs"] });
  assert.ok(stillNew.some((o) => o.rule === 7), "未注册的新脚本仍派生 R7（反证不误伤）");
  // 门禁条目多半只登记 npm 别名（command: "npm run check:xxx"），脚本路径只在 package.json 里——
  // 只认条目字面路径会漏认（真表实测 42 个检查器只认出 11 个，改导航等 31 个被误判「未注册」）。
  const aliasRegistries = {
    ...registries,
    scripts: { "check:navigation": "node scripts/quality/check-navigation.mjs --strict" },
    gates: { gates: [{ id: "navigation", command: "npm run check:navigation", testFiles: [] }] },
  };
  assert.ok(wp.registeredCheckers(aliasRegistries).has("scripts/quality/check-navigation.mjs"), "npm 别名经 package.json 解析回脚本路径");
  assert.ok(!wp.deriveObligations({ contract: contract(), registries: aliasRegistries, staged: ["scripts/quality/check-navigation.mjs"] }).some((o) => o.rule === 7), "别名注册的脚本 → 无 R7");
  // 真表闭环：scripts/quality 下所有 check-*.mjs 均已被真注册表（含别名解析）认领
  const realRegistries = wp.loadRegistries(ROOT);
  const realRegistered = wp.registeredCheckers(realRegistries);
  const unregistered = fs.readdirSync(path.join(ROOT, "scripts/quality"))
    .filter((f) => /^check-.*\.mjs$/.test(f))
    .map((f) => `scripts/quality/${f}`)
    .filter((f) => !realRegistered.has(f));
  assert.deepEqual(unregistered, [], `真表所有检查器都算已注册：${unregistered.join(", ")}`);
  // WP-143 波4b 复核建议：keptHelpers 声明的路径必须在盘（防幻影条目——第二轮复核实证 4 条 phantom）
  const keptAll = (wp.loadRegistries(ROOT).gates.gates || [])
    .flatMap((g) => g.keptHelpers || []);
  const keptMissing = keptAll.filter((h) => !fs.existsSync(path.join(ROOT, h)));
  assert.deepEqual(keptMissing, [], `keptHelpers 幻影条目（声明路径不在盘）：${keptMissing.join(", ")}`);
});

test("relevantScopeFiles：只收本合同声明范围——paths 精确/前缀、zones 治理路径、合同自身文件；越界文件不归本包", () => {
  const c = contract({ in_scope_paths: ["server/services/schema-manager/schema-validators.cjs", "scripts/vault-py/graph/"] });
  const files = [
    "docs/work-packages/TEST-001.json",
    "server/services/schema-manager/schema-validators.cjs",
    "scripts/vault-py/graph/extract_graph.py",
    "server/shared/persistence/derived-index-store.cjs",
    "src/App.tsx",
    "docs/work-packages/WP-999.json",
    "server/services/schema-manager/schema-validators.cjs.bak",
  ];
  assert.deepEqual(wp.relevantScopeFiles(c, files, registries), [
    "docs/work-packages/TEST-001.json",
    "server/services/schema-manager/schema-validators.cjs",
    "scripts/vault-py/graph/extract_graph.py",
    "server/shared/persistence/derived-index-store.cjs",
  ], "自身文件＋paths（精确/前缀）＋zone writers 命中；他人的合同文件与无关源码不进来");
  // 跨包重叠面：同一文件同属两个包声明范围时，各包只在自己的范围过滤里看见它——
  // 全量对账因此不会再拿全局 diff 给无关包派生 R2（gates 假红的根因）。
  const other = contract({ package_id: "TEST-002", in_scope_zones: [], in_scope_paths: ["src/App.tsx"] });
  assert.deepEqual(wp.relevantScopeFiles(other, files, registries), ["src/App.tsx"], "按另一包自己的声明范围收，互不串包");
  assert.deepEqual(wp.relevantScopeFiles(c, [], registries), [], "空输入不派生");
});

test("R8 终态 SPEC 证据列待回填→义务；无待回填→无（正反例）", { skip: DESIGN_SKIP }, () => {
  const pending = wp.deriveObligations({ contract: contract({ status: "accepted", upstream: { adr: [], spec: ["docs/plans/含待回填.md"], proposal: [] } }), registries, staged: [] });
  // 夹具 spec 不存在 → readFileSync 失败按 false → 不触发；用真实含「待回填」语义验证需真文件——此处用设计稿（已回填前含待回填字样）动态验证
  const realPending = wp.deriveObligations({ contract: contract({ status: "accepted" }), registries, staged: [] });
  const specHasPending = /\|\s*待回填/.test(fs.readFileSync(path.join(ROOT, contract().upstream.spec[0]), "utf8"));
  assert.equal(realPending.some((o) => o.rule === 8), specHasPending, "R8 随 spec 实际内容变化（回填前红/回填后绿）");
  assert.ok(pending.every((o) => o.rule !== 8), "不存在的 spec 不误报 R8（fail 静默不判红——证据由 reconcile 的 spec 存在性兜底）");
});

test("R9 触及立法面→立法对账义务；非立法面→无（正反例·PR-254 处置口径）", () => {
  // 触发面＝PR-254 处置口径三件：data/theschema 字段说明、field-rule-declarations 声明族、ADR·SPEC（前缀命中）
  const legislative = [
    "data/theschema/fields.yaml",
    "server/shared/field-rule-declarations.cjs",
    "docs/adr/ADR-016-结构目标-四个唯一入口-消费面归属律.md",
    "docs/spec/SPEC-046-身份入口-不透明ID与P2撞键收敛.md",
  ];
  for (const f of legislative) {
    const hit = wp.deriveObligations({ contract: contract(), registries, staged: [f] });
    assert.ok(hit.some((o) => o.rule === 9), `立法面 ${f} → R9`);
  }
  // 反例：登记簿／前端码／写门执行件都不是立法面——声明族只认 field-rule-declarations.cjs，不扩整目录
  const miss = wp.deriveObligations({ contract: contract(), registries, staged: ["docs/plans/problem-register.md", "src/App.tsx", "server/services/entity-compliance/entity-repair-service.cjs"] });
  assert.ok(!miss.some((o) => o.rule === 9), "非立法面 → 无 R9");
  const ob9 = wp.deriveObligations({ contract: contract(), registries, staged: ["data/theschema/fields.yaml"] }).find((o) => o.rule === 9);
  assert.match(ob9.id, /^R9-[a-z0-9-]+$/, "id 形状过 reconcile 正则（R9 扩上限）");
  assert.match(ob9.duty, /不收编/, "义务含「不收编」出路口径（禁止默认沉默）");
  assert.match(ob9.duty, /豁免/, "义务内嵌纯进度回写豁免口径");
});

test("R9 对账双钉死点：rule=9 过 reconcile id 形状与真 schema（8→9 扩上限后绿）", () => {
  const c = contract({ obligations: [{ id: "R9-legislative-meta-align", rule: 9, trigger: "触及立法面", duty: "立法落笔前本体对账", check: "提交含对账结论留痕", status: "pending" }] });
  const { errors } = wp.reconcile(c, registries);
  assert.ok(!errors.some((e) => /形状非法|schema 不过/.test(e)), `R9 义务 id/rule 过双钉死点（reconcile 正则＋schema pattern/maximum）：${errors.join(";")}`);
});

test("reconcile：gated 占位红/终态未了结红/伪造 id 红/正常绿", () => {
  const gated = wp.reconcile(contract({ status: "gated", wiring: { trigger: "（draft 待填）", logging: "l", source: "s", sink: "k" } }), registries);
  assert.ok(gated.errors.some((e) => e.includes("wiring.trigger")), "gated 占位红");
  const terminal = wp.reconcile(contract({ status: "accepted", obligations: [{ id: "R1-x", rule: 1, duty: "d", check: "c", status: "pending" }] }), registries);
  assert.ok(terminal.errors.some((e) => e.includes("义务未了结")), "终态 pending 红");
  const forged = wp.reconcile(contract({ status: "accepted", obligations: [{ id: "手写-义务", rule: 1, duty: "d", check: "c", status: "fulfilled", evidence: "e" }] }), registries);
  assert.ok(forged.errors.length > 0 && /schema|形状非法/.test(forged.errors.join(";")), `伪造 id 红（schema pattern 层拦截）：${forged.errors.join(";")}`);
  const okc = wp.reconcile(contract({ status: "building" }), registries);
  assert.deepEqual(okc.errors, [], "building 正常绿");
});

test("单调累积：mergeObligations 同 id 不重复、只增不减（临时目录防夹具污染）", () => {
  const c1 = contract();
  const d1 = wp.deriveObligations({ contract: c1, registries, staged: [] });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tmp-merge-"));
  try {
    const { added: a1 } = wp.mergeObligations(c1, d1, tmp);
    assert.ok(a1.length > 0, "首并有效");
    assert.ok(fs.existsSync(path.join(tmp, "TEST-001.json")), "写入注入目录而非真实 docs/work-packages/");
    const before = c1.obligations.length;
    const d2 = wp.deriveObligations({ contract: c1, registries, staged: ["src/App.tsx"] });
    const { added: a2 } = wp.mergeObligations(c1, d2, tmp);
    assert.equal(a2.filter((o) => d1.some((x) => x.id === o.id)).length, 0, "同 id 不重复并入");
    assert.ok(c1.obligations.length >= before, "只增不减");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("zone 词表动态：域表 id ∪ extras；未知 zone 对账红", () => {
  const vocab = wp.zoneVocabulary(registries);
  assert.ok(vocab.has("derived-index-data") && vocab.has("openapi") && vocab.has("quality-gates"));
  assert.ok(!vocab.has("no-such-zone"));
  const bad = wp.reconcile(contract({ in_scope_zones: ["no-such-zone"] }), registries);
  assert.ok(bad.errors.some((e) => e.includes("未知 zone")));
});

test("契约锚定：真实例 WP-001 与真登记册对账绿（integration）——WP-123 归档批后锚定 archive/ 存档件", { skip: WP001_SKIP }, () => {
  const real = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/work-packages/archive/WP-001.json"), "utf8"));
  const realRegistries = wp.loadRegistries(ROOT);
  const { errors } = wp.reconcile(real, realRegistries);
  assert.deepEqual(errors, []);
});

// ── PR-137 结构性承载：R6 扩面＋SPEC 骨架生成＋开域域行落表（正反例＋幂等＋fail-closed）──

test("PR-137 R6 扩面：http-api 与域实例契约 json 触发矩阵义务（原只认 contracts-core——WP-026 漏走实录）", () => {
  const openapi = wp.deriveObligations({ contract: contract({ upstream: { adr: [], spec: ["README.md"], proposal: [] } }), registries, staged: ["contracts/http-api.openapi.json"] });
  assert.ok(openapi.some((o) => o.rule === 6), "触 openapi → R6（扩面前不触发）");
  const domainJson = wp.deriveObligations({ contract: contract({ upstream: { adr: [], spec: ["README.md"], proposal: [] } }), registries, staged: ["contracts/article-lifecycle.json"] });
  assert.ok(domainJson.some((o) => o.rule === 6), "触域实例契约 json → R6");
  const notContract = wp.deriveObligations({ contract: contract({ upstream: { adr: [], spec: ["README.md"], proposal: [] } }), registries, staged: ["src/App.tsx"] });
  assert.ok(!notContract.some((o) => o.rule === 6), "非契约文件 → 无 R6");
  assert.ok(wp.touchesContractFace(["contracts/anything.json"]) && !wp.touchesContractFace(["docs/x.md"]), "touchesContractFace 正反例");
});

test("PR-265：登记簿锚定施工前合同（spec 全为 problem-register#PR-N 锚）→ R6 跳过派生；真 SPEC 合同不变（破坏实验双向）", () => {
  const anchor = contract({ upstream: { adr: [], spec: ["docs/plans/problem-register.md#PR-233"], proposal: [] } });
  const derived = wp.deriveObligations({ contract: anchor, registries, staged: ["contracts/http-api.openapi.json"] });
  assert.ok(!derived.some((o) => o.rule === 6), "登记簿锚定合同 → 无 R6（矩阵的家＝登记簿条目，义务构造性不可满足即不派生）：derived=" + JSON.stringify(derived.map((o) => o.id)));
  const mixed = contract({ upstream: { adr: [], spec: ["docs/plans/problem-register.md#PR-233", "README.md"], proposal: [] } });
  assert.ok(wp.deriveObligations({ contract: mixed, registries, staged: ["contracts/http-api.openapi.json"] }).some((o) => o.rule === 6), "锚＋真文件混合 → R6 照派（真 SPEC 须载矩阵）");
  const noSpec = contract({ upstream: { adr: [], spec: [], proposal: [] } });
  assert.ok(wp.deriveObligations({ contract: noSpec, registries, staged: ["contracts/http-api.openapi.json"] }).some((o) => o.rule === 6), "spec 空 → R6 照派（fail-closed，防占位合同漏矩阵）");
});

test("PR-137 ensureSpecSkeleton：契约触及且无 docs/spec 条目→取号生成骨架＋回填；已有→不动；无契约触及→不动", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tmp-spec-"));
  try {
    fs.mkdirSync(path.join(tmp, "docs/spec"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "docs/spec/SPEC-001-既有.md"), "# SPEC-001 既有\n## 三、追踪矩阵\n| 约束条款 |\n");
    const c = contract({ upstream: { adr: [], spec: ["（draft 待填：含追踪矩阵的 SPEC/设计稿路径）"], proposal: [] } });
    const r = wp.ensureSpecSkeleton(c, ["contracts/http-api.openapi.json"], { root: tmp, dir: path.join(tmp, "docs/work-packages") });
    assert.equal(r.created, "docs/spec/SPEC-002-测试合同.md", "取号 max+1＝002；文件名取标题主题，不用 package_id");
    assert.ok(c.upstream.spec.includes("docs/spec/SPEC-002-测试合同.md"), "upstream.spec 回填");
    assert.ok(!c.upstream.spec.some((s) => s.includes("待填")), "占位项被替换");
    const body = fs.readFileSync(path.join(tmp, "docs/spec/SPEC-002-测试合同.md"), "utf8");
    assert.match(body, /追踪矩阵/, "骨架含矩阵表头（R6 门禁锚）");
    assert.match(body, /满足则验收通过/, "验收门句式锚");
    assert.match(body, /非目标/, "五节齐");
    // 已有 docs/spec 条目 → 不再生成
    const again = wp.ensureSpecSkeleton(c, ["contracts/http-api.openapi.json"], { root: tmp, dir: path.join(tmp, "docs/work-packages") });
    assert.equal(again.created, null, "已有 spec 条目 → 幂等不动");
    // 无契约触及 → 不生成
    const c2 = contract({ upstream: { adr: [], spec: ["（draft 待填）"], proposal: [] } });
    const noTouch = wp.ensureSpecSkeleton(c2, ["src/App.tsx"], { root: tmp, dir: path.join(tmp, "docs/work-packages") });
    assert.equal(noTouch.created, null, "无契约触及 → 不生成");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test("PR-137 ensureDomainRows：open 新域→落行写回＋幂等；extend 无行→fail-closed；已有→跳过", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tmp-dom-"));
  try {
    fs.mkdirSync(path.join(tmp, "contracts"), { recursive: true });
    const fixture = { registry_version: 1, status_values: ["candidate"], rules: [], domains: [{ id: "existing-domain", name: "既有", status: "candidate", authority: "x", contract: null, gate: null, tests: [], writers: [], description: "", recipes: null, guide: null, register_entry: "docs/plans/x.md", verification_evidence: null, metrics: null, last_updated: "2026-10-28", note: "" }] };
    fs.writeFileSync(path.join(tmp, "contracts/reuse-domains.json"), JSON.stringify(fixture, null, 2));
    const regs = { dataDomains: { domains: [] }, reuseDomains: JSON.parse(JSON.stringify(fixture)) };
    const c = contract({ domain_mapping: [
      { item: "i1", domain: "brand-new-domain（本包新立）", action: "open" },
      { item: "i2", domain: "existing-domain", action: "extend" },
      { item: "i3", domain: "ghost-domain", action: "extend" },
    ] });
    const r1 = wp.ensureDomainRows(c, regs, { root: tmp });
    assert.deepEqual(r1.added, ["brand-new-domain"], "open 新域落一行");
    assert.equal(r1.errors.length, 1, "extend 无行 fail-closed 红一条");
    assert.match(r1.errors[0], /ghost-domain/, "红指名不存在的域");
    const saved = JSON.parse(fs.readFileSync(path.join(tmp, "contracts/reuse-domains.json"), "utf8"));
    assert.ok(saved.domains.some((d) => d.id === "brand-new-domain" && d.status === "candidate"), "域表写回含骨架行");
    assert.equal(saved.domains.length, 2, "仅增不改既有行");
    // 幂等：再次跑（extend 错误仍在，open 已有→跳过）
    const r2 = wp.ensureDomainRows(c, regs, { root: tmp });
    assert.deepEqual(r2.added, [], "已有 id 幂等不加");
    assert.equal(wp.domainIdOf("state-layering（本包新立）"), "state-layering", "域名字符串解析");
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// 本组用隔离 Git 进程和真实暂存区验证 CLI，不提交、不改真仓，也不作为外部服务集成证据。
const checkerFile = "scripts/quality/check-fixture.mjs";
const testFile = "scripts/quality/__tests__/fixture.test.mjs";
const contractFile = "docs/work-packages/TEST-001.json";
const specFile = "docs/spec/SPEC-001-fixture.md";
const schemaFile = "contracts/work-package.schema.json";
const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_")));

function gitFixture(t, overrides = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "wp-derive-index-")));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const put = (file, value, stage = false) => {
    const dest = path.join(root, file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, typeof value === "string" ? value : JSON.stringify(value));
    if (stage) git("add", "--", file);
  };
  const git = (...args) => execFileSync("git", args, { cwd: root, env: cleanEnv, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
  git("init", "--quiet");
  put("scripts/quality/wp-derive.mjs", fs.readFileSync(path.join(ROOT, "scripts/quality/wp-derive.mjs"), "utf8"));
  fs.mkdirSync(path.join(root, "node_modules"));
  fs.symlinkSync(path.dirname(createRequire(import.meta.url).resolve("ajv/package.json")), path.join(root, "node_modules/ajv"), "dir");
  put(".gitignore", "node_modules/\nscripts/quality/wp-derive.mjs\n", true);
  const c = contract({ in_scope_zones: [], in_scope_paths: [checkerFile, testFile], upstream: { adr: [], spec: [specFile], proposal: [] }, ...overrides });
  // 夹具批默认暂存六份登记册与 schema 作对账输入——它们必须算「已认领」，否则每个既有夹具用例都会先撞上
  // PR-217 孤儿判（wp_contract_missing），与本组要验的规则无关。用并集而非覆盖：各用例自己声明的范围原样保留
  c.in_scope_paths = [...new Set([...(c.in_scope_paths || []), "contracts/"])];
  c.obligations = wp.deriveObligations({ contract: c, registries }).map((o) => ({ ...o, status: "fulfilled", evidence: "fixture" }));
  put("contracts/data-domains.json", { domains: [] }, true);
  put("contracts/reuse-domains.json", { domains: [] }, true);
  put("contracts/quality-gates.json", { gates: [] }, true);
  put("contracts/retired-routes.json", { retired: [] }, true);
  put("contracts/test-coverage-baseline.json", { unclaimed: {} }, true);
  put("package.json", { scripts: {} }, true);
  put(schemaFile, fs.readFileSync(path.join(ROOT, schemaFile), "utf8"), true);
  put(specFile, "## 追踪矩阵\n| 实测证据 | 已验证 |\n", true);
  put(contractFile, c, true);
  const run = (args = ["--pre-commit"], env = {}) => {
    const result = spawnSync(process.execPath, [path.join(root, "scripts/quality/wp-derive.mjs"), ...args], {
      cwd: root, encoding: "utf8", env: { ...cleanEnv, WP_ENFORCE: "1", STAGED_FILES: contractFile, ...env },
    });
    assert.ifError(result.error);
    assert.notEqual(result.status, null, result.stderr);
    return { status: result.status, output: result.stdout + result.stderr, stdout: result.stdout };
  };
  return { root, put, git, run, c };
}

function expectRule(result, rule, denied) {
  assert.equal(result.status, denied ? 1 : 0, result.output);
  if (denied) assert.match(result.output, new RegExp(`R${rule}-`));
  else assert.doesNotMatch(result.output, /would-deny|work-packages\(enforce\)/);
}

test("R7 command 只认根路径完整 token 与完整 npm 命令/别名", () => {
  for (const command of [
    `node ${checkerFile}`, `node ./${checkerFile} --strict`, `node "./${checkerFile}"`,
    "npm run check:fixture", "npm run-script check:fixture", "npm run other && npm run check:fixture -- --strict",
  ]) {
    const regs = { ...registries, gates: { gates: [{ command }] }, scripts: { "check:fixture": `node ${checkerFile}` } };
    assert.ok(wp.registeredCheckers(regs).has(checkerFile), command);
  }
  for (const command of [
    `node archive/${checkerFile}`, `node /tmp/${checkerFile}`, `node x${checkerFile}`,
    `node "archive/${checkerFile}"`, `node ${checkerFile}.bak`, `node "${checkerFile}".bak`,
    "notnpm run check:fixture", "archive/npm run check:fixture", "npm run check:fixture/extra", "npm run check:fixture$SUFFIX",
  ]) {
    const regs = { ...registries, gates: { gates: [{ command }] }, scripts: { "check:fixture": `node ${checkerFile}` } };
    assert.ok(wp.deriveObligations({ contract: contract(), registries: regs, staged: [checkerFile] }).some((o) => o.rule === 7), command);
  }
});

test("R4 范围内 openapi 用完整批次类型证明，批次越界 openapi 不触发", () => {
  const batchFiles = ["contracts/http-api.openapi.json", "src/lib/generated/api-types.ts"];
  const paired = wp.deriveObligations({ contract: contract(), registries, staged: [batchFiles[0]], batchFiles });
  assert.ok(!ids(paired).includes(4));
  const outside = wp.deriveObligations({ contract: contract(), registries, staged: ["src/App.tsx"], batchFiles: [batchFiles[0]] });
  assert.ok(!ids(outside).includes(4));
});

test("pre-commit 注册只认暂存内容，外部 STAGED_FILES 子集不能漏掉检查器", async (t) => {
  for (const stagedRegistration of [false, true]) await t.test(`暂存注册=${stagedRegistration}`, (t) => {
    const f = gitFixture(t);
    f.put(checkerFile, "export {};\n", true);
    f.put("contracts/quality-gates.json", { gates: stagedRegistration ? [{ command: `node ${checkerFile}` }] : [] }, true);
    f.put("contracts/quality-gates.json", { gates: stagedRegistration ? [] : [{ command: `node ${checkerFile}` }] });
    expectRule(f.run(), 7, !stagedRegistration);
  });
});

test("pre-commit npm 别名只从暂存 package.json 解析", async (t) => {
  for (const stagedAlias of [false, true]) await t.test(`暂存别名=${stagedAlias}`, (t) => {
    const f = gitFixture(t);
    f.put(checkerFile, "export {};\n", true);
    f.put("contracts/quality-gates.json", { gates: [{ command: "npm run check:fixture" }] }, true);
    f.put("package.json", { scripts: { "check:fixture": stagedAlias ? `node ${checkerFile}` : "node other.mjs" } }, true);
    f.put("package.json", { scripts: { "check:fixture": stagedAlias ? "node other.mjs" : `node ${checkerFile}` } });
    expectRule(f.run(), 7, !stagedAlias);
  });
});

test("pre-commit 新增测试认领只读暂存的门禁/两域表", async (t) => {
  for (const registry of ["quality-gates", "data-domains", "reuse-domains"]) {
    for (const claimed of [false, true]) await t.test(`${registry} 暂存认领=${claimed}`, (t) => {
      const f = gitFixture(t);
      const value = (yes) => registry === "quality-gates"
        ? { gates: [{ testFiles: yes ? [testFile] : [] }] }
        : { domains: [{ id: "fixture", tests: yes ? [testFile] : [] }] };
      f.put(testFile, "export {};\n", true);
      f.put(`contracts/${registry}.json`, value(claimed), true);
      f.put(`contracts/${registry}.json`, value(!claimed));
      expectRule(f.run(), 3, !claimed);
    });
  }
});

test("pre-commit R6/R8 SPEC 证据只读暂存版本", async (t) => {
  for (const rule of [6, 8]) for (const valid of [false, true]) await t.test(`R${rule} 暂存合规=${valid}`, (t) => {
    const f = gitFixture(t, { status: rule === 8 ? "accepted" : "building", in_scope_paths: ["contracts/fixture.json"] });
    f.put("contracts/fixture.json", {}, true);
    const good = "## 追踪矩阵\n| 实测证据 | 已验证 |\n";
    const bad = rule === 6 ? "# 尚无矩阵\n" : "## 追踪矩阵\n| 待回填 |\n";
    f.put(specFile, valid ? good : bad, true);
    f.put(specFile, valid ? bad : good);
    expectRule(f.run(), rule, !valid);
  });
});

test("pre-commit 合同字段/义务/范围及枚举都只认暂存版本", async (t) => {
  for (const stagedValid of [false, true]) await t.test(`暂存义务合规=${stagedValid}`, (t) => {
    const f = gitFixture(t);
    const invalid = { ...f.c, obligations: [] };
    f.put(contractFile, stagedValid ? f.c : invalid, true);
    f.put(contractFile, stagedValid ? invalid : f.c);
    expectRule(f.run(), 1, !stagedValid);
  });
  await t.test("工作区删除合同不能从枚举中隐藏暂存合同", (t) => {
    const f = gitFixture(t);
    f.put(checkerFile, "export {};\n", true);
    fs.unlinkSync(path.join(f.root, contractFile));
    expectRule(f.run(), 7, true);
  });
  await t.test("未暂存新合同不参与检查，未暂存范围不遮蔽检查器", (t) => {
    const f = gitFixture(t);
    f.put("docs/work-packages/TEST-002.json", contract({ package_id: "TEST-002", in_scope_paths: [checkerFile] }));
    expectRule(f.run(), 1, false);
    f.put(checkerFile, "export {};\n", true);
    f.put(contractFile, { ...f.c, in_scope_paths: [] });
    expectRule(f.run(), 7, true);
  });
});

test("pre-commit schema 取暂存版本且对账错误遵循 observe/enforce", async (t) => {
  for (const stagedValid of [false, true]) await t.test(`暂存 schema 允许合同=${stagedValid}`, (t) => {
    const f = gitFixture(t);
    const schema = JSON.parse(fs.readFileSync(path.join(ROOT, schemaFile), "utf8"));
    const rejecting = { ...schema, required: [...schema.required, "fixture_required"] };
    f.put(schemaFile, stagedValid ? schema : rejecting, true);
    f.put(schemaFile, stagedValid ? rejecting : schema);
    const result = f.run();
    assert.equal(result.status, stagedValid ? 0 : 1, result.output);
    if (!stagedValid) assert.match(result.output, /schema.*fixture_required/);
  });
  for (const [label, patch, error] of [
    ["字段缺失", { wiring: {} }, /schema.*trigger/],
    ["未知状态", { status: "not-a-status" }, /schema.*status/],
    ["义务形状", { obligations: {} }, /schema.*obligations/],
    ["占位字段", { wiring: { trigger: "待填", logging: "l", source: "s", sink: "k" } }, /wiring.trigger/],
    ["终态缺证据", { status: "accepted", obligations: [{ id: "R1-test-001", rule: 1, duty: "d", check: "c", status: "fulfilled" }] }, /缺 evidence/],
    ["未知域", { in_scope_zones: ["unknown"] }, /未知 zone/],
  ]) await t.test(label, (t) => {
    const f = gitFixture(t);
    f.put(contractFile, { ...f.c, ...patch }, true);
    f.put(contractFile, f.c);
    const observe = f.run(["--pre-commit"], { WP_ENFORCE: "0" });
    assert.equal(observe.status, 0, observe.output);
    assert.match(observe.output, /work-packages\(observe\).*would-deny/);
    assert.match(observe.output, error);
    const enforce = f.run();
    assert.equal(enforce.status, 1, enforce.output);
    assert.match(enforce.output, /work-packages\(enforce\)/);
    assert.match(enforce.output, error);
  });
});

test("pre-commit 实际合同文件变更不能被缺失或错误 package_id 隐藏", async (t) => {
  for (const invalid of [{}, { package_id: "OTHER" }, { in_scope_paths: [], in_scope_zones: [] }]) await t.test(JSON.stringify(invalid), (t) => {
    const f = gitFixture(t);
    f.put(contractFile, invalid, true);
    const result = f.run();
    assert.equal(result.status, 1, result.output);
    assert.match(result.output, /schema|暂存对账失败/);
  });
});

test("pre-commit R4 同批已暂存类型跨 scope 仍作证明，未暂存不作证明", async (t) => {
  for (const stagedTypes of [false, true]) await t.test(`暂存类型=${stagedTypes}`, (t) => {
    const f = gitFixture(t, { in_scope_paths: ["contracts/http-api.openapi.json"] });
    f.put("contracts/http-api.openapi.json", {}, true);
    f.put("src/lib/generated/api-types.ts", "export {};\n", stagedTypes);
    expectRule(f.run(), 4, !stagedTypes);
  });
});

test("pre-commit wrong-prefix command 不能替代根目录检查器注册", (t) => {
  const f = gitFixture(t);
  f.put(checkerFile, "export {};\n", true);
  f.put("contracts/quality-gates.json", { gates: [{ command: `node archive/${checkerFile}` }] }, true);
  expectRule(f.run(), 7, true);
});

test("路由删除 diff 失败必须显式报错，不能当作无删除", (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "wp-derive-no-git-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.throws(() => wp.detectRouteRemovals(["server/routes/fixture.cjs"], root));
});

test("pre-commit 路由 diff 进程失败报告 observe/enforce，不伪装无删除", (t) => {
  const routeFile = "server/routes/fixture.cjs";
  const f = gitFixture(t, { in_scope_paths: [routeFile] });
  f.put(routeFile, 'registerRoute("GET", "/fixture", handler);\n', true);
  for (const enforce of ["0", "1"]) {
    const result = f.run(["--pre-commit"], { WP_ENFORCE: enforce, GIT_EXTERNAL_DIFF: "false" });
    assert.equal(result.status, Number(enforce), result.output);
    assert.match(result.output, /暂存对账失败.*git diff --cached/);
    assert.match(result.output, enforce === "1" ? /work-packages\(enforce\).*deny/ : /work-packages\(observe\).*would-deny/);
  }
});

test("--write 纳入未跟踪检查器/测试并过滤 scope，R4 用完整工作树批次", (t) => {
  const f = gitFixture(t, { in_scope_paths: [checkerFile, testFile, "contracts/http-api.openapi.json"] });
  f.put(checkerFile, "export {};\n");
  f.put(testFile, "export {};\n");
  f.put("scripts/quality/check-outside.mjs", "export {};\n");
  f.put("scripts/quality/__tests__/outside.test.mjs", "export {};\n");
  f.put("contracts/http-api.openapi.json", {}, true);
  f.put("src/lib/generated/api-types.ts", "export {};\n", true);
  const result = f.run(["TEST-001", "--write"]);
  assert.equal(result.status, 0, result.output);
  const saved = JSON.parse(fs.readFileSync(path.join(f.root, contractFile), "utf8"));
  assert.ok(ids(saved.obligations).includes(7));
  assert.ok(ids(saved.obligations).includes(3));
  assert.ok(!ids(saved.obligations).includes(4));
  assert.ok(saved.obligations.every((o) => !o.trigger.includes("outside")));
  const again = f.run(["TEST-001", "--write"]);
  assert.equal(again.status, 0, again.output);
  assert.deepEqual(JSON.parse(again.stdout).added, []);
});

test("--write 未跟踪测试使用磁盘认领，--plan/--check-all 仍读磁盘全量账本", (t) => {
  const f = gitFixture(t);
  f.put(testFile, "export {};\n");
  f.put("contracts/quality-gates.json", { gates: [{ testFiles: [testFile], command: `node ${checkerFile}` }] });
  const written = f.run(["TEST-001", "--write"]);
  assert.equal(written.status, 0, written.output);
  assert.ok(!JSON.parse(written.stdout).added.some((id) => id.startsWith("R3-")));
  const plan = f.run(["TEST-001", "--plan"]);
  assert.equal(plan.status, 0, plan.output);
  assert.ok(!ids(JSON.parse(plan.stdout).preview_obligations).includes(7));
  f.put(contractFile, { ...f.c, wiring: { ...f.c.wiring, trigger: "待填" } });
  const checked = f.run(["--check-all"]);
  assert.equal(checked.status, 1, checked.output);
  assert.match(checked.output, /wiring.trigger/);
});

// ── PR-217 孤儿改动判据（WP-087）：把循环主体从「在册合同」换成「暂存集」，缺实例的批才可见 ──

test("wp_contract_missing 分母：契约与钩子与新建执法件算，改既有 checker 与文档类不算", () => {
  const own = contract({ in_scope_paths: ["docs/spec/x.md"] });
  const gap = (staged, added = []) => wp.orphanContractGaps(staged, [own], new Set(added), { registries });
  assert.deepEqual(gap(["contracts/foo.json"]), ["contracts/foo.json"], "改契约而无一册合同覆盖＝孤儿");
  assert.deepEqual(gap(["contracts/x.schema.json"]), ["contracts/x.schema.json"], "契约 schema 同属 contracts/ 触及面");
  assert.deepEqual(gap([".githooks/pre-commit"]), [".githooks/pre-commit"], "钩子执行面同判");
  assert.deepEqual(gap(["scripts/quality/check-new.mjs"], ["scripts/quality/check-new.mjs"]), ["scripts/quality/check-new.mjs"], "新增执法件同判");
  assert.deepEqual(gap(["scripts/quality/check-new.mjs"]), [], "改既有 checker 不触发——否则每次修门禁都变成要开包");
  assert.deepEqual(gap(["docs/plans/problem-register.md", "docs/dev-log/progress.json", "src/App.tsx", "docs/spec/SPEC-001-x.md"]), [],
    "登记簿·台账·业务码·SPEC 不属本判（AGENTS §五 允许其走直接修复并随台账入账）");
  const covered = contract({ in_scope_paths: ["contracts/", ".githooks/"] });
  assert.deepEqual(wp.orphanContractGaps(["contracts/foo.json", ".githooks/pre-commit"], [covered], new Set(), { registries }), [], "被在册合同的声明范围覆盖即不误伤");
  assert.deepEqual(wp.orphanContractGaps(["contracts/foo.json"], [], new Set(), { registries }), ["contracts/foo.json"], "一册合同都没有时全算孤儿（--check-all 的 contracts=0 提示不是覆盖）");
  // 已并入的老合同是台账不是授权——若拿它当覆盖，本判会在几十个历史包面前变成永不红的空转（真树实测踩到）
  const retired = contract({ status: "merged", in_scope_paths: ["contracts/"] });
  assert.deepEqual(wp.orphanContractGaps(["contracts/foo.json"], [retired], new Set(), { registries }), ["contracts/foo.json"],
    "merged 合同的宽范围声明不得替新批背书");
  assert.deepEqual(wp.orphanContractGaps(["contracts/foo.json"], [retired, covered], new Set(), { registries }), [],
    "同一文件有在途合同认领即不报（在途与否是唯一判据）");
});

test("孤儿判在 pre-commit 真暂存面红并给出口；并入声明范围即转绿，observe 档只报不拦", async (t) => {
  const f = gitFixture(t);
  f.put(".githooks/hook-face", "#!/bin/sh\nexit 0\n", true);
  const denied = f.run();
  assert.equal(denied.status, 1, denied.output);
  assert.match(denied.output, /wp_contract_missing/);
  assert.match(denied.output, /\.githooks\/hook-face/, "红须点名到文件");
  assert.match(denied.output, /wp:start/, "红须给出口（不能只说红）");
  f.c.in_scope_paths = [...(f.c.in_scope_paths || []), ".githooks/"];
  f.put(contractFile, f.c, true);
  const green = f.run();
  assert.equal(green.status, 0, green.output);
  assert.doesNotMatch(green.output, /wp_contract_missing/, "认领之后不得继续挂红（豁免空转的同一纪律）");
  f.put(contractFile, contract({ ...f.c, in_scope_paths: ["docs/spec/x.md"] }), true);
  const observed = f.run(["--pre-commit"], { WP_ENFORCE: "0" });
  assert.equal(observed.status, 0, "observe 档退出 0——与既有双档一致，不把并行在飞批一次拦死");
  assert.match(observed.stdout, /wp_contract_missing/, "observe 档仍如实打印，不静默");
  assert.match(observed.stdout, /would-deny/);
});

test("WP-129：退役即删豁免——fileExists 判假的暂存脚本不派 R7（删除形态非新检查器）；判真照派", () => {
  const del = wp.deriveObligations({ contract: contract(), registries, staged: ["scripts/quality/check-gone.mjs"], fileExists: () => false });
  assert.ok(!del.some((o) => o.rule === 7), "已删除文件 → 无 R7（WP-129 批 1 合法退役被 enforce 误派实录）");
  const alive = wp.deriveObligations({ contract: contract(), registries, staged: ["scripts/quality/check-gone.mjs"], fileExists: () => true });
  assert.ok(alive.some((o) => o.rule === 7), "文件在盘且未注册 → R7 照派（准入执法不松）");
});

test("PR-265 缝三：pre-commit 只执法在建合同——merged/draft 跳过不执法，building R6 照派", (t) => {
  for (const [status, expectR6] of [["merged", false], ["draft", false], ["building", true]]) {
    const f = gitFixture(t, { status, in_scope_paths: ["contracts/fixture.json"] });
    f.put(specFile, "# 尚无矩阵\n", true); // 覆盖夹具默认的矩阵版——暂存版无矩阵才派 R6
    f.put("contracts/fixture.json", {}, true);
    const r = f.run(["--pre-commit"], { STAGED_FILES: "contracts/fixture.json" }); // R6 触发面＝暂存 contracts/*.json
    const out = r.output;
    const hasR6 = /R6-matrix/.test(out);
    const selfEnforced = /TEST-001 deny/.test(out);
    assert.equal(hasR6, expectR6, `${status} R6=${hasR6} 预期 ${expectR6}：${out.slice(0, 260)}`);
    assert.ok(expectR6 || !selfEnforced, `${status} 合同自身义务不得执法（僵尸债）：${out.slice(0, 260)}`);
    // 注：merged/draft 跳过后，其路径的孤儿判定由 orphanContractGaps 按「在册合同」口径另行处理，不属本断言。
  }
});
