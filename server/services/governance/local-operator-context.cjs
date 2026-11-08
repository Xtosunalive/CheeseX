// @responsible: 操作者身份解析与归因（PR-085 第 2 步起）——不再持有身份，而是从请求上下文读取 auth-stack 解析出的 Principal
//   （AsyncLocalStorage；ADR-010 决策 6）。对外签名 getOperatorId／attribution／resolve 不变——writer-gate／anomaly-workbench／
//   release-runtime／article-association（service＋worktree-writer）5 个消费点零改动。
//   - AUTH_MODE=local（缺省）：请求上下文无主体（如启动期/非 HTTP 调用）时回落本地操作者——与原单用户桩等价；
//   - AUTH_MODE=oidc：无主体即抛 401 UNAUTHENTICATED（fail-closed：归属取证不得伪造身份）。
//   - resolve(requestValue)：授权绝不来自请求参数（TALOS 纪律）——忽略客户端声明值，恒返回服务端解析身份。
const { getPrincipal } = require("../../shared/request-context.cjs");
const { attributionOf } = require("../../shared/auth/principal.cjs");
const { createError } = require("../../shared/error-factory.cjs");

function createLocalOperatorContext({ operatorId = process.env.LOCAL_OPERATOR_ID || "local-architect", mode = process.env.AUTH_MODE || "local" } = {}) {
  if (typeof operatorId !== "string" || !operatorId.trim()) throw new Error("LOCAL_OPERATOR_ID must be a non-empty string");
  const normalized = operatorId.trim();

  function requirePrincipalOrFallback() {
    const principal = getPrincipal();
    if (principal) return principal;
    if (mode === "local") return null;
    throw createError("UNAUTHENTICATED", "无认证主体：oidc 模式下归属取证不得回落到本地操作者", 401);
  }

  return {
    getOperatorId() {
      const principal = requirePrincipalOrFallback();
      return principal ? principal.operatorId : normalized;
    },
    attribution() {
      const principal = requirePrincipalOrFallback();
      if (!principal) return { operatorId: normalized, mode: "local-single-user", authenticated: false, assurance: "unverified-local", channel: "local" };
      return { ...attributionOf(principal), mode: principal.channel === "local" ? "local-single-user" : "oidc" };
    },
    resolve(_requestValue) {
      return this.getOperatorId();
    },
  };
}

module.exports = { createLocalOperatorContext };
