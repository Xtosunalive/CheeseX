// Component: Value-Domain-Resolver
// @responsible: 字段值域参考实现（SPEC-020 波 1）——按 fields.yaml 的结构化配方（resolve/normalize/
//               default/composite）从 enums.yaml＋versions.yaml 解析每个字段的合法值集合、归一表与缺省值。
//               纯函数无 IO：配方数据化后的唯一解释器；校验器/画像/合规/投影的消费方切换属波 2。
// @inputs: { fields: fields.yaml 解析对象, enums: enums.yaml 解析对象（原始——内部先过 normalizeEnums
//           形态收口，与 buildRuleSet 同一咽喉：ADR-008 D1 标量归一＋trim、PR-053 脏节点局部降级）,
//           versions: versions.yaml 解析对象 }
// @outputs: { byField: [{ name, scope, values, aliasMap, default, wikilinkStrip, composite }], errors: [string] }
// @context: 等价基线＝server/shared/enums-loader.cjs buildRuleSet——红队复核批（2026-10-18）修正：
//           原实现吃原始 enums 绕开形态收口，契约合法的 legacy 标量子域/带空白 id/纯空白缺省即分叉；
//           本批统一走 normalizeEnums，并补 default.from 悬空执法与 op/形态不符报错。
// 操作集封闭（SPEC-020）：values/keys/ids[+filter:entity_usable]/tags_union/matrix_union_fallback/
//               product_closure/version_registry/free_slug——未知 op 记 errors（防御，契约层已拦）。
// 空态语义忠实（真实 vault 现状）：tags/modules/别名表可全空；subdomain_constraints 缺省→matrix_union_fallback
//               回落 arch_categories（ADR-006 保底）；disabled_tags 缺省＝空集。

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/** 按点路径取段（enums 内）："lifecycle.status" → enums.lifecycle.status；缺段返回 undefined。 */
function segment(enums, path) {
  if (!path) return undefined;
  return String(path)
    .split(".")
    .reduce((node, key) => (isPlainObject(node) ? node[key] : undefined), enums);
}

/** 词条表取 id 并集（ADR-008 D1：裸标量无损升格为 {id}；对象直通 trim id）。数组对象与按域分组 map 均收。 */
function collectIds(value) {
  if (Array.isArray(value)) {
    const out = [];
    for (const entry of value) {
      if (typeof entry === "string") {
        const id = entry.trim();
        if (id !== "") out.push(id);
      } else if (isPlainObject(entry) && typeof entry.id === "string") {
        const id = entry.id.trim();
        if (id !== "") out.push(id);
      }
    }
    return out;
  }
  if (isPlainObject(value)) {
    const out = [];
    for (const group of Object.values(value)) out.push(...collectIds(group));
    return out;
  }
  return [];
}

// WP-050 D1：操作闭集 null 原型——内容可写 op（constructor 族）直取不可表达，回落「未知操作」红
const SET_OPS = Object.assign(Object.create(null), {
  values(source) {
    return Array.isArray(source) ? source.filter((v) => typeof v === "string" && v.trim() !== "").map((v) => v) : [];
  },
  keys(source) {
    return isPlainObject(source) ? Object.keys(source) : [];
  },
  ids(source, resolve) {
    if (!Array.isArray(source)) return collectIds(source);
    const entries = resolve && resolve.filter === "entity_usable" ? source.filter((e) => !isPlainObject(e) || e.entity_layer !== false) : source;
    return collectIds(entries);
  },
  tags_union(_source, _resolve, enums) {
    const groups = isPlainObject(enums.tags) ? enums.tags : {};
    const union = new Set();
    for (const list of Object.values(groups)) {
      for (const tag of Array.isArray(list) ? list : []) if (typeof tag === "string") union.add(tag);
    }
    for (const disabled of Array.isArray(enums.disabled_tags) ? enums.disabled_tags : []) union.delete(disabled);
    return [...union];
  },
  matrix_union_fallback(_source, _resolve, enums) {
    const matrix = enums.subdomain_constraints;
    const union = new Set();
    if (isPlainObject(matrix)) {
      for (const policy of Object.values(matrix)) {
        for (const cat of (isPlainObject(policy) && Array.isArray(policy.allowed_categories) ? policy.allowed_categories : [])) {
          if (typeof cat === "string" && cat.trim() !== "") union.add(cat.trim());
        }
      }
    }
    return union.size > 0 ? [...union] : Array.isArray(enums.arch_categories) ? enums.arch_categories : [];
  },
  product_closure(_source, _resolve, enums, versions) {
    const proj = isPlainObject(enums.architecture_projection) ? enums.architecture_projection : {};
    const set = new Set();
    if (typeof proj.product === "string" && proj.product.trim() !== "") set.add(proj.product);
    if (isPlainObject(proj.product_aliases)) for (const key of Object.keys(proj.product_aliases)) set.add(key);
    for (const reserved of Array.isArray(versions && versions.reserved_products) ? versions.reserved_products : []) set.add(reserved);
    return [...set];
  },
  version_registry(_source, _resolve, _enums, versions) {
    const set = new Set();
    const products = isPlainObject(versions && versions.products) ? versions.products : {};
    for (const def of Object.values(products)) {
      for (const entry of (isPlainObject(def) && Array.isArray(def.versions) ? def.versions : [])) {
        if (!isPlainObject(entry)) continue;
        if (typeof entry.id === "string" && entry.id !== "") set.add(entry.id);
        for (const alias of Array.isArray(entry.aliases) ? entry.aliases : []) if (typeof alias === "string") set.add(alias);
      }
    }
    return [...set];
  },
  free_slug() {
    return []; // 自由段无闭合集合（pattern 语义，校验属消费方）
  },
});

