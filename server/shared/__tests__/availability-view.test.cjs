// 层级：L1 纯单元（WP-070／SPEC-070 §3.2）。被测对象：空态语义投影 availability-view 由
// contracts/empty-state-semantics.json 单源驱动——表驱动：逐种类/逐类别问函数，期望从契约读出不另抄；
// 依赖序（前置缺失排前＋hint 带前置指引）；未登记种类/类别 fail-closed。
const test = require("node:test");
const assert = require("node:assert/strict");

const CONTRACT = require("../../../contracts/empty-state-semantics.json");
const view = require("../availability-view.cjs");

function expectedGuide(kind) {
  const k = CONTRACT.absence_kinds[kind];
  return CONTRACT.guide_template.replace("{what}", k.what).replace("{where}", k.where);
}

test("guidanceFor：逐种类表驱动——文案＝契约模板×what/where（表即期望）", () => {
  for (const kind of Object.keys(CONTRACT.absence_kinds)) {
    assert.equal(view.guidanceFor(kind), expectedGuide(kind), kind);
  }
  assert.deepEqual([...view.KINDS].sort(), Object.keys(CONTRACT.absence_kinds).sort(), "KINDS 与契约种类集一致");
});

test("behaviorOf：三类行为逐类表驱动（behavior/status/rule 与契约一致）", () => {
  for (const [cls, spec] of Object.entries(CONTRACT.consumer_classes)) {
    assert.deepEqual(view.behaviorOf(cls), { behavior: spec.behavior, status: spec.status, rule: spec.rule }, cls);
  }
  assert.equal(view.behaviorOf("consumer").status, 409, "消费类保持拒绝（裁决第三类）");
  assert.equal(view.behaviorOf("display").status, 200, "展示类不当错误（裁决第二类）");
});

test("依赖序：前置缺失排前；被依赖者的 hint 以前置指引开头；前置已满足时不带前置段", () => {
  const dependents = Object.entries(CONTRACT.absence_kinds).filter(([, k]) => (k.requires || []).length);
  assert.ok(dependents.length >= 1, "契约须至少一条依赖边供本测覆盖");
  for (const [kind, k] of dependents) {
    const req = k.requires[0];
    const both = view.availabilityView({ absent: [kind, req], consumerClass: "form" });
    assert.deepEqual(both.map((v) => v.kind), [req, kind], `${req} 须排在 ${kind} 之前`);
    const prefix = CONTRACT.prerequisite_template.replace("{what}", CONTRACT.absence_kinds[req].what).replace("{where}", CONTRACT.absence_kinds[req].where);
    assert.ok(both[1].hint.startsWith(prefix), `被依赖者 hint 以前置指引开头：${both[1].hint}`);
    assert.deepEqual(both[1].prerequisites, [req]);
    const alone = view.availabilityView({ absent: [kind], consumerClass: "form" });
    assert.equal(alone[0].hint, expectedGuide(kind), "前置已满足时 hint 不带前置段");
    assert.deepEqual(alone[0].prerequisites, []);
  }
});

test("displayAvailability／formOptionAvailability：响应形状；空集→empty:false 零指引", () => {
  assert.deepEqual(view.displayAvailability([]), { empty: false, kinds: [], hints: [] });
  const d = view.displayAvailability(["formal-release-empty"]);
  assert.equal(d.empty, true);
  assert.deepEqual(d.kinds, ["formal-release-empty"]);
  assert.equal(d.hints[0], expectedGuide("formal-release-empty"));
  const f = view.formOptionAvailability({
    products: { kind: "product-identity-unmounted", empty: false },
    versions: { kind: "versions-empty", empty: true },
  });
  assert.deepEqual(f.products, { empty: false, hint: "", kind: "product-identity-unmounted" }, "非空选项 hint 为空串（WP-062 形状兼容）");
  assert.equal(f.versions.empty, true);
  assert.equal(f.versions.hint, expectedGuide("versions-empty"), "前置（产品身份）已配 → 不带前置段");
});

test("fail-closed：未登记种类／未知类别即 TypeError（新站点先登记再接线）", () => {
  assert.throws(() => view.guidanceFor("not-a-kind"), /EMPTY_STATE_KIND_UNREGISTERED/);
  assert.throws(() => view.availabilityView({ absent: ["not-a-kind"], consumerClass: "form" }), /EMPTY_STATE_KIND_UNREGISTERED/);
  assert.throws(() => view.behaviorOf("page"), /EMPTY_STATE_CLASS_UNKNOWN/);
});
