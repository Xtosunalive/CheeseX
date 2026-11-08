const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { createArticleWorkflowService } = require("../article-workflow-service.cjs");
const { getRuntimeStateStore } = require("../../../shared/persistence/runtime-state-store.cjs");

function fixture() {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "article-workflow-"));
  fs.mkdirSync(path.join(vaultPath, "知识库", "raw", "drafts"), { recursive: true });
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
  // PR-151：字典必填集解析物（标准化必填轴与完整校验器同源的数据面——缺它重章器 fail-closed）
  fs.writeFileSync(path.join(vaultPath, "知识库", "TheSchema", "resolved-domains.json"), "{\n  \"byField\": [\n    {\n      \"name\": \"title\",\n      \"required\": \"是\",\n      \"scope\": [\n        \"article\"\n      ],\n      \"values\": null\n    },\n    {\n      \"name\": \"category-path\",\n      \"required\": \"是\",\n      \"scope\": [\n        \"article\"\n      ],\n      \"values\": null\n    },\n    {\n      \"name\": \"article_type\",\n      \"required\": \"是\",\n      \"scope\": [\n        \"article\"\n      ],\n      \"values\": [\n        \"排错指南\"\n      ]\n    },\n    {\n      \"name\": \"doc-type\",\n      \"required\": \"是\",\n      \"scope\": [\n        \"article\"\n      ],\n      \"values\": [\n        \"用户手册\"\n      ]\n    },\n    {\n      \"name\": \"arch_layer\",\n      \"required\": \"是\",\n      \"scope\": [\n        \"entity\",\n        \"article\"\n      ],\n      \"values\": [\n        \"gateway\",\n        \"service\"\n      ]\n    },\n    {\n      \"name\": \"arch_category\",\n      \"required\": \"是\",\n      \"scope\": [\n        \"entity\",\n        \"article\"\n      ],\n      \"values\": [\n        \"终端\",\n        \"服务\"\n      ]\n    },\n    {\n      \"name\": \"module\",\n      \"required\": \"是\",\n      \"scope\": [\n        \"article\"\n      ],\n      \"values\": [\n        \"Gateway\"\n      ]\n    },\n    {\n      \"name\": \"product\",\n      \"required\": \"是\",\n      \"scope\": [\n        \"article\"\n      ],\n      \"values\": [\n        \"AnyShare\",\n        \"通用\"\n      ]\n    },\n    {\n      \"name\": \"version\",\n      \"required\": \"是\",\n      \"scope\": [\n        \"article\"\n      ],\n      \"values\": [\n        \"7.0.1.1\",\n        \"1.0\"\n      ]\n    }\n  ]\n}");
  return vaultPath;
}

function validArticle(id, title) {
  return [
    "---", ...(id ? [`article_id: ${id}`] : []), `title: ${title}`, "product: AnyShare",
    "version: 7.0.1.1", "module: Gateway", "article_type: 排错指南",
    "doc-type: 用户手册", "category-path: ops:maintain", "arch_layer: gateway", "arch_category: 服务", `tags: [${title}]`,
    "---", "", `# ${title}\n\n正文`,
  ].join("\n");
}

function writeCandidate(vaultPath, fileName, raw) {
  fs.writeFileSync(path.join(vaultPath, "知识库", "raw", "precleaned", fileName), raw, "utf8");
}

test("stores uploads unchanged and lists newest tasks first", (t) => {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  const service = createArticleWorkflowService({ vaultPath, logger: { info() {}, error() {} } });
  const contentBase64 = Buffer.from("# 原始标题\n\n第一步：检查服务。", "utf8").toString("base64");
  const first = service.upload({ fileName: "故障处理.md", contentBase64 });
  const second = service.upload({ fileName: "第二篇.md", contentBase64: Buffer.from("second").toString("base64") });
  assert.equal(first.status, "awaiting_architect_processing");
  assert.equal(fs.readFileSync(path.join(vaultPath, ...first.draftPath.split("/")), "utf8"), "# 原始标题\n\n第一步：检查服务。");
  assert.equal(service.listUploads(1).items[0].taskId, second.taskId);
  assert.throws(() => service.listUploads(0), { code: "VALIDATION_ERROR" });
  assert.throws(() => service.upload({ fileName: "故障处理.md", contentBase64 }), { code: "DRAFT_ALREADY_EXISTS" });
  assert.throws(() => service.upload({ fileName: "../escape.md", contentBase64 }), { code: "INVALID_FILE_NAME" });
});

