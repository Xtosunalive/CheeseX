// Component: Auth-Stack（PR-085 第 2 步 · ADR-010 决策 6：有序认证方法序列——OpenMAIC 身份接缝同构）
// @responsible: 每请求按序询问认证方法，三态裁决：authenticated 取胜即停；invalid（凭据存在但无效）**立即拒绝、绝不降级**到下一方法
//               或本地用户；not-applicable 问下一方法；全部不适用 → anonymous（读端点放行，写端点由 http-app 判 401）。
//               方法自身无法判定（抛错）→ error（500，不问下一方法——不可判定不得静默放行）。
// @inputs: methods: [{ name, authenticate(request) → {status, principal?, setCookies?, reason?} }]
// @outputs: createAuthStack({ methods, mode }) → { mode, methods, resolve(request) → Outcome }
//   Outcome = { outcome:"authenticated", principal, setCookies, method } | { outcome:"invalid", method, reason, setCookies }
//           | { outcome:"anonymous" } | { outcome:"error", method, error }
const { isPrincipal } = require("./principal.cjs");

const AUTH_MODES = Object.freeze(["local", "oidc"]);

function createAuthStack({ methods, mode }) {
  if (!Array.isArray(methods) || methods.length === 0) throw new Error("auth-stack 至少一个认证方法（空序列＝全体匿名，不允许隐式）");
  if (!AUTH_MODES.includes(mode)) throw new Error(`AUTH_MODE 须为 ${AUTH_MODES.join("|")}，收到 ${mode}`);
  for (const m of methods) {
    if (!m || typeof m.name !== "string" || typeof m.authenticate !== "function") throw new Error("认证方法须有 name 与 authenticate(request)");
  }
  return {
    mode,
    methods: methods.map((m) => m.name),
    async resolve(request) {
      for (const method of methods) {
        let result;
        try {
          result = await method.authenticate(request);
        } catch (error) {
          return { outcome: "error", method: method.name, error };
        }
        if (!result || typeof result.status !== "string") {
          return { outcome: "error", method: method.name, error: new Error(`认证方法 ${method.name} 未返回三态结果`) };
        }
        if (result.status === "authenticated") {
          if (!isPrincipal(result.principal)) return { outcome: "error", method: method.name, error: new Error(`认证方法 ${method.name} 返回的 principal 不合形状`) };
          return { outcome: "authenticated", principal: result.principal, setCookies: Array.isArray(result.setCookies) ? result.setCookies : [], method: method.name };
        }
        if (result.status === "invalid") return { outcome: "invalid", method: method.name, reason: result.reason || "凭据无效", setCookies: Array.isArray(result.setCookies) ? result.setCookies : [] };
        if (result.status !== "not-applicable") {
          return { outcome: "error", method: method.name, error: new Error(`认证方法 ${method.name} 返回未知状态 ${result.status}`) };
        }
      }
      return { outcome: "anonymous" };
    },
  };
}

module.exports = { AUTH_MODES, createAuthStack };
