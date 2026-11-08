// Component: 本体元素生命周期迁移守卫回归（ADR-017／WP-068）
// @responsible: 迁移表每条合法边、各类非法迁移、缺省态参与、数组段参与，以及「允许清单只来自 contracts 单源」
// @inputs: contracts/ontology-lifecycle.json＋守卫模块（纯内存，不读 .env、不碰真库——本文件是 ADR-017 §四 要求的可在干净检出跑的钉子）
// @outputs: 断言结果
// @context: Schema-Manager
const assert = require("node:assert/strict");
const test = require("node:test");

const TABLE = require("../../../../contracts/ontology-lifecycle.json");
const GUARD = require("../ontology-lifecycle-transition.cjs");
const { validateOntologyPayload } = require("../schema-validators.cjs");

const REL = (status, extra) => Object.assign({ lifecycle_status: status, retirement: undefined }, extra || {});

function denied(previous, payload) {
  return GUARD.assertElementTransitions(previous, payload).filter((e) => e.startsWith("lifecycle_transition_denied:"));
}

test("迁移表边数与守卫允许集一致——允许清单只来自 contracts 单源", () => {
  assert.equal(GUARD.transitionCount, TABLE.transitions.length, "守卫允许集＝表内边数，代码内不得另抄一份");
  assert.ok(TABLE.transitions.length > 0);
  assert.ok(TABLE.explicitlyDenied.every((edge) => !TABLE.transitions.some((t) => t.from === edge.from && t.to === edge.to)), "明令禁止的边不得同时存在于允许表");
});

test("契约实例过自身形状 schema（$schema 指针非虚指）＋破坏例必红", () => {
  const Ajv = require("ajv").default || require("ajv");
  const schema = require("../../../../contracts/ontology-lifecycle.schema.json");
  const validate = new Ajv({ strict: false, allErrors: true }).compile(schema);
  assert.equal(validate(TABLE), true, "在册表须过形状：" + JSON.stringify(validate.errors));
  const broken = JSON.parse(JSON.stringify(TABLE));
  delete broken.defaultStatus;
  broken.transitions[0].stray = 1;
  assert.equal(validate(broken), false, "缺必填键＋边行多余键必须红（防形状断言空转）");
});

test("表内每条合法迁移实跑放行（正反例逐边）", () => {
  for (const edge of TABLE.transitions) {
    const errors = denied({ relation_types: { R: REL(edge.from) } }, { relation_types: { R: REL(edge.to, edge.to === "retired" ? { retirement: { reason: "r", replaced_by: "S" } } : {}) } });
    assert.deepEqual(errors, [], edge.from + " -> " + edge.to + " 应放行：" + errors.join("; "));
  }
});

test("表外一律拒绝——跨态跳跃、原地复活、预留退役（ADR-017 §二）", () => {
  const illegal = [
    ["approved", "draft"], ["approved", "submitted"], ["draft", "retired"], ["draft", "reserved"],
    ["submitted", "reserved"], ["retired", "approved"], ["retired", "draft"], ["reserved", "retired"],
    ["reserved", "draft"], ["submitted", "retired"],
  ];
  for (const [from, to] of illegal) {
    assert.equal(denied({ relation_types: { R: REL(from) } }, { relation_types: { R: REL(to, { retirement: { reason: "r", replaced_by: "S" } }) } }).length, 1, from + " -> " + to + " 必须被拒且只报一条");
  }
});

test("存量缺省态按 approved 参与判定；首写不是迁移", () => {
  assert.equal(GUARD.statusOf({}), "approved", "无 lifecycle_status＝approved（ADR-014 §三 存量零回填）");
  assert.equal(denied({}, { relation_types: { NEW: REL("retired", { retirement: { reason: "r", replaced_by: "S" } }) } }).length, 0, "新元素缺省 approved→retired 合法");
  assert.deepEqual(denied({}, { relation_types: { NEW: REL("draft") } }), [], "新建 draft 是创建不是跳跃");
  assert.deepEqual(denied({ node_types: { X: REL("approved") } }, { node_types: { NEW: REL("draft") } }), [], "在册元素存在时，另建新元素仍按首写放行");
});

