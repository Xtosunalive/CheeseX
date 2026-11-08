'use strict';
// Component: Ontology-Lifecycle-Transition-Guard（ADR-017 §二）
// @responsible: 本体元素 lifecycle_status 的写侧迁移判定——边定义表单源 contracts/ontology-lifecycle.json，代码内无第二份允许清单
// @inputs: previousDoc（写入前在册本体）＋nextDoc（本次落盘的终态形态，段按整段替换语义参与）
// @outputs: 人读错误文案数组（空＝合法）；前缀 lifecycle_transition_denied:／lifecycle_retired_removal_denied:／lifecycle_status_offdomain: 供调用方与测试机器判定，错误码沿用已登记的 VALIDATION_ERROR（不新生未入册码，PR-172 口径）
// @context: 判定既挂路由校验器（早报面）也挂 schema-write-service 落盘咽喉（保证面）——PR-178 收口，统一写客户端与快照回滚同经此门
const TABLE = require("../../../contracts/ontology-lifecycle.json");
const LIFECYCLE_STATUSES = new Set(require("../../../contracts/object-meta-model.json").layers.status.enums.lifecycle_status.map((e) => e.value));

const ALLOWED = new Set(TABLE.transitions.map((edge) => edge.from + "->" + edge.to));
const DEFAULT_STATUS = TABLE.defaultStatus;
// 越出取值域的在册脏值禁止一步直入活消费终点——修正须先迁往其他合法态再走正常链（PR-181：不静默免检，也不因禁到底而把元素锁死）
const OFFDOMAIN_FORBIDDEN_TARGET = DEFAULT_STATUS;
// 终态角色（ADR-017 §二 判定语义 7：退役不可迁出、不可删除）——态别名由迁移表自己声明（terminalFrom），代码内不留字面量；
// 五态取值域仍单源 object-meta-model，本表不重列。守卫按「不得从终态迁出」硬编执法，与 transitions 的内容无关——
// 改表加一条 `retired→approved` 也放松不了（回归用例断言表内不得出现以终态为 from 的边）。
const RETIRED_STATUS = TABLE.terminalFrom;

// 元素身份就是对象属性键。只拒「按键写入落不成自有键」的那一类——Object.prototype 上的**访问器**属性（现场即 `__proto__`：
// `obj[k]=v` 被 setter 吃掉变成改原型，元素静默消失，PR-191 实测的抹痕路）。谓词从语言自身的描述符面取，不手写名字清单。
// `constructor`／`toString`／`hasOwnProperty` 是原型上的数据属性，按键赋值照常落自有键，且既有已签收判据明令它们作在册元素 id
// 合法（server/routes/__tests__/ontology-routes.test.cjs「与对象原型同名的自身注册键仍合法」）——不得连坐。
const PROTOTYPE_ACCESSOR_KEYS = new Set(Object.getOwnPropertyNames(Object.prototype).filter((key) => {
  const descriptor = Object.getOwnPropertyDescriptor(Object.prototype, key);
  return !!descriptor && (descriptor.get !== undefined || descriptor.set !== undefined);
}));
function isReservedIdentity(id) {
  return typeof id === "string" && PROTOTYPE_ACCESSOR_KEYS.has(id);
}
/** 只认自有键——缺席就是 undefined，不得回落到 Object.prototype 上的同名值。 */
function ownValue(object, key) {
  if (!object || typeof object !== "object") return undefined;
  return Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined;
}

function statusOf(definition) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) return null;
  const value = definition.lifecycle_status === undefined ? DEFAULT_STATUS : definition.lifecycle_status;
  // 空串＝未填＝缺省（与缺键同口径，PR-188：否则 `retired → ""` 逃过终态判定而 `retired → 缺键` 不逃）；非字符串仍交回取值域
  if (typeof value === "string") return value.trim() || DEFAULT_STATUS;
  return null;
}

// 稳定身份只认元素自带的 id／name 字段：位置兜底会把「数组前插」错认成同一元素跨态跳跃（PR-180 假红源）
function identityOf(definition) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) return null;
  for (const key of ["id", "name"]) {
    if (typeof definition[key] === "string" && definition[key].trim()) return definition[key];
  }
  return null;
}

