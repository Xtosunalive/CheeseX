// Layer: unit（server CJS 域）· 验证对象: server/shared/auth/{principal,auth-stack,session-cookie}.cjs
const assert = require("node:assert/strict");
const test = require("node:test");
const { createPrincipal, isPrincipal, attributionOf, OPERATOR_ID_PATTERN } = require("../auth/principal.cjs");
const { createAuthStack } = require("../auth/auth-stack.cjs");
const { createSessionCookieService } = require("../auth/session-cookie.cjs");

test("PR-1 Principal 形状：字符集守卫／roles 子集／冻结；归属取证字段齐", () => {
  const p = createPrincipal({ operatorId: "alice", roles: ["submit", "review"], assurance: "verified" });
  assert.equal(p.kind, "user");
  assert.equal(p.channel, "web");
  assert.ok(isPrincipal(p));
  assert.deepEqual(attributionOf(p), { operatorId: "alice", authenticated: true, assurance: "verified", channel: "web" });
  assert.throws(() => createPrincipal({ operatorId: "带 空格" }));
  assert.throws(() => createPrincipal({ operatorId: "x".repeat(257) }));
  assert.throws(() => createPrincipal({ operatorId: "a", roles: ["superuser"] }));
  assert.equal(OPERATOR_ID_PATTERN.test("local-architect"), true);
});

test("PR-2 方法序列三态：authenticated 即停；not-applicable 问下一；invalid 立即拒绝不降级（先红后绿核心断言）", async () => {
  const local = { name: "local", async authenticate() { return { status: "authenticated", principal: createPrincipal({ operatorId: "local-architect", assurance: "unverified-local" }) }; } };
  const absent = { name: "absent", async authenticate() { return { status: "not-applicable" }; } };
  // 无凭据：走到 local（合法过渡）
  const anonymousThenLocal = await createAuthStack({ mode: "oidc", methods: [absent, local] }).resolve({ headers: {} });
  assert.equal(anonymousThenLocal.outcome, "authenticated");
  assert.equal(anonymousThenLocal.principal.operatorId, "local-architect");
  // 凭据存在但无效：立即 invalid——绝不落到下一方法（OpenMAIC：坏凭据不得悄悄变成别的身份）
  const invalid = { name: "oidc", async authenticate() { return { status: "invalid", reason: "cookie 过期" }; } };
  const broken = await createAuthStack({ mode: "oidc", methods: [invalid, local] }).resolve({ headers: {} });
  assert.equal(broken.outcome, "invalid");
  assert.equal(broken.method, "oidc");
  // 全不适用：anonymous（写端点由 http-app 判 401）
  const anon = await createAuthStack({ mode: "oidc", methods: [absent] }).resolve({ headers: {} });
  assert.equal(anon.outcome, "anonymous");
  // 方法抛错（不可判定）：error——不得静默放行
  const broken2 = { name: "probe", async authenticate() { throw new Error("IdP 不可达"); } };
  const errored = await createAuthStack({ mode: "oidc", methods: [broken2, local] }).resolve({ headers: {} });
  assert.equal(errored.outcome, "error");
});

test("PR-3 会话 cookie：签发/校验往返；篡改与过期一律 null；短密钥启动即错", () => {
  const svc = createSessionCookieService({ secret: "0123456789abcdef0123456789abcdef", ttlMs: 60_000 });
  const cookie = svc.issue({ sub: "alice", name: "Alice" });
  const claims = svc.verify(cookie);
  assert.equal(claims.sub, "alice");
  assert.equal(svc.verify(cookie + "x"), null, "签名篡改必须拒绝");
  assert.equal(svc.verify("garbage"), null);
  const expired = createSessionCookieService({ secret: "0123456789abcdef0123456789abcdef", ttlMs: -1 });
  assert.equal(expired.verify(expired.issue({ sub: "a" })), null, "过期必须拒绝");
  assert.throws(() => createSessionCookieService({ secret: "short" }));
});
