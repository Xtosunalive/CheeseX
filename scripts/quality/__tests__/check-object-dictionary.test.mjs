// check-object-dictionary.test.mjs — 对象字典门禁测试（认领 contracts/object-dictionary 域）
// 每 case 标注层级：纯单元（checkDictionary 纯函数，真契约文件为底）＋ CLI 面（子进程退出码）。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { checkDictionary, checkLifecycleTransitions, validateLifecycleTable } from "../check-object-dictionary.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../../..");
const load = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), "utf8"));
const base = () => [structuredClone(load("contracts/object-dictionary.json")), structuredClone(load("contracts/object-meta-model.json"))];

test("绿：真契约文件全量对账通过（14 卡/六层/读侧纪律）", () => {
  const [d, mm] = base();
  const { errors } = checkDictionary(d, mm);
  assert.deepEqual(errors, []);
});

test("红：卡片塞未登记字段——扩展规则①执法面（未修订元模型不得加字段）", () => {
  const [d, mm] = base();
  d.core_objects[0].random_patch_field = 1;
  assert.ok(checkDictionary(d, mm).errors.some((e) => e.includes("random_patch_field")));
});

test("红：已迁移遗留字段（naming_status 混维状态）回归即拦", () => {
  const [d, mm] = base();
  d.core_objects[0].naming_status = "proposed";
  const errs = checkDictionary(d, mm).errors;
  assert.ok(errs.some((e) => e.includes("遗留字段")));
});

test("红：无名⇔incomplete 纪律（空名不得标 recorded）", () => {
  const [d, mm] = base();
  d.core_objects[0].canonical_name = "";
  assert.ok(checkDictionary(d, mm).errors.some((e) => e.includes("canonical_name 为空")));
});

test("红：自造 subtype 枚举外值", () => {
  const [d, mm] = base();
  d.core_objects[0].subtype = "超级类型";
  assert.ok(checkDictionary(d, mm).errors.some((e) => e.includes("subtype=")));
});

test("红：读侧纪律通道被拆（machine_read_policy 缺失）——TALOS 借鉴面", () => {
  const [d, mm] = base();
  delete mm.machine_read_policy;
  assert.ok(checkDictionary(d, mm).errors.some((e) => e.includes("machine_read_policy")));
});

test("红：读侧通道 read 越界（吃到非声明字段）", () => {
  const [d, mm] = base();
  mm.machine_read_policy.channels.search_matching.read.push("definition");
  assert.ok(checkDictionary(d, mm).errors.some((e) => e.includes("search_matching.read 非法字段")));
});

test("绿：传导面真数据零违例（TR1 裁决联动/TR2 值域边⇒亚型，2026-10-23 R2/R5 直落）", () => {
  const [d, mm] = base();
  const errs = checkDictionary(d, mm).errors;
  assert.deepEqual(errs.filter((e) => e.startsWith("TR:")), []);
});

test("红：editable 已转必填（B6=a）——缺字段即红", () => {
  const [d, mm] = base();
  const c = d.core_objects.find((x) => x.object_id === "bd061091-c542-43a5-9fdb-fdb319f0b92f");
  delete c.editable;
  assert.ok(checkDictionary(d, mm).errors.some((e) => e.endsWith(".editable empty")));
});

test("红：TR3 层级⇒不可编辑——L3 运行时聚合不得 editable=true（B6=a）", () => {
  const [d, mm] = base();
  const c = d.core_objects.find((x) => x.object_id === "092cc25c-4d84-4af3-980a-14faae69f8dc");
  c.editable = true;
  assert.ok(checkDictionary(d, mm).errors.some((e) => e.startsWith("TR:TR3") && e.includes("092cc25c-4d84-4af3-980a-14faae69f8dc") && e.includes("data_domain")));
});

test("红：TR3 预留⇒不可编辑——reserved 卡不得 editable=true（参数单源：改 requires 后执法随变）", () => {
  const [d, mm] = base();
  const c = d.core_objects.find((x) => x.object_id === "65ece684-3770-4cdd-b9a8-aa19bca38926");
  c.editable = true; // L1 但 reserved——lifecycle 维度应触发
  const errs = checkDictionary(d, mm).errors;
  assert.ok(errs.some((e) => e.startsWith("TR:TR3") && e.includes("65ece684-3770-4cdd-b9a8-aa19bca38926") && e.includes("lifecycle_status")));
  // 改元模型参数：去掉 lifecycle 要求——只剩 data_domain 维度，disabled_tags(L1) 不再触发（证明 requires 非硬编码）
  const tr3 = mm.transduction_rules.rules.find((r) => r.id === "TR3");
  delete tr3.requires.lifecycle_status;
  assert.ok(!checkDictionary(d, mm).errors.some((e) => e.startsWith("TR:TR3") && e.includes("65ece684-3770-4cdd-b9a8-aa19bca38926")));
});