test("candidate identity and read-only search expose no retired approval or graph state", (t) => {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  writeCandidate(vaultPath, "半成品.md", "---\ntitle: 半成品文章\n---\n正文");
  const service = createArticleWorkflowService({ vaultPath, logger: { info() {}, error() {} } });
  const candidate = service.listPrecleaned().items[0];
  assert.match(candidate.id, /^candidate:[a-f0-9]{20}$/);
  assert.equal(candidate.standardizationStatus, "blocked");
  for (const retired of ["status", "approvedAt", "batchId", "pipelineJobId", "graphStatus", "graphAdmissionStatus", "hasApprovedVersion"]) {
    assert.equal(Object.hasOwn(candidate, retired), false, retired);
  }
  assert.deepEqual(service.searchCandidates({ keyword: "半成品" }).items, [{ title: "半成品文章" }]);
  assert.equal(service.getPrecleaned(candidate.id).content, "正文");
});

test("candidate identity changes by source path without duplicate or batch-owned workflow state", (t) => {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  writeCandidate(vaultPath, "identity.md", validArticle(null, "身份迁移"));
  const service = createArticleWorkflowService({ vaultPath, logger: { info() {}, error() {} } });
  assert.match(service.listPrecleaned().items[0].id, /^candidate:/);

  writeCandidate(vaultPath, "identity.md", validArticle("stable-identity", "身份迁移"));
  assert.equal(service.listPrecleaned().items[0].id, "stable-identity");
  writeCandidate(vaultPath, "identity.md", validArticle(null, "身份迁移"));
  const fallback = service.listPrecleaned().items[0];
  assert.match(fallback.id, /^candidate:/);

  const stored = getRuntimeStateStore(vaultPath).workflow.get().state; // SPEC-012 WP-A：工作流状态迁 runtime-state store；WP-018 get 形态 {state,revision}
  assert.equal(stored.articles.length, 1);
  assert.equal(stored.articles[0].candidateId, fallback.id);
  for (const retired of ["status", "approvedAt", "batchId", "pipelineJobId", "graphStatus", "graphAdmissionStatus", "hasApprovedVersion"]) {
    assert.equal(Object.hasOwn(stored.articles[0], retired), false, retired);
  }
});

test("deleting the submitted source file moves the upload task to source_deleted instead of keeping an expired waiting state", (t) => {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  const service = createArticleWorkflowService({ vaultPath, logger: { info() {}, error() {} } });
  const contentBase64 = Buffer.from("# 原始标题\n\n正文", "utf8").toString("base64");
  const task = service.upload({ fileName: "将被删除.md", contentBase64 });
  assert.equal(task.status, "awaiting_architect_processing");

  // 源文件仍在：状态保持等待本地 Skill 处理（合法初始态）
  assert.equal(service.listUploads().items[0].status, "awaiting_architect_processing");

  // 删除投稿源文件后刷新：状态必须变为 source_deleted，且不计入待处理
  fs.unlinkSync(path.join(vaultPath, ...task.draftPath.split("/")));
  const list = service.listUploads();
  assert.equal(list.items[0].status, "source_deleted");
  assert.equal(list.statusCounts.source_deleted, 1);
  assert.equal(list.statusCounts.awaiting_architect_processing, 0);
});

test("deleting the processed candidate also marks the upload task as source_deleted", (t) => {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  const service = createArticleWorkflowService({ vaultPath, logger: { info() {}, error() {} } });
  const contentBase64 = Buffer.from("# 原始标题\n\n正文", "utf8").toString("base64");
  const task = service.upload({ fileName: "有候选.md", contentBase64 });
  // 本地 Skill 产出候选（frontmatter source_file 指回投稿路径）→ 任务聚合为待标准化检查
  writeCandidate(vaultPath, "候选.md", validArticle("candidate-1", "候选").replace("title: 候选", `title: 候选\nsource_file: ${task.draftPath}`));
  assert.equal(service.listUploads().items[0].status, "awaiting_approval");
  // 删除候选后刷新：不能回到"等待本地 Skill 处理"，必须标记源已删除
  fs.unlinkSync(path.join(vaultPath, "知识库", "raw", "precleaned", "候选.md"));
  const list = service.listUploads();
  assert.equal(list.items[0].status, "source_deleted");
  assert.equal(list.statusCounts.source_deleted, 1);
});

