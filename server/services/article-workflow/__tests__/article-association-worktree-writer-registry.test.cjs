const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const test = require("node:test");
const YAML = require("yaml");

// seq180（红灯证据工具）：main.cjs:367 文章映射 save 装配的 getRegistry 裸引用修复。
// 后端 reader readVersionRegistry(vaultPath) 是带参函数（version-registry-reader.cjs:93），
// 消费端 article-association-service.cjs:129/157 零参调用 getRegistry()——main.cjs:367
// `getRegistry: readVersionRegistry` 裸引用使 vaultPath=undefined → getVersionsFilePath(undefined)
// 抛 TypeError("The \"path\" argument must be of type string") → 文章映射 save 全链崩。
// 实现前本文件为红灯（用例一/二断言失败），实现后转绿（行为级红灯证据，规则 28 全环境层）。

const { createWorktreeAssociationWriter } = require("../article-association-worktree-writer.cjs");
const { readVersionRegistry, revision } = require("../../../shared/version-registry-reader.cjs");

const MAIN_CJS = fs.readFileSync(path.join(__dirname, "..", "..", "..", "main.cjs"), "utf8");

function makeFixtureVault(t) {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "seq180-registry-"));
  t.after(function () { fs.rmSync(vaultPath, { recursive: true, force: true }); });
  const dir = path.join(vaultPath, "知识库", "raw", "precleaned");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "guide.md"), [
    "---",
    "article_id: ART-1",
    "title: Guide",
    "product: AnyShare",
    "version: 7.0",
    "module: fixture",
    "doc-type: 用户手册",
    "article_type: 最佳实践",
    "category-path: ops.maintain",
    "---",
    "",
    "# Guide",
    "",
  ].join("\n"), "utf8");
  const schemaDir = path.join(vaultPath, "知识库", "TheSchema");
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.writeFileSync(path.join(schemaDir, "versions.yaml"), YAML.stringify({
    products: { AnyShare: { versions: [{ id: "7.0", label: "AnyShare 7.0", status: "draft" }] } },
  }), "utf8");
  // schema-config 身份（canonicalizeRegistryProducts → resolveArchitectureProduct 需要）
  fs.writeFileSync(path.join(schemaDir, "enums.yaml"), YAML.stringify({
    architecture_projection: { product: "AnyShare", version: "7.0" },
  }), "utf8");
  // formal article（scanFormalReleaseSources 扫 知识库/wiki/articles，要求 article_id 身份）
  const formalDir = path.join(vaultPath, "知识库", "wiki", "articles");
  fs.mkdirSync(formalDir, { recursive: true });
  fs.writeFileSync(path.join(formalDir, "guide.md"), [
    "---",
    "article_id: ART-1",
    "title: Guide",
    "product: AnyShare",
    "version: 7.0",
    "---",
    "",
    "# Guide",
    "",
  ].join("\n"), "utf8");
  return vaultPath;
}

function makeRequest() {
  return { articleId: "ART-1", action: "replace", componentIds: [], versionIds: [] };
}

test("seq180: bare getRegistry reference reproduces the vaultPath=undefined TypeError (regression negative)", function (t) {
  const vaultPath = makeFixtureVault(t);
  // 复刻修复前 main.cjs:367 裸引用形态：把带参函数直接作为零参 port 传入——
  // 本用例恒为负例（钉住 bug 机理防回归认知）：零参调用 readVersionRegistry(undefined)
  // 必须暴露 TypeError，证明裸引用形态确实会崩、修复（用例二/三的闭包形态）是必要的。
  const writer = createWorktreeAssociationWriter({
    vaultPath,
    operatorContext: { getOperatorId: () => "seq180-tester" },
    getGraph: () => ({ nodes: [] }),
    getRegistry: readVersionRegistry,
  });
  const previewRevision = "sha256:" + "a".repeat(64);
  assert.throws(function () {
    writer.save(previewRevision, makeRequest());
  }, function (error) {
    // SPEC-023 波 1：裸引用形态现由 resolver 显式拦截（原为 path.join 隐式 TypeError——机理等价，信息更显式）
    return error instanceof TypeError && /THESCHEMA_ROOT_UNRESOLVED|path.*argument|undefined/i.test(error.message);
  }, "裸引用形态必须暴露 vaultPath=undefined TypeError（修复必要性的机器证明）");
});

test("seq180: main.cjs must assemble getRegistry as a zero-arg closure bound to vaultPath", function () {
  // 静态装配断言：save 装配行必须是零参闭包形态（同族先例 main.cjs:309/319
  // `getRegistry: () => versionRegistryService.getRegistry()`），禁止裸函数引用。
  const barePattern = /articleAssociationService\s*=\s*\{[\s\S]*?getRegistry:\s*readVersionRegistry\s*[,}]/;
  assert.match(MAIN_CJS, /articleAssociationService/, "main.cjs 必须装配 articleAssociationService");
  assert.doesNotMatch(MAIN_CJS, barePattern,
    "main.cjs save 装配禁止 getRegistry: readVersionRegistry 裸引用（须零参闭包 () => readVersionRegistry(vaultPath)）");
  assert.match(MAIN_CJS, /getRegistry:\s*\(\)\s*=>\s*readVersionRegistry\(vaultPath\)/,
    "main.cjs save 装配必须是 () => readVersionRegistry(vaultPath) 零参闭包形态");
});

test("seq180: closure-bound getRegistry reads the fixture registry through the save chain", function (t) {
  const vaultPath = makeFixtureVault(t);
  // WP-079 唯一门：本例会写 article_associations.yaml（TheSchema 文件），须显式钉扎其自含领地才合法
  // （A1-2 在册断言：未钉扎的 vault 侧落点 fail-closed）。其余两例不写账本，故不钉——负例正是要裸引用炸掉。
  const prevPin = process.env.THESCHEMA_DIR;
  process.env.THESCHEMA_DIR = path.join(vaultPath, "知识库", "TheSchema");
  t.after(function () { if (prevPin === undefined) delete process.env.THESCHEMA_DIR; else process.env.THESCHEMA_DIR = prevPin; });
  const writer = createWorktreeAssociationWriter({
    vaultPath,
    operatorContext: { getOperatorId: () => "seq180-tester" },
    getGraph: () => ({ nodes: [] }),
    getRegistry: () => readVersionRegistry(vaultPath),
  });
  const request = makeRequest();
  // revision 绑定真实文章内容（save 的乐观锁校验 fileRevision）
  const previewRevision = revision(fs.readFileSync(path.join(vaultPath, "知识库", "raw", "precleaned", "guide.md"), "utf8"));
  const saved = writer.save(previewRevision, request);
  // registry 真被消费：versions.yaml 的 AnyShare/7.0 经 getRegistry 闭包进入 versionOptions
  assert.ok(saved.versionOptions.some((item) => item.product === "AnyShare" && item.version === "7.0"),
    "save 链必须经 getRegistry 闭包读到 fixture versions.yaml 的产品版本");
  assert.equal(saved.decisions.length, 1);
  assert.equal(saved.decisions[0].articleId, "ART-1");
});
