// validate-article 金标回归夹具（SPEC-022 波 C）：
// Python 校验器已退役——其终版行为于退役前实跑落档为 validate-article-golden.json（21 篇语料＋四探测＋stamp）。
// 本夹具跑 Node 唯一实现 vs 金标：除「登记的有意变更」外逐字相等；语料与金标冻结同变（改语料须手工同步金标）。
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { spawnSync, execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const YAML = require("yaml");
const { resolvePythonPath } = require("../../../server/shared/python-path.cjs");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const PY = path.join(ROOT, "scripts", "vault-runtime", "validate-article.py");
const CLIENT = path.join(ROOT, "scripts", "vault-runtime", "schema-write-client.mjs");
const GENERATOR = path.join(ROOT, "scripts", "quality", "project-resolved-domains.mjs");
const GOLDEN = JSON.parse(fs.readFileSync(path.join(__dirname, "validate-article-golden.json"), "utf8"));

function buildVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "parity-"));
  const schema = path.join(root, "知识库", "TheSchema");
  fs.mkdirSync(schema, { recursive: true });
  fs.writeFileSync(path.join(schema, "enums.yaml"), [
    "modules:",
    "  主模块: {label: 主}",
    "domains:",
    "  ref: 参考资料",
    "subdomains:",
    "  ref:",
    "    - id: overview",
    "article_types: [排错指南]",
    "doc_types: [用户手册]",
    "tags: {}",
    "disabled_tags: []",
    "lifecycle:",
    "  status: [灰度, 在线, 退役, 已驳回]",
    "  default_status: 灰度",
    "  review_cycle: [30d]",
    "arch_categories: []",
    "layers: []",
    "architecture_projection:",
    "  product: ''",
    "  version: ''",
    "  product_aliases: {}",
    "  layer_aliases: {}",
    "  category_aliases: {}",
    "  subdomain_aliases: {}",
    "",
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(schema, "versions.yaml"), "schema_version: 1\nproducts: {}\n", "utf8");
  fs.writeFileSync(path.join(schema, "fields.yaml"), [
    "schema_version: 1",
    "fields:",
    ...["title", "module", "product", "article_type", "doc-type", "version", "category-path"].map((name) =>
      `  - name: ${name}\n    label: 测试\n    type: string\n    required: 是\n    scope: [entity, article]\n    layer: 内容属性`),
    `  - name: status\n    label: 状态\n    type: enum\n    required: 否\n    scope: [article]\n    layer: 管理属性\n    value_domain: { source: lifecycle, segment: lifecycle.status, resolve: { op: values } }`,
    "",
  ].join("\n"), "utf8");
  // 解析物（两端的必填集与 status 值域单源）——V11 收编后投影写经 repoWrite 目的地执法，
  // 夹具 vault 的 TheSchema 须显式钉 THESCHEMA_DIR（钉扎领地合法；隐式窗口写被 SPEC-021 拦截）
  execFileSync("node", [GENERATOR], { env: { ...process.env, VAULT_PATH: root, THESCHEMA_DIR: path.join(root, "知识库", "TheSchema"), VAULT_GIT_LEDGER_DISABLE: "1" }, encoding: "utf8" });
  // wikilink 目标页
  fs.mkdirSync(path.join(root, "知识库", "wiki", "entities"), { recursive: true });
  fs.writeFileSync(path.join(root, "知识库", "wiki", "entities", "existing-entity.md"), "---\ntitle: existing-entity\n---\n\n实体。\n", "utf8");
  return root;
}

function writeArticle(dir, name, fmLines, bodyLines) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), ["---", ...fmLines, "---", "", ...bodyLines, ""].join("\n"), "utf8");
}

const BASE_FM = [
  "title: REPLACE-TITLE",
  "module: 主模块",
  "product: 通用",
  "article_type: 排错指南",
  "doc-type: 用户手册",
  "version: '7.0'",
  "category-path: ref:overview",
  "tags:",
  "  - t1",
  "author: 张三",
];
const BASE_BODY = ["正文，链接 [[existing-entity]]。"];

