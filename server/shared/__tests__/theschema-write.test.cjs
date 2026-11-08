// 层级：纯单元＋Adapter 契约（唯一门形态）。
// WP-079 收口断言：TheSchema 文件的写只经仓内通道（主源 data/theschema ∪ 显式钉扎 THESCHEMA_DIR 领地），
// vault 侧落点未被钉扎即 fail-closed——这是 SPEC-012 F1「经合法通道写回 vault 须构造性不可能」的立法原意
// 与 A1-2 在册断言（迁移窗翻回＝读得到、写不进）在咽喉层的等价钉，不因换实现而松。
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const { writeTheSchemaFile, replaceTheSchemaFile } = require("../theschema-write.cjs");
const { contentRevision, ABSENT_REVISION } = require("../vault-io.cjs");

const LEDGER = "schema_version: 1\ndecisions: []\n";

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), prefix));
}

/** 钉扎一块仓外自含领地（repo-schema-io 认的合法领地），并备好 vault 根。 */
function pinnedTerritory(t) {
  const previous = process.env.THESCHEMA_DIR;
  const base = tmpDir("throat-");
  process.env.THESCHEMA_DIR = path.join(base, "TheSchema");
  t.after(() => {
    if (previous === undefined) delete process.env.THESCHEMA_DIR;
    else process.env.THESCHEMA_DIR = previous;
    fs.rmSync(base, { recursive: true, force: true });
  });
  return path.resolve(process.env.THESCHEMA_DIR);
}

test("钉扎领地内更新写：凭据齐即落盘，内容为唯一事实", function (t) {
  const dir = pinnedTerritory(t);
  const target = path.join(dir, "article_associations.yaml");
  writeTheSchemaFile(target, LEDGER, { expectedContentHash: ABSENT_REVISION, summary: "首建" });
  assert.equal(fs.readFileSync(target, "utf8"), LEDGER);
});

test("缺凭据即拒（不盲覆盖），磁盘零落盘", function (t) {
  const dir = pinnedTerritory(t);
  const target = path.join(dir, "article_associations.yaml");
  writeTheSchemaFile(target, LEDGER, { expectedContentHash: ABSENT_REVISION, summary: "首建" });
  assert.throws(
    () => writeTheSchemaFile(target, "decisions: [污染]\n", { summary: "无凭据覆盖" }),
    (error) => error.code === "SCHEMA_REVISION_REQUIRED",
    "更新写凭据必填（PR-083 同闸形）",
  );
  assert.equal(fs.readFileSync(target, "utf8"), LEDGER, "拒绝后磁盘未被覆盖");
});

test("过期基线即拒并回 409 形冲突码，原内容不丢", function (t) {
  const dir = pinnedTerritory(t);
  const target = path.join(dir, "article_associations.yaml");
  writeTheSchemaFile(target, LEDGER, { expectedContentHash: ABSENT_REVISION, summary: "首建" });
  const second = "schema_version: 1\ndecisions:\n  - articleId: ART-2\n";
  writeTheSchemaFile(target, second, { expectedContentHash: contentRevision(LEDGER), summary: "追加" });
  assert.throws(
    () => writeTheSchemaFile(target, "盲覆盖\n", { expectedContentHash: contentRevision(LEDGER), summary: "拿过期首建基线" }),
    (error) => error.code === "SCHEMA_REVISION_CONFLICT" && error.status === 409,
  );
  assert.match(fs.readFileSync(target, "utf8"), /ART-2/, "冲突写未落盘");
});

test("vault 侧落点未钉扎 → fail-closed 且册内零落盘（A1-2 语义在咽喉层不失）", function (t) {
  const previous = process.env.THESCHEMA_DIR;
  delete process.env.THESCHEMA_DIR; // 未钉扎＝生产形态：合法领地只有仓内 data/theschema
  const vault = tmpDir("throat-vault-");
  t.after(() => {
    if (previous !== undefined) process.env.THESCHEMA_DIR = previous;
    fs.rmSync(vault, { recursive: true, force: true });
  });
  const vaultSide = path.join(vault, "知识库", "TheSchema", "enums.yaml");
  assert.throws(
    () => writeTheSchemaFile(vaultSide, LEDGER, { expectedContentHash: ABSENT_REVISION, summary: "迁移窗翻回态" }),
    (error) => error.code === "REPO_SCHEMA_DESTINATION",
    "TheSchema 文件不得经咽喉写回 vault（SPEC-012 F1 立法原意）",
  );
  assert.equal(fs.existsSync(vaultSide), false, "拒写即零落盘");
  assert.equal(fs.existsSync(path.dirname(vaultSide)), false, "连目录都不该被建出来");
});

test("全权替换同样单路：钉扎领地可用、vault 侧未钉扎即拒", function (t) {
  const dir = pinnedTerritory(t);
  const repoTarget = path.join(dir, "versions.yaml");
  replaceTheSchemaFile(repoTarget, "schema_version: 1\n", { summary: "注册表全权替换" });
  assert.equal(fs.readFileSync(repoTarget, "utf8"), "schema_version: 1\n", "生成器形态免凭据可整表替换");
  const previous = process.env.THESCHEMA_DIR;
  delete process.env.THESCHEMA_DIR;
  const vault = tmpDir("throat-vault2-");
  t.after(() => {
    process.env.THESCHEMA_DIR = previous;
    fs.rmSync(vault, { recursive: true, force: true });
  });
  assert.throws(
    () => replaceTheSchemaFile(path.join(vault, "知识库", "TheSchema", "versions.yaml"), "x\n", { summary: "误写 vault" }),
    (error) => error.code === "REPO_SCHEMA_DESTINATION",
  );
});
