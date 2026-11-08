// @tests: WP-041——投放自动链（监听桥→validate+promote）判定/去重/容错单测＋真链集成（yaml 缺席环境显式 skip）
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { resolvePythonPath } = require("../../../../server/shared/python-path.cjs");

const { createDraftDropAutomation } = require("../draft-drop-automation.cjs");
const { createArticleWorkflowService } = require("../article-workflow-service.cjs");

function fixture() {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "draft-drop-"));
  fs.mkdirSync(path.join(vaultPath, "知识库", "raw", "drafts", "投稿"), { recursive: true });
  fs.mkdirSync(path.join(vaultPath, "知识库", "raw", "precleaned"), { recursive: true });
  fs.mkdirSync(path.join(vaultPath, "知识库", "TheSchema"), { recursive: true });
  fs.writeFileSync(path.join(vaultPath, "知识库", "TheSchema", "enums.yaml"), [
    "domains:", "  ops: 运维", "subdomains:", "  ops: [maintain]", "modules:", "  Gateway: {}",
    "article_types: [排错指南]", "doc_types: [用户手册]", "architecture_projection:", "  product: AnyShare", "  version: main",
  ].join("\n") + "\n");
  fs.writeFileSync(path.join(vaultPath, "知识库", "TheSchema", "versions.yaml"), [
    "schema_version: 1", "products:", "  AnyShare:", "    versions:", "      - id: 7.0.1.1",
    "        label: AnyShare 7.0.1.1", "        status: draft", "        aliases: []", "        snapshot: null",
  ].join("\n") + "\n");
  // 解析物在场（校验器必填集单源——与 parity 夹具同法：THESCHEMA_DIR 钉扎领地，SPEC-021 合规）
  fs.writeFileSync(path.join(vaultPath, "知识库", "TheSchema", "fields.yaml"), [
    "schema_version: 1", "fields:",
    ...["title", "module", "product", "article_type", "doc-type", "version", "category-path"].map((name) =>
      `  - name: ${name}\n    label: 测试\n    type: string\n    required: 是\n    scope: [entity, article]\n    layer: 内容属性`),
    "",
  ].join("\n") + "\n");
  execFileSync("node", [path.resolve(__dirname, "../../../../scripts/quality/project-resolved-domains.mjs")], {
    env: { ...process.env, VAULT_PATH: vaultPath, THESCHEMA_DIR: path.join(vaultPath, "知识库", "TheSchema"), VAULT_GIT_LEDGER_DISABLE: "1" },
    encoding: "utf8",
  });
  return vaultPath;
}

function validArticle(id, title) {
  return [
    "---", `article_id: ${id}`, `title: ${title}`, "product: AnyShare",
    "version: 7.0.1.1", "module: Gateway", "article_type: 排错指南",
    "doc-type: 用户手册", "category-path: ops:maintain", `tags: [${title}]`,
    "---", "", `# ${title}\n\n正文`,
  ].join("\n");
}

const quietLogger = { info() {}, warn() {}, error() {} };

test("判定：仅 drafts 根下在盘 .md 命中（非 md／precleaned 路径／已消失文件零触发）", () => {
  const vaultPath = fixture();
  try {
    const auto = createDraftDropAutomation({ vaultPath, articleWorkflowService: {}, logger: quietLogger });
    const drop = path.join(vaultPath, "知识库", "raw", "drafts", "投稿", "a.md");
    fs.writeFileSync(drop, "x", "utf8");
    assert.equal(auto.isDroppedDraftMd(drop), true, "投稿 .md 命中");
    assert.equal(auto.isDroppedDraftMd(path.join(vaultPath, "知识库", "raw", "precleaned", "a.md")), false, "precleaned 不命中");
    assert.equal(auto.isDroppedDraftMd(path.join(vaultPath, "知识库", "raw", "drafts", "投稿", "a.pdf")), false, "非 md 不命中");
    assert.equal(auto.isDroppedDraftMd(path.join(vaultPath, "知识库", "raw", "drafts", "投稿", "gone.md")), false, "消失文件（unlink）不命中");
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("链路与去重：命中路径串行 validate→promote；同文件在链中重复事件只跑一条；失败不外抛", async () => {
  const vaultPath = fixture();
  try {
    const drop = path.join(vaultPath, "知识库", "raw", "drafts", "投稿", "a.md");
    fs.writeFileSync(drop, "x", "utf8");
    const calls = [];
    const slowValidate = () => new Promise((resolve) => setTimeout(() => { calls.push("validate"); resolve(); }, 20));
    const svc = {
      validateDraft: (rel) => { calls.push(["validate", rel]); return slowValidate(); },
      promoteDraft: (rel, confirmed) => { calls.push(["promote", rel, confirmed]); return Promise.resolve({}); },
    };
    const auto = createDraftDropAutomation({ vaultPath, articleWorkflowService: svc, logger: quietLogger });
    // 同文件突发两事件：第二份在链中被 in-flight 去重
    await Promise.all([auto.onExternalWrite([drop]), auto.onExternalWrite([drop])]);
    const validates = calls.filter((c) => Array.isArray(c) && c[0] === "validate");
    assert.equal(validates.length, 1, "去重后只跑一条链");
    assert.deepEqual(validates[0], ["validate", "知识库/raw/drafts/投稿/a.md"]);
    const promotes = calls.filter((c) => Array.isArray(c) && c[0] === "promote");
    assert.equal(promotes.length, 1);
    assert.equal(promotes[0][2], true, "promote 显式确认");
    // 失败吞掉不外抛：后续事件继续可处理
    const failing = { validateDraft: () => Promise.reject(new Error("boom")), promoteDraft: () => Promise.resolve() };
    const auto2 = createDraftDropAutomation({ vaultPath, articleWorkflowService: failing, logger: quietLogger });
    await auto2.onExternalWrite([drop]);
    assert.ok(true, "失败被吞，未外抛");
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("真链集成：投放 .md → 桥 → 头信息建态＋precleaned 出现且草稿退场（真进程真文件）", { timeout: 120_000 }, async (t) => {
  let yamlOk = true;
  try { execFileSync(resolvePythonPath(), ["-c", "import yaml"], { stdio: "ignore" }); } // ADR-002：解释器单源
  catch (_e) { yamlOk = false; }
  if (!yamlOk) t.skip("环境 python3 缺 PyYAML——真链集成层跳过（非假绿；该层由 e2e fixture 环境覆盖）");

  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  const service = createArticleWorkflowService({ vaultPath, logger: quietLogger });
  const auto = createDraftDropAutomation({ vaultPath, articleWorkflowService: service, logger: quietLogger });
  const draftAbs = path.join(vaultPath, "知识库", "raw", "drafts", "投稿", "dropped.md");
  fs.writeFileSync(draftAbs, validArticle("dropped-article", "投放件"), "utf8");

  await auto.onExternalWrite([draftAbs]);

  const precleanedAbs = path.join(vaultPath, "知识库", "raw", "precleaned", "dropped.md");
  assert.ok(fs.existsSync(precleanedAbs), "候选已入工作区");
  assert.ok(!fs.existsSync(draftAbs), "草稿已退场");
  const archiveDir = path.join(vaultPath, "知识库", "raw", "archive", "投稿");
  const archived = fs.existsSync(archiveDir) ? fs.readdirSync(archiveDir).some((f) => f.endsWith("-dropped.md")) : false;
  assert.ok(archived, "原文溯源锚已归档（content-addressed）");
  const tasks = service.listUploads(10).items;
  assert.ok(tasks.some((task) => (task.draftPath || "").endsWith("投稿/dropped.md")), "任务账建态");
});