test("红：TR4 终态禁过渡标签——retired 卡挂 transitional 即红（R6，B6 同批）", () => {
  const [d, mm] = base();
  const c = d.core_objects.find((x) => x.object_id === "67ad9163-b172-4207-bdc9-cd1abb4822f8");
  c.lifecycle_status = "retired"; // 枚举合法（元模型 status 层含 retired）
  c.governance_tags.transitional = true; // 定形：布尔键，与 confidence 同构
  assert.ok(checkDictionary(d, mm).errors.some((e) => e.startsWith("TR:TR4") && e.includes("67ad9163-b172-4207-bdc9-cd1abb4822f8")));
});

test("红：TR5 查询产物非事实载体——runtime_view 卡不得 role=source（R3，Master 2026-10-23 批准扩枚举同批）", () => {
  const [d, mm] = base();
  const c = d.core_objects.find((x) => x.object_id === "092cc25c-4d84-4af3-980a-14faae69f8dc"); // discovery，kind=runtime_view
  assert.equal(c.object_kind, "runtime_view"); // 前置：扩枚举已落
  c.role = "source"; // 违例注入
  assert.ok(checkDictionary(d, mm).errors.some((e) => e.startsWith("TR:TR5") && e.includes("092cc25c")));
});

test("红：TR1 裁决联动未翻态——depends_on 全收敛但边界仍 needs_decision", () => {
  const [d, mm] = base();
  const b = d.boundary_determinations.find((x) => x.id === "arch-categories-derived");
  b.status = "needs_decision";
  b.depends_on = ["B1", "B2"]; // B1/B2 均 ruled——全收敛
  assert.ok(checkDictionary(d, mm).errors.some((e) => e.startsWith("TR:TR1") && e.includes("arch-categories-derived")));
});

test("红：TR1 参数单源——settled_status 从元模型读（仅 closed 收敛时不触发）", () => {
  const [d, mm] = base();
  const b = d.boundary_determinations.find((x) => x.id === "arch-categories-derived");
  b.status = "needs_decision";
  b.depends_on = ["B1"]; // B1=ruled 在 settled 集内，应触发
  assert.ok(checkDictionary(d, mm).errors.some((e) => e.startsWith("TR:TR1")));
  // 改元模型参数：settled 只认 closed——B1=ruled 不再收敛，不触发（证明参数非硬编码）
  mm.transduction_rules.rules[0].settled_status = ["closed"];
  assert.ok(!checkDictionary(d, mm).errors.some((e) => e.startsWith("TR:TR1")));
});

test("红：TR2 值域边⇒亚型——有 reference 边但 subtype 缺失", () => {
  const [d, mm] = base();
  const c = d.core_objects.find((x) => x.object_id === "67ad9163-b172-4207-bdc9-cd1abb4822f8");
  c.subtype = null;
  assert.ok(checkDictionary(d, mm).errors.some((e) => e.startsWith("TR:TR2") && e.includes("67ad9163-b172-4207-bdc9-cd1abb4822f8")));
});

test("红：未知 transduction type——fail-closed（无执法面的规则=假绿）", () => {
  const [d, mm] = base();
  mm.transduction_rules.rules.push({ id: "TR9", type: "future_unknown", statement: "占位" });
  assert.ok(checkDictionary(d, mm).errors.some((e) => e.startsWith("TR:TR9") && e.includes("未知 type")));
});

