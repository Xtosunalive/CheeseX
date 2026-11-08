// 写时准入守卫红绿夹具（SPEC-023 波 4）：
// 绿：注册段内 enums 写/合法配方 fields 写落盘；红：未注册顶层键拒写（ENUMS_SEGMENT_UNREGISTERED）＋配方悬空拒写（FIELDS_RECIPE_INVALID）。
// 钉扎纪律：THESCHEMA_DIR 指临时目录（防 repo 副本回流劫走——加固批教训）。
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const ROOT = path.resolve(__dirname, "..", "..", "..");

function buildPinnedVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "write-guards-"));
  const schema = path.join(dir, "schema");
  fs.mkdirSync(schema, { recursive: true });
  // 仅含已注册段（真实 registry 的段集——concept_types 等未注册键不入夹具）
  fs.writeFileSync(path.join(schema, "enums.yaml"), "modules:\n  主模块: {label: 主}\nlayers:\n  - {id: gateway, label: 网关}\n", "utf8");
  fs.writeFileSync(path.join(schema, "versions.yaml"), "schema_version: 1\nproducts: {}\n", "utf8");
  fs.writeFileSync(path.join(schema, "fields.yaml"),
    "schema_version: 1\nfields:\n  - name: module\n    label: 模块\n    type: list\n    required: 是\n    scope: [entity, article]\n    layer: 业务属性\n    value_domain: { source: modules, resolve: { op: keys } }\n    description: 测试。\n", "utf8");
  process.env.THESCHEMA_DIR = schema;
  return { dir, schema };
}

test("绿：注册段内 enums 写放行（经 writeEnums 全协议）", () => {
  const env = buildPinnedVault();
  try {
    const { readEnums, writeEnums } = require("../enums-write-service.cjs");
    const r = writeEnums({ vaultPath: env.dir, expectedRevision: readEnums(env.dir).revision, mutate: (doc) => { doc.get("modules").set("新模块", { system: "a" }); } });
    assert.ok(r.revision.startsWith("sha256:"));
    const enums = require("yaml").parse(fs.readFileSync(path.join(env.schema, "enums.yaml"), "utf8"));
    assert.equal(enums.modules["新模块"].system, "a");
  } finally { delete process.env.THESCHEMA_DIR; fs.rmSync(env.dir, { recursive: true, force: true }); }
});

test("红：未注册顶层键拒写（ENUMS_SEGMENT_UNREGISTERED，不落盘）", () => {
  const env = buildPinnedVault();
  try {
    const { readEnums, writeEnums } = require("../enums-write-service.cjs");
    assert.throws(
      () => writeEnums({ vaultPath: env.dir, expectedRevision: readEnums(env.dir).revision, mutate: (doc) => { doc.set("probe_unregistered", 1); } }),
      (e) => e.code === "ENUMS_SEGMENT_UNREGISTERED" && /theschema-roles/.test(e.message),
    );
    const enums = require("yaml").parse(fs.readFileSync(path.join(env.schema, "enums.yaml"), "utf8"));
    assert.ok(!("probe_unregistered" in enums), "拒写不得落盘");
  } finally { delete process.env.THESCHEMA_DIR; fs.rmSync(env.dir, { recursive: true, force: true }); }
});

test("红：配方悬空拒写（FIELDS_RECIPE_INVALID，不落盘）", async () => {
  const env = buildPinnedVault();
  try {
    const { createFieldsWriteService } = require("../fields-write-service.cjs");
    const svc = createFieldsWriteService({ vaultPath: env.dir, logger: { info() {}, warn() {}, error() {} } });
    await assert.rejects(
      svc.writeFields({ fields: [{ name: "bad", label: "坏", type: "enum", required: "否", scope: ["entity"], layer: "内容属性", value_domain: { source: "no_such_segment", resolve: { op: "values" } }, description: "悬空。" }], expectedRevision: svc.readFields().revision }),
      (e) => e.code === "FIELDS_RECIPE_INVALID",
    );
    const fields = require("yaml").parse(fs.readFileSync(path.join(env.schema, "fields.yaml"), "utf8"));
    assert.ok(!fields.fields.some((f) => f.name === "bad"), "拒写不得落盘");
  } finally { delete process.env.THESCHEMA_DIR; fs.rmSync(env.dir, { recursive: true, force: true }); }
});

