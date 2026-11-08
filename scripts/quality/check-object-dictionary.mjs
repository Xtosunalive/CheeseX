#!/usr/bin/env node
// check-object-dictionary.mjs — 业务对象字典×元模型对账门禁（TALOS 枚举单源＋常设校验面借鉴批，2026-10-23 Master 批准）
// @responsible: 两级执法——①元模型自检（六层齐备／扩展规则三条／machine_read_policy 读侧纪律在场／字段归属索引存在）
//               ②字典对账（卡片字段 ⊆ field_ownership——未登记字段即红＝扩展规则①的机器面；两轴枚举（object_kind/subtype
//               经 ontology 层枚举，quality/lifecycle 经 status 层枚举——双状态机替代混维 naming_status/segment_status，
//               遗留字段出现即红）；证据双通道（仓内 file:line／标准出处·备选·直译来源·裁决 前缀豁免）；
//               关系边类型化（edges.type ⊆ relationships 层枚举）；无名⇔incomplete；治理标签层承载 confidence；
//               边界 7 条／B1–B6 在册且 ruled 有裁决文／N·D 项 status 枚举／附录五族与 9 文档型／B3 引用过期面／标准对照≥20）
//               ③传导面（transduction_rules 元模型驱动）：按 type 分发解释、参数从元模型块读取
//               （TR1 裁决联动翻态／TR2 值域边⇒值域亚型／TR3 editable=true⇒L1×approved 必要条件〔B6=a，editable 同批转必填〕
//               ／TR4 retired 禁 transitional 过渡标签〔R6，transitional 定形 governance_tags 布尔键〕）；
//               未知 type 红＝fail-closed（无执法面的规则=假绿）。
// @inputs: contracts/object-dictionary.json、contracts/object-meta-model.json（枚举与字段归属唯一源——本脚本零枚举字面量）
// @outputs: 退出码 0＋`object_dictionary=ok …` 单行摘要；失败非零＋错误清单（首行 object_dictionary=FAIL）
// @context: 定稿遗留兑现（REQUIREMENTS #52 遗留项①）；校验器此前在会话临时目录，先红后绿已验，本件转常设。
//           可测性：checkDictionary(dict, mm) 纯函数导出，__tests__/check-object-dictionary.test.mjs 消费。
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "../..");
// WP-049 L4（SPEC-044 C4）：档位名集单源——本体声明经装载端口派生（confidence-bands），不手抄
const { createRequire } = await import("node:module");
const require_ = createRequire(import.meta.url);
const { confidenceBandNames } = require_("../../server/shared/confidence-bands.cjs");
const BAND_NAMES = confidenceBandNames(ROOT); // 仓根经装载阶梯回落 data/theschema 真源（非静默缺省）
const READ_FIELDS = new Set(["canonical_name", "aliases", "technical_refs", "object_id"]);

function loadArgs(argv) {
  const out = {
    dictionary: path.join(ROOT, "contracts/object-dictionary.json"),
    metaModel: path.join(ROOT, "contracts/object-meta-model.json"),
    lifecycleTable: path.join(ROOT, "contracts/dictionary-lifecycle.json"),
  };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--dictionary") out.dictionary = path.resolve(argv[++i]);
    else if (argv[i] === "--meta-model") out.metaModel = path.resolve(argv[++i]);
    else if (argv[i] === "--lifecycle-table") out.lifecycleTable = path.resolve(argv[++i]);
  }
  return out;
}

