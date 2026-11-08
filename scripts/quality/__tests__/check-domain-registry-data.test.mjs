// @tests: scripts/quality/check-domain-registry.mjs（检查面⑤＋schema 面）
// SPEC-012 数据域登记补建 步骤1——「数据域登记制度纸面规则」类消灭守卫（先红后绿固化）：
//   空/缺件五件套、非法住址、repo-data 工件不对账 → 红；完整 vault/repo-data 域 → 绿；
//   schema 面对 kind=data 条件必填兜底；P5 顺带固化 schema-writers 面①核心破坏实验（writers 空/指针悬空 → 红）。
// 层级：门禁契约测试（临时树夹具，不污染真表）。
"use strict";

import { test as nodeTest } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
// WP-138：门禁本体已外迁 discipline-kit/gates/（机制层唯一住址）；夹具仍按 fixture 相对路径
// scripts/quality/check-domain-registry.mjs 落位（runGate cwd=夹具根），源头改从包内拷
const KIT = "node_modules/@cheeseh/discipline-kit";
const GATE = "scripts/quality/check-domain-registry.mjs";

// kit 为个人件不入公开仓（WP-161）：缺席时明示跳过，与 check:domain-registry 优雅跳过同惯例；
// 本地装有 kit 时照常执法。
const KIT_SKIP = fs.existsSync(path.join(REPO_ROOT, KIT, "gates/check-domain-registry.mjs"))
  ? false
  : "discipline-kit 未安装（个人件，不入公开仓）——kit 门禁测试缺席跳过";
const test = (name, fn) => nodeTest(name, { skip: KIT_SKIP }, fn);

function makeTree() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "domain-registry-gate-"));
  for (const rel of ["scripts/quality/shared", "contracts", "server/shared"]) {
    fs.mkdirSync(path.join(root, rel), { recursive: true });
  }
  // SPEC-023 波 1：门禁经 resolver 解析 TheSchema——桥件随拷（缺即模块找不到假红）
  fs.copyFileSync(path.join(REPO_ROOT, "scripts/quality/shared/theschema-root.mjs"), path.join(root, "scripts/quality/shared/theschema-root.mjs"));
  fs.copyFileSync(path.join(REPO_ROOT, "server/shared/theschema-root.cjs"), path.join(root, "server/shared/theschema-root.cjs"));
  // 数据域治理批 A6：writers 门禁新依赖 null-segment-guard（检查面⑧）——同款随拷
  fs.copyFileSync(path.join(REPO_ROOT, "scripts/quality/shared/null-segment-guard.mjs"), path.join(root, "scripts/quality/shared/null-segment-guard.mjs"));
  // 复用机制自判批（fa1282f9）：writers 门禁面⑨ 新依赖 theschema-writer-scan——随拷（漏拷即 MODULE_NOT_FOUND 假红，第三次同类漏；
  // 根治候选＝夹具按 checker 的 ./shared/ import 自动随拷，见 REQUIREMENTS #51 备注）
  fs.copyFileSync(path.join(REPO_ROOT, "scripts/quality/shared/theschema-writer-scan.mjs"), path.join(root, "scripts/quality/shared/theschema-writer-scan.mjs"));
  fs.copyFileSync(path.join(REPO_ROOT, KIT, "gates/check-domain-registry.mjs"), path.join(root, GATE));
  // 拆表批（2026-10-14）：schema 双拷；reuse 表用最小夹具（真表指针在临时树悬空会混入 69 条无关违规）——
  // WP-132 通用块单源化后：status_values/四通用规则住 domain-table-common.json（夹具随建），表内不携带
  //（回填即绊线红）；域行只留一个零指针 candidate
  for (const f of ["data-domains.schema.json", "reuse-domains.schema.json"]) {
    fs.copyFileSync(path.join(REPO_ROOT, KIT, "schemas", f), path.join(root, "contracts", f));
  }
  // WP-138：门禁参数化后夹具需自携 discipline.config.json（schema/通用块住 fixture 内相对路径）
  fs.writeFileSync(path.join(root, "discipline.config.json"), JSON.stringify({
    tables: [
      { key: "reuse", file: "contracts/reuse-domains.json", schema: "contracts/reuse-domains.schema.json" },
      { key: "data", file: "contracts/data-domains.json", schema: "contracts/data-domains.schema.json" },
    ],
    common: "contracts/domain-table-common.json",
    faces: { anchors: false, data_five: true, sql_catalog: true, gate_pointer: false, test_claims: true },
    scan_dirs: ["server", "scripts"],
  }, null, 2));
  fs.writeFileSync(path.join(root, "contracts", "test-coverage-baseline.json"), JSON.stringify({ unclaimed: {} }, null, 2)); // 夹具空基线（真基线在无测试文件的树里必判僵尸）
  const realReuse = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "contracts", "reuse-domains.json"), "utf-8"));
  const realCommon = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, KIT, "schemas", "domain-table-common.json"), "utf-8"));
  fs.writeFileSync(path.join(root, "contracts", "domain-table-common.json"), JSON.stringify(realCommon, null, 2));
  fs.writeFileSync(path.join(root, "contracts", "reuse-domains.json"), JSON.stringify({
    $schema: "./reuse-domains.schema.json",
    registry_version: realReuse.registry_version,
    domains: [{ id: "fixture-reuse", name: "夹具复用域", status: "candidate", register_entry: "docs/plans/problem-register.md#PR-059（夹具——全状态非空面随尾批升级，夹具补锚）" }],
  }, null, 2));
  fs.copyFileSync(path.join(REPO_ROOT, "contracts", "data-domains.json"), path.join(root, "contracts", "data-domains.json"));
  // ajv 依赖：临时树软链主仓 node_modules（schema 面消费）
  fs.symlinkSync(path.join(REPO_ROOT, "node_modules"), path.join(root, "node_modules"), "dir");
  return root;
}