/** op 与段形态的硬搭配（红队 C5/C6：不符即红，不留静默空集执法空档）。 */
function opTypeMismatch(op, source) {
  if (op === "values" && !Array.isArray(source)) return "values 只适用列表段";
  if (op === "keys" && !isPlainObject(source)) return "keys 只适用对象段";
  return null;
}

/**
 * 解析全部字段值域。
 * @param {{fields?: {fields?: Array}, enums?: object, versions?: object}} inputs
 * @returns {{byField: Array<object>, errors: string[]}}
 */
function resolveValueDomains({ fields, enums, versions } = {}) {
  // 形态收口（红队复核批）：与 buildRuleSet 同一咽喉——ADR-008 D1 归一＋PR-053 脏节点降级。
  const normalized = normalizeEnumsSafe(enums);
  const enumsSafe = normalized;
  const versionsSafe = isPlainObject(versions) ? versions : {};
  const rows = (fields && Array.isArray(fields.fields) ? fields.fields : []).filter(isPlainObject);
  const errors = [];
  const byField = [];

  for (const field of rows) {
    const vd = field.value_domain;
    if (!isPlainObject(vd)) continue;
    const record = { name: field.name, scope: field.scope || [], values: null, aliasMap: null, default: null, wikilinkStrip: false, composite: null };

    if (Array.isArray(vd.composite)) {
      // 混合域（category-path）：闭合段逐段解析；scoped_by: previous 段产出按前段键收窄的映射。
      record.composite = [];
      let previousValues = null;
      let partIndex = 0;
      for (const part of vd.composite) {
        partIndex += 1;
        if (!isPlainObject(part)) {
          errors.push(`[composite 段形态] 字段 '${field.name}' 第 ${partIndex} 段非对象`);
          record.composite.push({ values: [] });
          continue;
        }
        if (part.resolve && part.resolve.op === "free_slug") {
          record.composite.push({ op: "free_slug" });
          continue;
        }
        if (part.scoped_by === "previous" && !previousValues) {
          errors.push(`[composite 收窄错位] 字段 '${field.name}' 第 ${partIndex} 段 scoped_by: previous 但无前段（首段不可收窄）`);
          record.composite.push({ source: part.source, values: [] });
          continue;
        }
        const src = segment(enumsSafe, part.source);
        if (src === undefined) {
          errors.push(`[值域引用悬空] 字段 '${field.name}' composite 段 '${part.source}' 在 enums 不存在`);
          record.composite.push({ source: part.source, values: [] });
          continue;
        }
        const resolve = part.resolve || { op: "values" };
        const impl = SET_OPS[resolve.op];
        if (!impl) {
          errors.push(`[未知操作] 字段 '${field.name}' composite 段 '${part.source}' op='${resolve.op}' 不在封闭操作集`);
          record.composite.push({ source: part.source, values: [] });
          continue;
        }
        const typeErr = opTypeMismatch(resolve.op, src);
        if (typeErr) {
          errors.push(`[op 形态不符] 字段 '${field.name}' composite 段 '${part.source}'：${typeErr}`);
          record.composite.push({ source: part.source, values: [] });
          continue;
        }
        const values = impl(src, resolve, enumsSafe, versionsSafe);
        record.composite.push(
          part.scoped_by === "previous" && previousValues
            ? { source: part.source, scoped: Object.fromEntries(previousValues.map((key) => [key, collectIds(segment(enumsSafe, part.source)[key])])) }
            : { source: part.source, values },
        );
        if (part.scoped_by !== "previous") previousValues = values;
      }
    } else if (vd.resolve) {
      const resolve = vd.resolve;
      const impl = SET_OPS[resolve.op];
      if (!impl) {
        errors.push(`[未知操作] 字段 '${field.name}' op='${resolve.op}' 不在封闭操作集`);
      } else if (resolve.filter && resolve.op !== "ids") {
        // 红队 C1：filter 声明挂在非 ids op 上＝过滤意图静默丢失——红。
        errors.push(`[filter 错挂] 字段 '${field.name}' filter 只可与 op: ids 搭配（当前 op=${resolve.op}）`);
      } else {
        // matrix_union_fallback/product_closure/version_registry/tags_union 的真源是整份 enums/versions（按 op 语义取），
        // 段地址仅作对账锚点（check:fields-registry 扩面用）。
        const needsSegment = ["values", "keys", "ids"].includes(resolve.op);
        const src = needsSegment ? segment(enumsSafe, vd.segment || vd.source) : null;
        if (needsSegment && src === undefined) {
          errors.push(`[值域引用悬空] 字段 '${field.name}' 来源段 '${vd.segment || vd.source}' 在 enums 不存在`);
        } else if (needsSegment) {
          const typeErr = opTypeMismatch(resolve.op, src);
          if (typeErr) errors.push(`[op 形态不符] 字段 '${field.name}' 来源段 '${vd.segment || vd.source}'：${typeErr}`);
        }
        record.values = impl(src, resolve, enumsSafe, versionsSafe);
      }
    }

    if (vd.normalize && typeof vd.normalize.aliases === "string") {
      const table = segment(enumsSafe, vd.normalize.aliases);
      if (!isPlainObject(table)) {
        errors.push(`[归一表悬空] 字段 '${field.name}' normalize.aliases='${vd.normalize.aliases}' 在 enums 不存在或非对象`);
      } else {
        // A6（红队）：别名表值形态统一为数组（tag_aliases 的标量值 lenient 合法——PR-049 事故原型），
        // 消费方只见一种类型。
        const aliasMap = {};
        for (const [alias, target] of Object.entries(table)) {
          const targets = Array.isArray(target) ? target.filter((t) => typeof t === "string") : typeof target === "string" ? [target] : [];
          if (targets.length) aliasMap[alias] = targets;
        }
        record.aliasMap = aliasMap;
      }
    }
    if (vd.normalize && vd.normalize.wikilink_strip === true) record.wikilinkStrip = true;
    if (isPlainObject(vd.default)) {
      // D2（红队）：default.from 是段引用——悬空与 normalize.aliases 同罪即红，不留执法不对称。
      const from = segment(enumsSafe, vd.default.from);
      if (from === undefined) {
        errors.push(`[缺省来源悬空] 字段 '${field.name}' default.from='${vd.default.from}' 在 enums 不存在`);
      } else {
        // A3（红队）：纯空白不是有效缺省值（buildRuleSet trim 判空口径）——回落。
        record.default = typeof from === "string" && from.trim() !== "" ? from.trim() : record.values && record.values.length ? record.values[0] : null;
      }
    }
    byField.push(record);
  }
  return { byField, errors };
}

/** normalizeEnums 安全包裹（enums-loader 为纯构建器；异常输入回落空对象——门禁面另有存在性执法）。 */
function normalizeEnumsSafe(enums) {
  try {
    const { normalizeEnums } = require("./enums-loader.cjs");
    if (!isPlainObject(enums)) return {};
    const out = normalizeEnums(enums);
    return isPlainObject(out && out.data) ? out.data : {};
  } catch {
    return {};
  }
}

module.exports = { resolveValueDomains };
