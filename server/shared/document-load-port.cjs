'use strict';
// Component: Document-Load-Port（文档装载入口——WP-050 D-B／SPEC-045 D2/D3）
// @responsible: vault 文档（实体 frontmatter／关系账本行／评审记录）→类型化领域对象的唯一装载点：
//   解析经既有单点（yaml-frontmatter——本模块为其类型化视图层），键闭集校验＋六态查询与
//   WP-049 vocabLookup 同构；产物 null 原型（P1 文档面病根的结构消灭——保留名键不可命中）。
//   消费方（文章准入链／master-graph／anomaly 采集／gap 文案／entity-repair）不得各自
//   YAML.parse 后裸取键（SPEC-045 D2）。
// @inputs: 文档文本（raw）或已解析 frontmatter（内部产物）
// @outputs: docField(doc, key)（六态）／docFieldClosedSet(fm, key, closedSet)（键闭集）
// @context: Vault（Sync——纯函数，无 fs；读文件由调用方经既有通道）
// WP-116 批2（SPEC-083 §二.3）：消费面 require 收口——本端口为宿主唯一出口，补纯转发三件
// （无任何包装逻辑，逐函数直通宿主）：patchFrontmatter／frontmatterBounds（无状态文本变换，宿主
// 同源）与 parseEntityDocumentStrict（严格通道，projection 委托用）。解析主出口仍是 loadDocument。
const {
  frontmatterBounds,
  parseEntityDocument,
  parseEntityDocumentStrict,
  patchFrontmatter,
} = require('./yaml-frontmatter.cjs');

/**
 * 六态查询（SPEC-045 D3，与 WP-049 vocabLookup 同构）：
 * doc-absent／key-absent／empty-string／empty-collection／present／non-object。
 * frontmatter 产物为 null 原型（保留名键不可命中原型面——P1 判据安全豁免形态）。
 */
function docField(doc, key) {
  if (!doc || typeof doc !== 'object') return { state: 'doc-absent', value: undefined };
  const fm = doc.frontmatter !== undefined ? doc.frontmatter : doc;
  if (fm === null || fm === undefined || typeof fm !== 'object') return { state: 'doc-absent', value: undefined };
  if (!Object.hasOwn(fm, key)) return { state: 'key-absent', value: undefined };
  const value = fm[key];
  if (value === '') return { state: 'empty-string', value };
  if (Array.isArray(value) && value.length === 0) return { state: 'empty-collection', value };
  if (value === null || value === undefined) return { state: 'null-value', value };
  return { state: 'present', value };
}

/**
 * 键闭集校验取值（SPEC-045 D3）：内容字段作键前须在闭集（在册枚举/别名表）——
 * 闭集外值返回 { ok:false, state:'not-in-closed-set' }，消费方显式分支（不静默当在册）。
 * 闭集建议以 Set 传入；数组自动升格。
 */
function docFieldClosedSet(doc, key, closedSet) {
  const probe = docField(doc, key);
  if (probe.state !== 'present' && probe.state !== 'empty-string' && probe.state !== 'empty-collection' && probe.state !== 'null-value') {
    return { ok: false, state: probe.state, value: undefined };
  }
  const set = closedSet instanceof Set ? closedSet : new Set(closedSet || []);
  const raw = probe.value;
  const normalized = typeof raw === 'string' ? raw.trim() : raw;
  if (!set.has(normalized)) return { ok: false, state: 'not-in-closed-set', value: normalized };
  return { ok: true, state: probe.state, value: normalized };
}

/** 便捷装载：文本→{frontmatter, body}（null 原型产物）——消费方统一入口（SPEC-045 D2）。 */
function loadDocument(raw, sourcePath) {
  return parseEntityDocument(raw, sourcePath);
}

module.exports = {
  loadDocument,
  docField,
  docFieldClosedSet,
  // 批2 纯转发（无包装——消费面禁直 require 宿主，出口唯一经本端口）
  frontmatterBounds,
  parseEntityDocumentStrict,
  patchFrontmatter,
};