function corpus(vault) {
  const dir = path.join(vault, "知识库", "raw", "precleaned");
  const mk = (name, fmOverride, body) => {
    const fm = fmOverride === null ? BASE_FM.slice(1) : BASE_FM.slice();
    for (const [k, v] of Object.entries(fmOverride || {})) {
      const idx = fm.findIndex((l) => l.startsWith(`${k}:`) || l.startsWith(`${k} `));
      if (v === null) { if (idx >= 0) fm.splice(idx, 1); }
      else if (idx >= 0) fm[idx] = v; // v＝完整 "key: value" 行（裸值会断 YAML——差分双端同归于空＝假同构）
      else fm.push(v);
    }
    writeArticle(dir, name, fm, body || BASE_BODY);
  };
  // 覆盖值＝整行替换（v 必须是完整 "key: value" 行；null＝删除该行）
  mk("clean.md", { title: "title: clean" }, ["正文 [[existing-entity]]"]);
  mk("missing-product.md", { title: "title: missing-product", product: null });
  mk("title-mismatch.md", { title: "title: 另一个标题" });
  mk("module-bad.md", { title: "title: module-bad", module: "module: 非法模块" });
  mk("module-wikilink.md", { title: "title: module-wikilink", module: 'module: "[[主模块]]"' });
  mk("module-empty.md", { title: "title: module-empty", module: 'module: ""' });
  mk("version-bad.md", { title: "title: version-bad", version: "version: v7" });
  mk("version-range.md", { title: "title: version-range", version: 'version: "9.0 → 7.0"' });
  mk("tags-empty.md", { title: "title: tags-empty", tags: null });
  mk("wikilink-missing.md", { title: "title: wikilink-missing" }, ["正文 [[不存在的页面]] 结束"]);
  mk("image-bad.md", { title: "title: image-bad" }, ["截图 ![[截图.png]] 嵌入"]);
  mk("status-lifecycle.md", { title: "title: status-lifecycle", status: "status: 灰度" });
  mk("status-entity-trio.md", { title: "title: status-entity-trio", status: "status: 有效" });
  mk("status-empty.md", { title: "title: status-empty", status: null });
  mk("doc-type-bad.md", { title: "title: doc-type-bad", "doc-type": "doc-type: 手册X" });
  mk("article-type-bad.md", { title: "title: article-type-bad", article_type: "article_type: 指南X" });
  mk("catpath-format.md", { title: "title: catpath-format", "category-path": 'category-path: "ref-overview"' });
  mk("catpath-troubleshoot.md", { title: "title: catpath-troubleshoot", "category-path": 'category-path: "troubleshoot:net"' });
  mk("catpath-bad-domain.md", { title: "title: catpath-bad-domain", "category-path": 'category-path: "nope:overview"' });
  mk("catpath-bad-sub.md", { title: "title: catpath-bad-sub", "category-path": 'category-path: "ref:noxist"' });
  mk("catpath-bad-topic.md", { title: "title: catpath-bad-topic", "category-path": 'category-path: "ref:overview:Bad_Topic"' });
  mk("version-numeric.md", { title: "title: version-numeric", version: "version: 7.0" }); // 红队 H1：未引号纯数值——登记变更②
  return dir;
}

/** 登记的有意变更（SPEC-022 波 A）：file → 预测差异（py→node）。仲裁＝契约 fields.yaml。 */
const INTENTIONAL = {
  "status-lifecycle.md": { kind: "py-only-warn", match: /status 值不标准/ }, // 变更①：Python 实体三值误伤；契约＝lifecycle → Node 不告
  "status-entity-trio.md": { kind: "node-only-warn", match: /status 值不标准/ }, // 变更①反向：契约文章侧不认实体三值 → Node 告
  "version-numeric.md": { kind: "node-only-error", match: /version '7' 格式非法/ }, // 变更②（红队 H1）：纯数值标量按 JS 数文本判——契约版本 id 恒为字符串
};

function runNode(vault, file, extra = []) {
  const r = spawnSync("node", [CLIENT, "validate-article", "--file", file, ...extra, "--vault", vault], { env: { ...process.env, VAULT_GIT_LEDGER_DISABLE: "1" }, encoding: "utf8", timeout: 60_000 });
  let payload = null;
  try { payload = JSON.parse(r.stdout); } catch { payload = { raw: r.stdout, stderr: r.stderr }; }
  return { code: r.status, payload };
}

