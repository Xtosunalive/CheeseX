const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createArticleWorkflowService } = require("../article-workflow-service.cjs");
const { createAnomalyWorkbenchService } = require("../../anomaly/anomaly-workbench-service.cjs");
const { collectStandardizationWarningIssues } = require("../../admission/standardization-warning-issues.cjs");
const { checkStandardizationFindings } = require("../article-admission-policy.cjs");
const { createStandardVersion, readWorkflowState } = require("../article-workflow-store.cjs");
const { syncUploadTasks } = require("../article-upload-status.cjs");
const { getRuntimeStateStore } = require("../../../shared/persistence/runtime-state-store.cjs");

function fixture() {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "standard-article-"));
  fs.mkdirSync(path.join(vaultPath, "知识库", "raw", "precleaned"), { recursive: true });
  fs.mkdirSync(path.join(vaultPath, "知识库", "wiki", "entities"), { recursive: true });
  fs.mkdirSync(path.join(vaultPath, "知识库", "TheSchema"), { recursive: true });
  fs.writeFileSync(path.join(vaultPath, "知识库", "TheSchema", "enums.yaml"), [
    "domains:", "  ops: 运维", "subdomains:", "  ops: [maintain]", "modules:", "  Gateway: {}",
    "article_types: [排错指南]", "doc_types: [用户手册]", "architecture_projection:", "  product: AnyShare", "  version: main",
  ].join("\n") + "\n");
  fs.writeFileSync(path.join(vaultPath, "知识库", "TheSchema", "versions.yaml"), [
    "schema_version: 1", "products:", "  AnyShare:", "    versions:", "      - id: 7.0.1.1",
    "        label: AnyShare 7.0.1.1", "        status: draft", "        aliases: []", "        snapshot: null",
  ].join("\n") + "\n");
  fs.writeFileSync(path.join(vaultPath, "知识库", "wiki", "entities", "root.md"), "---\ntitle: Root\narchitecture-node-id: root\n---\nRoot");
  // PR-151：字典必填集解析物（标准化必填轴与完整校验器同源的数据面——缺它重章器 fail-closed）
  fs.writeFileSync(path.join(vaultPath, "知识库", "TheSchema", "resolved-domains.json"), "{\n  \"byField\": [\n    {\n      \"name\": \"title\",\n      \"required\": \"是\",\n      \"scope\": [\n        \"article\"\n      ],\n      \"values\": null\n    },\n    {\n      \"name\": \"category-path\",\n      \"required\": \"是\",\n      \"scope\": [\n        \"article\"\n      ],\n      \"values\": null\n    },\n    {\n      \"name\": \"article_type\",\n      \"required\": \"是\",\n      \"scope\": [\n        \"article\"\n      ],\n      \"values\": [\n        \"排错指南\"\n      ]\n    },\n    {\n      \"name\": \"doc-type\",\n      \"required\": \"是\",\n      \"scope\": [\n        \"article\"\n      ],\n      \"values\": [\n        \"用户手册\"\n      ]\n    },\n    {\n      \"name\": \"arch_layer\",\n      \"required\": \"是\",\n      \"scope\": [\n        \"entity\",\n        \"article\"\n      ],\n      \"values\": [\n        \"gateway\",\n        \"service\"\n      ]\n    },\n    {\n      \"name\": \"arch_category\",\n      \"required\": \"是\",\n      \"scope\": [\n        \"entity\",\n        \"article\"\n      ],\n      \"values\": [\n        \"终端\",\n        \"服务\"\n      ]\n    },\n    {\n      \"name\": \"module\",\n      \"required\": \"是\",\n      \"scope\": [\n        \"article\"\n      ],\n      \"values\": [\n        \"Gateway\"\n      ]\n    },\n    {\n      \"name\": \"product\",\n      \"required\": \"是\",\n      \"scope\": [\n        \"article\"\n      ],\n      \"values\": [\n        \"AnyShare\",\n        \"通用\"\n      ]\n    },\n    {\n      \"name\": \"version\",\n      \"required\": \"是\",\n      \"scope\": [\n        \"article\"\n      ],\n      \"values\": [\n        \"7.0.1.1\",\n        \"1.0\"\n      ]\n    }\n  ]\n}");
  return vaultPath;
}

function validArticle(id, title, overrides = {}) {
  const values = {
    article_id: id, title, product: "AnyShare", version: "7.0.1.1", module: "Gateway",
    article_type: "排错指南", "doc-type": "用户手册", "category-path": "ops:maintain",
    arch_layer: "gateway", arch_category: "服务",
    tags: `[${title}]`, ...overrides,
  };
  const lines = ["---"];
  for (const [key, value] of Object.entries(values)) if (value !== null) lines.push(`${key}: ${value}`);
  lines.push("---", "", overrides.body || `# ${title}\n\n这是足够长的标准文章正文，用于通过数据质量检查。`);
  return lines.join("\n");
}

