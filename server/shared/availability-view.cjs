// Component: Availability-View
// @responsible: 空态语义投影（WP-070／SPEC-070 §3.2）——「读不到数据」对消费面意味着什么、该怎么说的
//   唯一回答点。纯函数、零 fs、零 feature 依赖；单源＝contracts/empty-state-semantics.json
//   （三类行为／缺失种类 what-where-requires／站点登记）。指引文案在此唯一组装（门禁 tripwire
//   执法第二文案源）。形态参照 OpenMAIC EffectiveView（判别联合＋why）：消费方只问谓词，不自推策略。
// @inputs: absent 种类集合（事实层——vocab-load-port／document-load-port 六态或站点自判）＋消费面类别
// @outputs: availabilityView → 按依赖序排序的 { kind, status, hint, prerequisites, behavior }[]；
//   guidanceFor(kind) → 指引串；behaviorOf(class) → 行为契约；formOptionAvailability → 表单形状适配
// @context: Canvas
"use strict";

const CONTRACT = require("../../contracts/empty-state-semantics.json");

const KINDS = CONTRACT.absence_kinds;
const CLASSES = CONTRACT.consumer_classes;

function assertKind(kind) {
  if (!Object.prototype.hasOwnProperty.call(KINDS, kind)) {
    throw new TypeError(`EMPTY_STATE_KIND_UNREGISTERED: 缺失种类 ${kind} 未在 contracts/empty-state-semantics.json 登记——新站点先登记种类再接线`);
  }
  return KINDS[kind];
}

function fill(template, kind) {
  const k = assertKind(kind);
  return template.replace("{what}", k.what).replace("{where}", k.where);
}

/**
 * 指引串（唯一组装点）：`{what}——请到「{where}」配置`；前置缺失在场时以「先…再」引导依赖序。
 * @param {string} kind 缺失种类 id
 * @param {string[]} [absentSet] 当前全部缺失种类（判断前置是否也缺）；缺省只看自身
 */
function guidanceFor(kind, absentSet = []) {
  const k = assertKind(kind);
  const absent = new Set(absentSet);
  const unmetPrereqs = (k.requires || []).filter((req) => absent.has(req));
  const lead = unmetPrereqs.map((req) => fill(CONTRACT.prerequisite_template, req)).join("");
  return `${lead}${fill(CONTRACT.guide_template, kind)}`;
}

/** 缺失种类的机制备注（契约 note——供消费类错误 message 附带语境；无则空串） */
function noteFor(kind) {
  return assertKind(kind).note || "";
}

/** 消费面类别 → 行为契约 { behavior, status, rule } */
function behaviorOf(consumerClass) {
  const c = CLASSES[consumerClass];
  if (!c) throw new TypeError(`EMPTY_STATE_CLASS_UNKNOWN: 消费面类别 ${consumerClass} ∉ form|display|consumer`);
  return { behavior: c.behavior, status: c.status, rule: c.rule };
}

/** 依赖序：前置种类排前（拓扑序），同层按契约登记顺序 */
function orderByPrerequisite(kinds) {
  const set = new Set(kinds);
  const out = [];
  const seen = new Set();
  const visit = (kind) => {
    if (seen.has(kind) || !set.has(kind)) return;
    seen.add(kind);
    for (const req of assertKind(kind).requires || []) visit(req);
    out.push(kind);
  };
  for (const kind of Object.keys(KINDS)) visit(kind);
  return out;
}

/**
 * 空态投影：absent 种类集合 → 判别联合数组（EffectiveView 形态）。
 * @param {{ absent: string[], consumerClass: "form"|"display"|"consumer" }} input
 * @returns {{ kind, status: "unassigned", hint, prerequisites: string[], behavior }[]} 依赖序排列；absent 为空即 []
 */
function availabilityView({ absent = [], consumerClass }) {
  const { behavior } = behaviorOf(consumerClass);
  for (const kind of absent) assertKind(kind); // 入口即校验：未登记种类不得静默消失（单测 2026-11-02 咬出的 fail-open）
  const ordered = orderByPrerequisite(absent);
  return ordered.map((kind) => ({
    kind,
    status: "unassigned",
    hint: guidanceFor(kind, ordered),
    prerequisites: (assertKind(kind).requires || []).filter((req) => ordered.includes(req)),
    behavior,
  }));
}

/**
 * 展示类响应附件：{ empty, kinds, hints }（openapi AvailabilityGuide）。absent 为空 → { empty:false, kinds:[], hints:[] }
 */
function displayAvailability(absent) {
  const view = availabilityView({ absent, consumerClass: "display" });
  return { empty: view.length > 0, kinds: view.map((v) => v.kind), hints: view.map((v) => v.hint) };
}

/**
 * 表单类形状适配（WP-062 兼容）：optionsKey → kind 映射 ＋ 是否为空 → { empty, hint, kind }。
 * @param {Record<string,{ kind: string, empty: boolean }>} facts 各选项源的事实（空否）
 */
function formOptionAvailability(facts) {
  const absent = Object.values(facts).filter((f) => f.empty).map((f) => f.kind);
  const view = new Map(availabilityView({ absent, consumerClass: "form" }).map((v) => [v.kind, v]));
  const out = {};
  for (const [key, fact] of Object.entries(facts)) {
    const v = view.get(fact.kind);
    out[key] = { empty: Boolean(fact.empty), hint: v ? v.hint : "", kind: fact.kind };
  }
  return out;
}

module.exports = { availabilityView, guidanceFor, noteFor, behaviorOf, displayAvailability, formOptionAvailability, KINDS: Object.freeze(Object.keys(KINDS)) };