test("PR-194 红：三处回滚口缺 expectedRevision 一律拒（乐观锁不得被假值短路）＋错 revision 对照仍 409", () => {
  // PR-200 把该规则的闸形与错误码收到单点（assertRevisionGiven → SCHEMA_REVISION_REQUIRED）：
  // 拒写面不变，码名归一——错值仍走各文件自家 CONFLICT，证明不是恒拒。
  const env = buildPinnedVault();
  const SNAP = "a".repeat(40);
  try {
    const { rollbackSnapshot: enumsRollback } = require("../enums-write-service.cjs");
    let missing = null;
    try { enumsRollback(env.dir, "", SNAP); } catch (e) { missing = e; }
    assert.ok(missing && missing.code === "SCHEMA_REVISION_REQUIRED", "enums 回滚缺 revision 必须 400 拒写，不得跳过比对：" + JSON.stringify(missing && missing.code));
    assert.match(missing.message, /expectedRevision/);
    assert.equal(missing.status, 400);
    let wrong = null;
    try { enumsRollback(env.dir, "sha256:" + "0".repeat(64), SNAP); } catch (e) { wrong = e; }
    assert.ok(wrong && wrong.code === "ENUMS_REVISION_CONFLICT", "带错 revision 仍按冲突拒（证明不是恒拒造成的假绿）：" + JSON.stringify(wrong && wrong.code));

    const { rollbackSnapshot: relationsRollback } = require("../relations-write-service.cjs");
    let relMissing = null;
    try { relationsRollback(env.dir, "", SNAP); } catch (e) { relMissing = e; }
    assert.ok(relMissing && relMissing.code === "SCHEMA_REVISION_REQUIRED", "relations 回滚缺 revision 必须拒：" + JSON.stringify(relMissing && relMissing.code));
    let relWrong = null;
    try { relationsRollback(env.dir, "sha256:" + "0".repeat(64), SNAP); } catch (e) { relWrong = e; }
    assert.ok(relWrong && relWrong.code === "RELATIONS_REVISION_CONFLICT", "relations 错 revision 仍走冲突面");

    const { rollbackSnapshot: historyRollback } = require("../schema-history-service.cjs");
    let hisMissing = null;
    try { historyRollback(env.dir, "ontology", "", SNAP); } catch (e) { hisMissing = e; }
    assert.ok(hisMissing && hisMissing.code === "SCHEMA_REVISION_REQUIRED", "schema-history 回滚缺 revision 必须拒：" + JSON.stringify(hisMissing && hisMissing.message));
    let hisWrong = null;
    try { historyRollback(env.dir, "ontology", "sha256:" + "0".repeat(64), SNAP); } catch (e) { hisWrong = e; }
    assert.ok(hisWrong && hisWrong.code === "SCHEMA_REVISION_CONFLICT", "schema-history 错 revision 仍走冲突面：" + JSON.stringify(hisWrong && hisWrong.code));
    assert.equal(fs.existsSync(path.join(env.schema, "relations.yaml")), false, "拒写不得顺手造出relations件");
  } finally { delete process.env.THESCHEMA_DIR; fs.rmSync(env.dir, { recursive: true, force: true }); }
});

// PR-200：写入路径（非回滚）与回滚同闸——缺基线一律拒、错值各报自家冲突、读后写放行。
// 三面各自断言「零落盘」，并留首建出口绿例（读侧对缺席文件也给出基线，原样回传即可写）。
const REL_ROW = {
  source: "知识本体",
  target: "关系类型",
  type: "containment",
  note: "PR-200 夹具行",
  asserted_by: "human",
  asserted_at: "2026-11-02",
};
const FIELD_ROW = { name: "title", label: "显示名", type: "string", required: "是", scope: ["entity", "article"], layer: "内容属性", description: "标题" };

function codeOf(fn) {
  try { fn(); return { code: null }; } catch (e) { return { code: e && e.code, status: e && e.status, message: e && e.message }; }
}