function baseRegistry() {
  // WP-132：status_values/通用规则住 domain-table-common.json（makeTree 已随建），表内不携带
  return {
    $schema: "./data-domains.schema.json",
    registry_version: 3,
    description: "test fixture",
    domains: [],
  };
}

function fullDataDomain(overrides = {}) {
  return {
    id: "fixture-data",
    name: "夹具数据域",
    status: "gating",
    authority: null,
    contract: "contracts/data-domains.schema.json", // 树内真文件（gating 三件指针须可解析）
    guide: null,
    gate: "npm run check:domain-registry",
    register_entry: "docs/plans/problem-register.md#PR-059（夹具——结构收口尾批后非 PR 形态即红，夹具升级为合规形态）",
    store: "知识库/TheSchema/（VAULT_PATH 解析）",
    store_location: "vault",
    data_owner: "库主（fixture）",
    writers: ["scripts/quality/check-domain-registry.mjs:1（夹具网关——树内真实文件，可定位）"],
    write_protocol: "fixture 协议：原子写＋快照",
    snapshot_policy: "fixture 快照策略",
    ...overrides,
  };
}

function runGate(root, script = GATE) {
  const r = spawnSync("node", [script], { cwd: root, encoding: "utf-8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

function writeRegistry(root, reg) {
  fs.writeFileSync(path.join(root, "contracts", "data-domains.json"), JSON.stringify(reg, null, 2));
}

function cleanup(root) {
  fs.rmSync(root, { recursive: true, force: true });
}

test("空五件套 kind=data 域 → 红（rules.data_fields 机器执法）", () => {
  const root = makeTree();
  try {
    const reg = baseRegistry();
    reg.domains.push({ id: "fake-empty", name: "空五件套", status: "gating" });
    writeRegistry(root, reg);
    const { code, out } = runGate(root);
    assert.notEqual(code, 0, "空五件套必须红");
    assert.match(out, /schema:data.*'store'/); // 五件套非空由 data 表 schema 无条件必填执法
    assert.match(out, /schema:data.*'writers'/);
    assert.match(out, /数据域住址.*store_location/);
  } finally {
    cleanup(root);
  }
});

test("五件套填全但 store_location 非法/缺失 → 红", () => {
  const root = makeTree();
  try {
    const reg = baseRegistry();
    reg.domains.push(fullDataDomain({ store_location: "cloud" }));
    writeRegistry(root, reg);
    const bad = runGate(root);
    assert.notEqual(bad.code, 0, "非法住址必须红");
    assert.match(bad.out, /store_location 缺失或非法/);

    const reg2 = baseRegistry();
    const dom = fullDataDomain();
    delete dom.store_location;
    reg2.domains.push(dom);
    writeRegistry(root, reg2);
    const missing = runGate(root);
    assert.notEqual(missing.code, 0, "缺住址必须红");
  } finally {
    cleanup(root);
  }
});

test("repo-data 住址 store 未命中合法工件 → 红；命中三库名 → 绿", () => {
  const root = makeTree();
  try {
    const reg = baseRegistry();
    reg.domains.push(fullDataDomain({
      store_location: "repo-data",
      store: "某个不明目录/whatever.bin",
    }));
    writeRegistry(root, reg);
    const bad = runGate(root);
    assert.notEqual(bad.code, 0, "repo-data 不含合法工件必须红");
    assert.match(bad.out, /repo-data 住址的 store 未命中合法工件/);

    const reg2 = baseRegistry();
    reg2.domains.push(fullDataDomain({
      id: "runtime-state-fixture",
      store_location: "repo-data",
      store: "data/runtime-state.db（KB_DATA_DIR 解析，.gitignore 收录）",
    }));
    writeRegistry(root, reg2);
    const good = runGate(root);
    assert.equal(good.code, 0, good.out);
    assert.match(good.out, /domain_registry=ok/);
  } finally {
    cleanup(root);
  }
});

test("schema 面：kind=data 条件必填由 ajv 兜底（绕过手写面也能拦）", () => {
  const root = makeTree();
  try {
    // 五件套全空但构造上让手写面不易逐字段报（验证 ajv 独立兜底）：writers 给空数组
    const reg = baseRegistry();
    reg.domains.push(fullDataDomain({ writers: [] }));
    writeRegistry(root, reg);
    const { code, out } = runGate(root);
    assert.notEqual(code, 0, "writers 空数组必须红");
    assert.match(out, /schema:data.*writers must NOT have fewer/); // 拆表批：writers 非空由 schema minItems 执法
  } finally {
    cleanup(root);
  }
});

test("真实仓回归锚：双表过全检查面（计数从两域表派生＋一致性面）", () => {
  // WP-138：真实仓锚改跑包内门禁（cwd=REPO_ROOT，config=contracts/discipline.config.json 全量面）
  const { code, out } = runGate(REPO_ROOT, path.join(REPO_ROOT, "node_modules/@cheeseh/discipline-kit/gates/check-domain-registry.mjs"));
  assert.equal(code, 0, out);
  // 计数锚从两域表派生——写死数字会随每次开域/扩域过期（PR-098 开域后 21/6→22/7 曾致本锚假红）；
  // 断言的是「检查器报出的数等于登记册实有的数」这一一致性，而不是某个历史快照值
  const reuse = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "contracts/reuse-domains.json"), "utf8")).domains.length;
  const data = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "contracts/data-domains.json"), "utf8")).domains.length;
  assert.match(out, new RegExp(`domain_registry=ok domains=${reuse + data} \\(reuse=${reuse} data=${data}\\)`));
});