test("状态同值改写与未触及段不产判定（幂等写不误伤）", () => {
  assert.deepEqual(denied({ relation_types: { R: REL("approved") } }, { relation_types: { R: REL("approved") } }), []);
  assert.deepEqual(GUARD.assertElementTransitions({ node_types: { A: REL("approved") } }, { node_types: { A: REL("approved") } }), []);
  assert.deepEqual(denied({ relation_types: { R: REL("approved") } }, { constraints: [] }), [], "payload 不含生命周期段时不判");
});

test("数组段元素同样受表约束（inference_rules／constraints）", () => {
  for (const key of ["inference_rules", "constraints"]) {
    assert.equal(denied({ [key]: [{ id: "e1", lifecycle_status: "retired" }] }, { [key]: [{ id: "e1", lifecycle_status: "approved" }] }).length, 1, key + " 段 retired→approved 必须被拒");
    assert.equal(denied({ [key]: [{ id: "e1", lifecycle_status: "draft" }] }, { [key]: [{ id: "e1", lifecycle_status: "submitted" }] }).length, 0, key + " 段合法迁移放行");
  }
});

test("非法值域不由本守卫吞掉——仍交既有取值校验与结构校验处理", () => {
  const errors = GUARD.assertElementTransitions({ relation_types: { R: REL("approved") } }, { relation_types: { R: { lifecycle_status: 42 } } });
  assert.deepEqual(errors, [], "非字符串状态本守卫不判（避免把取值域问题伪装成迁移问题）");
  assert.deepEqual(GUARD.assertElementTransitions({ relation_types: { R: REL("approved") } }, { relation_types: { R: REL("archived") } }), [], "五态之外的值不由本守卫接管（实测：写路径曾据此把取值域问题报成迁移问题）");
  const structural = validateOntologyPayload({ relation_types: { R: { lifecycle_status: "nonsense" } } }, { relation_types: { R: { lifecycle_status: "nonsense" } } }, { relation_types: { R: { lifecycle_status: "approved" } } }, undefined);
  assert.ok(structural.some((e) => /lifecycle_status/.test(e)), "取值域非法由既有校验报错");
});

test("守卫接进写路径校验器：非法迁移在 validateOntologyPayload 内即报", () => {
  const previous = { relation_types: { R: REL("retired", { retirement: { reason: "r", replaced_by: "S" } }) } };
  const payload = { relation_types: { R: REL("approved") } };
  const errors = validateOntologyPayload(payload, payload, previous, undefined);
  assert.ok(errors.some((e) => e.startsWith("lifecycle_transition_denied:")), errors.join("; "));
});

// ── 2026-11-02 独立反例复核收口批（PR-179／PR-180／PR-181／PR-182）──

const all = (previous, next) => GUARD.assertDocumentTransitions(previous, next);

test("PR-179 在册退役元素从本体消失即拒——「先删再同名新建」的复活路在删除这一步就断", () => {
  const previous = { relation_types: { R: REL("retired", { retirement: { reason: "r", replaced_by: "S" } }), S: REL("approved") } };
  const removed = all(previous, { relation_types: { S: REL("approved") } });
  assert.equal(removed.filter((e) => e.startsWith("lifecycle_retired_removal_denied:")).length, 1, removed.join("; "));
  assert.ok(removed[0].includes("relation_types.R"), "必须点名是哪个退役元素");
  // 在册退役元素留在档内时零判定（禁删只针对消失）
  assert.deepEqual(all(previous, { relation_types: { R: REL("retired", { retirement: { reason: "r", replaced_by: "S" } }), S: REL("approved") } }), []);
  const droppable = { relation_types: { T: REL("draft"), R: REL("retired", { retirement: { reason: "r", replaced_by: "S" } }) } };
  assert.deepEqual(all(droppable, { relation_types: { R: REL("retired", { retirement: { reason: "r", replaced_by: "S" } }) } }), [], "在册 draft 元素可删——禁删只限退役态");
});