test("promoted candidate with archived source_file keeps the task tracking candidate status", (t) => {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  const service = createArticleWorkflowService({ vaultPath, logger: { info() {}, error() {} } });
  const contentBase64 = Buffer.from("# 原始标题\n\n正文", "utf8").toString("base64");
  const task = service.upload({ fileName: "已晋升.md", contentBase64 });
  // 晋升后的真实形态：候选 source_file 指向上传归档（哈希前缀名），且草稿已被 promote 消费删除。
  // 期望：任务↔候选匹配命中（归一化剥哈希前缀），状态聚合为待标准化检查而非误报 source_deleted。
  const archivedSource = `知识库/raw/archive/投稿/${"a".repeat(64)}-已晋升.md`;
  writeCandidate(vaultPath, "已晋升.md", validArticle("candidate-9", "已晋升").replace("title: 已晋升", `title: 已晋升\nsource_file: ${archivedSource}`));
  fs.unlinkSync(path.join(vaultPath, ...task.draftPath.split("/")));
  const list = service.listUploads();
  assert.equal(list.items[0].status, "awaiting_approval");
  assert.equal(list.items[0].candidateCount, 1);
  assert.equal(list.items[0].precleanedPath, "知识库/raw/precleaned/已晋升.md");
});

test("updateCandidateFields: 白名单外字段拒绝、非法枚举拒绝（含 arch 闭包）、合法补丁保正文并重算校验章、已标准化可补齐回落待标准化", (t) => {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  // 候选缺 product/module/version（Skill 上报的缺口形态）
  const raw = validArticle("candidate-patch", "待补齐").replace("product: AnyShare\n", "").replace("module: Gateway\n", "");
  writeCandidate(vaultPath, "待补齐.md", raw);
  const service = createArticleWorkflowService({ vaultPath, logger: { info() {}, error() {} } });
  const id = service.listPrecleaned().items[0].id;

  // 1. 白名单外字段 → FIELD_NOT_ALLOWED
  assert.throws(() => service.updateCandidateFields(id, { title: "越权改标题" }), (error) => error.code === "FIELD_NOT_ALLOWED");

  // 2. 非法枚举值（modules 只有 Gateway）→ FIELD_VALUE_INVALID
  assert.throws(() => service.updateCandidateFields(id, { module: "不存在的模块" }), (error) => error.code === "FIELD_VALUE_INVALID");

  // 3. 合法补丁：写入白名单字段，正文字节与未涉及键保持原样
  const before = fs.readFileSync(path.join(vaultPath, "知识库", "raw", "precleaned", "待补齐.md"), "utf8");
  const detail = service.updateCandidateFields(id, { product: "AnyShare", module: "Gateway" });
  const after = fs.readFileSync(path.join(vaultPath, "知识库", "raw", "precleaned", "待补齐.md"), "utf8");
  assert.match(after, /product: AnyShare/);
  assert.match(after, /module: Gateway/);
  assert.equal(after.split("---")[2], before.split("---")[2]); // 正文区逐字节一致
  assert.equal(detail.metadata.product, "AnyShare");

  // 3.5 PR-046：category-path 两段式结构化校验（WP-040）（与 A08/validate-article.py 同语义）——
  // 合法两段接受；点分旧口径/多段拒绝（FIELD_VALUE_INVALID）——补齐与发布同语义不脱钩。
  assert.doesNotThrow(() => service.updateCandidateFields(id, { "category-path": "ops:maintain" }));
  assert.throws(() => service.updateCandidateFields(id, { "category-path": "ops.maintain" }), (error) => error.code === "FIELD_VALUE_INVALID");
  assert.throws(() => service.updateCandidateFields(id, { "category-path": "ops:maintain:extra" }), (error) => error.code === "FIELD_VALUE_INVALID");

  // 4. PR-151：arch 两字段值域闭包（fields.yaml 配方派生值）——合法接受、闭包外拒绝
  assert.doesNotThrow(() => service.updateCandidateFields(id, { arch_layer: "service" }));
  assert.throws(() => service.updateCandidateFields(id, { arch_layer: "不存在的层" }), (error) => error.code === "FIELD_VALUE_INVALID");
  assert.throws(() => service.updateCandidateFields(id, { arch_category: "不存在的分类" }), (error) => error.code === "FIELD_VALUE_INVALID");

  // 5. PR-151 修复③：补字段随写重算校验章——frontmatter validation_* 与当前内容一致（旧 failed 章不残留）
  const stampedRaw = fs.readFileSync(path.join(vaultPath, "知识库", "raw", "precleaned", "待补齐.md"), "utf8");
  assert.match(stampedRaw, /^validation_status: (passed|warnings|failed)\b/m);
  assert.match(stampedRaw, /^validation_errors: 0\b/m, "补齐后完整校验 0 错——章须如实反映");

  // 6. PR-151：已标准化文章放开 Web 补齐——写入后回落待标准化（与 Obsidian 编辑同一语义）；
  // WP-063：回落待标准化后系统自动执行标准化（哈希变更→状态回退→自动 standardize）——最终态回 standardized
  service.standardize(id, true);
  const detailAfter = service.updateCandidateFields(id, { arch_category: "终端" });
  const reset = service.listPrecleaned().items.find((entry) => entry.id === id);
  assert.equal(reset.standardizationStatus, "standardized", "WP-063：哈希变更回退后系统自动重标准化——最终态回到 standardized");
  assert.equal(detailAfter.metadata.arch_category, "终端");
});