// 整档语义（document）：段缺席、置 null 或形状非法＝该段被清空，返回空表 ⇒ 在册退役元素按消失判定（PR-190）。
// 补丁语义（patch，路由早报面）：段缺席＝本次不写该段，返回 null 跳过——两种模式不能混，
// 否则补丁面会把「没带的段」当成清空，凭空造出假红（复核点名的边界）。
function entriesFor(data, section, mode) {
  const documentMode = mode === "document";
  const value = data ? data[section.key] : undefined;
  if (section.shape === "array") {
    if (!Array.isArray(value)) return documentMode ? [] : null;
    const out = [];
    for (const definition of value) {
      const id = identityOf(definition);
      if (id !== null) out.push({ id, definition });
    }
    return out;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return documentMode ? [] : null;
  return Object.keys(value).map((id) => ({ id, definition: ownValue(value, id) }));
}

/** 本次写入里「在册且态别变了」的元素清单——迁移边判定与律文附加条件共用同一份变更集（PR-183）。 */
function collectTransitions(previousDoc, nextDoc, mode) {
  const MODE = mode || "document";
  const changes = [];
  for (const section of TABLE.elementSections) {
    const nextEntries = entriesFor(nextDoc, section, MODE);
    if (nextEntries === null) continue;
    const previousEntries = entriesFor(previousDoc, section, MODE);
    if (previousEntries === null) continue;
    const previous = new Map(previousEntries.map((entry) => [entry.id, entry]));
    for (const entry of nextEntries) {
      const previousEntry = previous.get(entry.id);
      if (!previousEntry) continue; // 首写是创建不是迁移（SPEC-068 §二 C2）
      const from = statusOf(previousEntry.definition);
      const to = statusOf(entry.definition);
      // 退役件的"值不可识别"新值也算迁出——放行到 judge 统一拒（PR-188 复核抓的形态：null／数字／布尔／对象）
      if (from === RETIRED_STATUS && to === null) {
        changes.push({ section: section.key, id: entry.id, from, to: null, rawTo: rawStatus(entry.definition), definition: entry.definition, where: section.key + "." + entry.id });
        continue;
      }
      if (from === null || to === null || from === to) continue;
      changes.push({ section: section.key, id: entry.id, from, to, definition: entry.definition, where: section.key + "." + entry.id });
    }
  }
  return changes;
}

/** 原样取 lifecycle_status 值（未归一）——拒写文案要说清"写进来的是什么"，而非归一后的缺省。 */
function rawStatus(definition) {
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) return null;
  return definition.lifecycle_status === undefined ? DEFAULT_STATUS : definition.lifecycle_status;
}

function judge(change) {
  const { from, to, where } = change;
  // 退役是终态（ADR-017 §二 判定语义 7）：从 retired 迁出一律拒，**含改成越词表值**。
  // 这条判定必须先于「非法目标态交回取值域」那句——原顺序让 `retired → archived` 零判定返回，
  // 一笔即可抹掉退役痕迹并把元素转入免检档（PR-188）。
  if (from === RETIRED_STATUS && to === null) {
    return ["lifecycle_status_invalid: " + where + " 在册态为 " + RETIRED_STATUS + "（终态），本次写入值 " + JSON.stringify(change.rawTo) + " 既非五态之一、也不构成可判定的迁移目标——退役痕迹不得以「改成非法值」的方式抹除（ADR-017 §二 判定语义 7）"];
  }
  if (from === RETIRED_STATUS) {
    return ["lifecycle_transition_denied: " + where + " " + from + " -> " + to + " 不在迁移表内（ADR-017 §二 退役为终态，不得迁出——含改成取值域外的值）"];
  }
  if (!LIFECYCLE_STATUSES.has(to)) return []; // 其余非法目标态交回取值域与结构校验（SPEC-068 §二 C3）
  if (!LIFECYCLE_STATUSES.has(from)) {
    if (to === OFFDOMAIN_FORBIDDEN_TARGET) {
      return ["lifecycle_status_offdomain: " + where + " 在册值「" + from + "」越出取值域，禁止直入 " + OFFDOMAIN_FORBIDDEN_TARGET + "——修正请先迁往其他合法态再走正常链（ADR-017 §二）"];
    }
    return [];
  }
  if (!ALLOWED.has(from + "->" + to)) {
    return ["lifecycle_transition_denied: " + where + " " + from + " -> " + to + " 不在迁移表内（ADR-017 §二）"];
  }
  return [];
}