export function checkDictionary(d, mm) {
  const errors = [];
  const push = (msg) => errors.push(msg);
  // ── ①元模型自检 ──
  // PR-138 快照审阅⑤：六层清单改双向动态对账——缺层红＋清单外多层红
  // （原固定清单只咬缺层：元模型新增第七层不会被咬——"加层门禁没跟上"敞口闭合）
  const KNOWN_META_LAYERS = ["identity", "ontology", "characteristics", "relationships", "status", "governance_tags"];
  const actualLayers = Object.keys(mm.layers || {});
  for (const k of KNOWN_META_LAYERS) {
    if (!mm.layers?.[k]) push(`meta-model.layers.${k} missing`);
  }
  for (const k of actualLayers) {
    if (!KNOWN_META_LAYERS.includes(k)) push(`meta-model.layers.${k} 不在自检清单——新层须先扩 KNOWN_META_LAYERS 与字典执法面（无执法面的层=假绿）`);
  }
  if (mm.extension_rules?.length !== 3) push("meta-model.extension_rules != 3");
  if (!mm.machine_read_policy?.channels || Object.keys(mm.machine_read_policy.channels).length === 0) {
    push("meta-model.machine_read_policy.channels missing");
  }
  for (const [name, ch] of Object.entries(mm.machine_read_policy?.channels ?? {})) {
    if (!Array.isArray(ch.read) || ch.read.length === 0) push(`machine_read_policy.channels.${name}.read empty`);
    for (const f of ch.read ?? []) if (!READ_FIELDS.has(f)) push(`machine_read_policy.channels.${name}.read 非法字段 ${f}`);
  }
  const OWNED = new Set(Object.values(mm.field_ownership ?? {}).flat());
  const enumOf = (layer, key) => (mm.layers?.[layer]?.enums?.[key] ?? []).map((e) => e.value ?? e);
  const E = {
    kind: enumOf("ontology", "object_kind"),
    subtype: enumOf("ontology", "subtype"),
    q: enumOf("status", "quality_status"),
    lc: enumOf("status", "lifecycle_status"),
    edge: enumOf("relationships", "edge_type"),
  };
  for (const [k, v] of Object.entries(E)) if (v.length === 0) push(`meta-model 枚举空：${k}`);

  // ── ②字典对账 ──
  const FORBIDDEN = new Set(["naming_status", "segment_status", "confidence"]); // 已迁移遗留字段（status/governance_tags 层承载）
  const STATUSES = ["determined", "partially_determined", "needs_decision"];
  const CORE_TABS = ["domains", "layers", "categories", "taxonomy", "tags", "ontology", "dependencies", "versions", "fields", "concepts", "discovery", "relations", "modules"]; // relations：EDGE-RELATION-GOV-001 对象本体批（D3 关系类型卡＋D1 关系实例页签——页面随前端批）；modules：SCHEMA-IA-001 批10 拆页签（Master 2026-10-26「1 拆」）
  const hasFileLine = (s) => /\.(md|json|yaml|yml|ts|tsx|cjs|mjs|py):\d/.test(s);
  const PREFIXES = ["标准出处：", "备选：", "直译来源：", "裁决："];
  const evidenceOk = (e) => hasFileLine(e) || PREFIXES.some((p) => e.startsWith(p));
  if (!["draft-pending-master", "master-confirmed"].includes(d.dictionary_status)) push(`dictionary_status=${d.dictionary_status}`);
  const EXPECTED_CARDS = 16; // 16＝SCHEMA-IA-001 批10（Master 2026-10-26「1 拆」）增「产品模块」卡；15＝EDGE-RELATION-GOV-001 对象本体批（2026-10-24 D3）增「关系类型」卡
  if (!Array.isArray(d.core_objects) || d.core_objects.length !== EXPECTED_CARDS) push(`core_objects!=${EXPECTED_CARDS}`);
  const tabs = new Set();
  for (const c of d.core_objects ?? []) {
    const id = c.object_id ?? "?";
    for (const k of Object.keys(c)) if (!OWNED.has(k)) push(`${id}.${k} 未登记于元模型 field_ownership（扩展须先修订元模型）`);
    for (const k of FORBIDDEN) if (k in c) push(`${id}.${k} 为已迁移遗留字段`);
    for (const k of ["object_id", "definition", "write_path", "data_domain", "role", "editable", "quality_status", "lifecycle_status"]) {
      if (c[k] === undefined || c[k] === null || c[k] === "") push(`${id}.${k} empty`);
    }
    if (!E.kind.includes(c.object_kind) && c.object_kind !== null) push(`${id}.object_kind=${c.object_kind}`);
    if (c.object_kind === null && !c.object_kind_note) push(`${id}.object_kind null without note`);
    if (c.subtype !== undefined && c.subtype !== null && !E.subtype.includes(c.subtype)) push(`${id}.subtype=${c.subtype}`);
    if (!E.q.includes(c.quality_status)) push(`${id}.quality_status=${c.quality_status}`);
    if (!E.lc.includes(c.lifecycle_status)) push(`${id}.lifecycle_status=${c.lifecycle_status}`);
    if (!BAND_NAMES.includes(c.governance_tags?.confidence)) push(`${id}.governance_tags.confidence`);
    if (c.editable !== undefined && typeof c.editable !== "boolean") push(`${id}.editable not boolean`);
    if (c.future_split && (!Array.isArray(c.future_split.reevaluate_when) || c.future_split.reevaluate_when.length === 0)) push(`${id}.future_split.reevaluate_when empty`);
    if (!c.canonical_name && c.quality_status !== "incomplete") push(`${id}.canonical_name 为空但 quality_status=${c.quality_status}`);
    for (const k of ["canonical_name_evidence", "definition_evidence", "authority_source"]) {
      if (!Array.isArray(c[k]) || c[k].length === 0) push(`${id}.${k} empty`);
      else for (const e of c[k]) if (!evidenceOk(e)) push(`${id}.${k} evidence 无出处 → ${String(e).slice(0, 50)}`);
    }
    for (const e of c.relationships?.edges ?? []) if (!E.edge.includes(e.type)) push(`${id}.edges type=${e.type}`);
    if (!Array.isArray(c.aliases)) push(`${id}.aliases not array`);
    tabs.add(c.edited_by_tab);
  }
  for (const t of CORE_TABS) if (!tabs.has(t)) push(`tab not covered: ${t}`);
  if ([...tabs].filter((t) => !CORE_TABS.includes(t)).length) push(`unexpected tabs: ${[...tabs].filter((t) => !CORE_TABS.includes(t))}`);
  if (d.boundary_determinations?.length !== 7) push("boundary_determinations!=7");
  for (const b of d.boundary_determinations ?? []) {
    for (const k of ["id", "title", "determination"]) if (!b[k]) push(`boundary ${b.id ?? "?"}.${k} empty`);
    if (!STATUSES.includes(b.status)) push(`boundary ${b.id}.status=${b.status}`);
    if (!Array.isArray(b.evidence) || b.evidence.length === 0) push(`boundary ${b.id}.evidence empty`);
  }
  const mids = (d.pending_decisions?.master_items ?? []).map((m) => m.id).sort().join(",");
  if (mids !== "B1,B2,B3,B4,B5,B6") push(`master_items != B1-B6: ${mids}`);
  for (const m of d.pending_decisions?.master_items ?? []) {
    for (const k of ["item", "options", "impact", "status"]) if (!m[k]) push(`${m.id}.${k} empty`);
    if (m.status === "ruled" && !m.ruling) push(`${m.id}.ruled without ruling`);
  }
  for (const n of d.pending_decisions?.dictionary_items ?? []) {
    for (const k of ["id", "item", "status"]) if (!n[k]) push(`${n.id}.${k} empty`);
    if (!["open", "ruled", "closed"].includes(n.status)) push(`${n.id}.status=${n.status}`);
  }
  const ap = d.appendix ?? {};
  if (ap.doc_type_files?.length !== 8) push("doc_type_files!=8"); // PR-245 退役 system-components 卡后 9→8（2026-11-04）
  for (const key of ["derived_l2", "evidence_l4", "ledgers", "faceless_source_segments"]) {
    if (!Array.isArray(ap[key]) || ap[key].length === 0) push(`appendix.${key} empty`);
  }
  for (const l of ap.ledgers ?? []) if (/B3 待裁/.test(l.note ?? "")) push(`appendix.ledgers[${l.object_id}] B3 引用过期`);
  const sa = d.standards_alignment?.entries;
  if (!Array.isArray(sa) || sa.length < 20) push("standards_alignment.entries<20");
  for (const e of sa ?? []) {
    for (const k of ["form", "standard", "verdict"]) if (!e[k]) push(`standards '${e.form ?? "?"}'.${k} empty`);
    if (!["align", "near", "diff", "none"].includes(e.verdict)) push(`standards '${e.form}'.verdict=${e.verdict}`);
  }
  // ── ③传导面（transduction_rules 元模型驱动；未知 type 红＝fail-closed）──
  const settledOf = (r) =>
    new Set(
      (d.pending_decisions?.master_items ?? [])
        .filter((m) => (r.settled_status ?? []).includes(m.status))
        .map((m) => m.id),
    );
  for (const r of mm.transduction_rules?.rules ?? []) {
    if (r.type === "boundary_depends_converged_implies_determined") {
      const settled = settledOf(r);
      for (const b of d.boundary_determinations ?? []) {
        const deps = b.depends_on ?? [];
        if (deps.length && deps.every((x) => settled.has(x)) && b.status === r.pending_status) {
          push(`TR:${r.id} boundary '${b.id}' depends_on 全收敛（${deps.join("+")}）但 status=${b.status}——裁决联动未翻态`);
        }
      }
    } else if (r.type === "reference_edge_implies_subtype") {
      for (const c of d.core_objects ?? []) {
        if ((c.relationships?.edges ?? []).some((e) => e.type === r.edge_type) && c.subtype !== r.subtype) {
          push(`TR:${r.id} '${c.object_id}' 有 ${r.edge_type} 边但 subtype=${c.subtype ?? "(缺)"}——应为 ${r.subtype}`);
        }
      }
    } else if (r.type === "editable_true_requires") {
      for (const c of d.core_objects ?? []) {
        if (c.editable === true) {
          const bad = Object.entries(r.requires ?? {}).filter(([k, v]) => c[k] !== v);
          if (bad.length) {
            push(`TR:${r.id} '${c.object_id}' editable=true 但 ${bad.map(([k, v]) => `${k}=${c[k]}(应 ${v})`).join("、")}——可编辑的必是源层现役对象`);
          }
        }
      }
    } else if (r.type === "lifecycle_forbids_tag") {
      for (const c of d.core_objects ?? []) {
        if (c.lifecycle_status === r.forbidden_when_lifecycle && c.governance_tags?.[r.tag] === true) {
          push(`TR:${r.id} '${c.object_id}' lifecycle=${r.forbidden_when_lifecycle} 但 governance_tags.${r.tag}=true——终态不得挂过渡标签`);
        }
      }
    } else if (r.type === "runtime_view_implies_non_source") {
      for (const c of d.core_objects ?? []) {
        if (c.object_kind === r.kind && c.role === r.forbidden_role) {
          push(`TR:${r.id} '${c.object_id}' object_kind=${r.kind}（查询产物，无持久化存储）但 role=${r.forbidden_role}——运行时现算对象不是事实载体`);
        }
      }
    } else if (r.type === "retired_requires_replacement_seat") {
      // TR6（WP-115/PR-259 #3）：retired 卡必带退役三件套座次——静态面；迁移边合法性另住 dictionary-lifecycle.json（④段）
      const seat = r.seat ?? {};
      const byId = new Map((d.core_objects ?? []).map((c) => [c.object_id, c]));
      for (const c of d.core_objects ?? []) {
        if (c.lifecycle_status !== "retired") continue;
        const id = c.object_id ?? "?";
        const seatObj = c[seat.field ?? "retirement"];
        if (!seatObj || typeof seatObj !== "object") {
          push(`TR:${r.id} '${id}' retired 缺 ${seat.field ?? "retirement"} 座次——退役必带 reason＋replaced_by（历史锚点，事后清空同样拒）`);
          continue;
        }
        for (const sf of seat.subfields ?? []) {
          const v = seatObj[sf.name];
          if (v === undefined || v === null || v === "" || (typeof v === "string" && !v.trim())) {
            push(`TR:${r.id} '${id}' ${seat.field}.${sf.name} 空——退役三件套座次不齐（事后清空同样拒）`);
          } else if (sf.type && typeof v !== sf.type) {
            push(`TR:${r.id} '${id}' ${seat.field}.${sf.name} 形状非法（应 ${sf.type}，实 ${typeof v}）——座次是历史锚点不是占位符`);
          }
        }
        const tf = seat.target ?? {};
        const ref = seatObj[tf.field ?? "replaced_by"];
        const tgt = typeof ref === "string" ? byId.get(ref) : undefined;
        if (!tgt) {
          push(`TR:${r.id} '${id}' ${seat.field}.${tf.field ?? "replaced_by"} 指向在册外目标 '${String(ref ?? "").slice(0, 40)}'——须指向同类型现役卡`);
          continue;
        }
        if (tf.self === false && tgt === c) push(`TR:${r.id} '${id}' replaced_by 自指——替代目标不得是自身`);
        if (tf.kind_field && tgt[tf.kind_field] !== c[tf.kind_field]) {
          push(`TR:${r.id} '${id}' replaced_by '${tgt.object_id}' 跨类型（${tgt[tf.kind_field]}≠${c[tf.kind_field]}）`);
        }
        if (tf.status_field && tf.status_value && tgt[tf.status_field] !== tf.status_value) {
          push(`TR:${r.id} '${id}' replaced_by '${tgt.object_id}' 非现役（${tf.status_field}=${tgt[tf.status_field]}）`);
        }
      }
    } else {
      push(`TR:${r.id} 未知 type='${r.type}'——新传导类型须先扩 check 解释器（无执法面的规则=假绿）`);
    }
  }
  return { errors };
}

