// Component: OIDC-Method（PR-085 第 2 步 · ADR-010 决策 6：OIDC 对接现成 IdP——openid-client 标准件，禁自建密码/会话/CSRF）
// @responsible: OIDC 认证方法与登录三端点（login/callback/logout）：authorize 跳转＋授权码换 token（openid-client
//               authorizationCodeGrant，ID token 校验在库内）＋会话签发（session-cookie）；request 侧只认签名 cookie。
// @inputs: AUTH_OIDC_ISSUER／AUTH_OIDC_CLIENT_ID／AUTH_OIDC_CLIENT_SECRET／AUTH_SESSION_SECRET／AUTH_PUBLIC_BASE_URL
// @outputs: createOidcMethod(options) → { name, authenticate, loginHandler, callbackHandler, logoutHandler, config }
// @context: 三态语义（auth-stack 执行）：cookie 缺席=not-applicable（问下一方法）；存在但篡改/过期=invalid（立即 401 不降级）。
//           discovery 惰性一次（首次 login/callback 触发），失败 503 不崩进程；回调 state 双提交校验（cookie 比对，防 CSRF）。
const oidc = require("openid-client");
const { createPrincipal } = require("./principal.cjs");
const { createSessionCookieService } = require("./session-cookie.cjs");
const { randomToken } = require("./principal.cjs");
const { createError } = require("../error-factory.cjs"); // 错误工厂定义唯一（EG-1b）

function parseCookies(headerValue) {
  const out = {};
  for (const part of String(headerValue || "").split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    out[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return out;
}

function createOidcMethod(options = {}) {
  const config = {
    issuer: options.issuer || process.env.AUTH_OIDC_ISSUER || "",
    clientId: options.clientId || process.env.AUTH_OIDC_CLIENT_ID || "",
    clientSecret: options.clientSecret || process.env.AUTH_OIDC_CLIENT_SECRET || "",
    publicBaseUrl: options.publicBaseUrl || process.env.AUTH_PUBLIC_BASE_URL || "",
    scope: options.scope || "openid profile",
    ...options.session ? { session: options.session } : {},
  };
  if (!config.issuer || !config.clientId || !config.publicBaseUrl) {
    throw new Error("oidc 模式须配置 AUTH_OIDC_ISSUER／AUTH_OIDC_CLIENT_ID／AUTH_PUBLIC_BASE_URL（启动 fail-closed）");
  }
  const session = config.session || createSessionCookieService({});
  const redirectUri = `${config.publicBaseUrl.replace(/\/+$/, "")}/api/auth/callback`;
  let discovered = null; // 惰性 discovery（一次）
  async function client() {
    if (!discovered) {
      // http:// issuer 仅限本机/内网（如测试桩与内网 IdP）；https 生产不受影响
      const insecure = new URL(config.issuer).protocol === "http:";
      discovered = await oidc.discovery(
        new URL(config.issuer),
        config.clientId,
        config.clientSecret || undefined,
        undefined,
        insecure ? { execute: [oidc.allowInsecureRequests] } : undefined,
      );
    }
    return discovered;
  }

  function absoluteUrl(request) {
    return new URL(request.url, config.publicBaseUrl);
  }

  function principalFromClaims(idTokenClaims) {
    return createPrincipal({
      operatorId: String(idTokenClaims.sub),
      kind: "user",
      roles: [], // 角色由服务端登记表映射（第 3 步）——绝不读 token 里的角色声明（授权不来自请求参数）
      assurance: "verified",
      channel: "web",
      claims: { name: idTokenClaims.name ?? null },
    });
  }

  function clearSessionCookie() {
    return `${session.cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
  }

  return {
    name: "oidc",
    config: { ...config, redirectUri, cookieName: session.cookieName },
    session,
    async authenticate(request) {
      const cookies = parseCookies(request.headers.cookie);
      const value = cookies[session.cookieName];
      if (!value) return { status: "not-applicable" };
      const claims = session.verify(value);
      if (!claims) return { status: "invalid", reason: "session cookie 无效或过期", setCookies: [clearSessionCookie()] };
      return { status: "authenticated", principal: principalFromClaims({ sub: claims.sub, name: claims.name }) };
    },
    async loginHandler(request, reply) {
      const state = randomToken(24);
      const as = await client();
      const url = oidc.buildAuthorizationUrl(as, {
        redirect_uri: redirectUri,
        scope: config.scope,
        state,
      });
      // state 双提交：短期 state cookie（httpOnly），回调时比对（防 CSRF）
      reply.header("set-cookie", `${session.cookieName}_state=${state}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=600`);
      return reply.redirect(url.href);
    },
    async callbackHandler(request, reply) {
      const cookies = parseCookies(request.headers.cookie);
      const expectedState = cookies[`${session.cookieName}_state`];
      const url = absoluteUrl(request);
      const paramsState = url.searchParams.get("state");
      if (!expectedState || !paramsState || expectedState !== paramsState) {
        throw createError("AUTH_STATE_MISMATCH", "登录回跳 state 不匹配（重放/伪造回调）", 400);
      }
      const as = await client();
      let tokens;
      try {
        tokens = await oidc.authorizationCodeGrant(as, url, { expectedState });
      } catch (error) {
        throw createError("AUTH_CODE_EXCHANGE_FAILED", "IdP 令牌交换失败：" + (error && error.message), 502);
      }
      const claims = tokens.claims(); // ID token claims（库内已验签/验 aud/exp）
      const principal = principalFromClaims(claims);
      const cookie = session.issue({ sub: principal.operatorId, name: principal.claims.name });
      reply.header("set-cookie", `${session.cookieName}=${cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(session.ttlMs / 1000)}`);
      reply.header("set-cookie", `${session.cookieName}_state=; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=0`);
      return reply.redirect(config.publicBaseUrl.replace(/\/+$/, "") + "/");
    },
    async logoutHandler(_request, reply) {
      reply.header("set-cookie", clearSessionCookie());
      return { authenticated: false };
    },
  };
}

module.exports = { createOidcMethod, parseCookies };
