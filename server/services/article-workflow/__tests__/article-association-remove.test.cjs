// 引用随源流转（2026-10-15 Master 批准）——removeDecision（stale 行移除出口：乐观锁/幂等/审计写入）
// ＋ removeDecisionsForArticle（退役沿链清行）。层级：纯单元（注入 audit raw 内存通道）。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const YAML = require("yaml");
const { createArticleAssociationService } = require("../article-association-service.cjs");

function makeService(decisions) {
  let raw = YAML.stringify({ schema_version: 1, decisions });
  const service = createArticleAssociationService({
    vaultPath: "/tmp/vault",
    listFormalArticles: () => ({ articles: [] }),
    getGraph: () => ({ nodes: [] }),
    getRegistry: () => ({ products: {} }),
    readAuditRaw: () => raw,
    writeAuditRaw: (next) => { raw = next; },
  });
  return {
    service,
    decisions: () => YAML.parse(raw).decisions,
    revision: () => "sha256:" + require("node:crypto").createHash("sha256").update(raw).digest("hex"),
  };
}

function dec(decisionId, articleId, sourcePath) {
  return { decisionId, articleId, action: "replace", componentIds: ["c"], versionIds: [], candidateSourcePath: sourcePath, candidateSourceHash: "sha256:" + "a".repeat(64), decidedAt: "2026-10-15 00:00:00", operatorId: "t" };
}

test("removeDecision：按 decisionId 删行＋乐观锁冲突＋幂等", () => {
  const { service, decisions, revision } = makeService([dec("d1", "A", "知识库/raw/precleaned/a.md"), dec("d2", "B", "知识库/raw/precleaned/b.md")]);
  const rev = revision();
  const result = service.removeDecision(rev, "d1");
  assert.equal(result.removed, 1);
  assert.deepEqual(decisions().map((d) => d.decisionId), ["d2"], "目标行已删");
  // 幂等：同 id 再删 removed=0
  assert.equal(service.removeDecision(revision(), "d1").removed, 0);
  // 乐观锁：旧 revision 拒绝
  assert.throws(() => service.removeDecision(rev, "d2"), (e) => e.code === "ARTICLE_REVISION_CONFLICT");
});

test("幽灵行投影过滤：解析不到活文章的决策不进 list()（失效数据直接不显示——Master 2026-10-15 裁）", () => {
  const { service } = makeService([dec("ghost", "GONE", "知识库/raw/precleaned/gone.md"), dec("live", "B", "知识库/raw/precleaned/stay.md")]);
  // listFormalArticles 注入返回空 articles → 两条都解析不到活文章 → 全部过滤
  const listed = service.list();
  assert.equal(listed.auditRecords.length, 0, "幽灵行零投影");
  assert.equal(listed.articles.length, 0);
});

test("removeDecisionsForArticle：按文件名清全部行（退役沿链）＋无关行保留＋幂等", () => {
  const { service, decisions } = makeService([
    dec("d1", "A", "知识库/raw/precleaned/gone.md"),
    dec("d2", "A2", "知识库/raw/precleaned/gone.md"),
    dec("d3", "B", "知识库/raw/precleaned/stay.md"),
  ]);
  assert.equal(service.removeDecisionsForArticle("gone.md"), 2, "两条幽灵行清掉");
  assert.deepEqual(decisions().map((d) => d.decisionId), ["d3"]);
  assert.equal(service.removeDecisionsForArticle("gone.md"), 0, "幂等");
  assert.equal(service.removeDecisionsForArticle("stay.md"), 1, "按名匹配其他文章同样可清");
});