test("PR-180 数组段身份只认稳定键——无 id 元素不产拒写（位置兜底假红根除）", () => {
  const previous = { inference_rules: [{ name: "transitive", pattern: "a" }, { name: "covers", pattern: "b" }] };
  // 前插一个新 draft 规则：位置兜底旧实现会把 previous 的 name:"transitive" 错配成 #0 而误拒
  const next = { inference_rules: [{ id: "NEW", lifecycle_status: "draft" }, ...previous.inference_rules] };
  assert.deepEqual(all(previous, next), [], "在册历史规则无 lifecycle_status 且新元素身份独立——不得误判跨态跳跃");
  // 事故原形（二次复核指出上一版输入分不出新旧）：新元素**自身无 id 无 name**前插——
  // 旧 #index 兜底会把在册第 0 位（approved）与新元素（缺省即 approved→draft）错配成同一元素误拒；新实现两侧身份不可确立即跳过
  const accident = { inference_rules: [{ lifecycle_status: "draft" }, { name: "transitive" }, { name: "covers" }] };
  assert.deepEqual(all(previous, accident), [], "无 id 无 name 的新元素前插必须零误拒（旧兜底在此输入下产出 1 条假红）");
  assert.equal(all(previous, accident).length, 0);
  // 加严（三轮复核指出「仅对无键元素用 #index」的半旧实现可躲过上一版断言）：两侧皆无稳定键的形态
  const keyless = { inference_rules: [{ lifecycle_status: "approved", note: "在册无键元素" }] };
  const keylessNext = { inference_rules: [{ lifecycle_status: "draft" }, ...keyless.inference_rules] };
  assert.deepEqual(all(keyless, keylessNext), [], "两侧皆无稳定键时不产判定——任何位置兜底（含只对无键元素兜底）在此输入都会产出 approved->draft 假红");
  // 反向：有稳定键时照判（假红消除不等于免检）
  const judged = all({ inference_rules: [{ id: "e1", lifecycle_status: "retired", retirement: { reason: "r", replaced_by: "e2" } }, { id: "e2", lifecycle_status: "approved" }] },
    { inference_rules: [{ id: "e1", lifecycle_status: "approved" }, { id: "e2", lifecycle_status: "approved" }] });
  assert.equal(judged.filter((e) => e.startsWith("lifecycle_transition_denied:")).length, 1, judged.join("; "));
  // 在册元素有稳定键、其前插入无键新元素——有键侧仍照判（不被无键元素带偏）
  const mixed = all({ constraints: [{ id: "c1", lifecycle_status: "retired", retirement: { reason: "r", replaced_by: "c2" } }, { id: "c2", lifecycle_status: "approved" }] },
    { constraints: [{ lifecycle_status: "draft" }, { id: "c1", lifecycle_status: "approved" }, { id: "c2", lifecycle_status: "approved" }] });
  assert.equal(mixed.filter((e) => e.startsWith("lifecycle_transition_denied:")).length, 1, mixed.join("; "));
});

test("PR-181 越出取值域的在册值不再静默免检——禁直入 approved，修正另有去路", () => {
  const offdomain = { relation_types: { R: { lifecycle_status: "archived" } } };
  const toApproved = GUARD.assertElementTransitions(offdomain, { relation_types: { R: REL("approved") } });
  assert.equal(toApproved.filter((e) => e.startsWith("lifecycle_status_offdomain:")).length, 1, toApproved.join("; "));
  for (const target of ["draft", "submitted", "reserved", "retired"]) {
    assert.deepEqual(GUARD.assertElementTransitions(offdomain, { relation_types: { R: REL(target) } }), [], "越词表在册值须能修正为 " + target + "（不成死锁，ADR-017 §二 判定语义 6）");
  }
  assert.deepEqual(GUARD.assertElementTransitions(offdomain, { relation_types: { R: { lifecycle_status: "archived" } } }), [], "同值改写不判（幂等写不误伤）");
});

