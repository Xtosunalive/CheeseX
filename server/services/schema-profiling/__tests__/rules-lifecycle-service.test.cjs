// Component: Rules-Lifecycle-Service Tests（SPEC-008 §3.2）
// @responsible: propose/retire/存量封印/revision 乐观锁/索引联动 各判例。
// @inputs: rules-lifecycle-service + 临时 repoRoot（契约+索引 fixture）
// @outputs: node:test 断言
// @context: SPEC-008；fixture 用 git 仓库真实契约的最小复制（契约形状真实性优先）。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { createRulesLifecycleService, nextRuleId } = require("../rules-lifecycle-service.cjs");

function makeRepo(rules) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rules-lc-"));
  fs.mkdirSync(path.join(dir, "contracts"), { recursive: true });
  const base = {
    $comment: "test fixture",
    article: { required: [], enumFields: {}, fields: {} },
    fields: {},
    rules,
  };
  fs.writeFileSync(path.join(dir, "contracts", "entity-readiness-rules.json"), JSON.stringify(base, null, 2));
  fs.writeFileSync(path.join(dir, "contracts", "rules-lifecycle-index.json"), JSON.stringify({
    $schema: "test",
    "rules-index": { source: "contracts/entity-readiness-rules.json", rules: [] },
  }));
  fs.writeFileSync(path.join(dir, "contracts", "rule-issue-derivation-map.json"), JSON.stringify({
    $schema: "test",
    "rule-issue-derivation-map": { rows: [] },
  }));
  return dir;
}

const EXISTING = [
  { id: "F01", check: "required", field: "title", severity: "error", gates: ["entity-repair.apply-create"], message: "m" },
  { id: "F06", check: "enum-ref", field: "arch_subdomain", severity: "error", gates: ["entity-repair.apply-create"], message: "m" },
  { id: "F17", check: "enum-ref", field: "aliases", severity: "warn", gates: [], message: "m" },
  { id: "B02", check: "body", field: "body", severity: "info", gates: [], message: "m" },
];

test("listRules：台账形态（severity/gates/sealed 判定）", () => {
  const repo = makeRepo(EXISTING);
  const svc = createRulesLifecycleService({ repoRoot: repo });
  const r = svc.listRules();
  assert.equal(r.total, 4);
  const f06 = r.rules.find((x) => x.id === "F06");
  assert.equal(f06.severity, "error");
  assert.equal(f06.sealed, true, "F06 属存量（波4 前封印）");
  assert.equal(f06.indexed, false); // fixture 索引为空
  assert.ok(r.revision.startsWith("sha256:"));
});

test("propose：新 id 自动分配 F18+、一律 warn（波3 红线：error 不发）、契约+索引双写、快照落盘", () => {
  const repo = makeRepo(EXISTING);
  const svc = createRulesLifecycleService({ repoRoot: repo });
  const r = svc.proposeRule({ check: "enum-ref", field: "module", message: "模块引用未注册（{actual}）", issueKind: "unrecognized_entity", revision: svc.listRules().revision }); // PR-201：缺基线即拒
  assert.equal(r.rule.id, "F18");
  assert.equal(r.rule.severity, "warn", "波3 新立规则一律 advise");
  assert.deepEqual(r.rule.gates, []);
  // 契约落盘
  const contract = JSON.parse(fs.readFileSync(path.join(repo, "contracts", "entity-readiness-rules.json")));
  assert.ok(contract.rules.some((x) => x.id === "F18"));
  // 索引联动
  const index = JSON.parse(fs.readFileSync(path.join(repo, "contracts", "rules-lifecycle-index.json")));
  const entry = index["rules-index"].rules.find((x) => x.ruleId === "F18");
  assert.ok(entry, "索引自动补行");
  assert.equal(entry.severity, "warn");
  assert.equal(entry.closure.exit.issueKind, "unrecognized_entity");
  // 映射联动（四层互指第四层——真库验证 A5 孤儿检测抓出的缺口）
  const map = JSON.parse(fs.readFileSync(path.join(repo, "contracts", "rule-issue-derivation-map.json")));
  const row = map["rule-issue-derivation-map"].rows.find((x) => x.ruleId === "F18");
  assert.ok(row, "映射自动补行");
  assert.equal(row.severity, "warn");
  assert.equal(row.exit, "unrecognized_entity");
  assert.equal(row.stage, "read-diagnostic");
  // 快照
  assert.ok(r.snapshot.includes("snapshots/rules-lifecycle"));
  assert.ok(fs.existsSync(path.join(repo, r.snapshot)));
  // 再立一条 → F19
  const r2 = svc.proposeRule({ check: "enum-ref", field: "tags", revision: svc.listRules().revision });
  assert.equal(r2.rule.id, "F19");
});

