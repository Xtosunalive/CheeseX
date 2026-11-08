// Layer: integration（server CJS 域，Fastify inject 走完整传输层）· 验证对象: http-app 身份接缝（PR-085 第 2 步 · ADR-010 决策 6/7）
// 覆盖：local 模式现状不变／oidc 模式写 401・读开放／凭据无效不降级／归属取证记真实 operatorId／墓碑与 logout 免门／
//       CORS 随模式收窄／writer-gate 通道轴＋403 封套（裁项 4a・5）
const assert = require("node:assert/strict");
const test = require("node:test");
const path = require("node:path");
const { createHttpApp } = require("../http-app.cjs");
const { createAuthFromEnv } = require("../auth/index.cjs");
const { createAuthStack } = require("../auth/auth-stack.cjs");
const { createOidcMethod } = require("../auth/oidc-method.cjs");
const { createLocalSingleUserMethod } = require("../auth/local-single-user.cjs");
const { createSessionCookieService } = require("../auth/session-cookie.cjs");
const { createPrincipal } = require("../auth/principal.cjs");
const { createLocalOperatorContext } = require("../../services/governance/local-operator-context.cjs");
const { createWriterGate } = require("../writer-gate.cjs");
const { sendJSON } = require("../api-envelope.cjs");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const SECRET = "0123456789abcdef0123456789abcdef";
const silent = { info() {}, warn() {}, error() {} };

function oidcAuth({ allowLocal = false, origins = null } = {}) {
  const session = createSessionCookieService({ secret: SECRET });
  const oidc = createOidcMethod({ issuer: "http://127.0.0.1:1", clientId: "cheeseh", publicBaseUrl: "http://127.0.0.1:5184", session });
  const methods = [oidc];
  if (allowLocal) methods.push(createLocalSingleUserMethod({ operatorId: "local-architect" }));
  return { mode: "oidc", stack: createAuthStack({ mode: "oidc", methods }), oidc, cors: origins ? { origin: origins, credentials: true } : false, session };
}

function makeApp(auth, { writerGate = null } = {}) {
  const http = createHttpApp({ auth, writerGate, isWriteGateExempt: (p) => p === "/api/health" });
  const ctx = createLocalOperatorContext({ mode: auth.mode });
  const safeOperator = () => { try { return ctx.getOperatorId(); } catch (error) { return "ERR:" + error.code; } };
  http.registerRoute("POST", "/api/pipeline/cancel", (_req, res) => sendJSON(res, 200, { operator: ctx.getOperatorId(), attribution: ctx.attribution() }));
  http.registerRoute("GET", "/api/health", (_req, res) => sendJSON(res, 200, { ok: true, operator: safeOperator() }));
  http.registerRoute("PUT", "/api/articles/precleaned/approval", Object.assign((_req, res) => sendJSON(res, 410, { error_code: "LEGACY_ARTICLE_APPROVAL_GONE", message: "gone" }), { tombstone: true }));
  return http;
}

test("WP-093 密钥轮换：旧会话首次401且清凭据，不降级；清除后退出可达", async () => {
  const auth = oidcAuth({ allowLocal: true });
  const old = createSessionCookieService({ secret: "old-secret-0123456789abcdef0123456789" });
  const cookie = `${auth.session.cookieName}=${old.issue({ sub: "alice" })}`;
  const http = makeApp(auth);
  try {
    for (const [method, url] of [["GET", "/api/auth/login"], ["POST", "/api/auth/logout"], ["POST", "/api/pipeline/cancel"]]) {
      const res = await http.app.inject({ method, url, headers: { cookie } });
      assert.equal(res.statusCode, 401, "无效凭据仍立即拒绝，不落到本地身份");
      assert.match(String(res.headers["set-cookie"]), /anyshare_session=;.*Path=\/;.*Max-Age=0/);
    }
    const logout = await http.app.inject({ method: "POST", url: "/api/auth/logout" });
    assert.equal(logout.statusCode, 200);
  } finally { await http.close(); }
});