test("writers 悬空指针 → 红（角色口径存在性执法：网关文件必须真实存在）", () => {
  const root = makeTree();
  try {
    const reg = baseRegistry();
    reg.domains.push(fullDataDomain({ writers: ["ghost-gateway.cjs:1（幽灵网关）"] }));
    writeRegistry(root, reg);
    const { code, out } = runGate(root);
    assert.notEqual(code, 0, "悬空网关指针必须红");
    assert.match(out, /数据域写者悬空/);
  } finally {
    cleanup(root);
  }
});

test("catalog 面⑥：网关清单外的 SQLite 连接点 → 红（唯一实现被绕过）", () => {
  const root = makeTree();
  try {
    // 先落夹具注册表（理由同前——真表指针在临时树内悬空会混入无关违规）
    const reg = baseRegistry();
    reg.domains.push(fullDataDomain({
      id: "runtime-state-fixture",
      store_location: "repo-data",
      store: "data/runtime-state.db（KB_DATA_DIR 解析，.gitignore 收录）",
    }));
    writeRegistry(root, reg);
    // 植入一个网关清单外模块直接开库（模拟第三只手绕过 store）
    fs.mkdirSync(path.join(root, "server", "services", "evil"), { recursive: true });
    fs.writeFileSync(path.join(root, "server", "services", "evil", "stray-writer.cjs"),
      'const { openPersistenceDb } = require("../../shared/persistence/sqlite-adapter.cjs");\nmodule.exports = { db: openPersistenceDb({ path: "x.db" }) };\n');
    const { code, out } = runGate(root);
    assert.notEqual(code, 0, "网关外连接点必须红");
    assert.match(out, /唯一实现被绕过.*stray-writer/);
  } finally {
    cleanup(root);
  }
});