// ── 边表律文钉（WP-115 红队 P1-2/P2-1 修复）：「改表放松不了」的形状谓词半句——
// terminalFrom/defaultStatus/两条律文禁止边是 ADR-017 §二 律文硬编，动它们须先修 ADR；
// 允许边∩明令禁止边不得重叠（自相矛盾即红）；全部迁移边取值不得越五态取值域。
export function validateLifecycleTable(table, lcEnum) {
  const errors = [];
  const P = (m) => errors.push(`LCT:${m}`);
  if (!table || typeof table !== "object") {
    P("边表不可读");
    return errors;
  }
  if (table.terminalFrom !== "retired") {
    P(`terminalFrom=${table.terminalFrom} ——律文硬编（ADR-017 §二：退役不可原地复活），改表放松不了；修此钉须先修 ADR-017`);
  }
  if (table.defaultStatus !== "approved") {
    P(`defaultStatus=${table.defaultStatus} ——律文硬编（ADR-014 §三：缺省 approved）`);
  }
  const allowed = (table.transitions ?? []).map((e) => `${e.from}\u0000${e.to}`);
  const denied = (table.explicitlyDenied ?? []).map((e) => `${e.from}\u0000${e.to}`);
  for (const e of table.transitions ?? []) {
    if (!(lcEnum ?? []).includes(e.from) || !(lcEnum ?? []).includes(e.to)) {
      P(`迁移边 ${e.from}→${e.to} 越出取值域（五态单源 contracts/object-meta-model.json#layers.status）`);
    }
  }
  for (const s of denied) {
    if (allowed.includes(s)) P(`明令禁止边 ${s.replace("\u0000", "→")} 同时出现在允许集——自相矛盾`);
  }
  for (const p of [["retired", "approved"], ["reserved", "retired"]]) {
    if (!denied.includes(p.join("\u0000"))) {
      P(`律文禁止边 ${p[0]}→${p[1]} 缺席 explicitlyDenied——律文硬编（ADR-017 §二），清不得`);
    }
  }
  return errors;
}