test("PR-182 允许边集合相等断言——缩表或换边必红（原断言两侧同源恒真，删四边无人察觉）", () => {
  const EXPECTED_EDGES = [
    "draft->submitted", "submitted->approved", "submitted->draft",
    "approved->reserved", "approved->retired", "reserved->approved",
  ];
  const actual = TABLE.transitions.map((edge) => edge.from + "->" + edge.to).sort();
  assert.deepEqual(actual, EXPECTED_EDGES.slice().sort(), "在册表与期望边集不＝——改动执法范围须同批改本判据（ADR-017 §二 律文表）");
  assert.equal(actual.length, 6);
});

test("PR-188 退役是终态——从 retired 迁出一律拒，含改成越词表值（旧顺序在此零判定）", () => {
  const retiredDoc = { relation_types: { R: REL("retired", { retirement: { reason: "r", replaced_by: "S" } }) } };
  for (const target of ["archived", "nonsense", ""]) {
    const errors = all(retiredDoc, { relation_types: { R: { lifecycle_status: target } } });
    assert.equal(errors.filter((e) => e.startsWith("lifecycle_transition_denied:")).length, 1, "retired -> " + target + " 必须被拒且只报一条：" + JSON.stringify(errors));
  }
  assert.equal(all(retiredDoc, { relation_types: { R: {} } }).length, 1, "删掉 lifecycle_status 键回落 approved 同属迁出，必须拒");
  assert.deepEqual(all(retiredDoc, retiredDoc), [], "同态改写不误伤（退役块的改动由 conditions 层判，PR-187）");
  // 反向对照：非退役元素的非法目标值仍交回取值域（C3 不回归）
  assert.deepEqual(GUARD.assertDocumentTransitions({ relation_types: { R: REL("approved") } }, { relation_types: { R: { lifecycle_status: "archived" } } }), [], "approved -> archived 仍不由本守卫接管");
});
test("PR-190 整档语义：段被置 null 或整段消失＝清空，退役元素按消失拒；补丁语义不追缴", () => {
  const previous = { relation_types: { R: REL("retired", { retirement: { reason: "r", replaced_by: "S" } }) }, inference_rules: [{ id: "q", lifecycle_status: "retired", retirement: { reason: "r", replaced_by: "S" } }] };
  for (const next of [{ relation_types: null, inference_rules: null }, { node_types: {} }, {}]) {
    const errors = GUARD.assertDocumentTransitions(previous, next, "document");
    assert.equal(errors.filter((e) => e.startsWith("lifecycle_retired_removal_denied:")).length, 2, "整档下这段消失即清空，须各拒一条：" + JSON.stringify(errors));
  }
  // 补丁模式（路由早报面）：没带的段＝不写该段，不得凭空造红
  assert.deepEqual(GUARD.assertElementTransitions(previous, { node_types: { N: REL("draft") } }), [], "补丁语义下未带段不追缴");
  // 段在而内容完整 ⇒ 零判（不误伤正常整段回写）
  assert.deepEqual(GUARD.assertDocumentTransitions(previous, previous, "document"), []);
});
test("PR-188 补洞：非字符串新值不得成为退役件的抹痕出口（复核抓的 null／123／{}／true）", () => {
  const retiredDoc = { relation_types: { R: REL("retired", { retirement: { reason: "r", replaced_by: "S" } }) } };
  for (const value of [null, 123, {}, true]) {
    const errors = all(retiredDoc, { relation_types: { R: { lifecycle_status: value } } });
    assert.equal(errors.filter((e) => e.startsWith("lifecycle_status_invalid:")).length, 1, "retired -> " + JSON.stringify(value) + " 必须拒一条：" + JSON.stringify(errors));
    assert.match(errors[0], /relation_types\.R/, "必须点名是哪个元素");
  }
  // 反向对照：非退役元素的非法值仍归取值域校验（C3 不回归）；同值改写不误伤
  assert.deepEqual(GUARD.assertDocumentTransitions({ relation_types: { R: REL("approved") } }, { relation_types: { R: { lifecycle_status: 123 } } }), [], "approved -> 123 仍不由本守卫接管");
  assert.deepEqual(all(retiredDoc, retiredDoc), [], "retired 同值零判（退役块改动由 conditions 层判，PR-187）");
  // 落盘后形态自检：一旦非法值真进了档，缺省与禁删判定都看不见它——这正是本洞必须在前端堵死的原因
  assert.equal(GUARD.statusOf({ lifecycle_status: null }), null, "statusOf 对非字符串返 null（故不能靠它兜非法值）");
});