test("AU-1 local 模式（缺省）：写照常通过、归属为本地操作者（现状零变化）；/api/auth/* 四端点可用", async () => {
  const auth = createAuthFromEnv({ AUTH_MODE: "local", LOCAL_OPERATOR_ID: "local-architect" });
  const http = makeApp(auth);
  const write = await http.app.inject({ method: "POST", url: "/api/pipeline/cancel" });
  assert.equal(write.statusCode, 200, JSON.stringify(write.body));
  assert.equal(write.json().data.operator, "local-architect");
  assert.deepEqual(write.json().data.attribution, { operatorId: "local-architect", authenticated: false, assurance: "unverified-local", channel: "local", mode: "local-single-user" });
  const me = await http.app.inject({ method: "GET", url: "/api/auth/me" });
  assert.equal(me.json().data.mode, "local");
  assert.equal(me.json().data.authenticated, false, "本地单用户无凭据——诚实标注未经验证");
  assert.equal(me.json().data.principal.operatorId, "local-architect");
  assert.deepEqual(me.json().data.principal.roles, ["submit", "review", "publish", "admin"]);
  const login = await http.app.inject({ method: "GET", url: "/api/auth/login" });
  assert.equal(login.statusCode, 400); assert.equal(login.json().error_code, "AUTH_LOCAL_MODE");
  const logout = await http.app.inject({ method: "POST", url: "/api/auth/logout" });
  assert.equal(logout.statusCode, 200); assert.equal(logout.json().data.authenticated, false);
  await http.close();
});

test("AU-2 oidc 模式无凭据：写 → 401 UNAUTHENTICATED 封套；读开放（裁项 3a）且 operator-context fail-closed", async () => {
  const http = makeApp(oidcAuth());
  const write = await http.app.inject({ method: "POST", url: "/api/pipeline/cancel" });
  assert.equal(write.statusCode, 401);
  assert.equal(write.json().error_code, "UNAUTHENTICATED");
  assert.match(write.json().trace_id, /^tr_/);
  const read = await http.app.inject({ method: "GET", url: "/api/health" });
  assert.equal(read.statusCode, 200);
  assert.equal(read.json().data.operator, "ERR:UNAUTHENTICATED", "oidc 模式无主体时归属取证不得回落本地操作者");
  const me = await http.app.inject({ method: "GET", url: "/api/auth/me" });
  assert.equal(me.json().data.authenticated, false); assert.equal(me.json().data.principal, null);
  await http.close();
});

test("AU-3 oidc 有效会话：写通过、归属记真实 operatorId（verified）；/api/auth/me 回显主体视图", async () => {
  const auth = oidcAuth();
  const http = makeApp(auth);
  const cookie = `${auth.session.cookieName}=${auth.session.issue({ sub: "alice", name: "Alice" })}`;
  const write = await http.app.inject({ method: "POST", url: "/api/pipeline/cancel", headers: { cookie } });
  assert.equal(write.statusCode, 200, JSON.stringify(write.body));
  assert.equal(write.json().data.operator, "alice");
  assert.deepEqual(write.json().data.attribution, { operatorId: "alice", authenticated: true, assurance: "verified", channel: "web", mode: "oidc" });
  const me = await http.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie } });
  assert.equal(me.json().data.authenticated, true);
  assert.equal(me.json().data.principal.name, "Alice");
  assert.deepEqual(me.json().data.principal.roles, [], "roles 不从 token 读——归第 3 步服务端登记表");
  await http.close();
});