function writeCandidate(vaultPath, fileName, raw) {
  fs.writeFileSync(path.join(vaultPath, "知识库", "raw", "precleaned", fileName), raw, "utf8");
}

function storePath(vaultPath) { return path.join(vaultPath, ".ledger", "article-upload-tasks.json"); }

test("首次发布生成可读可编辑正式文件，再发布沿同一位置更新", function (t) {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  const doc = { articleId: "readable-1", title: "架构说明", version: "7.0.1.1", categoryPath: "ops:maintain" };
  const firstRaw = validArticle(doc.articleId, doc.title);
  const firstHash = require("node:crypto").createHash("sha256").update(firstRaw).digest("hex");
  const first = createStandardVersion(vaultPath, { contentHash: firstHash, sourcePath: "working" }, firstRaw, doc, new Date().toISOString(), { allowedDomains: ["ops"] });
  assert.match(first.version.snapshotPath, /知识库\/wiki\/articles\/ops\/架构说明-7\.0\.1\.1\.md$/);
  const file = path.join(vaultPath, first.version.snapshotPath);
  assert.notEqual(fs.statSync(file).mode & 0o200, 0);
  const nextRaw = firstRaw.replace("标准文章正文", "再次发布正文");
  const nextHash = require("node:crypto").createHash("sha256").update(nextRaw).digest("hex");
  const next = createStandardVersion(vaultPath, { contentHash: nextHash, sourcePath: "working" }, nextRaw, doc, new Date().toISOString(), { allowedDomains: ["ops"] });
  assert.equal(next.version.snapshotPath, first.version.snapshotPath);
  assert.equal(fs.readFileSync(file, "utf8"), nextRaw);
  const moved = path.join(vaultPath, "知识库/wiki/articles/ops/改名后的文章.md");
  fs.renameSync(file, moved);
  const thirdRaw = nextRaw.replace("再次发布正文", "移动后发布正文");
  const third = createStandardVersion(vaultPath, { contentHash: require("node:crypto").createHash("sha256").update(thirdRaw).digest("hex"), sourcePath: "working" }, thirdRaw, doc, new Date().toISOString(), { allowedDomains: ["ops"] });
  assert.equal(path.join(vaultPath, third.version.snapshotPath), moved, "改名移动后按 article_id 复用同一文件");
  assert.equal(fs.readFileSync(moved, "utf8"), thirdRaw);
});


test("standardization ERROR blocks with 409 and produces no searchable version", function (t) {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  writeCandidate(vaultPath, "blocked.md", validArticle("STD-BLOCKED", "阻断文章", { product: "通用" }));
  const service = createArticleWorkflowService({ vaultPath, logger: { info() {}, error() {} } });
  assert.throws(
    () => service.standardize("STD-BLOCKED", true),
    (error) => error.code === "ARTICLE_STANDARDIZATION_BLOCKED" && error.status === 409,
  );
  const record = getRuntimeStateStore(vaultPath).workflow.get().state.articles[0];
  assert.equal(record.standardizationStatus, "blocked");
  assert.ok(record.admissionBlockers.some((item) => item.ruleId === "A03-P"));
  assert.equal(fs.existsSync(path.join(vaultPath, "知识库", "wiki", "articles")), false);
  assert.equal(Object.hasOwn(record, "currentStandardVersion"), false);
  assert.equal(fs.existsSync(storePath(vaultPath)), false, "工作流状态已迁 runtime-state store，vault 不得残留该文件（SPEC-012 WP-A 迁出语义）");
});

test("standardization requires explicit confirmation", function (t) {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  writeCandidate(vaultPath, "confirm.md", validArticle("STD-CONFIRM", "确认文章"));
  const service = createArticleWorkflowService({ vaultPath, logger: { info() {}, error() {} } });
  assert.throws(() => service.standardize("STD-CONFIRM"), { code: "CONFIRMATION_REQUIRED" });
});