// ── ④生命周期迁移边判定（卡族咽喉：HEAD↔当前逐卡对表——WP-115/PR-259 #4）──
// 迁移语义照抄 ADR-017 §二律文表（同一家律同一套边）；两条律文硬编在本函数（改表放松不了）：
// 终态不得迁出＋越词表在册值禁一步直入缺省态（PR-181 同构）。
export function checkLifecycleTransitions(oldCards, newCards, table, lcEnum) {
  const errors = [];
  const def = table.defaultStatus;
  const term = table.terminalFrom;
  const allowed = new Set((table.transitions ?? []).map((e) => `${e.from}\u0000${e.to}`));
  const denied = (table.explicitlyDenied ?? []).map((e) => `${e.from}\u0000${e.to}\u0000${e.reason}`);
  const oldById = new Map((oldCards ?? []).map((c) => [c.object_id, c]));
  const val = (c) => (c?.lifecycle_status === undefined || c?.lifecycle_status === null || c?.lifecycle_status === "" ? def : c.lifecycle_status);
  const inEnum = (v) => (lcEnum ?? []).includes(v);
  // 删除面：退役是历史锚点（ADR-017 §二.7 同构）——retired 卡不得从字典消失；非退役卡可删照常
  for (const [id, old] of oldById) {
    if (val(old) === term && !(newCards ?? []).some((c) => c.object_id === id)) {
      errors.push(`LC:'${id}' retired 卡被删除——退役是历史锚点，恢复走新建或 ADR-014 §5.2 替代链`);
    }
  }
  for (const c of newCards ?? []) {
    const id = c.object_id ?? "?";
    const old = oldById.get(id);
    if (!old) continue; // 新建卡豁免边判定（首态取枚举合法值即可；枚举合法性由②层执法）
    const from = val(old);
    const to = val(c);
    if (from === to) continue;
    const deniedHit = denied.find((s) => s.startsWith(`${from}\u0000${to}\u0000`));
    if (deniedHit) {
      errors.push(`LC:'${id}' ${from}→${to} 明令禁止：${deniedHit.split("\u0000")[2]}`);
      continue;
    }
    if (from === term) {
      errors.push(`LC:'${id}' ${from}→${to} ——终态不得迁出（退役不可原地复活，恢复走新建或 ADR-014 §5.2 替代链）`);
      continue;
    }
    if (!inEnum(from)) {
      if (to === def) {
        errors.push(`LC:'${id}' 在册值 '${from}' 越出取值域，禁一步直入缺省态 '${def}'——先迁其他合法态再走正常链`);
        continue;
      }
      if (inEnum(to)) continue; // 修正出口：越词表值可迁往任何非缺省合法态，落新态后走正常链（PR-181 同构）
    }
    if (!deniedHit && !allowed.has(`${from}\u0000${to}`)) {
      errors.push(`LC:'${id}' ${from}→${to} 未登记迁移边——字典卡族边表 contracts/dictionary-lifecycle.json（fail-closed，任意跨态跳跃一律拒绝）`);
    }
  }
  return errors;
}