test("PR-200 红：enums/relations/fields 三写入口缺基线一律拒（SCHEMA_REVISION_REQUIRED）且零落盘", async () => {
  const env = buildPinnedVault();
  try {
    const enumsFile = path.join(env.schema, "enums.yaml");
    const before = fs.readFileSync(enumsFile, "utf8");
    const { readEnums, writeEnums } = require("../enums-write-service.cjs");
    for (const shape of [{ label: "缺省" }, { label: "空串", expectedRevision: "" }, { label: "null", expectedRevision: null }, { label: "undefined", expectedRevision: undefined }]) {
      const r = codeOf(() => writeEnums({ vaultPath: env.dir, mutate: (doc) => { doc.get("modules").set("非法模块", { system: "a" }); }, ...shape }));
      assert.equal(r.code, "SCHEMA_REVISION_REQUIRED", `${shape.label}形态必须拒写：` + JSON.stringify(r));
      assert.equal(r.status, 400);
    }
    assert.equal(fs.readFileSync(enumsFile, "utf8"), before, "拒写不得改动画盘（丢更新面已闭）");

    // 错值对照：仍按各自冲突码拒（证明新闸不是恒拒）
    const wrong = codeOf(() => writeEnums({ vaultPath: env.dir, expectedRevision: "sha256:" + "0".repeat(64), mutate: (doc) => { doc.get("modules").set("非法模块", { system: "a" }); } }));
    assert.equal(wrong.code, "ENUMS_REVISION_CONFLICT", "错基线走冲突面：" + JSON.stringify(wrong));

    const rel = codeOf(() => require("../relations-write-service.cjs").writeRelations({ vaultPath: env.dir, relations: [REL_ROW] }));
    assert.equal(rel.code, "SCHEMA_REVISION_REQUIRED", "relations 缺基线必须拒：" + JSON.stringify(rel));
    assert.equal(fs.existsSync(path.join(env.schema, "relations.yaml")), false, "拒写不得造出 relations.yaml");
    const relWrong = codeOf(() => require("../relations-write-service.cjs").writeRelations({
      vaultPath: env.dir, relations: [REL_ROW], expectedRevision: "sha256:" + "0".repeat(64),
    }));
    assert.equal(relWrong.code, "RELATIONS_REVISION_CONFLICT", "relations 错基线走冲突面：" + JSON.stringify(relWrong));

    const { createFieldsWriteService } = require("../fields-write-service.cjs");
    const svc = createFieldsWriteService({ vaultPath: env.dir, logger: { info() {}, warn() {}, error() {} } });
    const fieldsBefore = fs.readFileSync(path.join(env.schema, "fields.yaml"), "utf8");
    for (const shape of [{ label: "缺省" }, { label: "空串", expectedRevision: "" }, { label: "undefined", expectedRevision: undefined }]) {
      const r = await svc.writeFields({ fields: [FIELD_ROW], ...shape }).then(() => ({ code: null }), (e) => ({ code: e.code, status: e.status }));
      assert.equal(r.code, "SCHEMA_REVISION_REQUIRED", `fields ${shape.label}形态必须拒写：` + JSON.stringify(r));
    }
    assert.equal(fs.readFileSync(path.join(env.schema, "fields.yaml"), "utf8"), fieldsBefore, "fields 拒写零落盘");
    const fieldsWrong = await svc.writeFields({ fields: [FIELD_ROW], expectedRevision: "sha256:" + "0".repeat(64) }).then(() => ({ code: null }), (e) => ({ code: e.code }));
    assert.equal(fieldsWrong.code, "FIELDS_REVISION_CONFLICT", "fields 错基线走冲突面：" + JSON.stringify(fieldsWrong));
    // 读后写放行（基线恒可取——含缺席文件的空库基线）
    const ok = writeEnums({ vaultPath: env.dir, expectedRevision: readEnums(env.dir).revision, mutate: (doc) => { doc.get("modules").set("合法模块", { system: "b" }); } });
    assert.match(ok.raw, /合法模块/, "带正确基线的写入必须放行");
  } finally { delete process.env.THESCHEMA_DIR; fs.rmSync(env.dir, { recursive: true, force: true }); }
});

