// 层级：Adapter 契约（通道→账车接线）＋纯单元（写者参数）。
// PR-204 裁定「与其他域一致」的回归钉：文章正文写必须搭 vault-git-ledger 账车，
// 关联账本写按其落点通道记账（vault 侧＝账车；仓内主源＝repo-schema-io 的 git 即账，无账车语义）。
// 撤线自证：任一处回填 noLedger: true → 对应断言即红（本文件此前无覆盖＝全域唯一未记账内容写的原因）。
const assert = require("assert");
const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { createArticleAssociationService } = require("../article-association-service.cjs");
const { initVaultIO, resetVaultIO } = require("../../../shared/vault-io.cjs");
const { parseEntityDocument } = require("../../../shared/yaml-frontmatter.cjs");

const ARTICLE_REL = path.join("知识库", "raw", "precleaned", "guide.md");

function writeArticle(vaultPath) {
  const abs = path.join(vaultPath, ARTICLE_REL);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, ["---", "article_id: ART-1", "title: Guide", "product: AnyShare", 'version: "7.0"', "module: fixture", "doc-type: 用户手册", "article_type: 最佳实践", "category-path: ops.maintain", "---", "", "# Guide"].join("\n") + "\n");
  return abs;
}

function catalogFor(vaultPath) {
  return function () {
    const abs = path.join(vaultPath, ARTICLE_REL);
    const raw = fs.readFileSync(abs, "utf8");
    const doc = parseEntityDocument(raw, abs);
    return { articles: [{ articleId: doc.frontmatter.article_id, title: doc.frontmatter.title, ownerSourcePath: "知识库/raw/precleaned/guide.md", sourceHash: "sha256:" + crypto.createHash("sha256").update(raw).digest("hex"), product: String(doc.frontmatter.product), version: String(doc.frontmatter.version), componentIds: [], associations: doc.frontmatter.architecture_associations || [] }] };
  };
}

/** 账车替身：只记录「通道交给账车什么」，不跑 git（git 本体由 vault-git-ledger 自己的测试管）。 */
function captureLedger() {
  const calls = [];
  return {
    calls,
    markSystemFile() {},
    isSystemFile() { return false; },
    scheduleLedger(domain, summary, files) { calls.push({ domain, summary, files }); },
  };
}

/** 夹具：vault 在 tmp；schemaDir 由调用方决定钉在 vault 内（vault 通道）还是 vault 外（仓内通道）。 */
function fixture(t, { schemaInsideVault }) {
  const previousPin = process.env.THESCHEMA_DIR;
  const vaultPath = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "aa-ledger-"));
  const schemaDir = schemaInsideVault ? path.join(vaultPath, "知识库", "TheSchema") : fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "aa-ledger-schema-"));
  process.env.THESCHEMA_DIR = schemaDir;
  fs.mkdirSync(path.join(vaultPath, "知识库"), { recursive: true });
  const ledger = captureLedger();
  initVaultIO({ vaultPath, gitLedger: ledger });
  const articleAbs = writeArticle(vaultPath);
  t.after(() => {
    resetVaultIO();
    if (previousPin === undefined) delete process.env.THESCHEMA_DIR; else process.env.THESCHEMA_DIR = previousPin;
    fs.rmSync(vaultPath, { recursive: true, force: true });
    if (!schemaInsideVault) fs.rmSync(schemaDir, { recursive: true, force: true });
  });
  return { vaultPath, schemaDir, articleAbs, ledger };
}

function saveOnce(service, request) {
  const preview = service.preview(request);
  return service.save(preview.fileRevision, request);
}

test("生产领土态（账本住仓内主源）：正文写搭账车，账本写走 git 即账通道不重复交账车", function (t) {
  const { vaultPath, articleAbs, ledger } = fixture(t, { schemaInsideVault: false });
  const service = createArticleAssociationService({ vaultPath, listFormalArticles: catalogFor(vaultPath), getGraph: () => ({ nodes: [{ id: "gateway" }] }), getRegistry: () => ({ products: {} }) });
  saveOnce(service, { articleId: "ART-1", action: "add", componentIds: ["gateway"], versionIds: [] });
  const summaries = ledger.calls.map((c) => c.summary);
  assert.ok(summaries.includes("文章源文件写回"), "正文写必须交账车（与其他域同口径）");
  assert.equal(ledger.calls.filter((c) => c.summary === "文章源文件写回")[0].domain, "workflow");
  assert.ok(!summaries.includes("关联决策账本写回"), "仓内主源的账本写不经 vault 账车——git 即账由 repo-schema-io 承担，交两次＝双记");
  const files = ledger.calls.filter((c) => c.summary === "文章源文件写回")[0].files;
  assert.equal(files[0], articleAbs, "账车收到的是被写的文章绝对路径");
});

test("唯一门形态：账本写只经仓内通道（钉扎领地亦然），账户只收内容写那一笔", function (t) {
  // WP-079 收口：TheSchema 文件的写不再分「vault 落点走 vault-io」一途——vault 侧未钉扎即 fail-closed，
  // 钉扎领地内亦由 repo-schema-io 承接（git 即账）。故账车里永远只有内容写，不会因主源翻面而少记或多记。
  const { vaultPath, schemaDir, ledger } = fixture(t, { schemaInsideVault: true });
  const service = createArticleAssociationService({ vaultPath, listFormalArticles: catalogFor(vaultPath), getGraph: () => ({ nodes: [{ id: "gateway" }] }), getRegistry: () => ({ products: {} }) });
  saveOnce(service, { articleId: "ART-1", action: "add", componentIds: ["gateway"], versionIds: [] });
  const summaries = ledger.calls.map((c) => c.summary);
  assert.deepEqual(summaries, ["文章源文件写回"], "账车只该收到内容写这一笔——账本写不交账车（防同域双记）");
  assert.ok(fs.existsSync(path.join(schemaDir, "article_associations.yaml")), "账本落钉扎领地（仓内通道）");
});
test("审计写失败触发的回滚写同样搭账车（回滚也是内容状态变化）", function (t) {
  const { vaultPath, ledger } = fixture(t, { schemaInsideVault: false });
  const service = createArticleAssociationService({
    vaultPath, listFormalArticles: catalogFor(vaultPath),
    getGraph: () => ({ nodes: [{ id: "gateway" }] }), getRegistry: () => ({ products: {} }),
    writeAuditRaw() { throw Object.assign(new Error("audit down"), { code: "ARTICLE_ASSOCIATIONS_WRITE_FAILED", status: 500 }); },
  });
  assert.throws(() => saveOnce(service, { articleId: "ART-1", action: "add", componentIds: ["gateway"], versionIds: [] }));
  assert.ok(ledger.calls.some((c) => c.summary === "文章源文件回滚"), "回滚写须入账车（否则盘面回滚无痕）");
});
