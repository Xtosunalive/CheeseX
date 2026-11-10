// check-error-codes 守护测试（PR-206 批立）：对账核心为纯函数（合成输入，零盘上夹具）。
// 覆盖：①双向对账（未登记/死枚举）②内部信号车道机器面四硬判 ③四要素/过期结构红 ④路由边界识别。
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { auditErrorCodes, auditRegistryFaces, collectThrownCodes, collectContractCodes } from "../check-error-codes.mjs";

const contract = (codes) => ({
  components: {
    schemas: {
      FooErrorResponse: { properties: { error_code: { type: "string", enum: codes } } },
    },
  },
});
const four = (code, reason = "有主有期有追踪的理由，足够具体") => ({
  code,
  reason,
  owner: "klena",
  expiresAt: "2099-12-31",
  reviewCondition: "到期复审",
});
const texts = (map) => new Map(Object.entries(map));

test("collectThrownCodes：五形态全收＋路由层单列＋error_code 直写单列", () => {
  const t = texts({
    "server/routes/a-routes.cjs": 'router.post("/a", () => { throw createError("ROUTE_SIDE_CODE", "x", 400); });',
    "server/services/s.cjs": 'function f() { const e = new Error("x"); e.code = "DOT_CODE_SIGNAL"; return e; }',
    "server/shared/u.cjs": 'module.exports = { error_code: "SERIALIZED_LITERAL" };',
    "server/shared/v.cjs": 'throw Object.assign(new Error("m"), { code: "OBJASSIGN_CODE" });',
  });
  const { thrown, serialized, routesThrown } = collectThrownCodes(t);
  assert.deepEqual([...thrown.keys()].sort(), ["DOT_CODE_SIGNAL", "OBJASSIGN_CODE", "ROUTE_SIDE_CODE", "SERIALIZED_LITERAL"]);
  assert.ok(serialized.has("SERIALIZED_LITERAL"), "error_code: 直写进序列化集");
  assert.ok(routesThrown.has("ROUTE_SIDE_CODE"), "路由层抛点进 routesThrown");
  assert.ok(!routesThrown.has("DOT_CODE_SIGNAL"), "服务层抛点不进 routesThrown");
});

test("双向对账：抛了未登记红（出口提示含内部信号车道）＋死枚举红＋齐则绿", () => {
  const ok = auditErrorCodes({
    contract: contract(["IN_CONTRACT"]),
    exemptions: { unregistered: [four("IN_BASELINE")] },
    serverTexts: texts({ "server/services/a.cjs": 'throw serviceError("IN_CONTRACT", "x");\nthrow serviceError("IN_BASELINE", "y");' }),
  });
  assert.equal(ok.violations.length, 0, "契约内＋基线内＝绿：" + ok.violations.join(" / "));
  assert.match(ok.readout, /unregistered_baseline=1 internal_signals=0/);

  const unregistered = auditErrorCodes({
    contract: contract([]),
    exemptions: {},
    serverTexts: texts({ "server/services/a.cjs": 'throw serviceError("NAKED_CODE", "x");' }),
  });
  assert.match(unregistered.violations[0], /\[未登记\] 服务端抛 "NAKED_CODE"/);
  assert.match(unregistered.violations[0], /internalSignals 车道/);

  const dead = auditErrorCodes({
    contract: contract(["GHOST_ENUM"]),
    exemptions: {},
    serverTexts: texts({}),
  });
  assert.match(dead.violations[0], /\[死枚举\].*"GHOST_ENUM"/);
});