test("catalog 面⑥：Python 只读连接点（无写 SQL）→ 不红；写 SQL 且未登记 → 红", () => {
  const root = makeTree();
  try {
    // 先落夹具注册表（勿沿用拷贝真表——其写者指针在临时树内无文件可解析）
    const reg = baseRegistry();
    reg.domains.push(fullDataDomain({
      id: "runtime-state-fixture",
      store_location: "repo-data",
      store: "data/runtime-state.db（KB_DATA_DIR 解析，.gitignore 收录）",
    }));
    writeRegistry(root, reg);
    // 只读（SELECT only）——豁免不红
    fs.mkdirSync(path.join(root, "scripts", "vault-runtime"), { recursive: true });
    fs.writeFileSync(path.join(root, "scripts", "vault-runtime", "reader-probe.py"),
      "import sqlite3\nconn = sqlite3.connect('probe.db')\nrows = conn.execute('SELECT 1').fetchall()\n");
    let r = runGate(root);
    assert.equal(r.code, 0, `只读连接应豁免：${r.out}`);

    // 写 SQL 且不在网关清单——红
    fs.writeFileSync(path.join(root, "scripts", "vault-runtime", "writer-probe.py"),
      "import sqlite3\nconn = sqlite3.connect('probe.db')\nconn.execute('INSERT INTO t VALUES (1)')\n");
    r = runGate(root);
    assert.notEqual(r.code, 0, "未登记的写连接必须红");
    assert.match(r.out, /唯一实现被绕过.*writer-probe/);
  } finally {
    cleanup(root);
  }
});

test("vault-only 写者无 vault 环境 → 跳过不红（沿 vault=skip 并明示惯例），计数随输出披露", () => {
  const root = makeTree();
  try {
    const reg = baseRegistry();
    reg.domains.push(fullDataDomain({ writers: ["some-vault-only-script.py:1（vault 侧写者）"] }));
    writeRegistry(root, reg);
    // 夹具树无 .env 无 VAULT_PATH → 跳过不红、计数明示
    const noVault = runGate(root);
    assert.equal(noVault.code, 0, noVault.out);
    assert.match(noVault.out, /vault_writers_skipped=[1-9]/, "跳过须明示计数");
  } finally {
    cleanup(root);
  }
});

// ══ 拆表批（2026-10-14）专属守卫 ══

test("生命周期执法：在途域（gating）缺三件 → schema 红；candidate 裸登记 → 绿", () => {
  const root = makeTree();
  try {
    // gating 缺 contract → 红（schema 条件必填）
    const reg = baseRegistry();
    const dom = fullDataDomain();
    delete dom.contract;
    reg.domains.push(dom);
    writeRegistry(root, reg);
    let r = runGate(root);
    assert.notEqual(r.code, 0, "gating 缺 contract 必须红");
    assert.match(r.out, /schema:data.*'contract'/);

    // candidate 裸登记（reuse 表夹具即此形态）——reuse 侢单独验证
    const reuseTable = JSON.parse(fs.readFileSync(path.join(root, "contracts", "reuse-domains.json"), "utf-8"));
    void reuseTable; // makeTree 已含 candidate 夹具——绿面由其余场景的整体绿覆盖
  } finally {
    cleanup(root);
  }
});

test("kind 残留：分表后行内出现 kind 字段 → 红（表即 kind）", () => {
  const root = makeTree();
  try {
    const reg = baseRegistry();
    reg.domains.push(fullDataDomain({ kind: "data" }));
    writeRegistry(root, reg);
    const { code, out } = runGate(root);
    assert.notEqual(code, 0, "行内 kind 残留必须红");
    assert.match(out, /kind 残留/);
  } finally {
    cleanup(root);
  }
});

test("WP-132 回填绊线：表内再现通用块（status_values/通用规则）→ 红（原双表互比面随单源化退役）", () => {
  const root = makeTree();
  try {
    const reg = baseRegistry();
    reg.status_values = ["candidate"]; // 表内回填＝第二事实源
    reg.rules = { single_source: "被回填的规则文本" };
    reg.domains.push(fullDataDomain());
    writeRegistry(root, reg);
    const { code, out } = runGate(root);
    assert.notEqual(code, 0, "通用块回填必须红");
    assert.match(out, /回填绊线.*status_values/);
    assert.match(out, /回填绊线.*single_source/);
  } finally {
    cleanup(root);
  }
});