function main() {
  const args = loadArgs(process.argv.slice(2));
  const mm = JSON.parse(fs.readFileSync(args.metaModel, "utf8"));
  const lcEnum = (mm.layers?.status?.enums?.lifecycle_status ?? []).map((e) => e.value ?? e);
  const errors = [];
  let d;
  try {
    // 提交时真值＝暂存区优先（pre-commit 语义，与迁移边咽喉同源——红队 P1-1：防「暂存 TR6 非法＋工作树净」漏判）；无暂存条目回退工作树（CI/手工语义）
    try {
      const rel = path.relative(ROOT, args.dictionary);
      d = JSON.parse(execFileSync("git", ["show", `:${rel}`], { encoding: "utf8" }));
    } catch {
      d = JSON.parse(fs.readFileSync(args.dictionary, "utf8"));
    }
  } catch (e) {
    errors.push(`字典不可读/不可解析（fail-closed）：${String(e.message).slice(0, 120)}`);
  }
  if (d) {
    errors.push(...checkDictionary(d, mm).errors);
    // ── 边表可用性＋律文钉（无条件：坏表不潜伏到首次迁移才暴露；「改表放松不了」由 validateLifecycleTable 承载）──
    let lifecycleTable;
    try {
      lifecycleTable = JSON.parse(fs.readFileSync(args.lifecycleTable, "utf8"));
    } catch (e) {
      errors.push(`LC:边表不可读/不可解析（fail-closed）：${String(e.message).slice(0, 120)}`);
    }
    if (lifecycleTable) errors.push(...validateLifecycleTable(lifecycleTable, lcEnum));
    // ── 卡族迁移边咽喉：提交时真值＝暂存区；index==HEAD 零判定（干净检出/CI）──
    try {
      const rel = path.relative(ROOT, args.dictionary);
      const headRaw = execFileSync("git", ["show", `HEAD:${rel}`], { encoding: "utf8" });
      let newRaw;
      try {
        newRaw = execFileSync("git", ["show", `:${rel}`], { encoding: "utf8" });
      } catch {
        newRaw = fs.readFileSync(args.dictionary, "utf8");
      }
      if (newRaw !== headRaw) {
        const oldD = JSON.parse(headRaw);
        const newD = JSON.parse(newRaw);
        errors.push(...checkLifecycleTransitions(oldD.core_objects ?? [], newD.core_objects ?? [], lifecycleTable ?? {}, lcEnum));
      }
    } catch (e) {
      errors.push(`LC:迁移边咽喉无法判定（fail-closed）：${String(e.message).slice(0, 120)}`);
    }
  }
  if (errors.length) {
    console.error("object_dictionary=FAIL errors=" + errors.length);
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }
  const qs = d.core_objects.map((c) => c.quality_status);
  const edges = d.core_objects.reduce((n, c) => n + (c.relationships?.edges?.length || 0), 0);
  console.log(
    `object_dictionary=ok cards=${d.core_objects.length} tabs=${new Set(d.core_objects.map((c) => c.edited_by_tab)).size}` +
      ` quality=certified:${qs.filter((q) => q === "certified").length},recorded:${qs.filter((q) => q === "recorded").length},incomplete:${qs.filter((q) => q === "incomplete").length}` +
      ` subtype_vd=${d.core_objects.filter((c) => c.subtype === "value_domain").length} edges=${edges}` +
      ` boundaries=${d.boundary_determinations.length} standards=${d.standards_alignment.entries.length} status=${d.dictionary_status}`
  );
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invoked) main();