test("内部信号车道四硬判：入契约／error_code 直写／路由层出现／悬空——各红一条（破坏实验）", () => {
  const baseTexts = texts({ "server/shared/inner.cjs": 'throw createError("INNER_SIG", "x", 500);' });
  const run = (over = {}) =>
    auditErrorCodes({
      contract: contract([]),
      exemptions: { internalSignals: [four("INNER_SIG")] },
      serverTexts: baseTexts,
      ...over,
    });
  assert.equal(run().violations.length, 0, "基线：内部道在册且仅服务层工厂形态＝绿");

  const inContract = auditErrorCodes({
    contract: contract(["INNER_SIG"]),
    exemptions: { internalSignals: [four("INNER_SIG")] },
    serverTexts: baseTexts,
  });
  assert.match(inContract.violations.find((v) => v.includes("越界")), /已在契约 enum/);

  const serialized = auditErrorCodes({
    contract: contract([]),
    exemptions: { internalSignals: [four("INNER_SIG")] },
    serverTexts: texts({ "server/shared/inner.cjs": 'const body = { error_code: "INNER_SIG" };' }),
  });
  assert.match(serialized.violations.find((v) => v.includes("越界")), /error_code: 直写形态/);

  const inRoutes = auditErrorCodes({
    contract: contract([]),
    exemptions: { internalSignals: [four("INNER_SIG")] },
    serverTexts: texts({ "server/routes/x-routes.cjs": 'router.post("/x", () => { throw routeError("INNER_SIG", "x", 500); });' }),
  });
  assert.match(inRoutes.violations.find((v) => v.includes("越界")), /server\/routes/);

  const dangling = auditErrorCodes({
    contract: contract([]),
    exemptions: { internalSignals: [four("INNER_SIG")] },
    serverTexts: texts({ "server/services/other.cjs": 'throw serviceError("OTHER", "x");' }),
  });
  assert.match(dangling.violations.find((v) => v.includes("悬空")), /服务端已无抛点/);
});

test("内部信号免除欠账：同码挂 internalSignals 后 [未登记] 即消（车道分流实证）", () => {
  const t = texts({ "server/shared/inner.cjs": 'throw createError("INNER_SIG", "x", 500);' });
  const asDebt = auditErrorCodes({ contract: contract([]), exemptions: {}, serverTexts: t });
  assert.ok(asDebt.violations.some((v) => v.includes('[未登记] 服务端抛 "INNER_SIG"')));
  const asInternal = auditErrorCodes({ contract: contract([]), exemptions: { internalSignals: [four("INNER_SIG")] }, serverTexts: t });
  assert.ok(!asInternal.violations.some((v) => v.includes("INNER_SIG")), "移挂内部道后不再算欠账：" + asInternal.violations.join(" / "));
});

test("结构红：内部道缺要素／过期——与外发道同纪律", () => {
  const missing = auditErrorCodes({
    contract: contract([]),
    exemptions: { internalSignals: [{ code: "INNER_SIG", reason: "r", owner: "klena" }] },
    serverTexts: texts({ "server/shared/i.cjs": 'throw createError("INNER_SIG", "x", 500);' }),
  });
  assert.match(missing.violations[0], /\[豁免缺要素\] INNER_SIG/);
  const expired = auditErrorCodes({
    contract: contract([]),
    exemptions: { internalSignals: [four("INNER_SIG")] , },
    serverTexts: texts({ "server/shared/i.cjs": 'throw createError("INNER_SIG", "x", 500);' }),
    today: "2099-01-01",
  });
  assert.equal(expired.violations.length, 0);
  const expiredLater = auditErrorCodes({
    contract: contract([]),
    exemptions: { internalSignals: [{ ...four("INNER_SIG"), expiresAt: "2020-01-01" }] },
    serverTexts: texts({ "server/shared/i.cjs": 'throw createError("INNER_SIG", "x", 500);' }),
  });
  assert.match(expiredLater.violations[0], /\[豁免过期\] INNER_SIG/);
});

test("PR-222：改名解构别名派生——`const { createError: relationError }` 的别名码照常入账", () => {
  const t = texts({
    "server/services/x.cjs": 'const { createError: relationError } = require("../../shared/error-factory.cjs");\nthrow relationError("VERSION_NOT_ALLOWED", "x", 422);',
    "server/shared/error-factory.cjs": 'throw createError("REAL_FACTORY_CODE", "y", 400);',
  });
  const { thrown } = collectThrownCodes(t);
  assert.ok(thrown.has("VERSION_NOT_ALLOWED"), "别名抛点必须入账（红队 PR-220：allowlist 对改名解构失明）");
  assert.ok(thrown.has("REAL_FACTORY_CODE"), "原生工厂不受影响");
  // 无关解构不误收
  const t2 = texts({ "server/services/y.cjs": 'const { writeVault: wv } = require("../../shared/vault-io.cjs");\nmodule.exports = { wv };' });
  assert.equal(collectThrownCodes(t2).thrown.size, 0, "非工厂别名零误收");
});

