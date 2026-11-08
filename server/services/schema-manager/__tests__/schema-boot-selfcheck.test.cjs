// @tests: server/services/schema-manager/schema-boot-selfcheck.cjs（PR-109 缺口①——校验执法活性）
// 层级：纯单元（schemaDir 注入缝指向 tmp 夹具；校验器为真实依赖非替身——活性/数据违例即对其行为验收）。
// 活性反例两例＝「校验器的校验」：期望导出面缺失（validateNodeType 改名漏项史防复发）与校验器抛错
// （断线另一形态）都必须被自检报出，静默绿即测试失败。
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const YAML = require("yaml");

const { runSchemaBootSelfCheck, EXPECTED_VALIDATORS } = require("../schema-boot-selfcheck.cjs");
const validators = require("../schema-validators.cjs");

const SILENT = { info() {}, warn() {}, error() {} };

function writeSchema(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "schema-selfcheck-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}

// 顶层键全在 theschema-roles enums 注册段内（册外面零违例）；各段形态合法（节校验零违例）
const CLEAN_ENUMS = [
  "domains: { d1: 域一 }",
  "subdomains: { d1: [s1] }",
  "layers: []",
  "arch_categories: []",
  "article_types: []",
  "doc_types: []",
  "modules: {}",
  "tags: {}",
  "tag_aliases: {}",
  "disabled_tags: []",
  "subdomain_constraints: {}",
].join("\n");

const CLEAN_ONTOLOGY = `
node_types:
  Document:
    description: 文档节点
    category: Document
    color: "#000000"
    icon: doc
    allows_relations: [BELONGS_TO]
relation_types:
  BELONGS_TO:
    description: 归属关系
    label_cn: 归属
    versionable: true
    weight_default: 1
    weight_range: [0, 1]
    source_types: [Document]
    target_types: [Document]
`;

const CLEAN_FIELDS = `
schema_version: 1
fields:
  - name: title
    label: 标题
    type: string
    required: 否
    scope: [entity, article]
    layer: 内容属性
`;

function ontologyWithBinding(field = "title") {
  const ontology = YAML.parse(CLEAN_ONTOLOGY);
  ontology.node_types.Document.data_properties = { [field]: { required: true } };
  return YAML.stringify(ontology);
}

test("字段绑定：boot 读取同目录 fields.yaml，合法绑定无数据违例", (t) => {
  const dir = writeSchema(t, {
    "enums.yaml": CLEAN_ENUMS,
    "ontology.yaml": ontologyWithBinding(),
    "fields.yaml": CLEAN_FIELDS,
  });
  const result = runSchemaBootSelfCheck({ vaultPath: "/vault", schemaDir: dir, logger: SILENT });
  assert.equal(result.outcome, "clean", result.dataViolations.join("; "));
  assert.deepEqual(result.livenessViolations, []);
  assert.deepEqual(result.dataViolations, []);
  assert.ok(result.executed.includes("validateOntologyPayload"));
});

test("字段绑定反例：同目录字典未声明的字段报数据违例", (t) => {
  const dir = writeSchema(t, {
    "enums.yaml": CLEAN_ENUMS,
    "ontology.yaml": ontologyWithBinding("unknown_field"),
    "fields.yaml": CLEAN_FIELDS,
  });
  const result = runSchemaBootSelfCheck({ vaultPath: "/vault", schemaDir: dir, logger: SILENT });
  assert.equal(result.outcome, "violations");
  assert.deepEqual(result.livenessViolations, []);
  assert.deepEqual(result.dataViolations, [
    "ontology: node_types.Document.data_properties.unknown_field: unknown field in fields.yaml",
  ]);
});

test("字段绑定反例：缺 fields.yaml 不跳过自检，绑定报数据违例", (t) => {
  const dir = writeSchema(t, {
    "enums.yaml": CLEAN_ENUMS,
    "ontology.yaml": ontologyWithBinding(),
  });
  const result = runSchemaBootSelfCheck({ vaultPath: "/vault", schemaDir: dir, logger: SILENT });
  assert.equal(result.outcome, "violations");
  assert.deepEqual(result.livenessViolations, []);
  assert.deepEqual(result.dataViolations, [
    "ontology: node_types.Document.data_properties.title: unknown field in fields.yaml",
  ]);
  assert.ok(result.executed.includes("validateOntologyPayload"));
});

test("降级的非法绑定不能把启动自检与遥测报成 clean", (t) => {
  const ontology = YAML.parse(CLEAN_ONTOLOGY);
  ontology.node_types.Document.data_properties = { title: { required: "true" } };
  const source = YAML.stringify(ontology);
  const dir = writeSchema(t, { "enums.yaml": CLEAN_ENUMS, "ontology.yaml": source, "fields.yaml": CLEAN_FIELDS });
  const traces = [];
  const result = runSchemaBootSelfCheck({ schemaDir: dir, logger: SILENT, telemetry: { recordTrace(kind, payload) { traces.push(payload); } } });
  assert.equal(result.outcome, "violations");
  assert.ok(result.dataViolations.some((v) => v.includes("node_types.Document") && v.includes("required")), result.dataViolations.join("; "));
  assert.equal(traces[0].outcome, "violations");
  assert.equal(fs.readFileSync(path.join(dir, "ontology.yaml"), "utf8"), source);
});

test("字段字典损坏不吞掉本体与枚举检查，恢复后重跑正常", (t) => {
  const dir = writeSchema(t, {
    "enums.yaml": CLEAN_ENUMS,
    "ontology.yaml": CLEAN_ONTOLOGY.replace("allows_relations: [BELONGS_TO]", "allows_relations: [GHOST_RELATION]"),
    "fields.yaml": "fields: [",
  });
  const result = runSchemaBootSelfCheck({ schemaDir: dir, logger: SILENT });
  assert.equal(result.outcome, "violations");
  assert.ok(result.livenessViolations.some((v) => v.includes("fields.yaml")));
  assert.ok(result.executed.includes("validateOntologyPayload"));
  assert.ok(result.executed.includes("validatePolicyReferences"));
  assert.ok(result.dataViolations.some((v) => v.includes("GHOST_RELATION")));
  fs.writeFileSync(path.join(dir, "fields.yaml"), CLEAN_FIELDS);
  fs.writeFileSync(path.join(dir, "ontology.yaml"), CLEAN_ONTOLOGY);
  assert.equal(runSchemaBootSelfCheck({ schemaDir: dir, logger: SILENT }).outcome, "clean");
});

test("历史退役链：boot 接受 A retired → B retired → C approved，保留原文件", (t) => {
  const node = { ...YAML.parse(CLEAN_ONTOLOGY).node_types.Document, allows_relations: [] };
  const ontology = YAML.stringify({
    node_types: {
      A: { ...node, lifecycle_status: "retired", retirement: { reason: "由 B 替代", replaced_by: "B" } },
      B: { ...node, lifecycle_status: "retired", retirement: { reason: "由 C 替代", replaced_by: "C" } },
      C: { ...node, lifecycle_status: "approved" },
    },
    relation_types: {},
  });
  const dir = writeSchema(t, { "enums.yaml": CLEAN_ENUMS, "ontology.yaml": ontology });
  const result = runSchemaBootSelfCheck({ vaultPath: "/vault", schemaDir: dir, logger: SILENT });
  assert.equal(result.outcome, "clean", result.dataViolations.join("; "));
  assert.deepEqual(result.livenessViolations, []);
  assert.deepEqual(result.dataViolations, []);
  assert.ok(result.executed.includes("validateOntologyPayload"));
  assert.equal(fs.readFileSync(path.join(dir, "ontology.yaml"), "utf8"), ontology);
});

test("clean：真 TheSchema 形态夹具全量执行零违例，执行面覆盖四类校验器", (t) => {
  const dir = writeSchema(t, { "enums.yaml": CLEAN_ENUMS, "ontology.yaml": CLEAN_ONTOLOGY });
  const result = runSchemaBootSelfCheck({ vaultPath: "/vault", schemaDir: dir, logger: SILENT });
  assert.equal(result.outcome, "clean");
  assert.equal(result.livenessViolations.length, 0);
  assert.equal(result.dataViolations.length, 0);
  assert.ok(result.executed.includes("enumsSegmentViolations"), "册外面闸门须执行");
  assert.ok(result.executed.includes("validateSection(subdomains)"), "节校验须执行");
  assert.ok(result.executed.includes("validatePolicyReferences"), "跨段引用须执行");
  assert.ok(result.executed.includes("validateOntologyPayload"), "本体互查须执行");
});

test("数据违例：ontology allows_relations 悬空引用被报出（不改启动流程）", (t) => {
  const dir = writeSchema(t, {
    "enums.yaml": CLEAN_ENUMS,
    "ontology.yaml": CLEAN_ONTOLOGY.replace("allows_relations: [BELONGS_TO]", "allows_relations: [GHOST_RELATION]"),
  });
  const result = runSchemaBootSelfCheck({ vaultPath: "/vault", schemaDir: dir, logger: SILENT });
  assert.equal(result.outcome, "violations");
  assert.equal(result.livenessViolations.length, 0);
  assert.ok(result.dataViolations.some((v) => v.includes("unknown relation type 'GHOST_RELATION'")), result.dataViolations.join("; "));
});

test("skip：缺 TheSchema 文件按既有惯例跳过（不抛错不假红）", (t) => {
  const dir = writeSchema(t, {});
  const result = runSchemaBootSelfCheck({ vaultPath: "/vault", schemaDir: dir, logger: SILENT });
  assert.equal(result.outcome, "skipped");
  assert.ok(result.reason.includes("TheSchema 缺文件"));
});

test("活性违例反例①：期望校验器导出面缺失即活性违例（改名/删除防复发）", (t) => {
  const dir = writeSchema(t, { "enums.yaml": CLEAN_ENUMS, "ontology.yaml": CLEAN_ONTOLOGY });
  const original = validators.validateNodeType;
  delete validators.validateNodeType;
  try {
    const result = runSchemaBootSelfCheck({ vaultPath: "/vault", schemaDir: dir, logger: SILENT });
    assert.ok(
      result.livenessViolations.some((v) => v.includes("schema-validators.cjs#validateNodeType")),
      result.livenessViolations.join("; "),
    );
    assert.equal(result.outcome, "violations");
  } finally {
    validators.validateNodeType = original;
  }
});

test("活性违例反例②：校验器抛错被报出而非静默绿（断线另一形态）", (t) => {
  const dir = writeSchema(t, { "enums.yaml": CLEAN_ENUMS, "ontology.yaml": CLEAN_ONTOLOGY });
  const original = validators.validateSection;
  validators.validateSection = () => { throw new Error("boom"); };
  try {
    const result = runSchemaBootSelfCheck({ vaultPath: "/vault", schemaDir: dir, logger: SILENT });
    assert.ok(
      result.livenessViolations.some((v) => v.includes("抛错") && v.includes("validateSection")),
      result.livenessViolations.join("; "),
    );
    assert.equal(result.outcome, "violations");
  } finally {
    validators.validateSection = original;
  }
});

test("trace：自检结论落 telemetry（kind schema-selfcheck-run，尽力而为）", (t) => {
  const dir = writeSchema(t, { "enums.yaml": CLEAN_ENUMS, "ontology.yaml": CLEAN_ONTOLOGY });
  const traces = [];
  const telemetry = { recordTrace(kind, payload) { traces.push({ kind, payload }); } };
  runSchemaBootSelfCheck({ vaultPath: "/vault", schemaDir: dir, logger: SILENT, telemetry });
  assert.equal(traces.length, 1);
  assert.equal(traces[0].kind, "schema-selfcheck-run");
  assert.equal(traces[0].payload.outcome, "clean");
  assert.ok(traces[0].payload.at, "trace 须带时间戳");
});

test("trace 容错：telemetry 抛错不阻断自检", (t) => {
  const dir = writeSchema(t, { "enums.yaml": CLEAN_ENUMS, "ontology.yaml": CLEAN_ONTOLOGY });
  const telemetry = { recordTrace() { throw new Error("telemetry down"); } };
  const result = runSchemaBootSelfCheck({ vaultPath: "/vault", schemaDir: dir, logger: SILENT, telemetry });
  assert.equal(result.outcome, "clean");
});

test("活性注册表与 schema-validators 函数导出面双向相等（新增校验器须同批登记）", () => {
  const exportedFunctions = Object.keys(validators).filter((k) => typeof validators[k] === "function").sort();
  const expected = [...EXPECTED_VALIDATORS["schema-validators.cjs"]].sort();
  assert.deepEqual(expected, exportedFunctions, "注册表＝模块函数导出面：新增/改名校验器不同批登记即红");
});

test("装配在册：main.cjs 接入 boot 自检与投影值域注入（grep 先例——防「写了没接线」复发）", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "..", "..", "main.cjs"), "utf8");
  assert.ok(main.includes("runSchemaBootSelfCheck"), "main.cjs 须装配 runSchemaBootSelfCheck");
  assert.ok(main.includes("listRelationTypes"), "main.cjs 须为 edgeProjectionService 注入 listRelationTypes");
});

test("TRACE_KINDS 登记：SCHEMA_SELFCHECK＝schema-selfcheck-run（telemetry 单源）", () => {
  const { TRACE_KINDS } = require("../../../shared/persistence/telemetry-store.cjs");
  assert.equal(TRACE_KINDS.SCHEMA_SELFCHECK, "schema-selfcheck-run");
});