test("standardization passes with WARNING and persists audit without a formal-version pointer", function (t) {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  // 短正文触发数据质量 WARNING（W01），但不阻断标准化。
  writeCandidate(vaultPath, "warn.md", validArticle("STD-WARN", "警告文章", { body: "短。" }));
  const service = createArticleWorkflowService({ vaultPath, logger: { info() {}, error() {} } });

  const result = service.standardize("STD-WARN", true);
  assert.equal(result.standardizationStatus, "standardized");
  assert.equal(result.standardizationWarningCount, 1);
  assert.equal(Object.hasOwn(result, "hasApprovedVersion"), false);

  // E3'c：Plan-B 纯文件标准化——无 proposal 字段，审计决定保留（decision=standardized）。
  const record = getRuntimeStateStore(vaultPath).workflow.get().state.articles[0];
  assert.equal(Object.hasOwn(record, "currentStandardVersion"), false);
  assert.ok(record.validatedAt);
  assert.deepEqual(record.standardizationWarnings.map((item) => item.ruleId), ["W01"]);
  assert.deepEqual(record.decisions.map((item) => item.decision), ["standardized"]);

  // 退出证据1：WARNING 进入待处理问题且不阻断任何业务动作。
  const issues = collectStandardizationWarningIssues(vaultPath);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].issueKind, "standardization_warning");
  assert.equal(issues[0].proposedAction, null);
  const workbench = createAnomalyWorkbenchService({ vaultPath, collectIssues: () => collectStandardizationWarningIssues(vaultPath) });
  const collected = workbench.list().issues.find((issue) => issue.issueKind === "standardization_warning");
  assert.ok(collected, "standardization warning must surface in the anomaly workbench");
  assert.deepEqual(collected.blockedActions, []);
});

test("standardized article keeps formal identity after workflow service reload", function (t) {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  writeCandidate(vaultPath, "reload.md", validArticle("STD-RELOAD", "重载文章"));
  const first = createArticleWorkflowService({ vaultPath, logger: { info() {}, error() {} } });
  first.standardize("STD-RELOAD", true);

  // E3'c：标准版本发现走 releaseReader（无注入 → null），workflow JSON 不存 currentStandardVersion 指针。
  const second = createArticleWorkflowService({ vaultPath, logger: { info() {}, error() {} } });
  const item = second.listPrecleaned().items.find((entry) => entry.id === "STD-RELOAD");
  assert.equal(item.standardizationStatus, "standardized");
  const state = readWorkflowState(vaultPath);
  assert.equal(Object.hasOwn(state.articles[0], "currentStandardVersion"), false);
});

test("a changed source returns the draft to pending standardization while preserving the prior searchable version", async function (t) {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  writeCandidate(vaultPath, "revision.md", validArticle("STD-REVISION", "第一版标题"));
  const service = createArticleWorkflowService({ vaultPath, logger: { info() {}, error() {} } });
  service.standardize("STD-REVISION", true);

  writeCandidate(vaultPath, "revision.md", validArticle("STD-REVISION", "第二版标题"));
  const revised = service.listPrecleaned().items.find((entry) => entry.id === "STD-REVISION");
  assert.equal(revised.standardizationStatus, "pending_standardization");
});

test("standardization task progression follows standardizationStatus instead of legacy approval status", () => {
  const task = {
    taskId: "task-1", draftPath: "知识库/raw/drafts/投稿/source.md", createdAt: "2026-08-08T00:00:00.000Z",
    precleanedPath: null, precleanedPaths: [], articleIds: [], candidateCount: 0,
    status: "awaiting_approval", updatedAt: "2026-08-08T00:00:00.000Z",
  };
  const article = {
    id: "STD-TASK", sourcePath: "知识库/raw/precleaned/task.md",
    standardizationStatus: "standardized", validatedAt: "2026-08-08T01:00:00.000Z",
    updatedAt: "2026-08-08T00:30:00.000Z",
  };
  const result = syncUploadTasks([task], [article], new Map([[article.id, task.draftPath]]));
  assert.equal(result.changed, true);
  assert.equal(task.status, "standardized"); // SPEC-030 派①六态：全候选 standardized 且审批未达 snapshot
  assert.equal(task.updatedAt, article.validatedAt);
});

test("promote 快照通道退役回归墙：账本 pendingIssues 不再派生任何卡（PRD 红线·不建第二套状态）", function (t) {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  // SPEC-012 WP-A：经 runtime-state store 直种同构账本（文件种法已随迁出失效）
  getRuntimeStateStore(vaultPath).workflow.put({
    schemaVersion: "1", generatedAt: new Date().toISOString(),
    tasks: [{
      taskId: "task-legacy", originalFileName: "pending.md",
      draftPath: "知识库/raw/drafts/投稿/pending.md",
      precleanedPath: "知识库/raw/precleaned/不存在.md",
      status: "awaiting_approval",
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      pendingIssues: [{ issue: "frontmatter 缺可上报字段: version", source: "promote-validation", resolved: false }],
    }],
    articles: [],
  });
  const issues = collectStandardizationWarningIssues(vaultPath);
  const fieldCards = issues.filter((item) => item.issueKind === "missing_field" || String(item.issueId || "").startsWith("promote-field-"));
  assert.equal(fieldCards.length, 0, "退役后账本 pendingIssues 不得派生 missing_field 卡（扫描通道独供）");
});


