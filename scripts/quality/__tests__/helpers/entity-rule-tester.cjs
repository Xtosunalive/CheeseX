// Component: Entity-Rule-Tester (对标 ESLint RuleTester)
// @responsible: 测试专用单条规则断言工具——生产唯一入口是 service.checkEntityCompliance(runAllDiagnostics)，
//              本工具从同一引擎取单条规则诊断，替代挂在生产 service 上的 legacy checkF*/checkB* 死链。
// @inputs: frontmatter 对象 / body 字符串 + ruleId + 可选 ruleSet/indexes
// @outputs: 单条诊断 { ruleId, field, severity, passed, message, hint, currentValue, ... }（legacy finding 形态）
// @context: Canvas（仅测试使用，禁止生产 import）
// 对标 ESLint：linter.verify(生产) ↔ RuleTester.run(测试专用)。此处 ruleDiag 是测试专用，
// 与生产共用 engine.runAllDiagnostics（同源，杜绝双出口语义漂移）。

const engine = require("../../../../server/services/entity-compliance/entity-compliance-declarative-engine.cjs");

const EMPTY_IDX = { ids: {}, titleLookup: {}, filenameLookup: {}, duplicateIds: new Set(), duplicateTitles: new Set() };

function ruleDiag(input, ruleId, opts) {
  opts = opts || {};
  var ruleSet = opts.ruleSet || {};
  var isBody = opts.isBody === true;
  var idx = opts.indexes || EMPTY_IDX;
  var all = engine.runAllDiagnostics(
    isBody ? { frontmatter: {}, body: input || "" } : { frontmatter: input || {}, body: "" },
    ruleSet,
    idx
  );
  var d = all.find(function (x) { return x.ruleId === ruleId; });
  if (!d) return { ruleId: ruleId, field: ruleId, severity: "info", passed: true, message: "通过", _group: "?" };
  return engine.diagnosticToFinding(d);
}

module.exports = { ruleDiag: ruleDiag };
