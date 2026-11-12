"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  MANAGED_FIELDS, computeDraftProvenance, mergeProvenanceWithCurrent,
} = require("../article-field-provenance.cjs");

const fm = {
  title: "既有标题", date: "2026-01-01", updated: "2026-01-02", status: "在线",
  module: "anyshare", article_type: "排错指南", "doc-type": "用户手册", "category-path": "ops:maintain", tags: ["a"],
};

test("受管集与三态判定：auto（本次机械填）/ human（既有值）/ not-extracted（无信号）", () => {
  const frontmatter = { title: "人工标题", tags: ["x"] };
  const provenance = computeDraftProvenance(frontmatter, ["date", "updated"], { module: "anyshare" });
  assert.equal(provenance.title.source, "human");
  assert.equal(provenance.date.source, "auto");
  assert.equal(provenance.updated.source, "auto");
  assert.equal(provenance.tags.source, "human");
  assert.equal(provenance.module.source, "not-extracted");
  assert.equal(provenance.module.suggestion, "anyshare");
  assert.equal(provenance.status.source, "not-extracted");
  assert.ok(!("suggestion" in provenance.status), "无信号无建议＝纯未提取到，不伪造建议");
  // 受管集恰为草稿提取流程管理的九字段（双拼写归并后）
  assert.deepEqual([...MANAGED_FIELDS].sort(), ["article_type", "category-path", "date", "doc-type", "module", "status", "tags", "title", "updated"]);
});

test("B12 回归钉：推测只作为 not-extracted 态的 suggestion 附注，永不充当确认值", () => {
  const provenance = computeDraftProvenance({}, [], { article_type: "排错指南" });
  assert.equal(provenance.article_type.source, "not-extracted");
  assert.equal(provenance.article_type.suggestion, "排错指南");
  // 快照值通道也不携带建议值——建议不进入任何 value 位
  assert.equal(provenance.article_type.value, null);
});

test("双拼写别名：legacy 拼写的值按 canonical 键归并报告", () => {
  const provenance = computeDraftProvenance({ doc_type: "旧拼写手册", "category-path": "ops:deploy" }, [], {});
  assert.equal(provenance["doc-type"].source, "human");
  assert.equal(provenance["doc-type"].value, "旧拼写手册");
  assert.equal(provenance["category-path"].source, "human");
});

test("合并规则：值未变保留来源；被改写→human；被清空→not-extracted；无快照存量→保守两态", () => {
  const snapshot = computeDraftProvenance({ title: "机器题" }, ["title"], { module: "anyshare" });
  const merged = mergeProvenanceWithCurrent(snapshot, { title: "机器题", module: "anyshare" });
  assert.equal(merged.title.source, "auto", "值未变→保持 auto");
  assert.equal(merged.module.source, "human", "建议被人采纳落盘→human（人写的）");
  const edited = mergeProvenanceWithCurrent(snapshot, { title: "人改过的题" });
  assert.equal(edited.title.source, "human", "改写→human");
  const cleared = mergeProvenanceWithCurrent(snapshot, {});
  assert.equal(cleared.title.source, "not-extracted", "清空→not-extracted（机器从不清空）");
  const legacy = mergeProvenanceWithCurrent(null, fm);
  assert.equal(legacy.title.source, "human", "无快照存量：有值保守报 human，不冒认 auto");
  assert.equal(legacy.status.source, "human");
  assert.equal(mergeProvenanceWithCurrent(null, {}).title.source, "not-extracted", "无快照且无值→未提取到");
});