test("AU-4 凭据存在但无效 → 401 不降级（读写一律），即便序列后置了本地方法；无凭据时后置本地方法才接手（显式过渡）", async () => {
  const auth = oidcAuth({ allowLocal: true });
  const http = makeApp(auth);
  const bad = `${auth.session.cookieName}=tampered.signature`;
  const write = await http.app.inject({ method: "POST", url: "/api/pipeline/cancel", headers: { cookie: bad } });
  assert.equal(write.statusCode, 401, "坏凭据绝不能悄悄变成本地用户");
  const read = await http.app.inject({ method: "GET", url: "/api/health", headers: { cookie: bad } });
  assert.equal(read.statusCode, 401, "读端点同样拒绝坏凭据（匿名才开放）");
  const transition = await http.app.inject({ method: "POST", url: "/api/pipeline/cancel" });
  assert.equal(transition.statusCode, 200);
  assert.equal(transition.json().data.operator, "local-architect");
  await http.close();
});

test("AU-5 墓碑与 logout 不设主体门：未认证 PUT 墓碑 → 410；未认证 POST logout → 200 并清 cookie", async () => {
  const http = makeApp(oidcAuth());
  const gone = await http.app.inject({ method: "PUT", url: "/api/articles/precleaned/approval", payload: { approved: true } });
  assert.equal(gone.statusCode, 410);
  const logout = await http.app.inject({ method: "POST", url: "/api/auth/logout" });
  assert.equal(logout.statusCode, 200);
  assert.match(String(logout.headers["set-cookie"]), /anyshare_session=;.*Max-Age=0/);
  await http.close();
});

test("AU-6 CORS 随模式收窄：oidc 显式名单带凭据反射；名单外无 ACAO；未配名单仅同源（无 CORS 头）", async () => {
  const listed = makeApp(oidcAuth({ origins: ["http://a.test"] }));
  const okPreflight = await listed.app.inject({ method: "OPTIONS", url: "/api/health", headers: { origin: "http://a.test", "access-control-request-method": "GET" } });
  assert.equal(okPreflight.headers["access-control-allow-origin"], "http://a.test");
  assert.equal(okPreflight.headers["access-control-allow-credentials"], "true");
  const other = await listed.app.inject({ method: "GET", url: "/api/health", headers: { origin: "http://b.test" } });
  assert.equal(other.headers["access-control-allow-origin"], undefined);
  await listed.close();
  const sameOriginOnly = makeApp(oidcAuth());
  const res = await sameOriginOnly.app.inject({ method: "GET", url: "/api/health", headers: { origin: "http://a.test" } });
  assert.equal(res.headers["access-control-allow-origin"], undefined, "未配名单＝不发 CORS 头（fail-closed）");
  await sameOriginOnly.close();
  const local = makeApp(createAuthFromEnv({ AUTH_MODE: "local" }));
  const star = await local.app.inject({ method: "GET", url: "/api/health", headers: { origin: "http://anywhere.test" } });
  assert.equal(star.headers["access-control-allow-origin"], "*", "local 模式保持现状 *");
  await local.close();
});

test("AU-7 writer-gate 通道轴＋403 封套：已认证用户经已登记通道 api-page 通过；通道未登记 → 403 标准封套（details 承载名单）", async () => {
  const auth = oidcAuth();
  const cookie = `${auth.session.cookieName}=${auth.session.issue({ sub: "alice" })}`;
  const ctx = createLocalOperatorContext({ mode: "oidc" });
  const okGate = createWriterGate({ operatorContext: ctx, archRepoPath: ROOT, logger: silent });
  const okApp = makeApp(auth, { writerGate: okGate });
  const pass = await okApp.app.inject({ method: "POST", url: "/api/pipeline/cancel", headers: { cookie } });
  assert.equal(pass.statusCode, 200, "人不在 writers 名单但通道 api-page 已登记——通道轴放行：" + JSON.stringify(pass.body));
  await okApp.close();
  const rogueGate = createWriterGate({ operatorContext: ctx, archRepoPath: ROOT, logger: silent, channel: "rogue-channel" });
  const rogueApp = makeApp(auth, { writerGate: rogueGate });
  const denied = await rogueApp.app.inject({ method: "POST", url: "/api/pipeline/cancel", headers: { cookie } });
  assert.equal(denied.statusCode, 403);
  const body = denied.json();
  assert.equal(body.success, false, "裁项 4a 第 2 步：裸形态退役，归一标准封套");
  assert.equal(body.error_code, "WRITER_NOT_REGISTERED");
  assert.match(body.trace_id, /^tr_/);
  assert.equal(body.details.operator, "alice");
  assert.ok(body.details.registered_writers.includes("api-page"));
  await rogueApp.close();
});

