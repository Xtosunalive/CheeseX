'use strict';
// Component: Ontology-Lifecycle-Transition-Conditions（ADR-017 §二 律文表的「附加条件」列）
// @responsible: 把迁移表逐边附带的条件与迁移边判定放到同一执法位点（落盘咽喉＋回滚口）——PR-183，触发面按 PR-187 加宽
// @inputs: previousDoc（在册本体）＋nextDoc（本次落盘终态）
// @outputs: { errors: 400 类文案[], anchorErrors: 422 类文案[] }；判据实现不另写一份——复用 schema-validators 与 relation-capability-selector
// @context: 触发集＝①本次迁入 retired 的元素②本次新落盘即带 retired 的元素③态别未变但 retirement 块被改动的在册退役元素（PR-187：
//   只按①②触发＝不改态清空 retirement.reason 可无痕改写退役历史）④本次回入 approved 的关系。
//   校验函数一旦调用即按整档扫退役链（与路由既有行为一致）；收窄的只是「是否调用」，SPEC-068 C10 措辞按此实态写。
const GUARD = require("./ontology-lifecycle-transition.cjs");
const { validateElementLifecycles, validateRetirementChains } = require("./schema-validators.cjs");
const { validateCapabilityConsumerAnchors } = require("../../shared/relation-capability-selector.cjs");
const TABLE = require("../../../contracts/ontology-lifecycle.json");

const SHAPES = new Map(TABLE.elementSections.map((section) => [section.key, section.shape]));
// 终态态别住迁移表（terminalFrom），代码内不留 "retired" 字面量
const TERMINAL_STATUS = TABLE.terminalFrom;

/** 由触发集造出 payload——沿用路由同一校验入口的入参形状。 */
/** 本次落盘里 lifecycle_status **原值发生变化**的元素（含首次带值）——PR-189：取值域/形状校验必须有作用域，
 *   既不能只在「态别可识别地迁移」时才跑（非法值恰好不可识别），也不能整档追缴（存量脏值会把今天的写入全挡成假红）。*/
function collectLifecycleWriters(previousDoc, nextDoc) {
  const out = [];
  for (const section of TABLE.elementSections) {
    const nextValue = nextDoc ? nextDoc[section.key] : undefined;
    if (nextValue === undefined) continue;
    const prevValue = previousDoc ? previousDoc[section.key] : undefined;
    if (section.shape === "array") {
      if (!Array.isArray(nextValue)) continue;
      const before = new Map((Array.isArray(prevValue) ? prevValue : []).map((d, i) => [GUARD.rawStatus(d) === undefined ? "#" + i : keyOf(d, i), d]));
      nextValue.forEach((definition, i) => {
        const id = keyOf(definition, i);
        const was = before.get(id);
        if (was !== undefined && JSON.stringify(GUARD.rawStatus(was)) === JSON.stringify(GUARD.rawStatus(definition))) return; // forEach 回调：跳过该元素
        out.push({ section: section.key, id, definition, raw: GUARD.rawStatus(definition) });
      });
      continue;
    }
    if (!nextValue || typeof nextValue !== "object" || Array.isArray(nextValue)) continue;
    for (const id of Object.keys(nextValue)) {
      const definition = GUARD.ownValue(nextValue, id);
      const was = GUARD.ownValue(prevValue, id);
      if (was !== undefined && JSON.stringify(GUARD.rawStatus(was)) === JSON.stringify(GUARD.rawStatus(definition))) continue; // for…of：跳过未变化的元素
      out.push({ section: section.key, id, definition, raw: GUARD.rawStatus(definition) });
    }
  }
  return out;
}

function keyOf(definition, index) {
  if (definition && typeof definition === "object") {
    for (const k of ["id", "name"]) if (typeof definition[k] === "string" && definition[k].trim()) return definition[k];
  }
  return "#" + index;
}
function payloadOf(items) {
  // 空原型容器：`obj[id]=…` 对 `__proto__` 这类键会被原型访问器吃掉（元素静默消失，PR-191 实测的抹痕路）；
  // null 原型下同名赋值落为自有键，校验器按 Object.keys 就能看见它。
  const payload = Object.create(null);
  for (const item of items) {
    const shape = SHAPES.get(item.section) || "map";
    if (shape === "array") {
      if (!Array.isArray(payload[item.section])) payload[item.section] = [];
      payload[item.section].push(item.definition);
      continue;
    }
    if (!payload[item.section]) payload[item.section] = Object.create(null);
    payload[item.section][item.id] = item.definition;
  }
  return payload;
}

/** 态别未变但退役块被触碰的元素——PR-187 补的触发面（清 reason／换 replaced_by／整块删除皆在此列）。 */
function collectRetirementTouches(previousDoc, nextDoc) {
  const touched = [];
  for (const section of TABLE.elementSections) {
    const nextEntries = GUARD.entriesFor(nextDoc, section);
    if (nextEntries === null) continue;
    const previousEntries = GUARD.entriesFor(previousDoc, section);
    const previous = new Map((previousEntries || []).map((entry) => [entry.id, entry]));
    for (const entry of nextEntries) {
      if (GUARD.statusOf(entry.definition) !== TERMINAL_STATUS) continue;
      const before = previous.get(entry.id);
      if (!before) {
        touched.push({ section: section.key, id: entry.id, definition: entry.definition, trigger: "new-retired" });
        continue;
      }
      if (GUARD.statusOf(before.definition) !== TERMINAL_STATUS) continue; // 迁入 retired 的由迁移变更集覆盖
      const stringify = (value) => JSON.stringify(value && typeof value === "object" ? value : null);
      if (stringify(before.definition.retirement) !== stringify(entry.definition.retirement)) {
        touched.push({ section: section.key, id: entry.id, definition: entry.definition, trigger: "retirement-edited" });
      }
    }
  }
  return touched;
}