test("PR-178 全档判定面在场：段缺席＝不改，整档比较走同一判据", () => {
  const previous = { relation_types: { R: REL("retired", { retirement: { reason: "r", replaced_by: "S" } }), S: REL("approved") }, node_types: { N: REL("approved") } };
  assert.equal(all(previous, { node_types: { N: REL("approved") } }).filter((e) => e.startsWith("lifecycle_retired_removal_denied:")).length, 1, "整档语义下未带段＝该段清空，退役元素必须按消失拒（PR-190）");
  assert.deepEqual(GUARD.assertElementTransitions(previous, { node_types: { N: REL("approved") } }), [], "补丁语义下未带段＝本次不写该段，不追缴（路由早报面口径）");
  assert.deepEqual(all(previous, previous), [], "整档同值零判定（boot 自检同 doc 双传即走此形态）");
  assert.equal(typeof GUARD.assertDocumentTransitions, "function", "落盘咽喉与回滚口共用的全档判据须导出");
});

const PROTO_ID = "__proto__"; // 计算键才造自有属性（字面量 __proto__: 是设原型）
test("PR-191 身份键谓词：__proto__ 作元素键即拒，原型数据属性键不连坐，存量未动不追缴", () => {
  assert.equal(GUARD.isReservedIdentity("__proto__"), true, "__proto__ 是 Object.prototype 上的访问器属性");
  for (const key of ["constructor", "toString", "hasOwnProperty", "valueOf"]) {
    assert.equal(GUARD.isReservedIdentity(key), false, key + " 是原型上的数据属性，按键赋值照常落自有键——不得连坐（已签收判据明令其作在册元素 id 合法）");
  }
  assert.equal(GUARD.ownValue({}, "constructor"), undefined, "ownValue 只认自有键：缺席不得回落到 Object.prototype");
  assert.equal(GUARD.ownValue(JSON.parse('{"__proto__":{"a":1}}'), "__proto__").a, 1, "JSON.parse 造的自有 __proto__ 键须读得到");

  const protoKey = { relation_types: { KEEP: REL("approved"), [PROTO_ID]: REL("retired", { retirement: { reason: "在册锚点", replaced_by: "KEEP" } }) } };
  const wipe = { relation_types: { KEEP: REL("approved"), [PROTO_ID]: REL("retired", { retirement: [] }) } };
  const errors = GUARD.assertDocumentTransitions(protoKey, wipe);
  assert.equal(errors.filter((e) => e.startsWith("lifecycle_element_id_reserved:")).length, 1, "以 __proto__ 为身份键的写入必须拒（复核实测：此前条件层按键赋值丢元素，退役三件套可被抹成 []）：" + JSON.stringify(errors));
  assert.match(errors[0], /relation_types\.__proto__/, "须点名是哪个元素");
  // 新建同类键同样拒（复核 ②：此前按键读命中原型值→判成「未变化」而免检）
  assert.equal(GUARD.assertDocumentTransitions({ relation_types: { KEEP: REL("approved") } }, { relation_types: { KEEP: REL("approved"), [PROTO_ID]: REL("retired", { retirement: [] }) } })
    .filter((e) => e.startsWith("lifecycle_element_id_reserved:")).length, 1, "新建 __proto__ 元素同样不得放过");
  // 存量在册且本次未动 ⇒ 免检不追缴（PR-189 同一口径：否则历史脏键把今天所有写入挡成假红）
  assert.deepEqual(GUARD.assertDocumentTransitions(protoKey, protoKey), [], "同档自反零判（存量脏键不追缴）");
  assert.deepEqual(GUARD.assertDocumentTransitions({ relation_types: { constructor: REL("approved") } }, { relation_types: { constructor: REL("approved") } }), [], "原型数据属性键作在册 id 仍合法");
});

