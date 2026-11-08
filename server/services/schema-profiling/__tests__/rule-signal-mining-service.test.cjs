// Component: Rule-Signal-Mining-Service Tests（SPEC-006 §3.3）
// @responsible: rule mining 最小版单元测试——聚类正确性/噪音过滤/边界形态。
//               排序注记：A3 排最后，砍掉不伤 A1/A2（21:58 补充交接）。
// @inputs: mineRuleCandidates + 内联 issue 数组（anomaly workbench list() 形态）
// @outputs: node:test 断言
// @context: SPEC-006 §3.3；纯函数零 IO——不建 fixture。
const assert = require("node:assert/strict");
const test = require("node:test");
const { mineRuleCandidates, DEFAULT_MIN_COUNT } = require("../rule-signal-mining-service.cjs");

const issue = (issueId, issueKind, ruleIds) => ({
  issueId,
  issueKind,
  title: `t-${issueId}`,
  status: "open",
  evidence: ruleIds.map((ruleId) => ({ kind: "check", path: "x.md", ruleId })),
});

test("聚类：同 (issueKind, ruleId) 出现 ≥2 次出信号，按频次排序", () => {
  const r = mineRuleCandidates([
    issue("i1", "missing_field", ["F01"]),
    issue("i2", "missing_field", ["F01"]),
    issue("i3", "missing_field", ["F01"]),
    issue("i4", "unrecognized_entity", ["F06"]),
    issue("i5", "unrecognized_entity", ["F06"]),
  ]);
  assert.equal(r.signals.length, 2);
  assert.equal(r.signals[0].ruleId, "F01"); // 3 次 > 2 次，排前
  assert.equal(r.signals[0].count, 3);
  assert.equal(r.signals[0].issueKind, "missing_field");
  assert.equal(r.signals[0].key, "missing_field::F01");
  assert.equal(r.signals[1].count, 2);
  assert.equal(r.totalIssues, 5);
  assert.equal(r.clusteredIssues, 5);
});

test("噪音过滤：count<2 不出信号（单次违规是噪音不是模式）", () => {
  const r = mineRuleCandidates([
    issue("i1", "missing_field", ["F01"]),
    issue("i2", "unrecognized_entity", ["F06"]),
  ]);
  assert.equal(r.signals.length, 0);
  assert.equal(r.clusteredIssues, 2); // 参与聚类但均未达阈值
  assert.equal(r.unclusteredIssues, 0);
});

test("样本上限：sampleIssueIds ≤3，即使 count=5", () => {
  const r = mineRuleCandidates([
    issue("i1", "missing_field", ["F01"]),
    issue("i2", "missing_field", ["F01"]),
    issue("i3", "missing_field", ["F01"]),
    issue("i4", "missing_field", ["F01"]),
    issue("i5", "missing_field", ["F01"]),
  ]);
  assert.equal(r.signals[0].count, 5);
  assert.ok(r.signals[0].sampleIssueIds.length <= 3);
});

test("同 issue 多 ruleId：每条规则独立计数（一条问题挂两规则=两个聚类各+1）", () => {
  const r = mineRuleCandidates([
    issue("i1", "missing_field", ["F01", "F02"]),
    issue("i2", "missing_field", ["F01"]),
    issue("i3", "missing_field", ["F02"]),
  ]);
  assert.equal(r.signals.length, 2);
  assert.equal(r.signals.find((s) => s.ruleId === "F01").count, 2);
  assert.equal(r.signals.find((s) => s.ruleId === "F02").count, 2);
});

test("边界：无 ruleId / 缺 issueKind 的问题不参与聚类（信息不足）", () => {
  const r = mineRuleCandidates([
    { issueId: "x1", issueKind: "missing_field", evidence: [{ path: "a.md" }] }, // 无 ruleId
    { issueId: "x2", evidence: [{ ruleId: "F01" }] }, // 无 issueKind
    issue("i1", "missing_field", ["F01"]),
    issue("i2", "missing_field", ["F01"]),
  ]);
  assert.equal(r.signals.length, 1);
  assert.equal(r.clusteredIssues, 2);
  assert.equal(r.unclusteredIssues, 2);
  assert.equal(r.totalIssues, 4);
});

test("边界：空输入/非数组/垃圾元素防御", () => {
  assert.equal(mineRuleCandidates([]).signals.length, 0);
  assert.equal(mineRuleCandidates(null).signals.length, 0);
  assert.equal(mineRuleCandidates([null, 42, "x"]).signals.length, 0);
  assert.equal(mineRuleCandidates([null]).totalIssues, 1);
});

test("minCount 参数化：门槛可调（默认 " + DEFAULT_MIN_COUNT + "）", () => {
  const batch = [issue("i1", "missing_field", ["F01"]), issue("i2", "missing_field", ["F01"])];
  assert.equal(mineRuleCandidates(batch).signals.length, 1); // 默认 2：达阈
  assert.equal(mineRuleCandidates(batch, { minCount: 3 }).signals.length, 0); // 调严 3
  assert.equal(mineRuleCandidates(batch, { minCount: 1 }).signals.length, 1); // 调宽 1
});