// ── PR-085 第 3 步：角色绑定（ADR-010 决策 7 · 裁项 5）── 服务端登记表（contracts/operator-roles.json）＋
//    路由角色表（route-roles.cjs，加载即对账契约）＋审批 publish 载荷敏感升级；local 模式全角色恒过（现状零变化）。
const { createRoleRegistry, loadDefaultRoleRegistry } = require("../auth/role-registry.cjs");
const { ROUTE_ROLES, listRouteRoleBindings, requiredRolesFor } = require("../auth/route-roles.cjs");

function roleApp({ entries = [], defaults = { authenticated: ["submit"] }, user = "alice" } = {}) {
  const session = createSessionCookieService({ secret: SECRET });
  const oidc = createOidcMethod({ issuer: "http://127.0.0.1:1", clientId: "cheeseh", publicBaseUrl: "http://127.0.0.1:5184", session });
  const registry = createRoleRegistry({ entries, defaults });
  const auth = { mode: "oidc", stack: createAuthStack({ mode: "oidc", methods: [oidc] }), oidc, cors: false, roleRegistry: registry, session };
  const http = createHttpApp({ auth });
  http.registerRoute("PUT", "/api/schema/enums", (_req, res) => sendJSON(res, 200, { ok: true }));                     // admin 门（契约真实操作）
  http.registerRoute("POST", "/api/anomalies/:issueId/:operation", (req, res) => sendJSON(res, 200, { ok: true, operation: req.params.operation })); // review 门
  http.registerRoute("POST", "/api/approval/:articleId/transition", (_req, res) => sendJSON(res, 200, { ok: true }));  // review 门＋publish 升级
  return { http, cookie: `${session.cookieName}=${session.issue({ sub: user })}` };
}

test("ROLE-1 local 模式全角色恒过（现状零变化）；登记表装饰：默认 submit＋显式登记并集", async () => {
  const auth = createAuthFromEnv({ AUTH_MODE: "local", LOCAL_OPERATOR_ID: "local-architect" });
  const http = makeApp(auth);
  const schemaWrite = await http.app.inject({ method: "POST", url: "/api/pipeline/cancel" });
  assert.equal(schemaWrite.statusCode, 200);
  await http.close();
  const registry = createRoleRegistry({ defaults: { authenticated: ["submit"] }, entries: [{ operatorId: "alice", roles: ["review"] }] });
  const nobody = registry.decorate(createPrincipal({ operatorId: "stranger" }));
  assert.deepEqual([...nobody.roles], ["submit"], "默认保底＝投稿");
  const alice = registry.decorate(createPrincipal({ operatorId: "alice" }));
  assert.deepEqual([...alice.roles], ["submit", "review"], "默认∪显式登记");
});

