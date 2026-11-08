// 层级：组件级集成（writer/service 真实构造，非 main.cjs 装配）——PR-205 验收④正反例。
// 红队复核更正（2026-11-03）：本件两例均自装配，main.cjs 改回只读装配时本件不会红——
// 「main.cjs 装配形态」的回归网现无（e2e 六流不含 remove），残余记 PR-205 落账；头注如实。
// Master 2026-11-03 裁 A 支：/remove 两个移除出口（removeDecision／removeDecisionsForArticle）
// 从只读 pinned 实例改道活 writer（与 save 同装配）。本件钉两件事：
//   正例＝活装配真能删（行消失、revision 前移、幂等 removed=0）；
//   反例＝main.cjs 同形态只读装配（writeAuditRaw 恒抛 FORMAL_RELEASE_IMMUTABLE 409）对存在行拒删且账本零变化。
// 撤线自证（组件级）：writer 出口摘除（回 createArticleAssociationService 直调只读形态）→ 正例即红。
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const YAML = require("yaml");
const { createArticleAssociationService } = require("../article-association-service.cjs");
const { createWorktreeAssociationWriter } = require("../article-association-worktree-writer.cjs");
const { initVaultIO, resetVaultIO } = require("../../../shared/vault-io.cjs");

function auditRow(decisionId, basename) {
  return {
    decisionId, articleId: "ART-1", action: "add", componentIds: ["ops"], versionIds: [],
    candidateSourcePath: `知识库/raw/precleaned/${basename}`, candidateSourceHash: "sha256:old", decidedAt: "2026-07-17T00:00:00.000Z",
  };
}

/** 夹具：tmp vault＋THESCHEMA_DIR 钉夹具内（账本住址由 resolver 决定），账车替身不跑 git。 */
function fixture(t) {
  const previousPin = process.env.THESCHEMA_DIR;
  const vaultPath = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "aa-remove-"));
  const schemaDir = path.join(vaultPath, "知识库", "TheSchema");
  process.env.THESCHEMA_DIR = schemaDir;
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.mkdirSync(path.join(vaultPath, "知识库", "wiki", "entities"), { recursive: true }); // 受管根存在但空＝合法空态（ADR063 三值），formalCatalog 不炸
  initVaultIO({ vaultPath, gitLedger: { markSystemFile() {}, isSystemFile() { return false; }, scheduleLedger() {} } });
  const auditPath = path.join(schemaDir, "article_associations.yaml");
  const seed = (rows) => fs.writeFileSync(auditPath, YAML.stringify({ schema_version: 1, decisions: rows }));
  const readBack = () => YAML.parse(fs.readFileSync(auditPath, "utf8"));
  const revisionOf = () => {
    const svc = createArticleAssociationService({ vaultPath, getGraph: () => ({ nodes: [] }), getRegistry: () => ({ products: {} }), listFormalArticles: () => ({ articles: [], invalid: [] }) });
    return svc.list().revision;
  };
  t.after(() => {
    resetVaultIO();
    if (previousPin === undefined) delete process.env.THESCHEMA_DIR; else process.env.THESCHEMA_DIR = previousPin;
    fs.rmSync(vaultPath, { recursive: true, force: true });
  });
  return { vaultPath, auditPath, seed, readBack, revisionOf };
}

const stubs = { getGraph: () => ({ nodes: [] }), getRegistry: () => ({ products: {} }), listFormalArticles: () => ({ articles: [], invalid: [] }) };

test("PR-205 正例：活 writer 装配——removeDecision 删存在行；removeDecisionsForArticle 沿链清行", (t) => {
  const { vaultPath, seed, readBack, revisionOf } = fixture(t);
  seed([auditRow("d-1", "guide.md"), auditRow("d-2", "other.md")]);
  const writer = createWorktreeAssociationWriter({ vaultPath, ...stubs });
  const before = revisionOf();
  const removed = writer.removeDecision(before, "d-1");
  assert.equal(removed.removed, 1, "存在行应删 1");
  assert.ok(!readBack().decisions.some((d) => d.decisionId === "d-1"), "行应已消失");
  assert.notEqual(removed.revision, before, "删行后 revision 应前移");
  // 幂等：幽灵行 removed=0 且不写盘
  const ghost = writer.removeDecision(removed.revision, "d-nope");
  assert.equal(ghost.removed, 0, "幽灵行幂等 removed=0");
  // 退役沿链清行：按源文件名清该文章全部决策行
  const swept = writer.removeDecisionsForArticle("other.md");
  assert.equal(swept, 1, "沿链应清 1 行");
  assert.equal(readBack().decisions.length, 0, "账本应清空");
});

test("PR-205 反例：main.cjs 同形态只读装配——存在行拒删（FORMAL_RELEASE_IMMUTABLE 409）且账本零变化；幽灵行幂等", (t) => {
  const { vaultPath, seed, readBack, revisionOf } = fixture(t);
  seed([auditRow("d-1", "guide.md")]);
  // main.cjs:730-734 同形态：writeAuditRaw 覆写为恒 409（PR-205 改道后该闸只余纵深防御职能）
  const pinned = createArticleAssociationService({
    vaultPath, ...stubs,
    writeAuditRaw() {
      const error = new Error("Formal Release article associations are read-only");
      Object.assign(error, { code: "FORMAL_RELEASE_IMMUTABLE", status: 409 });
      throw error;
    },
  });
  assert.throws(() => pinned.removeDecision(revisionOf(), "d-1"), (e) => e.code === "FORMAL_RELEASE_IMMUTABLE" && e.status === 409, "只读装配对存在行应 409 拒删");
  assert.equal(readBack().decisions.length, 1, "拒删时账本零变化");
  // 提前返回不写盘：幽灵行在只读装配下也幂等（removed=0，不触发写闸）
  const ghost = pinned.removeDecision(revisionOf(), "d-nope");
  assert.equal(ghost.removed, 0, "只读装配幽灵行幂等 removed=0");
});