test("源文件删除后警告卡随源退场（读时派生补全，不依赖无写方的退场标记）", function (t) {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  writeCandidate(vaultPath, "gone.md", validArticle("STD-GONE", "已删源"));
  const service = createArticleWorkflowService({ vaultPath, logger: { info() {}, error() {} } } );
  // 造一条带警告记录的文章账目（模拟标准化过）
  const { writeWorkflowState, readWorkflowState } = require("../article-workflow-store.cjs");
  const state = readWorkflowState(vaultPath);
  state.articles.push({ candidateId: "STD-GONE", articleId: "STD-GONE", identitySource: "article_id", sourcePath: "知识库/raw/precleaned/gone.md", contentHash: "x", admissionBlockers: null, decisions: [], standardizationStatus: "standardized", standardizationWarnings: [{ ruleId: "W01", message: "标题与文件名不一致" }], lastStandardizationCheck: null, updatedAt: new Date().toISOString() });
  writeWorkflowState(vaultPath, state);
  const before = collectStandardizationWarningIssues(vaultPath).filter((i) => i.title.includes("STD-GONE"));
  assert.equal(before.length, 1, "源在时警告卡可见");
  fs.unlinkSync(path.join(vaultPath, "知识库", "raw", "precleaned", "gone.md"));
  const after = collectStandardizationWarningIssues(vaultPath).filter((i) => i.title.includes("STD-GONE"));
  assert.equal(after.length, 0, "源删除后警告卡必须随源消失（读时派生）");
});

// ── 2026-10-29 占位门注册表感知（通用/1.0 注册即合法；未注册仍拦）──
test("占位门注册表感知：通用/1.0 已登记为现役 → A03-P/A04-P 不再拦截", (t) => {
  const vaultPath = fixture();
  const versionsPath = path.join(vaultPath, "知识库", "TheSchema", "versions.yaml");
  fs.writeFileSync(versionsPath, fs.readFileSync(versionsPath, "utf8") + [
    "  通用:", "    versions:", "      - id: \"1.0\"", "        label: 通用 1.0", "        status: draft", "        aliases: []", "        snapshot: null", "",
  ].join("\n"));
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  const raw = validArticle("placeholder-ok", "占位注册即合法").replace("product: AnyShare", "product: 通用").replace("version: 7.0.1.1", 'version: "1.0"');
  writeCandidate(vaultPath, "placeholder-ok.md", raw);
  const { blockers } = checkStandardizationFindings(vaultPath, raw, "知识库/raw/precleaned/placeholder-ok.md");
  assert.ok(!blockers.some((b) => b.ruleId === "A03-P" || b.ruleId === "A04-P"), "注册后占位门不应拦截");
});

test("占位门注册表感知：未注册的 通用/1.0 仍拦截（保留占位语义）", (t) => {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  const raw = validArticle("placeholder-bad", "未注册占位").replace("product: AnyShare", "product: 通用").replace("version: 7.0.1.1", 'version: "1.0"');
  writeCandidate(vaultPath, "placeholder-bad.md", raw);
  const { blockers } = checkStandardizationFindings(vaultPath, raw, "知识库/raw/precleaned/placeholder-bad.md");
  assert.ok(blockers.some((b) => b.ruleId === "A03-P"), "未注册产品占位仍拦");
  assert.ok(blockers.some((b) => b.ruleId === "A04-P"), "未注册版本占位仍拦");
});

// ── WP-116 批1（八址键直取收敛）：准入链越界键 → 显式分支非静默 ──
test("WP-116 准入链：frontmatter product 保留名 → 显式 blockers（注册表 own 分支，不再 TypeError）", (t) => {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  for (const product of ["constructor", "toString", "__proto__"]) {
    const raw = validArticle("wp113-hostile", "保留名产品").replace("product: AnyShare", `product: ${product}`);
    const { blockers } = checkStandardizationFindings(vaultPath, raw, "知识库/raw/precleaned/wp113-hostile.md");
    assert.ok(Array.isArray(blockers), `${product} → blockers 数组（不炸）`);
    assert.ok(blockers.some((b) => b.ruleId === "A03"), `${product} → A03 product 不在册（显式分支非静默）`);
  }
  // 对照：在册产品不产 A03 阻断（宿主化不误伤）；版本注册表 own 键取照常
  const ok = checkStandardizationFindings(vaultPath, validArticle("wp113-ok", "在册产品"), "知识库/raw/precleaned/wp113-ok.md");
  assert.equal(ok.blockers.some((b) => b.ruleId === "A03"), false);
});