test("CLI 面：真文件退出码 0＋摘要单行", () => {
  const r = spawnSync(process.execPath, [path.join(HERE, "../check-object-dictionary.mjs")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^object_dictionary=ok cards=16 /); // 15＝D3 关系类型卡（EDGE-RELATION-GOV-001 对象本体批）
});

// ── WP-115／PR-259 处置批：#0 TR3 互引回归＋#3 TR6 退役座次＋#4 迁移边判定（先红后绿；层级标注：纯单元）──

test("绿：#0 TR3 互引文本在册（grep 形规则回归——字段级可改性互指不失踪）", () => {
  const [, mm] = base();
  const tr3 = mm.transduction_rules.rules.find((r) => r.id === "TR3");
  assert.ok(tr3.statement.includes("字段级可改性") && tr3.statement.includes("互相指认"));
});

const pickPair = (d) => {
  for (const a of d.core_objects) {
    if (a.lifecycle_status !== "approved") continue;
    const p = d.core_objects.find((x) => x !== a && x.object_kind === a.object_kind && x.lifecycle_status === "approved");
    if (p) return [a, p];
  }
  return null;
};

test("绿：TR6 真数据零违例（现役 0 retired 卡，TR6 空转）", () => {
  const [d, mm] = base();
  assert.deepEqual(checkDictionary(d, mm).errors.filter((e) => e.startsWith("TR:TR6")), []);
});

test("红：TR6 retired 卡缺 retirement 座次", () => {
  const [d, mm] = base();
  const c = d.core_objects[0];
  c.lifecycle_status = "retired";
  assert.ok(checkDictionary(d, mm).errors.some((e) => e.startsWith("TR:TR6") && e.includes("缺 retirement")));
});

test("红：TR6 座次不齐——reason／replaced_by 双空各点名", () => {
  const [d, mm] = base();
  const c = d.core_objects[0];
  c.lifecycle_status = "retired";
  c.retirement = { reason: "", replaced_by: "" };
  const errs = checkDictionary(d, mm).errors;
  assert.ok(errs.some((e) => e.startsWith("TR:TR6") && e.includes("retirement.reason 空")));
  assert.ok(errs.some((e) => e.startsWith("TR:TR6") && e.includes("retirement.replaced_by 空")));
});

test("红：TR6 replaced_by 指向在册外目标", () => {
  const [d, mm] = base();
  const c = d.core_objects[0];
  c.lifecycle_status = "retired";
  c.retirement = { reason: "退役测试", replaced_by: "nonexistent-card-id" };
  assert.ok(checkDictionary(d, mm).errors.some((e) => e.startsWith("TR:TR6") && e.includes("指向在册外目标")));
});

test("红：TR6 自指／跨类型／非现役三反例同批", () => {
  const [d, mm] = base();
  const pair = pickPair(d);
  assert.ok(pair, "夹具前提：存在同 kind 双 approved 卡");
  const [a] = pair;
  a.lifecycle_status = "retired";
  a.retirement = { reason: "退役测试", replaced_by: a.object_id };
  assert.ok(checkDictionary(d, mm).errors.some((e) => e.includes("自指")));
  const other = d.core_objects.find((x) => x.object_id !== a.object_id && x.object_kind !== a.object_kind);
  assert.ok(other, "夹具前提：存在异 kind 卡");
  a.retirement.replaced_by = other.object_id;
  assert.ok(checkDictionary(d, mm).errors.some((e) => e.includes("跨类型")));
  const reserved = d.core_objects.find((x) => x.object_id !== a.object_id && x.lifecycle_status === "reserved");
  assert.ok(reserved, "夹具前提：存在 reserved 卡（现值 2 张）");
  a.retirement.replaced_by = reserved.object_id;
  assert.ok(checkDictionary(d, mm).errors.some((e) => e.includes("非现役")));
});

test("绿：TR6 合格退役全绿＋参数单源（status_value 改 reserved 后同夹具即红）", () => {
  const [d, mm] = base();
  const pair = pickPair(d);
  assert.ok(pair, "夹具前提：存在同 kind 双 approved 卡");
  const [a, p] = pair;
  a.lifecycle_status = "retired";
  a.retirement = { reason: "退役测试", replaced_by: p.object_id };
  assert.deepEqual(checkDictionary(d, mm).errors.filter((e) => e.startsWith("TR:TR6")), []);
  mm.transduction_rules.rules.find((r) => r.id === "TR6").seat.target.status_value = "reserved";
  assert.ok(checkDictionary(d, mm).errors.some((e) => e.startsWith("TR:TR6") && e.includes("非现役")));
});

// 迁移边判定（checkLifecycleTransitions 纯函数；表＝dictionary-lifecycle.json，语义照抄 ADR-017 §二）

const lcTable = () => structuredClone(load("contracts/dictionary-lifecycle.json"));
const lcEnum = () => load("contracts/object-meta-model.json").layers.status.enums.lifecycle_status.map((e) => e.value);

test("边表：绿边（draft→submitted）＋新建卡豁免边判定", () => {
  const errs = checkLifecycleTransitions(
    [{ object_id: "a", lifecycle_status: "draft" }],
    [{ object_id: "a", lifecycle_status: "submitted" }, { object_id: "b", lifecycle_status: "draft" }],
    lcTable(), lcEnum(),
  );
  assert.deepEqual(errs, []);
});

test("边表：红——retired→approved 明令禁止（点名 ADR-017 理由）", () => {
  const errs = checkLifecycleTransitions(
    [{ object_id: "a", lifecycle_status: "retired" }],
    [{ object_id: "a", lifecycle_status: "approved" }],
    lcTable(), lcEnum(),
  );
  assert.ok(errs.some((e) => e.includes("明令禁止") && e.includes("原地复活")));
});

test("边表：红——终态迁出任何值（律文硬编双钉：往表里塞 retired→draft 边仍必须红）", () => {
  const table = lcTable();
  table.transitions.push({ from: "retired", to: "draft" });
  const errs = checkLifecycleTransitions(
    [{ object_id: "a", lifecycle_status: "retired" }],
    [{ object_id: "a", lifecycle_status: "draft" }],
    table, lcEnum(),
  );
  assert.ok(errs.some((e) => e.includes("终态不得迁出")));
});

test("边表：红——未登记边（缺省 approved→draft 跨态跳跃）", () => {
  const errs = checkLifecycleTransitions([{ object_id: "a" }], [{ object_id: "a", lifecycle_status: "draft" }], lcTable(), lcEnum());
  assert.ok(errs.some((e) => e.includes("未登记迁移边")));
});

test("边表：红——越词表在册值禁一步直入缺省态（PR-181 同构）；迁往其他合法态放行", () => {
  const t = lcTable(); const en = lcEnum();
  const errs = checkLifecycleTransitions([{ object_id: "a", lifecycle_status: "legacy_weird" }], [{ object_id: "a" }], t, en);
  assert.ok(errs.some((e) => e.includes("越出取值域")));
  assert.deepEqual(checkLifecycleTransitions([{ object_id: "a", lifecycle_status: "legacy_weird" }], [{ object_id: "a", lifecycle_status: "draft" }], t, en), []);
});

test("边表：红——retired 卡被删除（历史锚点）；非退役卡删除照常放行", () => {
  const errs = checkLifecycleTransitions([{ object_id: "a", lifecycle_status: "retired" }], [], lcTable(), lcEnum());
  assert.ok(errs.some((e) => e.includes("retired 卡被删除")));
  assert.deepEqual(checkLifecycleTransitions([{ object_id: "b", lifecycle_status: "draft" }], [], lcTable(), lcEnum()), []);
});

test("CLI 面：边表缺失/畸形即红（无条件加载——坏表不潜伏到首次迁移才暴露）", () => {
  const r = spawnSync(process.execPath, [path.join(HERE, "../check-object-dictionary.mjs"), "--lifecycle-table", "/nonexistent/dictionary-lifecycle.json"], { encoding: "utf8" });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /边表不可读/);
});

