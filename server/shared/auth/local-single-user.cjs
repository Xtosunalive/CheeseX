// Component: Local-Single-User-Method（PR-085 第 2 步 · ADR-010 决策 6）
// @responsible: localSingleUser 认证方法——本机单用户形态：无凭据、恒 authenticated（保持现状零摩擦），
//               assurance=unverified-local（诚实标注「无凭据证明」），角色全给（裁项 5：＝现状）。
// @inputs: LOCAL_OPERATOR_ID（或注入 operatorId）
// @outputs: createLocalSingleUserMethod(options) → { name, authenticate(request) }
// @context: AUTH_MODE=local（缺省）时它是序列唯一方法；oidc 模式默认不进序列（进序列须显式 AUTH_ALLOW_LOCAL=1，
//           且排在 OIDC 之后作显式过渡——绝不允许「凭据无效悄悄降级成本地用户」）。
const { createPrincipal } = require("./principal.cjs");

function createLocalSingleUserMethod(options = {}) {
  const operatorId = options.operatorId || process.env.LOCAL_OPERATOR_ID || "local-architect";
  // 形状守卫在 createPrincipal 内（LOCAL_OPERATOR_ID 环境变量写坏即启动期失败，fail-closed）
  const principal = createPrincipal({ operatorId, kind: "user", roles: ["submit", "review", "publish", "admin"], assurance: "unverified-local", channel: "local" });
  return {
    name: "local-single-user",
    async authenticate(_request) {
      return { status: "authenticated", principal };
    },
  };
}

module.exports = { createLocalSingleUserMethod };