test("真仓实跑：车道读数在册（unregistered 与 internalSignals 分列）", () => {
  const ROOT = path.resolve(import.meta.dirname, "..", "..", "..");
  const out = execFileSync("node", [path.join(ROOT, "scripts", "quality", "check-error-codes.mjs")], { encoding: "utf8" });
  assert.match(out, /error_codes=ok contract=198 thrown=\d+ unregistered_baseline=138 internal_signals=9 dead_enum_baseline=31/);
});

test("collectContractCodes：穿透 allOf 目录单元", () => {
  const cc = collectContractCodes({
    components: {
      schemas: {
        Wrapped: { allOf: [{ $ref: "#" }, { properties: { error_code: { enum: ["VIA_ALLOF"] } } }] },
        Plain: { properties: { error_code: { enum: ["PLAIN"] } } },
      },
    },
  });
  assert.ok(cc.has("VIA_ALLOF") && cc.has("PLAIN"));
});

// ── WP-122 error 族合一：面③freshness＋面④出生校验 strict（自 error-registry 门禁并入）守护 ──
// 层级：单元（合成桩直调 auditRegistryFaces，注入 runFreshness/factory）；真仓行为证明由门禁实跑
// 承担（registry_faces=ok 读数，见上「真仓实跑」用例所在脚本直跑形态）。
const stubFactory = ({ throwsOnUnknown = true, bindShared = true, codes = ["REAL_CODE_1"], drift = false } = {}) => ({
  listErrorCodes: () => codes,
  createError: (code, msg, status) => {
    if (throwsOnUnknown && !codes.includes(code)) throw new Error(`strict: 未出生码 ${code}`);
    return { code: drift ? "DRIFTED" : code, message: msg, status };
  },
  bindErrorFactory: () => (code) => {
    if (bindShared && throwsOnUnknown && !codes.includes(code)) throw new Error(`strict: 未出生码 ${code}`);
    return { code };
  },
});

test("面④绿：strict 三态全过（已登记过＋未知炸＋bind 共享）零违规", async () => {
  const v = await auditRegistryFaces({ runFreshness: async () => {}, factory: stubFactory() });
  assert.deepEqual(v, []);
});

test("面③红：freshness 生成器非零退出→[freshness] 违规（破坏实验：派生物过期）", async () => {
  const v = await auditRegistryFaces({
    runFreshness: async () => { const e = new Error("gen failed"); e.stderr = "注册物过期（271 个码）——抛点已变更未再生成"; throw e; },
    factory: stubFactory(),
  });
  assert.equal(v.length, 1);
  assert.match(v[0], /\[freshness\] 注册物过期/);
});

test("面④红×3：未知码不炸／bind 不共享／code 漂移（破坏实验：strict 面失效的三个方向）", async () => {
  const noThrow = await auditRegistryFaces({ runFreshness: async () => {}, factory: stubFactory({ throwsOnUnknown: false }) });
  assert.ok(noThrow.some((v) => /未知码未触发 strict 拒绝/.test(v)), noThrow.join(" / "));
  const noShare = await auditRegistryFaces({ runFreshness: async () => {}, factory: stubFactory({ bindShared: false }) });
  assert.ok(noShare.some((v) => /bindErrorFactory 视图未共享出生校验/.test(v)), noShare.join(" / "));
  const drift = await auditRegistryFaces({ runFreshness: async () => {}, factory: stubFactory({ drift: true }) });
  assert.ok(drift.some((v) => /构造后 code 漂移/.test(v)), drift.join(" / "));
});

test("面④红：账本不可读→整体旁路必须显红（fail-closed，不许静默绿）", async () => {
  const v = await auditRegistryFaces({ runFreshness: async () => {}, factory: stubFactory({ codes: null }) });
  assert.ok(v.some((x) => /\[账本\] error-registry\.generated\.cjs 不可读/.test(x)), v.join(" / "));
});