test("差分全量：22 篇语料逐篇对账（除登记变更外逐字相等）", () => {
  const vault = buildVault();
  const dir = corpus(vault);
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".md")).sort();
  assert.ok(files.length >= 20, `语料规模 ${files.length}`);
  for (const fname of files) {
    const file = path.join(dir, fname);
    const py = GOLDEN.files[fname];
    const nd = runNode(vault, file);
    const intentional = INTENTIONAL[fname];
    if (!py) assert.fail(`${fname} 不在金标——改语料须同步金标`);
    if (!intentional) {
      assert.deepEqual(nd.payload, py.payload, `${fname} 必须与金标逐字一致`);
      assert.equal(nd.code, py.exit, `${fname} 退出码与金标一致`);
    } else {
      // 有意变更：按预测差异断言（金标＝Python 终版行为）
      const list = intentional.kind.endsWith("error") ? "errors" : "warnings";
      const pyList = py.payload[list] || [];
      const ndList = nd.payload[list] || [];
      const pyHit = pyList.some((w) => intentional.match.test(w));
      const ndHit = ndList.some((w) => intentional.match.test(w));
      if (intentional.kind.startsWith("py-only")) {
        assert.ok(pyHit && !ndHit, `${fname} 预测：仅 Python ${list} 命中`);
      } else {
        assert.ok(ndHit && !pyHit, `${fname} 预测：仅 Node ${list} 命中`);
      }
      // 其余消息（除登记项）仍须一致
      const strip = (arr) => (arr || []).filter((w) => !intentional.match.test(w));
      assert.deepEqual(strip(nd.payload.errors), strip(py.payload.errors), `${fname} errors（除登记项）`);
      assert.deepEqual(strip(nd.payload.warnings), strip(py.payload.warnings), `${fname} warnings（除登记项）`);
    }
  }
  fs.rmSync(vault, { recursive: true, force: true });
});

test("金标探测：author/quality/stale/untracked 汇总与金标一致（除 directory 字段）", () => {
  const vault = buildVault();
  const corpusDir = corpus(vault);
  // 探测对账剔除登记变更两篇（status 语义分叉属单篇对账面；机制面在其余 19 篇上须逐字同构）
  const dir = path.join(vault, "知识库", "raw", "det-corpus");
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(corpusDir)) {
    if (!INTENTIONAL[f]) fs.copyFileSync(path.join(corpusDir, f), path.join(dir, f));
  }
  const norm = (summary) => JSON.parse(JSON.stringify(summary, (k, v) => (k === "directory" ? undefined : v)));
  for (const flag of ["--detect-author-placeholders", "--detect-untracked-wikilinks", "--quality-summary", "--detect-stale"]) {
    const nd = spawnSync("node", [CLIENT, "validate-article", flag, dir, "--vault", vault], { env: { ...process.env, VAULT_GIT_LEDGER_DISABLE: "1" }, encoding: "utf8", timeout: 60_000 });
    const ndSummary = JSON.parse(nd.stdout);
    assert.deepEqual(norm(ndSummary), norm(GOLDEN.detectors[flag].summary), `${flag} 汇总与金标一致`);
    assert.equal(nd.status, GOLDEN.detectors[flag].exit, `${flag} 退出码与金标一致`);
  }
  fs.rmSync(vault, { recursive: true, force: true });
});

test("金标 stamp：校验章字段与退出码一致", () => {
  const vault = buildVault();
  const drafts = path.join(vault, "知识库", "raw", "drafts");
  fs.mkdirSync(drafts, { recursive: true });
  for (const name of ["nd-copy.md"]) {
    const fm = BASE_FM.filter((l) => !l.startsWith("status:")).map((l) => l.replace("REPLACE-TITLE", name.replace(".md", "")));
    writeArticle(drafts, name, fm, BASE_BODY);
  }
  const nd = runNode(vault, path.join(drafts, "nd-copy.md"), ["--stamp"]);
  assert.equal(nd.code, GOLDEN.stamp.exit);
  assert.equal(nd.payload.stamped, GOLDEN.stamp.payload.stamped);
  assert.deepEqual(nd.payload.errors, GOLDEN.stamp.payload.errors);
  assert.deepEqual(nd.payload.warnings, GOLDEN.stamp.payload.warnings);
  const ndFm = YAML.parse(fs.readFileSync(path.join(drafts, "nd-copy.md"), "utf8").split("---")[1]);
  const goldenFm = YAML.parse(GOLDEN.stamp.frontmatter);
  assert.equal(ndFm.validation_status, goldenFm.validation_status);
  assert.equal(ndFm.validation_errors, goldenFm.validation_errors);
  assert.equal(ndFm.validation_warnings, goldenFm.validation_warnings);
  fs.rmSync(vault, { recursive: true, force: true });
});