test("standardize/scan flow survives a missing current pointer (falls back to worktree snapshot)", (t) => {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  writeCandidate(vaultPath, "候选.md", validArticle("candidate-1", "候选"));
  // E3'c：标准版本发现走 releaseReader（无注入 → null），listPrecleaned 不崩溃（ADR043 D2' 标准化是纯文件操作）
  const service = createArticleWorkflowService({ vaultPath, logger: { info() {}, error() {} } });
  const items = service.listPrecleaned().items;
  assert.equal(items.length, 1);
  assert.equal(items[0].id, "candidate-1");
});

test("reader throwing no-usable-Release codes falls back to worktree snapshot (not 404)", (t) => {
  // 回归 #1140：catch 之前抓死错误码 ARTICLE_CURRENT_MISSING/INVALID，导致 NO_CURRENT_RELEASE 上抛 → 404
  const codes = ["NO_CURRENT_RELEASE", "CURRENT_POINTER_INVALID", "CURRENT_RELEASE_INVALID", "CURRENT_POINTER_MISMATCH"];
  for (const code of codes) {
    const vaultPath = fixture();
    t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
    writeCandidate(vaultPath, "候选.md", validArticle("candidate-1", "候选"));
    const reader = {
      withPinnedRelease() {
        const error = new Error("no usable Release");
        error.code = code;
        throw error;
      },
    };
    const service = createArticleWorkflowService({ vaultPath, logger: { info() {}, error() {} }, getReleaseReader: () => reader });
    const items = service.listPrecleaned().items;
    assert.equal(items.length, 1, `${code} 应返回 null 让工作树快照兜底`);
    assert.equal(items[0].id, "candidate-1");
  }
});

test("reader throwing programming-error codes (RELEASE_ID_LOCKED / NOT_IN_PINNED_CONTEXT) still rethrows", (t) => {
  for (const code of ["RELEASE_ID_LOCKED", "NOT_IN_PINNED_CONTEXT"]) {
    const vaultPath = fixture();
    t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
    writeCandidate(vaultPath, "候选.md", validArticle("candidate-1", "候选"));
    const reader = {
      withPinnedRelease() {
        const error = new Error("programming error");
        error.code = code;
        throw error;
      },
    };
    const service = createArticleWorkflowService({ vaultPath, logger: { info() {}, error() {} }, getReleaseReader: () => reader });
    assert.throws(() => service.listPrecleaned(), { code }, `${code} 不应被吞`);
  }
});