test("ROLE-2 oidc 默认用户（仅 submit）：schema 写 → 403 ROLE_DENIED；登记 review 后异常处置过、schema 写仍拒；登记 admin 后过", async () => {
  // WP-048 W1-A：schema 写族角色绑定单源迁 action_types 快照（ADR-014 §6.1）——本用例即快照供源的角色门回归
  const { initActionRegistry, resetActionRegistry } = require("../action-registry.cjs");
  initActionRegistry({ vaultPath: process.cwd(), logger: null });
  try {
  const stranger = roleApp();
  const denied = await stranger.http.app.inject({ method: "PUT", url: "/api/schema/enums", headers: { cookie: stranger.cookie }, payload: { revision: "sha256:" + "a".repeat(64), patch: { subdomains: { ops: ["deploy"] } } } });
  assert.equal(denied.statusCode, 403, JSON.stringify(denied.json()));
  assert.equal(denied.json().error_code, "ROLE_DENIED");
  assert.deepEqual(denied.json().details.required, ["admin"]);
  assert.deepEqual(denied.json().details.have, ["submit"]);
  await stranger.http.close();

  const reviewer = roleApp({ entries: [{ operatorId: "alice", roles: ["review"] }] });
  const anomaly = await reviewer.http.app.inject({ method: "POST", url: "/api/anomalies/i1/preview", headers: { cookie: reviewer.cookie }, payload: {} });
  assert.equal(anomaly.statusCode, 200, JSON.stringify(anomaly.json()));
  const schemaStill = await reviewer.http.app.inject({ method: "PUT", url: "/api/schema/enums", headers: { cookie: reviewer.cookie }, payload: { revision: "sha256:" + "a".repeat(64), patch: { subdomains: { ops: ["deploy"] } } } });
  assert.equal(schemaStill.statusCode, 403);
  await reviewer.http.close();

  const admin = roleApp({ entries: [{ operatorId: "alice", roles: ["admin"] }] });
  const pass = await admin.http.app.inject({ method: "PUT", url: "/api/schema/enums", headers: { cookie: admin.cookie }, payload: { revision: "sha256:" + "a".repeat(64), patch: { subdomains: { ops: ["deploy"] } } } });
  assert.equal(pass.statusCode, 200, JSON.stringify(pass.json()));
  await admin.http.close();
  } finally { resetActionRegistry(); }
});

test("ROLE-3 审批 publish 载荷敏感升级：review 用户非 publish 操作过、publish 被拒；publish 角色用户 publish 过（WP-048 W1-B 起单源在 action_types payload_role_overrides）", async () => {
  const { initActionRegistry, resetActionRegistry } = require("../action-registry.cjs");
  initActionRegistry({ vaultPath: process.cwd(), logger: null });
  try {
  const reviewer = roleApp({ entries: [{ operatorId: "alice", roles: ["review"] }] });
  const confirm = await reviewer.http.app.inject({ method: "POST", url: "/api/approval/a1/transition", headers: { cookie: reviewer.cookie }, payload: { operation: "confirm" } });
  assert.equal(confirm.statusCode, 200, JSON.stringify(confirm.json()));
  const publishDenied = await reviewer.http.app.inject({ method: "POST", url: "/api/approval/a1/transition", headers: { cookie: reviewer.cookie }, payload: { operation: "publish" } });
  assert.equal(publishDenied.statusCode, 403);
  assert.equal(publishDenied.json().error_code, "ROLE_DENIED");
  assert.deepEqual(publishDenied.json().details.required, ["publish"]);
  await reviewer.http.close();
  const publisher = roleApp({ entries: [{ operatorId: "alice", roles: ["review", "publish"] }] });
  const publishOk = await publisher.http.app.inject({ method: "POST", url: "/api/approval/a1/transition", headers: { cookie: publisher.cookie }, payload: { operation: "publish" } });
  assert.equal(publishOk.statusCode, 200, JSON.stringify(publishOk.json()));
  await publisher.http.close();
  } finally { resetActionRegistry(); }
});