test("红：TR6 reason 数组形状即红（红队 P2-2——座次是历史锚点不是占位符）", () => {
  const [d, mm] = base();
  const pair = pickPair(d);
  const [a, p] = pair;
  a.lifecycle_status = "retired";
  a.retirement = { reason: ["理由"], replaced_by: p.object_id };
  assert.ok(checkDictionary(d, mm).errors.some((e) => e.startsWith("TR:TR6") && e.includes("形状非法")));
});

// 边表律文钉（红队 P1-2/P2-1 修复——validateLifecycleTable 承载「改表放松不了」的形状谓词半句）

test("LCT 绿：真边表零违例", () => {
  assert.deepEqual(validateLifecycleTable(lcTable(), lcEnum()), []);
});

test("LCT 红：terminalFrom 改 draft——律文硬编改表放松不了（红队 P1-2 全绕路径封死）", () => {
  const t = lcTable();
  t.terminalFrom = "draft";
  const errs = validateLifecycleTable(t, lcEnum());
  assert.ok(errs.some((e) => e.includes("terminalFrom=draft") && e.includes("须先修 ADR-017")));
});

test("LCT 红：清空 explicitlyDenied——两条律文禁止边缺席即红（红队 P2-1）", () => {
  const t = lcTable();
  t.explicitlyDenied = [];
  const errs = validateLifecycleTable(t, lcEnum());
  assert.ok(errs.some((e) => e.includes("retired→approved 缺席")));
  assert.ok(errs.some((e) => e.includes("reserved→retired 缺席")));
});

test("LCT 红：明令禁止边同时进允许集——自相矛盾即红", () => {
  const t = lcTable();
  t.transitions.push({ from: "retired", to: "approved" });
  const errs = validateLifecycleTable(t, lcEnum());
  assert.ok(errs.some((e) => e.includes("自相矛盾")));
});

test("LCT 红：允许边越五态取值域（取值域单源在元模型）", () => {
  const t = lcTable();
  t.transitions.push({ from: "approved", to: "archived" });
  assert.ok(validateLifecycleTable(t, lcEnum()).some((e) => e.includes("越出取值域")));
});
