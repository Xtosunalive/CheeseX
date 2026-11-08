// 文章生命周期路径角色单源（SPEC-013）——契约一致性＋角色判定＋目录构造。层级：纯单元。
const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const lifecycle = require("../article-lifecycle-paths.cjs");
const contract = require("../../../contracts/article-lifecycle.json");

test("契约↔模块一致性：角色根路径同源派生", () => {
  const byId = Object.fromEntries(contract.roles.map((r) => [r.id, r]));
  assert.equal(lifecycle.DRAFT_ROOT, byId.draft.root);
  assert.equal(lifecycle.WORKING_ROOT, byId["standard-working"].root);
  assert.equal(lifecycle.FORMAL_ROOT, byId["standard-formal"].root);
  assert.equal(lifecycle.ARCHIVE_ROOT, byId["source-archive"].root);
  assert.equal(lifecycle.SUBMISSION_DRAFT_PREFIX, `${byId.draft.submission_dir}/`);
});

test("角色判定：前缀语义与投稿子域", () => {
  assert.ok(lifecycle.isUnderDraft("知识库/raw/drafts/投稿/a.md"));
  assert.ok(lifecycle.isSubmissionDraft("知识库/raw/drafts/投稿/a.md"));
  assert.equal(lifecycle.isSubmissionDraft("知识库/raw/drafts/local.md"), false, "本地草稿非投稿子域");
  assert.ok(lifecycle.isUnderWorking("知识库/raw/precleaned/a.md"));
  assert.equal(lifecycle.isUnderWorking("知识库/raw/drafts/a.md"), false, "角色前缀不重叠");
  assert.ok(lifecycle.isUnderFormal("知识库/wiki/articles/article-x/h.md"));
  assert.ok(lifecycle.isUnderArchive("知识库/raw/archive/投稿/h-a.md"));
  assert.equal(lifecycle.isUnderDraft(null), false, "非字符串安全拒判");
  assert.ok(lifecycle.hasFormalSegment("prefix/wiki/articles/ok"), "正式区段子串识別（存量消费方语义）");
  assert.equal(lifecycle.hasFormalSegment("prefix/wiki/entities/"), false);
});

test("目录构造与正式源路径", () => {
  const v = "/tmp/vault";
  assert.equal(lifecycle.draftsDir(v), path.join(v, "知识库", "raw", "drafts"));
  assert.equal(lifecycle.submissionDraftsDir(v), path.join(v, "知识库", "raw", "drafts", "投稿"));
  assert.equal(lifecycle.workingDir(v), path.join(v, "知识库", "raw", "precleaned"));
  assert.equal(lifecycle.formalArticlesDir(v), path.join(v, "知识库", "wiki", "articles"));
  assert.equal(lifecycle.archiveDir(v), path.join(v, "知识库", "raw", "archive"));
  assert.equal(lifecycle.archiveDir(v, "投稿"), path.join(v, "知识库", "raw", "archive", "投稿"));
  // SPEC-030 派②位置维：两层（域/articleId目录）
  assert.equal(lifecycle.formalSourcePath("ops", "d1", "f.md"), "知识库/wiki/articles/ops/d1/f.md");
  assert.equal(lifecycle.resolveDomainSegment("ops:maintain:gw", ["ops", "ref"]), "ops");
  assert.throws(() => lifecycle.resolveDomainSegment("bad:maintain:gw", ["ops", "ref"]), /不在受管域值集/);
  assert.throws(() => lifecycle.resolveDomainSegment("", []), /category-path 缺失/);
});

// ── SPEC-028：resolveMutability（路径→角色→可变性档；角色根外 null）──
const { resolveMutability, ROLE_MUTABILITY } = lifecycle; // 同一单源模块，无第二份路径表
test("SPEC-028 resolveMutability：四角色根与子路径命中归档 lane", () => {
  assert.equal(resolveMutability("知识库/raw/drafts/a.md"), "human-editable");
  assert.equal(resolveMutability("知识库/raw/drafts/投稿/a.md"), "human-editable");
  assert.equal(resolveMutability("知识库/raw/precleaned/g.md"), "human-editable");
  assert.equal(resolveMutability("知识库/wiki/articles/article-x/abc.md"), "read-only-evidence");
  assert.equal(resolveMutability("知识库/raw/archive/投稿/" + "f".repeat(64) + "-原文.md"), "read-only-evidence");
  assert.equal(resolveMutability("知识库/raw/archive"), null, "角色根本身非文件落点——不执法（文件级语义）");
  assert.equal(resolveMutability("知识库/wiki/entities/a.md"), null, "实体页族不在文章四角色面（SPEC-028 第二落地另立）");
  assert.equal(resolveMutability("知识库/TheSchema/enums.yaml"), null, "TheSchema 已辖他域");
  assert.equal(resolveMutability(".ledger/master_graph.json"), null, "机器状态账本非本档面");
  assert.equal(resolveMutability(null), null, "非字符串不炸");
  assert.deepEqual(ROLE_MUTABILITY, {
    draft: "human-editable", "standard-working": "human-editable",
    "standard-formal": "read-only-evidence", "source-archive": "read-only-evidence",
  }, "角色档位映射与 SPEC-028 §四一致");
});