test("ROLE-4 绑定表 fail-closed：键必须对账契约（漂移即加载红）；requiredRolesFor 载荷升级与归一匹配（WP-048 W1-A 后双源分工）", () => {
  const ops = require("../contract-request-schema.cjs").listContractOperations().map((op) => `${op.method} ${op.template}`);
  for (const key of Object.keys(listRouteRoleBindings())) assert.ok(ops.includes(key), `绑定键须为契约操作：${key}`);
  // WP-048 W1-A/W1-B：schema 写族与审批载荷升级迁 action_types 快照供源（静态表键已移除，防两份角色声明）
  const { initActionRegistry, resetActionRegistry, actionRouteRoleFor } = require("../action-registry.cjs");
  initActionRegistry({ vaultPath: process.cwd(), logger: null });
  try {
    assert.deepEqual(requiredRolesFor("POST", "/api/approval/:articleId/transition", { operation: "publish" }), ["publish"], "载荷升级经快照声明式承载");
    assert.deepEqual(requiredRolesFor("POST", "/api/approval/:articleId/transition", { operation: "confirm" }), ["review"]);
    assert.deepEqual(requiredRolesFor("PUT", "/api/schema/enums"), ["admin"], "已迁移端点经快照取角色");
    assert.deepEqual(actionRouteRoleFor("PUT", "/api/schema/ontology"), ["admin"]);
    assert.deepEqual(actionRouteRoleFor("POST", "/api/governance/resolve"), [], "原无角色端点快照同样承载（空角色）");
    assert.equal(Object.keys(ROUTE_ROLES).length, 4, "W1-A/B/C 后静态表只保留未迁移端点（与快照互斥）");
  } finally { resetActionRegistry(); }
  assert.equal(requiredRolesFor("POST", "/api/pipeline/cancel"), null, "未绑定＝门不设（默认保底 submit 已由写门 401 覆盖；W1-C 迁移后改快照）");
});

test("ROLE-5 登记表校验：词表外角色／坏 operatorId／重复登记 → 加载即错", () => {
  assert.throws(() => createRoleRegistry({ entries: [{ operatorId: "x", roles: ["root"] }] }), /词表子集/);
  assert.throws(() => createRoleRegistry({ entries: [{ operatorId: "bad id", roles: ["admin"] }] }), /形状/);
  assert.throws(() => createRoleRegistry({ entries: [{ operatorId: "a", roles: ["admin"] }, { operatorId: "a", roles: ["review"] }] }), /重复/);
});

// PR-264：真实仓内配置装载，验证对象是默认装载器而非只给工厂传 entries。
test("ROLE-6 PR-264：真实默认配置operators的显式登记实际生效", () => {
  const fs = require("node:fs");
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "contracts/operator-roles.json"), "utf8"));
  const registry = loadDefaultRoleRegistry();
  assert.ok(config.operators.length > 0, "本回归使用仓内现存显式登记作为可观测输入");
  for (const entry of config.operators) {
    const actual = registry.resolveRoles(createPrincipal({ operatorId: entry.operatorId, roles: [] }));
    const expected = [...new Set([...config.defaults.authenticated, ...entry.roles])];
    assert.deepEqual([...actual].sort(), expected.sort(), "默认文件登记不能被静默丢弃");
  }
});

test("ROLE-7 PR-264：真实默认配置未登记主体仍只有原保底角色", () => {
  const fs = require("node:fs");
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, "contracts/operator-roles.json"), "utf8"));
  const registry = loadDefaultRoleRegistry();
  const unknown = createPrincipal({ operatorId: "wp120-" + require("node:crypto").randomUUID(), roles: [] });
  assert.deepEqual(registry.resolveRoles(unknown).sort(), [...new Set(config.defaults.authenticated)].sort());
});

for (const [name, operators, expected] of [
  ["非法角色", [{ operatorId: "alice", roles: ["not-a-role"] }], /roles 须为词表子集/],
  ["非法身份", [{ operatorId: "bad id", roles: ["review"] }], /operatorId 不合形状/],
  ["重复身份", [{ operatorId: "alice", roles: [] }, { operatorId: "alice", roles: [] }], /operatorId 重复/],
]) {
  test(`ROLE-8 PR-264 Adapter：文件operators含${name}时仍经原工厂校验拒绝`, () => {
    // 仅Adapter故障注入：替换配置读取结果，不改真实角色文件，不计真实外部身份集成。
    const fs = require("node:fs");
    const file = path.join(ROOT, "contracts/operator-roles.json");
    const original = fs.readFileSync;
    fs.readFileSync = function (target, ...args) {
      if (target === file) return JSON.stringify({ defaults: { authenticated: ["submit"] }, operators });
      return original.call(this, target, ...args);
    };
    try { assert.throws(() => loadDefaultRoleRegistry(), expected); }
    finally { fs.readFileSync = original; }
  });
}