// ── 2026-10-29 tags 补齐通道收编（A09 必填非空列表）──
test("tags 补齐通道：数组/逗号串归一为非空列表写入 frontmatter，空列表拒绝", (t) => {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  const raw = validArticle("tags-patch", "标签补齐");
  writeCandidate(vaultPath, "标签补齐.md", raw);
  const service = createArticleWorkflowService({ vaultPath, logger: { info() {}, error() {} } });
  const id = service.listPrecleaned().items[0].id;
  const detail = service.updateCandidateFields(id, { tags: ["mysql", " 备份 "] });
  assert.deepEqual(detail.metadata.tags, ["mysql", "备份"], "数组归一（trim）");
  const detail2 = service.updateCandidateFields(id, { tags: "排错, 高可用" });
  assert.deepEqual(detail2.metadata.tags, ["排错", "高可用"], "逗号串归一");
  assert.throws(() => service.updateCandidateFields(id, { tags: " , " }), (error) => error.code === "VALIDATION_ERROR", "全空白拒绝");
});

// ── 2026-10-29 SPEC-030 派②收尾：标准化不再落快照后，formalContentHash 须由 record 补位 ──
// （审批机 standardize 前置探针要求 formalContentHash 非空——原投影只认 Release/本地快照，
//   未发布标准化文章恒 ARTICLE_NOT_STANDARDIZED，draft→pending 死锁实录）
test("标准化后无 Release/快照 → formalContentHash 与 validatedAt 由 record 补位（审批探针可用）", (t) => {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  const raw = validArticle("probe-hash", "哈希补位");
  writeCandidate(vaultPath, "哈希补位.md", raw);
  const service = createArticleWorkflowService({ vaultPath, logger: { info() {}, error() {} } });
  const id = service.listPrecleaned().items[0].id;
  service.standardize(id, true);
  const item = service.getPrecleaned(id);
  assert.equal(item.standardizationStatus, "standardized");
  assert.match(item.formalContentHash || "", /^[0-9a-f]{64}$/, "无 Release 时哈希由 record 补位（64 位 hex）");
  assert.ok(item.validatedAt, "validatedAt 由 record 补位");
});

// ── WP-062（功能可用性）：availability 空态状态对象——空数据态显式上报＋满态零变化 ──
test("WP-062 availability：满数据态各面 empty=false 且无 hint", () => {
  const vaultPath = fixture();
  const service = createArticleWorkflowService({ vaultPath });
  const options = service.getFieldCompletionOptions();
  assert.equal(options.availability.products.empty, false);
  assert.equal(options.availability.versions.empty, false);
  assert.equal(options.availability.archCategories.empty, false);
  assert.equal(options.availability.products.hint, "");
  fs.rmSync(vaultPath, { recursive: true, force: true });
});

test("WP-062 availability：归档空态（无词表 arch_categories＋versions 空）→ empty=true＋hint 指路", () => {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "article-workflow-archived-"));
  fs.mkdirSync(path.join(vaultPath, "知识库", "raw", "drafts"), { recursive: true });
  fs.mkdirSync(path.join(vaultPath, "知识库", "raw", "precleaned"), { recursive: true });
  fs.mkdirSync(path.join(vaultPath, "知识库", "TheSchema"), { recursive: true });
  // 归档态词表（真库同构）：arch_categories=[]、products={}
  fs.writeFileSync(path.join(vaultPath, "知识库", "TheSchema", "enums.yaml"), [
    "domains:", "  ops: 运维", "subdomains:", "  ops: [maintain]", "modules: {}",
    "article_types: [排错指南]", "doc_types: [用户手册]", "arch_categories: []",
    "architecture_projection:", "  product: ''", "  version: ''",
  ].join("\n") + "\n");
  fs.writeFileSync(path.join(vaultPath, "知识库", "TheSchema", "versions.yaml"), "schema_version: 1\nproducts: {}\n");
  fs.writeFileSync(path.join(vaultPath, "知识库", "TheSchema", "resolved-domains.json"), "{\"byField\": []}");
  const service = createArticleWorkflowService({ vaultPath });
  const options = service.getFieldCompletionOptions();
  assert.equal(options.availability.products.empty, true);
  assert.match(options.availability.products.hint, /产品身份/);
  assert.match(options.availability.products.hint, /图谱规则配置/);
  assert.equal(options.availability.versions.empty, true);
  assert.match(options.availability.versions.hint, /版本注册表/);
  assert.equal(options.availability.archCategories.empty, true);
  assert.match(options.availability.archCategories.hint, /业务分类|arch_categories/);
  // WP-070 R4：文案与空态语义契约逐字同源＋kind 上报＋依赖序（产品身份未配 → 版本空态 hint 以前置指引开头）
  const { guidanceFor } = require("../../../shared/availability-view.cjs");
  assert.equal(options.availability.products.kind, "product-identity-unmounted");
  assert.equal(options.availability.products.hint, guidanceFor("product-identity-unmounted"));
  assert.equal(options.availability.versions.kind, "versions-empty");
  assert.equal(options.availability.versions.hint, guidanceFor("versions-empty", ["product-identity-unmounted", "versions-empty"]));
  assert.match(options.availability.versions.hint, /^前置未满足：产品身份未配置/, "依赖序：版本空态在产品未配时先指向产品身份");
  assert.equal(options.availability.archCategories.hint, guidanceFor("arch-categories-empty"));
  fs.rmSync(vaultPath, { recursive: true, force: true });
});

