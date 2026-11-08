// Component: 裁决 2 行为测试——别名接线三件套 + F02c 收窄 + F17 别名防撞
// @context: 第2步裁决指令-2026-10-08.md 裁决 2（dictionary-of-ai-coding 参照：
//   正名管身份（唯一+连线）、代号管机器（唯一+图谱）、别名管认人（检索+引导，绝不参与连线寻址））
const assert = require("node:assert/strict");
const test = require("node:test");

const { runAllDiagnostics } = require("../../entity-compliance/entity-compliance-declarative-engine.cjs");
const { buildEntityIndexes } = require("../../entity-compliance/entity-compliance-service.cjs");
const { resolveTarget, aliasOf } = require("../../entity-compliance/entity-compliance-body-rules.cjs");

const RULE_SET = { wikilinkTypeLabels: { "依赖": "DEPENDS_ON" } };

function entity(name, fm, body) {
  return { fileName: name + ".md", frontmatter: fm, body: body || "", sourcePath: "知识库/wiki/entities/" + name + ".md" };
}

test("检索归一：别名命中 resolveTarget，aliasOf 返回正名", () => {
  const entities = [
    entity("mysql", { title: "MySQL 主库", "architecture-node-id": "mysql-primary", aliases: ["主库", "数据库主节点"] }),
  ];
  const indexes = buildEntityIndexes(entities);
  assert.equal(resolveTarget("主库", indexes), true, "别名连线可解析（不再未识别误报）");
  assert.equal(aliasOf("主库", indexes), "MySQL 主库");
  assert.equal(resolveTarget("不存在的", indexes), false, "真未解析目标不受影响");
});

test("B02 善意提示：别名连线改出轻提醒而非 unresolved", () => {
  const entities = [
    entity("api", { title: "API 服务", "architecture-node-id": "api" }, "依赖::[[主库]]"),
    entity("mysql", { title: "MySQL 主库", "architecture-node-id": "mysql-primary", aliases: ["主库"] }),
  ];
  const indexes = buildEntityIndexes(entities);
  const diags = runAllDiagnostics(entities[0], RULE_SET, indexes);
  const b02Fail = diags.find((d) => d.ruleId === "B02" && d.passed === false);
  assert.equal(b02Fail, undefined, "别名可解析→B02 无失败诊断（body 段失败才产诊断）");
  const hint = diags.find((d) => d.ruleId === "B02" && d._aliasHint);
  assert.ok(hint, "存在别名善意提示");
  assert.ok(hint.message.includes("主库") && hint.message.includes("MySQL 主库"), "提示含 别名→正名");
  assert.equal(hint.severity, "warn", "轻提醒级");
  assert.equal(hint.passed, true, "非违规");
});

test("F02c 收窄：精确同名才拦，近似名并存合法", () => {
  const entities = [
    entity("a", { title: "MySQL", "architecture-node-id": "a" }),
    entity("b", { title: "MySQL 备库", "architecture-node-id": "b" }), // 近似名
  ];
  const indexes = buildEntityIndexes(entities);
  const diags = runAllDiagnostics(entities[1], RULE_SET, indexes);
  assert.equal(diags.find((d) => d.ruleId === "F02c" && d.passed === false), undefined, "近似名不拦（无失败诊断）");
  // 精确同名才拦
  const dup = [entity("a", { title: "MySQL", "architecture-node-id": "a" }), entity("c", { title: "MySQL", "architecture-node-id": "c" })];
  const dupIndexes = buildEntityIndexes(dup);
  const dupDiags = runAllDiagnostics(dup[1], RULE_SET, dupIndexes);
  assert.equal(dupDiags.find((d) => d.ruleId === "F02c").passed, false, "精确同名拦");
});

test("F17 别名防撞：别名撞他人正名 → warn 诊断（破坏实验：双撞必红）", () => {
  const entities = [
    entity("a", { title: "网关", "architecture-node-id": "gw", aliases: ["网关服务"] }),
    entity("b", { title: "B 服务", "architecture-node-id": "b", aliases: ["网关"] }), // 别名撞 A 的正名
  ];
  const indexes = buildEntityIndexes(entities);
  assert.ok(indexes.duplicateAliases.has("网关"), "索引捕到撞车值");
  const diagsB = runAllDiagnostics(entities[1], RULE_SET, indexes);
  const f17 = diagsB.find((d) => d.ruleId === "F17");
  assert.ok(f17, "F17 诊断存在");
  assert.equal(f17.passed, false, "别名撞正名=违规");
  assert.equal(f17.severity, "warn", "warn 级（提醒不拦写）");
  assert.ok(f17.message.includes("网关"), "message 含撞车值");
  // 被撞方 A 也应被告知（其正名被占）
  const diagsA = runAllDiagnostics(entities[0], RULE_SET, indexes);
  assert.ok(diagsA.find((d) => d.ruleId === "F17"), "正名被撞方也产 F17");
});

test("F17 别名互相撞：两实体同别名 → 双方 warn", () => {
  const entities = [
    entity("a", { title: "A 服务", "architecture-node-id": "a", aliases: ["服务"] }),
    entity("b", { title: "B 服务", "architecture-node-id": "b", aliases: ["服务"] }),
  ];
  const indexes = buildEntityIndexes(entities);
  assert.ok(indexes.duplicateAliases.has("服务"), "互相撞被捕");
  const diagsA = runAllDiagnostics(entities[0], RULE_SET, indexes);
  const f17a = diagsA.find((d) => d.ruleId === "F17");
  assert.equal(f17a && f17a.passed, false, "A 方违规");
  const diagsB = runAllDiagnostics(entities[1], RULE_SET, indexes);
  assert.equal(diagsB.find((d) => d.ruleId === "F17").passed, false, "B 方违规");
});

test("F17 零撞车：别名不撞时无诊断（dictionary 9 条目 17 别名零撞车的门禁化）", () => {
  const entities = [
    entity("a", { title: "网关", "architecture-node-id": "gw", aliases: ["网关服务", "API 网关"] }),
    entity("b", { title: "数据库", "architecture-node-id": "db", aliases: ["持久层"] }),
  ];
  const indexes = buildEntityIndexes(entities);
  assert.equal(indexes.duplicateAliases.size, 0, "零撞车");
  const diags = runAllDiagnostics(entities[0], RULE_SET, indexes);
  assert.equal(!!diags.find((d) => d.ruleId === "F17" && d.passed === false), false, "无 F17 违规");
});
