const assert = require("node:assert/strict");
const test = require("node:test");
const { createLocalOperatorContext } = require("../local-operator-context.cjs");

test("injects a configured local operator and ignores client reviewer", () => {
  const context = createLocalOperatorContext({ operatorId: "architect-local" });
  assert.equal(context.resolve("client-forged-reviewer"), "architect-local");
  // PR-085 第 2 步：归属取证增 assurance/channel（请求上下文无主体时为本地回落形态）
  assert.deepEqual(context.attribution(), { operatorId: "architect-local", mode: "local-single-user", authenticated: false, assurance: "unverified-local", channel: "local" });
});

test("rejects an empty operator", () => {
  assert.throws(() => createLocalOperatorContext({ operatorId: " " }), /non-empty/);
});