// ── WP-066（SPEC-059 T1）：状态化转移守卫单元测试（守卫函数级行为钉）──
test("WP-066 状态守卫：precleaned 路径要求 draft 起点 → 409 LIFECYCLE_STATE_MISMATCH 携带 current/expected", () => {
  const { assertTransitionState } = require("../../../shared/article-lifecycle-paths.cjs");
  assert.throws(
    () => assertTransitionState("知识库/raw/precleaned/状态错位.md", "draft"),
    (error) => error.code === "LIFECYCLE_STATE_MISMATCH"
      && error.status === 409
      && error.details.currentState === "standard-working"
      && error.details.expectedState === "draft",
    "状态错位必须 409 + current/expected 明示（不再误导性「文件不存在」）"
  );
  assert.equal(assertTransitionState("知识库/raw/drafts/投稿/x.md", "draft"), "draft", "正例：draft 路径要求 draft 起点 → 通过");
});

// 2026-11-01 Master（「环境启动说明咋还在呢」半成品区过滤批）三钉：
//   ①listCurrentStandardVersions 哈希取段修正（match[3]=文件名哈希，原 match[2]=articleId 错位
//     →发布识别恒假）；②published 标志语义（Release 在场＋哈希一致=true；源文件再改动→false）；
//   ③searchCandidates 把已发布且未再改动的候选从半成品区移除。
// 时序对齐真实链：standardize 会重盖校验章（文件字节变→哈希变），发布清单冻结的是**盖章后**
// 内容哈希——夹具先无 Release 标准化，再按盖章后字节造发布清单（否则哈希恒失配，假红）。
test("published-and-current candidates leave the draft-name list while edited sources stay", (t) => {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  const raw = validArticle("published-article", "已发布文章");
  writeCandidate(vaultPath, "published.md", raw);
  const formalRoot = "知识库/wiki/articles/排错指南/published-article";
  let formalHash = null; // 发布时刻冻结的正式内容哈希（真实链＝发布快照文件名）
  const fakeReader = {
    withPinnedRelease: (cb) => cb("release-" + "a".repeat(64)),
    readRelease: (releaseId) => ({ releaseId, artifacts: formalHash ? [{ name: `${formalRoot}/${formalHash}.md` }] : [] }),
  };
  const service = createArticleWorkflowService({ vaultPath, logger: { info() {}, error() {} }, getReleaseReader: () => fakeReader });

  // 第一步：无发布清单（artifacts 空）——显式标准化（校验章重算随 standardize 落盘）
  const candidateId = service.listPrecleaned().items[0].id;
  service.standardize(candidateId, true);
  const standardized = service.listPrecleaned().items[0];
  assert.equal(standardized.published, false, "无 Release 版本→未发布→在半成品区语义");
  assert.deepEqual(service.searchCandidates({ keyword: "已发布" }).items, [{ title: "已发布文章" }], "未发布候选在半成品区");

  // 第二步：发布（清单冻结盖章后内容哈希）——published=true，移出半成品区
  formalHash = crypto.createHash("sha256").update(
    fs.readFileSync(path.join(vaultPath, "知识库", "raw", "precleaned", "published.md"), "utf8"),
  ).digest("hex");
  const listed = service.listPrecleaned().items[0];
  assert.equal(listed.currentStandardVersion.contentHash, formalHash, "①哈希取段＝文件名哈希（match[3]）");
  assert.equal(listed.published, true, "②Release 在场且哈希一致→published");
  assert.deepEqual(service.searchCandidates({ keyword: "已发布" }).items, [], "③已发布候选不在半成品区");

  // 第三步：源文件再改动——哈希失配→published=false→重列（再标准化入口不丢）
  fs.appendFileSync(path.join(vaultPath, "知识库", "raw", "precleaned", "published.md"), "\n\n追加段落");
  const edited = service.listPrecleaned().items[0];
  assert.equal(edited.published, false, "源文件改动→哈希失配→published=false");
  assert.deepEqual(service.searchCandidates({ keyword: "已发布" }).items, [{ title: "已发布文章" }], "改动的源重列半成品区");
});

