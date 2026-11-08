// PR-151 回归墙：标准化假绿（字典必填不拦）＋校验章陈旧（Web 写不重章）两个类的反例固化。
// 场景原型＝2026-10-29 真库实录（AGENTS.md：标准化 0 错、完整校验缺 arch 两字段、发布闸门读旧 8 错章）。
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { createArticleWorkflowService } = require("../article-workflow-service.cjs");
const { checkStandardizationFindings } = require("../article-admission-policy.cjs");
const { createArticleValidator } = require("../../../../scripts/vault-runtime/article-validator-lib.cjs");

function fixture() {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "pr151-"));
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
  fs.writeFileSync(path.join(vaultPath, "知识库", "TheSchema", "resolved-domains.json"), JSON.stringify({
    byField: [
      { name: "title", required: "是", scope: ["article"], values: null },
      { name: "category-path", required: "是", scope: ["article"], values: null },
      { name: "article_type", required: "是", scope: ["article"], values: ["排错指南"] },
      { name: "doc-type", required: "是", scope: ["article"], values: ["用户手册"] },
      { name: "arch_layer", required: "是", scope: ["entity", "article"], values: ["gateway", "service"] },
      { name: "arch_category", required: "是", scope: ["entity", "article"], values: ["终端", "服务"] },
      { name: "module", required: "是", scope: ["article"], values: ["Gateway"] },
      { name: "product", required: "是", scope: ["article"], values: ["AnyShare"] },
      { name: "version", required: "是", scope: ["article"], values: ["7.0.1.1"] },
    ],
  }, null, 2));
  return vaultPath;
}

// A01-A10 全过、仅缺字典必填两字段（真库 AGENTS.md 2026-10-29 的抽象形态）＋补字段前的旧失败章
function articleMissingArch(id, title) {
  return [
    "---", `article_id: ${id}`, `title: ${title}`, "product: AnyShare", "version: 7.0.1.1",
    "module: Gateway", "article_type: 排错指南", "doc-type: 用户手册", "category-path: ops:maintain",
    `tags: [${title}]`,
    "validation_status: failed", "validation_errors: 8", "validation_warnings: 2",
    "validation_timestamp: 2026-10-29T13:10:27Z", "validation_summary: \"ERROR(8): 旧章\"",
    "---", "", `# ${title}`, "", "这是足够长的标准文章正文，用于通过数据质量检查。",
  ].join("\n");
}

test("PR-151①假绿反例：A01-A10 全过但缺字典必填两字段 → 标准化拦截并逐字段可修；补齐后通过", (t) => {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  const raw = articleMissingArch("pr151-arch", "假绿反例");
  fs.writeFileSync(path.join(vaultPath, "知识库", "raw", "precleaned", "假绿反例.md"), raw);

  // 改前类反例：A01-A10 手清单全过（0 blockers）＝假绿；字典必填轴必须把它拦下
  const { blockers } = checkStandardizationFindings(vaultPath, raw, "知识库/raw/precleaned/假绿反例.md");
  const dictBlockers = blockers.filter((b) => b.ruleId.startsWith("A11-"));
  assert.deepEqual(dictBlockers.map((b) => b.field).sort(), ["arch_category", "arch_layer"], "字典必填缺口逐字段可见");

  const service = createArticleWorkflowService({ vaultPath, logger: { info() {}, error() {} } });
  const id = service.listPrecleaned().items[0].id;
  assert.throws(() => service.standardize(id, true), (error) => {
    assert.equal(error.code, "ARTICLE_STANDARDIZATION_BLOCKED");
    assert.ok(error.details.blockers.some((b) => b.field === "arch_layer"));
    assert.ok(error.details.blockers.some((b) => b.field === "arch_category"));
    return true;
  });

  // Web 补齐两字段（含旧失败章的文章可直接补——PR-151 放开）→ 再标准化通过
  service.updateCandidateFields(id, { arch_layer: "gateway", arch_category: "服务" });
  const result = service.standardize(id, true);
  assert.equal(result.standardizationStatus, "standardized");
});