function assertTransitionConditions(previousDoc, nextDoc) {
  const changes = GUARD.collectTransitions(previousDoc, nextDoc);
  const writes = collectLifecycleWriters(previousDoc, nextDoc);
  const errors = [];
  const anchorErrors = [];
  // 取值域/形状校验随本次落盘值变化而跑（PR-189：此前只在迁移触发集非空时才跑，非法值恰好不构成迁移）
  for (const writer of writes) {
    const isArray = SHAPES.get(writer.section) === "array";
    const one = payloadOf([{ section: writer.section, id: writer.id, definition: writer.definition }]);
    const mark = errors.length;
    validateElementLifecycles(one, errors);
    // 数组段的定位器由校验器按数组下标生成，作用域收窄后下标会错位——回指到真实元素 id（红例要点名元素）
    if (isArray) {
      const prefix = writer.section + "[0]";
      for (let k = mark; k < errors.length; k += 1) errors[k] = errors[k].startsWith(prefix) ? writer.section + "." + writer.id + errors[k].slice(prefix.length) : errors[k];
    }
  }

  const retireTriggers = new Map();
  for (const item of [...changes.filter((change) => change.to === TERMINAL_STATUS), ...collectRetirementTouches(previousDoc, nextDoc)]) {
    retireTriggers.set(item.section + "." + item.id, item);
  }
  // PR-192：把替换目标迁出 approved（非退役方向）也是「改退役链」的动作。此前这类写入零判，断链要等到日后任意一次
  // 退役写入才被整档扫描扫出来，且点名的是操作者没碰的元素（复核实测 B14 放行→B15 拒）。现在就在造出断链的那一笔拒。
  const leavesApproved = changes.filter((change) => change.from === GUARD.DEFAULT_STATUS && change.to !== GUARD.DEFAULT_STATUS && change.to !== TERMINAL_STATUS && change.to !== null);
  // PR-195（第六轮复核 ①）：断链的第二条形是「链上节点消失」——非退役件本就可删，删掉唯一现役替换目标既不迁态也不退役，
  // 两层判据皆零判，仍要等日后无关退役写入才被整档扫描报出未触及元素。按「本次有没有元素消失」补一条触发。
  const disappearing = [];
  for (const section of TABLE.elementSections) {
    const nextEntries = GUARD.entriesFor(nextDoc, section, "document");
    if (nextEntries === null) continue;
    const nextIds = new Set(nextEntries.map((entry) => entry.id));
    const previousEntries = GUARD.entriesFor(previousDoc, section, "document");
    for (const entry of previousEntries || []) {
      if (!nextIds.has(entry.id)) disappearing.push({ where: section.key + "." + entry.id, status: GUARD.statusOf(entry.definition) });
    }
  }
  if (retireTriggers.size > 0 || leavesApproved.length > 0 || disappearing.length > 0) {
    const payload = retireTriggers.size > 0 ? payloadOf([...retireTriggers.values()]) : Object.create(null);
    if (retireTriggers.size > 0) validateElementLifecycles(payload, errors);
    const mark = errors.length;
    validateRetirementChains(payload, nextDoc, previousDoc, errors);
    if (errors.length > mark) {
      // 归因行插在链错之前——调用方只透出第一条错误，点名「未触及的 A」而不点名本次动的 T，操作者会以为拒得没道理
      const scope = [
        ...leavesApproved.map((change) => "lifecycle_retirement_chain_scope: 本次把 " + change.where + " 迁出 " + GUARD.DEFAULT_STATUS + "——在册退役元素的替换链须落到现役目标，此处断链即拒（出口：ADR-014 §5.2 另立现役替代并同笔改指，或经 Master 裁决的数据迁移工具）"),
        ...disappearing.map((gone) => "lifecycle_retirement_chain_scope: 本次移除了在册元素 " + gone.where + "（移走前态别 " + gone.status + "）——在册退役元素的替换链须落到在册现役目标，此处断链即拒（出口：同笔改指另一枚现役元素，或经 Master 裁决的数据迁移工具）"),
      ];
      errors.splice(mark, 0, ...scope);
    }
  }

  const reactivatedRelations = changes.filter((change) => change.to === GUARD.DEFAULT_STATUS && change.section === "relation_types");
  if (reactivatedRelations.length) {
    const anchors = validateCapabilityConsumerAnchors(nextDoc);
    if (!anchors.ok) anchorErrors.push.apply(anchorErrors, anchors.errors);
  }
  return { errors, anchorErrors, triggerCount: retireTriggers.size };
}

module.exports = { assertTransitionConditions, collectRetirementTouches, payloadOf };