test("unpublished candidates (no release reader) stay in the draft-name list", (t) => {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  writeCandidate(vaultPath, "pending.md", validArticle("pending-article", "待发布文章"));
  const service = createArticleWorkflowService({ vaultPath, logger: { info() {}, error() {} } });
  assert.equal(service.listPrecleaned().items[0].published, false, "无 Release 版本→published=false");
  assert.deepEqual(service.searchCandidates({ keyword: "待发布" }).items, [{ title: "待发布文章" }]);
});

// id 漂移容错钉（同批）：审批机落正式路径用自产 id（article-46f4… 实录）≠ 候选 frontmatter
// article_id——发布识别必须靠内容哈希兜底（正式快照文件名即内容哈希，B2/D2 不变式）。
test("published recognition survives article-id drift via content-hash fallback", (t) => {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  writeCandidate(vaultPath, "drifted.md", validArticle("候选侧id", "漂移文章"));
  const service0 = createArticleWorkflowService({ vaultPath, logger: { info() {}, error() {} }, getReleaseReader: () => null });
  service0.standardize(service0.listPrecleaned().items[0].id, true); // 校验章重算落盘——正式哈希取盖章后字节
  const fileHash = crypto.createHash("sha256").update(
    fs.readFileSync(path.join(vaultPath, "知识库", "raw", "precleaned", "drifted.md"), "utf8"),
  ).digest("hex");
  const formalRoot = "知识库/wiki/articles/排错指南/article-46f4d1ba6a451ffc2a06"; // 审批机自产 id（≠候选侧 id，漂移形态）
  const fakeReader = {
    withPinnedRelease: (cb) => cb("release-" + "a".repeat(64)),
    readRelease: (releaseId) => ({ releaseId, artifacts: [{ name: `${formalRoot}/${fileHash}.md` }] }),
  };
  const service = createArticleWorkflowService({ vaultPath, logger: { info() {}, error() {} }, getReleaseReader: () => fakeReader });
  const listed = service.listPrecleaned().items[0];
  assert.equal(listed.published, true, "正式路径 id 与候选 id 漂移——哈希兜底仍识别已发布");
  assert.deepEqual(service.searchCandidates({ keyword: "漂移" }).items, [], "已发布候选不出现在半成品区");
});

// WP-138 R5c 上传扩展名值域钉（领域认领测试，非新门禁）：唯一声明处＝shared/article-upload-extensions.mjs
// （ADR-016 §三「命令入口入参值域」单源；原 server/前端两份手抄退役）。本钉锁三点：成员集、顺序
// （415 载荷 acceptedExtensions 与前端 accept 串按此序展开）、冻结（防运行时改域）。
test("upload extension value domain is single-sourced and frozen (WP-138 R5c)", (t) => {
  const { ARTICLE_UPLOAD_EXTENSIONS } = require("../../../../shared/article-upload-extensions.mjs");
  assert.deepEqual([...ARTICLE_UPLOAD_EXTENSIONS], [".pdf", ".docx", ".xlsx", ".csv", ".pptx", ".mht", ".md", ".txt", ".html", ".eml"]);
  assert.ok(Object.isFrozen(ARTICLE_UPLOAD_EXTENSIONS), "值域冻结——运行时不得增删");
});