test("PR-151①同源断言：标准化检查的字典必填缺口集合 ＝ 完整校验器（article-validator-lib）必填错误集合", (t) => {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  for (const [title, drop] of [["只缺层", ["arch_layer"]], ["只缺分类", ["arch_category"]], ["两缺", ["arch_layer", "arch_category"]], ["不缺", []]]) {
    let raw = articleMissingArch(`pr151-${title}`, title);
    for (const field of drop) raw = raw.replace(new RegExp(`^(?!#).*\\b${field}:.*$`, "m"), "");
    const abs = path.join(vaultPath, "知识库", "raw", "precleaned", `${title}.md`);
    fs.writeFileSync(abs, raw);
    const rel = `知识库/raw/precleaned/${title}.md`;
    const { blockers } = checkStandardizationFindings(vaultPath, raw, rel);
    const standardizationGaps = blockers.filter((b) => b.ruleId.startsWith("A11-")).map((b) => b.field).sort();
    const validatorGaps = createArticleValidator({ vaultPath })
      .validateFile(abs).errors
      .filter((e) => e.startsWith("frontmatter 缺必填字段: "))
      .map((e) => e.replace("frontmatter 缺必填字段: ", ""))
      .filter((f) => f.startsWith("arch_"))
      .sort();
    assert.deepEqual(standardizationGaps, validatorGaps, `${title}：两侧字典必填缺口必须相等（同源）`);
  }
});

test("PR-151③旧章根治：标准化成功路径与 Web 补字段都重算校验章——failed/8 旧章不残留；内容变化后章与内容一致", (t) => {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  const abs = path.join(vaultPath, "知识库", "raw", "precleaned", "旧章根治.md");
  fs.writeFileSync(abs, articleMissingArch("pr151-stamp", "旧章根治"));
  const service = createArticleWorkflowService({ vaultPath, logger: { info() {}, error() {} } });
  const id = service.listPrecleaned().items[0].id;

  // 补字段（缺什么补什么）→ 章随写重算：旧 failed/8 消失，errors 归零如实反映当前内容
  service.updateCandidateFields(id, { arch_layer: "service", arch_category: "终端" });
  const afterPatch = fs.readFileSync(abs, "utf8");
  assert.match(afterPatch, /^validation_status: (passed|warnings)\b/m, "补齐后章不得再是 failed");
  assert.match(afterPatch, /^validation_errors: 0\b/m);
  assert.doesNotMatch(afterPatch, /validation_errors: 8/);

  // 标准化成功路径再重算一次（时间戳/章与 revision 绑定同一字节）
  service.standardize(id, true);
  const afterStd = fs.readFileSync(abs, "utf8");
  assert.match(afterStd, /^validation_status: (passed|warnings)\b/m);
  assert.match(afterStd, /^validation_errors: 0\b/m);
  const record = require("../../../shared/persistence/runtime-state-store.cjs").getRuntimeStateStore(vaultPath).workflow.get().state.articles[0];
  assert.equal(record.contentHash, require("crypto").createHash("sha256").update(afterStd).digest("hex"), "revision 绑定＝盖章后字节");
});

test("PR-151③fail-closed：解析物缺失（校验器 fatal）时 Web 写路径拒绝，不留未盖章写", (t) => {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  fs.unlinkSync(path.join(vaultPath, "知识库", "TheSchema", "resolved-domains.json"));
  fs.writeFileSync(path.join(vaultPath, "知识库", "raw", "precleaned", "无解析物.md"), articleMissingArch("pr151-fatal", "无解析物"));
  const service = createArticleWorkflowService({ vaultPath, logger: { info() {}, error() {} } });
  const id = service.listPrecleaned().items[0].id;
  assert.throws(() => service.updateCandidateFields(id, { arch_layer: "gateway" }), (error) => error.code === "VALIDATOR_UNAVAILABLE" && error.status === 503);
  assert.throws(() => service.standardize(id, true), (error) => error.code === "VALIDATOR_UNAVAILABLE");
});

test("PR-151 续·类消灭：字典新增必填字段（priority）仅登记字典 → 标准化自动拦（A11 派生，零代码改动）", (t) => {
  const vaultPath = fixture();
  t.after(() => fs.rmSync(vaultPath, { recursive: true, force: true }));
  // 只改字典（解析物加一行 required 字段）——契约/服务端/前端均不动：标准化必填轴自动生效
  const resolvedPath = path.join(vaultPath, "知识库", "TheSchema", "resolved-domains.json");
  const doc = JSON.parse(fs.readFileSync(resolvedPath, "utf8"));
  doc.byField.push({ name: "priority", required: "是", scope: ["article"], values: ["高", "低"] });
  fs.writeFileSync(resolvedPath, JSON.stringify(doc, null, 2));
  const raw = articleMissingArch("pr151-future", "未来字段");
  fs.writeFileSync(path.join(vaultPath, "知识库", "raw", "precleaned", "未来字段.md"), raw);
  const { blockers } = checkStandardizationFindings(vaultPath, raw, "知识库/raw/precleaned/未来字段.md");
  const gap = blockers.find((b) => b.field === "priority");
  assert.ok(gap, "字典新增必填自动生成 A11 检查");
  assert.equal(gap.ruleId, "A11-priority");
  assert.deepEqual(gap.allowedValues, ["高", "低"], "合法值随字典闭包供选项面");
});
