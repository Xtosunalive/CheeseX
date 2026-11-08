// Component: Role-Registry（PR-085 第 3 步 · ADR-010 决策 7 · 裁项 5：服务端角色登记表——授权绝不来自请求参数）
// @responsible: 从 contracts/operator-roles.json（唯一事实源）解析操作者角色：defaults.authenticated＝所有已认证主体
//               保底（首期投稿开放）；operators 显式登记额外角色。加载即校验（词表⊆OPERATOR_ROLES、operatorId 字符集、
//               id 唯一）——登记表写坏启动即错，不静默。
// @inputs: contracts/operator-roles.json（或注入 entries/defaults 供测试）
// @outputs: loadDefaultRoleRegistry() → { defaults, resolveRoles(principal) → string[] }
const fs = require("node:fs");
const path = require("node:path");
const { OPERATOR_ROLES, OPERATOR_ID_PATTERN, createPrincipal, isPrincipal } = require("./principal.cjs");

const VOCAB = new Set(OPERATOR_ROLES);

function createRoleRegistry({ entries = [], defaults = { authenticated: ["submit"] } } = {}) {
  const byOperator = new Map();
  for (const entry of entries) {
    if (!entry || typeof entry.operatorId !== "string" || !OPERATOR_ID_PATTERN.test(entry.operatorId)) {
      throw new Error(`operator-roles 登记表 operatorId 不合形状：${JSON.stringify(entry && entry.operatorId)}`);
    }
    if (byOperator.has(entry.operatorId)) throw new Error(`operator-roles 登记表 operatorId 重复：${entry.operatorId}`);
    if (!Array.isArray(entry.roles) || entry.roles.some((r) => !VOCAB.has(r))) {
      throw new Error(`operator-roles 登记表 ${entry.operatorId} 的 roles 须为词表子集 ${OPERATOR_ROLES.join("|")}：${JSON.stringify(entry.roles)}`);
    }
    byOperator.set(entry.operatorId, [...new Set(entry.roles)]);
  }
  const base = Array.isArray(defaults && defaults.authenticated) ? defaults.authenticated : [];
  if (base.some((r) => !VOCAB.has(r))) throw new Error(`operator-roles defaults.authenticated 须为词表子集：${JSON.stringify(base)}`);

  return {
    defaults: { authenticated: base },
    /** 有效角色＝主体自带（方法赋予，如 localSingleUser 全给）∪ 登记表保底 ∪ 登记表按 operatorId 显式登记。 */
    resolveRoles(principal) {
      if (!isPrincipal(principal)) throw new Error("resolveRoles 须收 Principal");
      return [...new Set([...principal.roles, ...base, ...(byOperator.get(principal.operatorId) || [])])]
        .filter((r) => VOCAB.has(r));
    },
    /** 用有效角色重铸 Principal（冻结不变式保持；无变化时原样返回）。 */
    decorate(principal) {
      const roles = this.resolveRoles(principal);
      if (roles.length === principal.roles.length && roles.every((r) => principal.roles.includes(r))) return principal;
      return createPrincipal({ ...principal, roles });
    },
  };
}

function loadDefaultRoleRegistry() {
  const file = path.resolve(__dirname, "..", "..", "..", "contracts", "operator-roles.json");
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  // 文件使用operators，工厂使用entries；显式映射后沿用同一校验与角色并集规则。
  return createRoleRegistry({ entries: parsed.operators, defaults: parsed.defaults });
}

module.exports = { createRoleRegistry, loadDefaultRoleRegistry };
