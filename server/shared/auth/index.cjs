// Component: Auth-From-Env（PR-085 第 2 步装配入口）
// @responsible: 从环境装配身份层：AUTH_MODE=local（缺省，现状零摩擦）| oidc（多用户：OIDC 方法领先；本地方法仅
//               AUTH_ALLOW_LOCAL=1 显式过渡时后置进序列）；CORS 随模式收窄（oidc 带凭据 → 显式 AUTH_ALLOWED_ORIGINS 名单，
//               未配即仅同源）。缺配置启动即错（fail-closed），不回落到 local。
// @inputs: process.env（或注入 env）：AUTH_MODE／AUTH_ALLOW_LOCAL／AUTH_ALLOWED_ORIGINS／LOCAL_OPERATOR_ID／AUTH_OIDC_*／AUTH_SESSION_SECRET／AUTH_PUBLIC_BASE_URL
// @outputs: createAuthFromEnv(env) → { mode, stack, oidc|null, cors, roleRegistry, describe() }
//          roleRegistry：第 3 步——认证主体经登记表装饰有效角色（defaults＋显式登记），由 http-app 在 setPrincipal 前套用
const { createAuthStack } = require("./auth-stack.cjs");
const { createLocalSingleUserMethod } = require("./local-single-user.cjs");
const { createOidcMethod } = require("./oidc-method.cjs");
const { loadDefaultRoleRegistry } = require("./role-registry.cjs");

function parseOrigins(value) {
  return String(value || "").split(",").map((s) => s.trim()).filter(Boolean);
}

function createAuthFromEnv(env = process.env) {
  const mode = env.AUTH_MODE || "local";
  if (mode === "local") {
    const local = createLocalSingleUserMethod({ operatorId: env.LOCAL_OPERATOR_ID });
    return {
      mode,
      stack: createAuthStack({ mode, methods: [local] }),
      oidc: null,
      roleRegistry: loadDefaultRoleRegistry(),
      // 现状保留：本机单用户、无凭据 → 允许任意来源（Vite 代理与直连脚本）
      cors: { origin: "*", methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], allowedHeaders: ["Content-Type", "X-Trace-Id"], strictPreflight: false },
      describe() { return { mode, methods: ["local-single-user"], cors: "*", roles: "registry:local-all+defaults" }; },
    };
  }
  if (mode === "oidc") {
    const oidc = createOidcMethod({});
    const methods = [oidc];
    if (env.AUTH_ALLOW_LOCAL === "1") methods.push(createLocalSingleUserMethod({ operatorId: env.LOCAL_OPERATOR_ID }));
    const origins = parseOrigins(env.AUTH_ALLOWED_ORIGINS);
    return {
      mode,
      stack: createAuthStack({ mode, methods }),
      oidc,
      roleRegistry: loadDefaultRoleRegistry(),
      // 带凭据（cookie）→ 不可用 "*"：显式名单反射；未配名单＝仅同源（不发 CORS 头，fail-closed）
      cors: origins.length
        ? { origin: origins, credentials: true, methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"], allowedHeaders: ["Content-Type", "X-Trace-Id"], strictPreflight: false }
        : false,
      describe() { return { mode, methods: methods.map((m) => m.name), cors: origins.length ? origins : "same-origin-only", issuer: oidc.config.issuer, roles: "registry:defaults+explicit" }; },
    };
  }
  throw new Error(`AUTH_MODE 须为 local|oidc，收到 ${JSON.stringify(mode)}`);
}

module.exports = { createAuthFromEnv };