test("propose 指定已存在 id（存量）→ 409 RULE_SEALED_UNTIL_WAVE4（波4 红线执法）", () => {
  const repo = makeRepo(EXISTING);
  const svc = createRulesLifecycleService({ repoRoot: repo });
  assert.throws(() => svc.proposeRule({ id: "F06", check: "enum-ref", field: "arch_subdomain", severity: "warn", revision: svc.listRules().revision }),
    (e) => e.code === "RULE_SEALED_UNTIL_WAVE4" && e.status === 409);
  // B 族同样封印
  assert.throws(() => svc.proposeRule({ id: "B02", check: "body", field: "body", revision: svc.listRules().revision }),
    (e) => e.code === "RULE_SEALED_UNTIL_WAVE4");
  // PR-201 红例：缺基线即拒（400 SCHEMA_REVISION_REQUIRED——原真值判断形缺省即跳过比对）
  assert.throws(() => svc.proposeRule({ check: "enum-ref", field: "x" }),
    (e) => e.code === "SCHEMA_REVISION_REQUIRED" && e.status === 400);
});

test("propose revision 乐观锁：旧 revision → 409", () => {
  const repo = makeRepo(EXISTING);
  const svc = createRulesLifecycleService({ repoRoot: repo });
  const stale = svc.listRules().revision;
  svc.proposeRule({ check: "enum-ref", field: "module", revision: svc.listRules().revision }); // 契约已变
  assert.throws(() => svc.proposeRule({ check: "enum-ref", field: "x", revision: stale }),
    (e) => e.code === "RULES_REVISION_CONFLICT" && e.status === 409);
});

test("retire：波3 新立规则可退役（severity→info/gates 清空/幂等）；存量 409", () => {
  const repo = makeRepo(EXISTING);
  const svc = createRulesLifecycleService({ repoRoot: repo });
  const { rule } = svc.proposeRule({ check: "enum-ref", field: "module", revision: svc.listRules().revision });
  // PR-201 红例：retire 缺基线同样即拒
  assert.throws(() => svc.retireRule({ id: rule.id }),
    (e) => e.code === "SCHEMA_REVISION_REQUIRED" && e.status === 400);
  const rev = svc.listRules().revision;
  const out = svc.retireRule({ id: rule.id, revision: rev });
  assert.equal(out.rule.severity, "info");
  assert.deepEqual(out.rule.gates, []);
  // 幂等：再 retire 同条
  const again = svc.retireRule({ id: rule.id, revision: svc.listRules().revision });
  assert.equal(again.alreadyRetired, true);
  // 索引联动
  const index = JSON.parse(fs.readFileSync(path.join(repo, "contracts", "rules-lifecycle-index.json")));
  assert.equal(index["rules-index"].rules.find((x) => x.ruleId === rule.id).severity, "info");
  // 存量封印
  assert.throws(() => svc.retireRule({ id: "F06", revision: svc.listRules().revision }), (e) => e.code === "RULE_SEALED_UNTIL_WAVE4");
});

test("nextRuleId 纯函数：跳过已占", () => {
  assert.equal(nextRuleId(["F01", "F18"]), "F19");
  assert.equal(nextRuleId([]), "F18");
});