// PR-193（复核实测 T2／T4／T5 三处「改表不红」）：把三件事变成有判力的钉——
// 终态不得被表放松、表删段即红、明令禁止的边逐条行为级被拒。
test("PR-193 表变即红三钉：终态出边禁列＋段集合相等＋explicitlyDenied 行为级被拒", () => {
  assert.equal(typeof TABLE.terminalFrom, "string", "终态态别须由表声明（代码内不留字面量）");
  assert.equal(TABLE.terminalFrom, "retired", "终态＝retired（ADR-017 §二 7）——表被改值即红");
  // 钉 1：往 transitions 里加一条从终态出发的边，本断言即红——改表放松不了终态执法
  assert.deepEqual(TABLE.transitions.filter((edge) => edge.from === TABLE.terminalFrom), [], "终态出边不得进允许表（复核实测 T2：曾把 retired→approved 写进表里判定仍拒，C1「改表即改执法范围」当时名实不符）");
  // 钉 2：段的形状声明是集合相等而非「表长」——删段或换形态即红（复核实测 T4：删段后咽喉套件仍绿）
  const EXPECTED_SECTIONS = [
    ["action_types", "map"], ["constraints", "array"], ["inference_rules", "array"],
    ["node_types", "map"], ["relation_types", "map"], ["risk_types", "map"],
  ];
  assert.deepEqual(TABLE.elementSections.map((section) => [section.key, section.shape]).sort(), EXPECTED_SECTIONS, "受接管段集合须与声明一致（缩表即红）");
  // 钉 3：每条明令禁止的边都真的被拒（此前只有一行 every() 的恒真面）
  for (const edge of TABLE.explicitlyDenied) {
    const previous = { relation_types: { E: REL(edge.from) } };
    const next = { relation_types: { E: REL(edge.to, edge.from === TABLE.terminalFrom ? { retirement: { reason: "x", replaced_by: "F" } } : {}) } };
    if (edge.to === "retired") next.relation_types.F = REL("approved");
    const errors = GUARD.assertDocumentTransitions(previous, next);
    assert.equal(errors.filter((e) => e.startsWith("lifecycle_transition_denied:") || e.startsWith("lifecycle_status_invalid:")).length, 1,
      "明令禁止的边 " + edge.from + "->" + edge.to + " 必须被拒一条：" + JSON.stringify(errors));
  }
  assert.ok(TABLE.explicitlyDenied.length >= 2, "明令禁止清单不得被清空后仍全绿（清空即本断言红）");
});

test("PR-196 存量坏键元素不得被冻成零出口：只改描述放行，改态／改锚仍拒", () => {
  const PROTO_ID = "__proto__";
  const historical = { relation_types: { KEEP: REL("approved"), [PROTO_ID]: REL("retired", { retirement: { reason: "历史锚点", replaced_by: "KEEP" } }) } };
  const labelOnly = { relation_types: { KEEP: REL("approved"), [PROTO_ID]: Object.assign(REL("retired", { retirement: { reason: "历史锚点", replaced_by: "KEEP" } }), { label_cn: "补个说明" }) } };
  assert.deepEqual(GUARD.assertDocumentTransitions(historical, labelOnly), [], "只改描述字段放行——否则存量坏键的退役件连标注都改不了，成为无任何可写出口的冻结件（ADR-017 §二 6 同族）");
  const reasonEdited = { relation_types: { KEEP: REL("approved"), [PROTO_ID]: REL("retired", { retirement: { reason: "改过的理由", replaced_by: "KEEP" } }) } };
  assert.ok(GUARD.assertDocumentTransitions(historical, reasonEdited).some((e) => e.startsWith("lifecycle_element_id_reserved:")), "改退役块仍拒（锚点承载字段）");
  const revived = { relation_types: { KEEP: REL("approved"), [PROTO_ID]: REL("approved") } };
  assert.ok(GUARD.assertDocumentTransitions(historical, revived).some((e) => e.startsWith("lifecycle_element_id_reserved:")), "改态仍拒");
});