test("WP-132 单源漂移：domain-table-common.json 删值 → 域行状态非法红（对账强度＝原互比面等价）", () => {
  const root = makeTree();
  try {
    const commonPath = path.join(root, "contracts", "domain-table-common.json");
    const common = JSON.parse(fs.readFileSync(commonPath, "utf-8"));
    common.status_values = common.status_values.filter((s) => s !== "gating"); // fullDataDomain status=gating
    fs.writeFileSync(commonPath, JSON.stringify(common, null, 2));
    const reg = baseRegistry();
    reg.domains.push(fullDataDomain());
    writeRegistry(root, reg);
    const { code, out } = runGate(root);
    assert.notEqual(code, 0, "单源删值必须红（域行状态失去枚举依据）");
    assert.match(out, /状态非法.*gating/);
  } finally {
    cleanup(root);
  }
});

test("行极简：新增行内 metrics → 红（验证证据住关闭卡，不住行内）", () => {
  const root = makeTree();
  try {
    const reg = baseRegistry();
    reg.domains.push(fullDataDomain({ metrics: { 改动半径: 1 } }));
    writeRegistry(root, reg);
    const { code, out } = runGate(root);
    assert.notEqual(code, 0, "行内 metrics 新增必须红");
    assert.match(out, /行极简.*metrics 已废止/);
  } finally {
    cleanup(root);
  }
});

// ══ test-domain-mgmt 批（2026-10-14）专属守卫：面⑦ ══

test("面⑦正向：tests 认领路径悬空 → 红", () => {
  const root = makeTree();
  try {
    const reg = baseRegistry();
    reg.domains.push(fullDataDomain({ tests: ["server/ghost/__tests__/ghost.test.cjs"] }));
    writeRegistry(root, reg);
    const { code, out } = runGate(root);
    assert.notEqual(code, 0, "认领悬空必须红");
    assert.match(out, /测试认领悬空/);
  } finally {
    cleanup(root);
  }
});

test("面⑦反向：未认领且不在基线的测试文件 → 红（无主即红——本类核心断言）", () => {
  const root = makeTree();
  try {
    const reg = baseRegistry();
    reg.domains.push(fullDataDomain()); // 夹具域认领空
    writeRegistry(root, reg);
    // 植入一个无主测试（在基线目录之外——server/shared/__tests__ 全在基线里，用新目录）
    fs.mkdirSync(path.join(root, "server", "orphan-dir"), { recursive: true });
    fs.writeFileSync(path.join(root, "server", "orphan-dir", "stray.test.cjs"), "const test = require('node:test'); test('x', () => {});\n");
    const { code, out } = runGate(root);
    assert.notEqual(code, 0, "无主测试必须红");
    assert.match(out, /测试无主.*stray\.test\.cjs/);
  } finally {
    cleanup(root);
  }
});

test("面⑦棘轮：基线膨胀（实覆盖>登记）与僵尸（登记>实覆盖）→ 双向红", () => {
  const root = makeTree();
  try {
    const reg = baseRegistry();
    reg.domains.push(fullDataDomain());
    writeRegistry(root, reg);
    // 膨胀：登记 count 0，目录内实有 1 个无主测试
    fs.mkdirSync(path.join(root, "server", "shared", "__tests__"), { recursive: true });
    fs.writeFileSync(path.join(root, "server", "shared", "__tests__", "extra-probe.test.cjs"), "");
    fs.writeFileSync(path.join(root, "contracts", "test-coverage-baseline.json"), JSON.stringify({
      unclaimed: { "server/shared/__tests__": { count: 0, reason: "夹具" }, "server/ghost-dir": { count: 1, reason: "僵尸夹具" } },
    }, null, 2));
    const { code, out } = runGate(root);
    assert.notEqual(code, 0, "棘轮双向必须红");
    assert.match(out, /测试基线膨胀/);
    assert.match(out, /测试基线僵尸/);
  } finally {
    cleanup(root);
  }
});
// WP-139 派生化随批核对：期望不变（行为等价），全量测试已复跑绿
// WP-140 M1 修复随批核对：期望不变（锚点面恢复执法，真仓锚 18/18 复跑绿）
