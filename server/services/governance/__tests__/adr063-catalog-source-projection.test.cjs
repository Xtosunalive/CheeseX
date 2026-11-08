const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { createAnomalyIssueCollector } = require("../anomaly-issue-collector.cjs");

// ADR063 #1746 源投影对账：正式 catalog 来自冻结 Release 快照，其 sourcePath 指向的
// 活源文件已删时，article_association 检出必须缺席（活源为准）；文件在位时检出照常。
describe("ADR063 #1746 article catalog source-projection reconcile", () => {
  function setup(vaultPath, articles) {
    const deps = {
      vaultPath,
      logger: { warn() {}, info() {} },
      scanAndCheck: () => { throw new Error("skip"); },
      readMasterGraph: () => { throw new Error("skip"); },
      scanDraftSources: () => ({ documents: [], invalid: [] }),
      isWorkbenchIssueFinding: () => false,
      findUnmanagedEntityCandidates: () => ({}),
      listRelationTargetOptions: () => [],
      relationRegistry: null,
      articleAssociationService: { list: () => ({ revision: "r1", articles, decisions: [] }) },
    };
    return createAnomalyIssueCollector(deps);
  }

  it("source file deleted → no article_association detection from frozen catalog", () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), "adr063-catalog-"));
    const collect = setup(vault, [
      { articleId: "样本A", title: "样本A", sourcePath: "知识库/raw/precleaned/样本A.md", sourceHash: "sha256:" + "a".repeat(64), componentIds: [] },
    ]);
    const issues = collect().issues.filter((issue) => issue.issueKind === "article_association");
    assert.equal(issues.length, 0, "活源已删，冻结快照中的文章不得产出检出");
    fs.rmSync(vault, { recursive: true, force: true });
  });

  it("source file present → detection stays (normal path unchanged)", () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), "adr063-catalog-live-"));
    fs.mkdirSync(path.join(vault, "知识库", "raw", "precleaned"), { recursive: true });
    fs.writeFileSync(path.join(vault, "知识库", "raw", "precleaned", "样本B.md"), "# 样本B\n");
    const collect = setup(vault, [
      { articleId: "样本B", title: "样本B", sourcePath: "知识库/raw/precleaned/样本B.md", sourceHash: "sha256:" + "b".repeat(64), componentIds: [] },
    ]);
    const issues = collect().issues.filter((issue) => issue.issueKind === "article_association");
    assert.equal(issues.length, 1, "活源在位，检出照常");
    assert.equal(issues[0].issueId, "article-association-missing-样本B");
    fs.rmSync(vault, { recursive: true, force: true });
  });
});
