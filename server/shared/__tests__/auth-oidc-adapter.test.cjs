// Layer: adapter-contract（OIDC Adapter · 层级②）· 验证对象: server/shared/auth/oidc-method.cjs
// 真实 openid-client 对接**本进程桩 IdP**（discovery/jwks/token 三端点，RS256 自签 ID token）——验证 authorize 跳转、
// 授权码换取、ID token 验签、会话签发全链；真 IdP 集成随部署选型落地（SPEC-024 诚实边界）。
// 失败注入：state 双提交不匹配 → 400 AUTH_STATE_MISMATCH；token 端点故障 → 502 AUTH_CODE_EXCHANGE_FAILED。
const assert = require("node:assert/strict");
const http = require("node:http");
const crypto = require("node:crypto");
const test = require("node:test");
const { createHttpApp } = require("../http-app.cjs");
const { createOidcMethod } = require("../auth/oidc-method.cjs");
const { createAuthStack } = require("../auth/auth-stack.cjs");
const { createSessionCookieService } = require("../auth/session-cookie.cjs");

const SECRET = "0123456789abcdef0123456789abcdef";
const CLIENT_ID = "cheeseh-e2e";
const KID = "test-key-1";

function b64url(buf) { return Buffer.from(buf).toString("base64url"); }

function startStubIdP() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    if (url.pathname === "/.well-known/openid-configuration") {
      const issuer = `http://127.0.0.1:${server.address().port}`;
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ["code"],
        subject_types_supported: ["public"],
        id_token_signing_alg_values_supported: ["RS256"],
        code_challenge_methods_supported: ["S256"],
      }));
    }
    if (url.pathname === "/jwks") {
      const jwk = publicKey.export({ format: "jwk" });
      res.setHeader("content-type", "application/json");
      return res.end(JSON.stringify({ keys: [{ ...jwk, kid: KID, alg: "RS256", use: "sig" }] }));
    }
    if (url.pathname === "/token" && req.method === "POST") {
      let raw = "";
      req.on("data", (c) => { raw += c; });
      req.on("end", () => {
        const params = new URLSearchParams(raw);
        if (params.get("code") === "bad") { res.statusCode = 500; return res.end(JSON.stringify({ error: "server_error" })); }
        const issuer = `http://127.0.0.1:${server.address().port}`;
        const now = Math.floor(Date.now() / 1000);
        const header = b64url(JSON.stringify({ alg: "RS256", kid: KID, typ: "JWT" }));
        const payload = b64url(JSON.stringify({ iss: issuer, sub: "alice", aud: CLIENT_ID, name: "Alice 测试", iat: now, exp: now + 300 }));
        const signature = crypto.sign("sha256", Buffer.from(`${header}.${payload}`), privateKey).toString("base64url");
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ access_token: "at-1", token_type: "Bearer", id_token: `${header}.${payload}.${signature}` }));
      });
      return undefined;
    }
    res.statusCode = 404; res.end("{}");
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve({ server, issuer: `http://127.0.0.1:${server.address().port}` })));
}

function parseCookies(setCookieValues) {
  const jar = {};
  for (const raw of [].concat(setCookieValues || [])) { const [pair] = String(raw).split(";"); const eq = pair.indexOf("="); jar[pair.slice(0, eq)] = pair.slice(eq + 1); }
  return jar;
}