test("stamp 保形（红队 H1 加重项）：未引号数值 scalar 不被数值化改写", () => {
  const vault = buildVault();
  const drafts = path.join(vault, "知识库", "raw", "drafts");
  fs.mkdirSync(drafts, { recursive: true });
  const fm = BASE_FM.filter((l) => !l.startsWith("status:")).map((l) => l.replace("REPLACE-TITLE", "keep-shape").replace("version: '7.0'", "version: 7.0.5"));
  writeArticle(drafts, "keep-shape.md", fm, BASE_BODY);
  // 7.0.5 是字符串不受影响；再放一个纯数值段验证 stamp 保形
  const fm2 = fm.map((l) => l.replace("title: keep-shape", "title: keep-shape2"));
  fm2[fm2.indexOf("version: 7.0.5")] = "version: 7.0";
  writeArticle(drafts, "keep-shape2.md", fm2, BASE_BODY);
  const r = runNode(vault, path.join(drafts, "keep-shape2.md"), ["--stamp"]);
  assert.equal(r.code, 1); // 数值 version 判非法（登记变更②）——但 stamp 仍落
  const stamped = fs.readFileSync(path.join(drafts, "keep-shape2.md"), "utf8");
  assert.ok(/^version: 7\.0$/m.test(stamped), "原始 scalar 文本必须保形（不得改写为 7）");
  fs.rmSync(vault, { recursive: true, force: true });
});

test("边界契约：裸库软化（必填集空）与缺解析物 exit 2", () => {
  // ① 裸库：无 TheSchema → 必填软化（warn stderr），校验其余规则照跑，双端一致
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "parity-bare-"));
  fs.mkdirSync(path.join(bare, "知识库", "raw"), { recursive: true });
  const f1 = path.join(bare, "知识库", "raw", "x.md");
  fs.writeFileSync(f1, "---\ntitle: x\n---\n\n正文\n", "utf8");
  const emptyPin = fs.mkdtempSync(path.join(os.tmpdir(), 'parity-bare-pin-'));
  process.env.THESCHEMA_DIR = emptyPin; // 钉空目录——裸库软化语义（防 repo 回落）
  const nd1 = runNode(bare, f1);
  delete process.env.THESCHEMA_DIR;
  fs.rmSync(emptyPin, { recursive: true, force: true });
  assert.ok(nd1.payload.valid, "必填软化后无 ERROR");
  assert.deepEqual(nd1.payload.errors, [], "裸库软化：无必填 ERROR");

  // ② TheSchema 在而解析物缺 → 双端 exit 2 同文案
  const half = fs.mkdtempSync(path.join(os.tmpdir(), "parity-half-"));
  fs.mkdirSync(path.join(half, "知识库", "TheSchema"), { recursive: true });
  fs.writeFileSync(path.join(half, "知识库", "TheSchema", "enums.yaml"), "modules: {}\n", "utf8");
  fs.mkdirSync(path.join(half, "知识库", "raw"), { recursive: true });
  const f2 = path.join(half, "知识库", "raw", "x.md");
  fs.writeFileSync(f2, "---\ntitle: x\n---\n\n正文\n", "utf8");
  const nd2 = spawnSync("node", [CLIENT, "validate-article", "--file", f2, "--vault", half], { env: { ...process.env }, encoding: "utf8", timeout: 60_000 });
  assert.equal(nd2.status, 2, "缺解析物必须 exit 2（fail-closed）");
  assert.ok(String(nd2.stderr).includes("resolved-domains.json 不存在"), String(nd2.stderr));

  fs.rmSync(bare, { recursive: true, force: true });
  fs.rmSync(half, { recursive: true, force: true });
});