test("PR-200 出口绿：空库首建有明示路径（fields 回传 null 基线／relations 回传缺席件算出的基线）", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pr200-first-create-"));
  const schema = path.join(dir, "知识库", "TheSchema");
  fs.mkdirSync(schema, { recursive: true });
  fs.writeFileSync(path.join(schema, "enums.yaml"), "modules: {}\nlayers:\n  - {id: gateway, label: 网关}\n", "utf8");
  fs.writeFileSync(path.join(schema, "versions.yaml"), "schema_version: 1\nproducts: {}\n", "utf8");
  fs.writeFileSync(path.join(schema, "ontology.yaml"), [
    "relation_types:",
    "  containment:",
    "    description: 治理语义边——包含",
    "    label_cn: 包含",
    "    fact_encoding: governance_assertion",
    "    projected: true",
    "node_types: {}",
    "inference_rules: []",
    "constraints: []",
    "",
  ].join("\n"), "utf8");
  process.env.THESCHEMA_DIR = schema;
  try {
    const { createFieldsWriteService } = require("../fields-write-service.cjs");
    const svc = createFieldsWriteService({ vaultPath: dir, logger: { info() {}, warn() {}, error() {} } });
    assert.equal(fs.existsSync(path.join(schema, "fields.yaml")), false, "夹具前提：fields.yaml 缺席");
    assert.equal(svc.readFields().revision, null, "缺席件读侧给出 null 空库基线（首建断言的可取处）");
    const first = await svc.writeFields({ fields: [FIELD_ROW], expectedRevision: null });
    assert.match(first.affectedFile, /fields\.yaml/, "回传 null 基线＝首建放行");
    assert.equal(fs.existsSync(path.join(schema, "fields.yaml")), true);
    // 文件已在而仍回传 null（＝基线断言已过时）→ 冲突，不得覆盖
    const staleCreate = await svc.writeFields({ fields: [FIELD_ROW], expectedRevision: null }).then(() => ({ code: null }), (e) => ({ code: e.code }));
    assert.equal(staleCreate.code, "FIELDS_REVISION_CONFLICT", "首建断言过期必须冲突：" + JSON.stringify(staleCreate));

    const { readRelationsFile, writeRelations } = require("../relations-write-service.cjs");
    assert.equal(fs.existsSync(path.join(schema, "relations.yaml")), false, "夹具前提：relations.yaml 缺席");
    const emptyBaseline = readRelationsFile(dir).revision;
    assert.match(emptyBaseline, /^sha256:/, "缺席件也给出可读基线（首建无需绕行）");
    const written = writeRelations({ vaultPath: dir, relations: [REL_ROW], expectedRevision: emptyBaseline });
    assert.equal(written.data.relations.length, 1, "读后写即首建成功");
  } finally { delete process.env.THESCHEMA_DIR; fs.rmSync(dir, { recursive: true, force: true }); }
});

test("PR-200 归一：页面写入口（enums patch）与本体／依赖同闸同码", async () => {
  const env = buildPinnedVault();
  fs.writeFileSync(path.join(env.schema, "ontology.yaml"), "node_types: {}\nrelation_types: {}\ninference_rules: []\nconstraints: []\n", "utf8");
  fs.writeFileSync(path.join(env.schema, "dependencies.yaml"), "rules: []\n", "utf8");
  try {
    const { createSchemaWriteService } = require("../schema-write-service.cjs");
    const svc = createSchemaWriteService({ vaultPath: env.dir, logger: { info() {}, warn() {}, error() {} } });
    const cases = [
      ["writeEnums（页面 patch 入口）", () => svc.writeEnums({ patch: { modules: { 甲: { system: "a" } } } })],
      ["writeOntology", () => svc.writeOntology({ patch: {} })],
      ["writeDependencies", () => svc.writeDependencies({ patch: {} })],
    ];
    for (const [name, run] of cases) {
      const missing = codeOf(run);
      assert.equal(missing.code, "SCHEMA_REVISION_REQUIRED", `${name} 缺基线必须报同一码（原自写闸形已收为单点）：` + JSON.stringify(missing));
    }
    // 对照：带基线即放行（证明拒的是缺基线，不是恒拒）
    const { readEnums } = require("../enums-write-service.cjs");
    const ok = svc.writeEnums({ revision: readEnums(env.dir).revision, patch: {} });
    assert.match(ok.revision, /^sha256:/, "带正确基线的页面写必须放行");
  } finally { delete process.env.THESCHEMA_DIR; fs.rmSync(env.dir, { recursive: true, force: true }); }
});