/** 退役元素消失判定——「先删再同名新建」的复活路在此断（PR-179）。 */
function assertNoRetiredRemoval(previousDoc, nextDoc, mode) {
  const MODE = mode || "document";
  const errors = [];
  for (const section of TABLE.elementSections) {
    const nextEntries = entriesFor(nextDoc, section, MODE);
    if (nextEntries === null) continue;
    const previousEntries = entriesFor(previousDoc, section, MODE);
    if (previousEntries === null) continue;
    const nextIds = new Set(nextEntries.map((entry) => entry.id));
    for (const entry of previousEntries) {
      if (statusOf(entry.definition) === RETIRED_STATUS && !nextIds.has(entry.id)) {
        errors.push("lifecycle_retired_removal_denied: " + section.key + "." + entry.id + " 退役元素不得从本体中删除（ADR-017 §二 禁止行落实——撤销退役的正当出口：按 ADR-014 §5.2 新建替代，或经 Master 裁决的数据迁移工具，不走本守卫）");
      }
    }
  }
  return errors;
}

/** 身份键形状谓词（PR-191）：以原型访问器键作元素身份者拒——新建、改态、改退役块皆拒；
 *  历史在册且只改纯描述字段者放行（PR-196：否则存量坏键的退役件连标注都改不了，成为零出口的冻结件，
 *  与 §二 6「不把元素锁死」同族缺陷。锚点风险只可能来自态别与 retirement，故只比这两项）。 */
function identityBearing(definition) {
  const retirement = definition && typeof definition === "object" && !Array.isArray(definition) ? definition.retirement : undefined;
  return JSON.stringify([rawStatus(definition), retirement]);
}

function assertReservedIdentities(previousDoc, nextDoc, mode) {
  const MODE = mode || "document";
  const errors = [];
  for (const section of TABLE.elementSections) {
    if (section.shape === "array") continue; // 数组段身份取自元素自带的 id／name 字段，不会成为对象属性键
    const nextEntries = entriesFor(nextDoc, section, MODE);
    if (nextEntries === null) continue;
    const previousEntries = entriesFor(previousDoc, section, MODE);
    const previous = new Map((previousEntries || []).map((entry) => [entry.id, entry]));
    for (const entry of nextEntries) {
      if (!isReservedIdentity(entry.id)) continue;
      const before = previous.get(entry.id);
      if (before && identityBearing(before.definition) === identityBearing(entry.definition)) continue;
      errors.push("lifecycle_element_id_reserved: " + section.key + "." + entry.id + " 元素身份键是 Object.prototype 上的访问器属性——按键写入不落自有键（元素静默消失）、按键读缺席命中原型值，迁移判定与退役锚点都会静默失真（ADR-017 §二 判定语义 11）。请改用能落成自有键的元素 id");
    }
  }
  return errors;
}

/** 全档判定：previous 与 next 均为整份本体形态（落盘咽喉与回滚口用）。 */
function assertDocumentTransitions(previousDoc, nextDoc, mode) {
  const MODE = mode || "document";
  return [...assertReservedIdentities(previousDoc, nextDoc, MODE), ...assertNoRetiredRemoval(previousDoc, nextDoc, MODE), ...collectTransitions(previousDoc, nextDoc, MODE).flatMap(judge)];
}

/** 段级判定（路由早报面）：payload 出现的段按整段替换语义参与，未出现的段视为不改。 */
function assertElementTransitions(previousData, payload) {
  const nextDoc = {};
  for (const section of TABLE.elementSections) {
    if (payload && payload[section.key] !== undefined) nextDoc[section.key] = payload[section.key];
  }
  return assertDocumentTransitions(previousData, nextDoc, "patch");
}

module.exports = { rawStatus,
  entriesFor,
  identityOf,
  isReservedIdentity,
  ownValue,
  assertElementTransitions,
  assertDocumentTransitions,
  assertNoRetiredRemoval,
  assertReservedIdentities,
  collectTransitions,
  statusOf,
  DEFAULT_STATUS,
  transitionCount: ALLOWED.size,
};
