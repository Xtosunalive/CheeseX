// Component: write-gate-policy（ADR054 D1 / seq171；2026-09-12 适配规则声明新版 gates 字符串数组）
// @responsible: 从 entity-readiness-rules.json 的 gates 声明构建写入门执法策略——
//               各写入门（entity-repair 等）不再手写「拦哪些规则」，统一读本模块。
// @inputs: contracts/entity-readiness-rules.json（rules[].gates: string[]，rules[].severity 单值）
// @outputs: buildWriteGatePolicy() → { strictRuleIds(gate), regressionRuleIds(gate) }
// @context: 仓库契约层（与 Vault 无关）
// 语义：severity==="error" 的规则在该门 strict（新建绝对拦）；其余（warn/info）只受回归保护（编辑回归守卫）。
// 缺省 fail-closed（ADR054）：某门未声明任何规则 → 视为全部 error 级规则 strict（漏声明不会放行）。

const fs = require("node:fs");
const path = require("node:path");

const RULES_PATH = path.join(__dirname, "..", "..", "contracts", "entity-readiness-rules.json");

function isBlockingRule(rule) {
  return rule.severity === "error";
}

function buildWriteGatePolicy(rulesPath = RULES_PATH) {
  const raw = JSON.parse(fs.readFileSync(rulesPath, "utf8"));
  // 2026-10-27 降档：F 族字段校验自代码内声明合并（registry 只剩 B 族真规则）——合并口径与迁出前等价
  const { FIELD_RULES } = require("./field-rule-declarations.cjs");
  const registryRules = Array.isArray(raw.rules) ? raw.rules : [];
  const rules = [...FIELD_RULES, ...registryRules];
  const blockingIds = new Set(rules.filter(isBlockingRule).map((rule) => rule.id));
  // ADR054 D1 fail-closed 精确化（降档随迁）：registry 漏 gates 声明的阻断级规则恒进缺省集——
  // 原粗缺省「整份零 gates 全量阻断」在 F 族代码内恒声明后被掩护失效，精确为「漏声明者不放行」
  const undeclaredBlocking = new Set(
    registryRules.filter(isBlockingRule).filter((rule) => !(rule.gates || []).length).map((rule) => rule.id),
  );
  const byGate = new Map(); // gate -> { strict:Set, regression:Set }
  for (const rule of rules) {
    for (const gate of rule.gates || []) {
      const entry = byGate.get(gate) || { strict: new Set(), regression: new Set() };
      if (rule.severity === "error") entry.strict.add(rule.id);
      else entry.regression.add(rule.id);
      byGate.set(gate, entry);
    }
  }
  return {
    strictRuleIds(gate) {
      const entry = byGate.get(gate);
      if (!entry || entry.strict.size + entry.regression.size === 0) return new Set(blockingIds); // fail-closed 缺省
      return new Set([...entry.strict, ...undeclaredBlocking]);
    },
    regressionRuleIds(gate) {
      const entry = byGate.get(gate);
      if (!entry || entry.strict.size + entry.regression.size === 0) return new Set(blockingIds);
      // strict 规则同时受回归保护（从过变不过更不该发生）；regression 项仅回归保护；漏声明者同护
      return new Set([...entry.regression, ...entry.strict, ...undeclaredBlocking]);
    },
  };
}

module.exports = { buildWriteGatePolicy, isBlockingRule };