test("OIDC-1 登录全链（桩 IdP）：login 302＋state cookie → callback 换码验签 → 会话 cookie → /api/auth/me 认证主体", async (t) => {
  const stub = await startStubIdP();
  t.after(() => stub.server.close());
  const session = createSessionCookieService({ secret: SECRET });
  const oidc = createOidcMethod({ issuer: stub.issuer, clientId: CLIENT_ID, clientSecret: "s3cret", publicBaseUrl: "http://127.0.0.1:5184", session });
  const http = createHttpApp({ auth: { mode: "oidc", stack: createAuthStack({ mode: "oidc", methods: [oidc] }), oidc, cors: false } });

  // 密钥轮换后浏览器第一次仍带旧凭据；清除后必须能走完整正常登录链。
  const oldSession = createSessionCookieService({ secret: "old-secret-0123456789abcdef0123456789" });
  const invalid = await http.app.inject({ method: "GET", url: "/api/auth/login", headers: { cookie: `${session.cookieName}=${oldSession.issue({ sub: "alice" })}` } });
  assert.equal(invalid.statusCode, 401);
  assert.match(String(invalid.headers["set-cookie"]), /Max-Age=0/);
  const login = await http.app.inject({ method: "GET", url: "/api/auth/login" });
  assert.equal(login.statusCode, 302);
  const authorize = new URL(login.headers.location);
  assert.equal(authorize.origin, stub.issuer, "跳转到桩 IdP authorize");
  assert.equal(authorize.searchParams.get("client_id"), CLIENT_ID);
  assert.equal(authorize.searchParams.get("redirect_uri"), "http://127.0.0.1:5184/api/auth/callback");
  const state = authorize.searchParams.get("state");
  assert.ok(state, "authorize 带 state");
  const jar = parseCookies(login.headers["set-cookie"]);
  assert.equal(jar[`${session.cookieName}_state`], state, "state 双提交：短期 cookie 与跳转参数同值");

  const callback = await http.app.inject({ method: "GET", url: `/api/auth/callback?code=good&state=${encodeURIComponent(state)}`, headers: { cookie: `${session.cookieName}_state=${jar[`${session.cookieName}_state`]}` } });
  assert.equal(callback.statusCode, 302, JSON.stringify(callback.body));
  assert.equal(callback.headers.location, "http://127.0.0.1:5184/");
  const jar2 = parseCookies(callback.headers["set-cookie"]);
  assert.ok(jar2[session.cookieName], "回跳签发会话 cookie");

  const me = await http.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: `${session.cookieName}=${jar2[session.cookieName]}` } });
  assert.equal(me.json().data.authenticated, true);
  assert.equal(me.json().data.mode, "oidc");
  assert.equal(me.json().data.principal.operatorId, "alice");
  assert.equal(me.json().data.principal.name, "Alice 测试");
  assert.equal(me.json().data.principal.assurance, "verified");
  await http.close();
});

test("OIDC-2 失败注入：state 不匹配 → 400 AUTH_STATE_MISMATCH；token 端点故障 → 502 AUTH_CODE_EXCHANGE_FAILED", async (t) => {
  const stub = await startStubIdP();
  t.after(() => stub.server.close());
  const session = createSessionCookieService({ secret: SECRET });
  const oidc = createOidcMethod({ issuer: stub.issuer, clientId: CLIENT_ID, clientSecret: "s3cret", publicBaseUrl: "http://127.0.0.1:5184", session });
  const http = createHttpApp({ auth: { mode: "oidc", stack: createAuthStack({ mode: "oidc", methods: [oidc] }), oidc, cors: false } });

  const mismatch = await http.app.inject({ method: "GET", url: "/api/auth/callback?code=good&state=forged", headers: { cookie: `${session.cookieName}_state=real-state` } });
  assert.equal(mismatch.statusCode, 400);
  assert.equal(mismatch.json().error_code, "AUTH_STATE_MISMATCH");

  const login = await http.app.inject({ method: "GET", url: "/api/auth/login" });
  const jar = parseCookies(login.headers["set-cookie"]);
  const state = jar[`${session.cookieName}_state`];
  const upstreamDown = await http.app.inject({ method: "GET", url: `/api/auth/callback?code=bad&state=${encodeURIComponent(state)}`, headers: { cookie: `${session.cookieName}_state=${state}` } });
  assert.equal(upstreamDown.statusCode, 502);
  assert.equal(upstreamDown.json().error_code, "AUTH_CODE_EXCHANGE_FAILED");
  await http.close();
});
