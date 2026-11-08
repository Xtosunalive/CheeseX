// PR-158 批次一（副本→收据）验收测试：审批 B3 现场计算——章不再裁决。
// 反例一（假绿根除）：旧章 passed + 规则新增必填 → 审批现场失败；
// 反例二（误拦根除）：旧章 failed + 内容已修复 → 审批现场放行；
// 反例三：人工豁免（validation_override=true）现场失败仍放行（真身侧人工裁定）；
// 收据身份：validation_content_hash 重章稳定 / validation_rules_hash 随规则变化。
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const YAML = require("yaml");

process.env.THESCHEMA_DIR = ""; // 各夹具内重设（createFixture 赋值）

const { createApprovalStateMachineService } = (() => {
  // 服务工厂名以实现为准（下方 require 后断言）
  const mod = require("../approval-state-machine-service.cjs");
  return mod;
})();

const { createArticleValidator, computeRulesHash } = require("../../../../scripts/vault-runtime/article-validator-lib.cjs");

const REPO = path.resolve(__dirname, "..", "..", "..", "..");

function git(repo, args) {
  execFileSync("git", ["-C", repo, ...args], { stdio: "pipe" });
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "b3-receipt-"));
  const repo = path.join(root, "vault");
  fs.mkdirSync(repo, { recursive: true });
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "fixture@example.invalid"]);
  git(repo, ["config", "user.name", "Fixture"]);
  const schemaDir = path.join(repo, "知识库", "TheSchema");
  fs.mkdirSync(schemaDir, { recursive: true });
  // 最小 TheSchema：fields（无 arch 必填起步）＋enums（最小闭合枚举）＋resolved-domains 投影
  const fields = {
    schema_version: 1,
    last_updated: "2026-10-30",
    fields: [
      { name: "title", label: "标题", type: "string", required: "是", scope: ["article"], layer: "内容属性",
        value_domain: { source: "free", note: "自由标题" } },
      { name: "product", label: "产品", type: "string", required: "是", scope: ["article"], layer: "业务属性",
        value_domain: { source: "products" } },
    ],
  };
  fs.writeFileSync(path.join(schemaDir, "fields.yaml"), YAML.stringify(fields));
  fs.writeFileSync(path.join(schemaDir, "enums.yaml"), "products:\n  - 通用\n");
  process.env.THESCHEMA_DIR = schemaDir;
  // WP-116 批1 夹具修复：project-resolved-domains.mjs 只认 VAULT_PATH/.env（--vault 形参它并不
  // 解析——原写法在无 .env 的树上夹具必红，在有 .env 的树上把解析物投影进真库）。显式钉
  // VAULT_PATH=夹具 vault，投影落夹具内（既可跑又零真库污染）。
  execFileSync("node", [path.join(REPO, "scripts", "quality", "project-resolved-domains.mjs"), "--vault", repo], { stdio: "pipe", env: { ...process.env, VAULT_PATH: repo } });
  return { root, repo, schemaDir };
}

function writeArticle(repo, name, frontmatter, body = "\n正文内容\n") {
  const abs = path.join(repo, "知识库", "raw", "precleaned", name);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, `---\n${frontmatter}---\n${body}`);
  return abs;
}

// 服务端 resolveContentHash 比对口径＝裸 hex（无 sha256: 前缀）
const sha256File = (abs) => require("node:crypto").createHash("sha256").update(fs.readFileSync(abs)).digest("hex");

function makeService(repo) {
  const factoryKeys = Object.keys(require("../approval-state-machine-service.cjs"));
  const factoryName = factoryKeys.find((k) => /^create/.test(k));
  assert.ok(factoryName, `服务工厂未找到：${factoryKeys.join(",")}`);
  return require("../approval-state-machine-service.cjs")[factoryName]({ vaultPath: repo });
}

async function confirmOrCatch(service, articleId, input) {
  try {
    await service.transition(articleId, "confirm", input);
    return { ok: true };
  } catch (e) {
    return { ok: false, code: e.code, details: e.details, message: e.message };
  }
}

(async () => {
  // ── 反例一（本批验收核心）：旧章 passed + 规则新增必填 → 审批现场失败 ──
  {
    const env = createFixture();
    try {
      const service = makeService(env.repo);
      const abs = writeArticle(env.repo, "a.md", 'title: 文A\nproduct: 通用\narticle_id: a-1\nvalidation_status: passed\nvalidation_errors: 0\nvalidation_timestamp: "2026-01-01T00:00:00Z"\n');
      // 先把文章推到 pending（合法链路：standardize）
      await service.transition("a-1", "standardize", { sourcePath: "知识库/raw/precleaned/a.md", contentHash: sha256File(abs) });
      // 规则真身变化：fields.yaml 新增必填字段（resolved-domains 随写重算）
      const fields = YAML.parse(fs.readFileSync(path.join(env.schemaDir, "fields.yaml"), "utf8"));
      fields.fields.push({ name: "impact_level", label: "影响级", type: "string", required: "是", scope: ["article"], layer: "业务属性",
        value_domain: { source: "free", note: "H/M/L" } });
      fs.writeFileSync(path.join(env.schemaDir, "fields.yaml"), YAML.stringify(fields));
      execFileSync("node", [path.join(REPO, "scripts", "quality", "project-resolved-domains.mjs"), "--vault", env.repo], { stdio: "pipe", env: { ...process.env, VAULT_PATH: env.repo } });

      const r = await confirmOrCatch(service, "a-1", { sourcePath: "知识库/raw/precleaned/a.md", contentHash: sha256File(abs) });
      assert.equal(r.ok, false, "旧章 passed 必须被现场计算拦截");
      assert.equal(r.code, "ARTICLE_VALIDATION_FAILED");
      assert.ok(Array.isArray(r.details?.errors) && r.details.errors.length > 0, "拒绝详情必须携带现场错误");
      assert.match(r.details.errors.join(";"), /impact_level/, "现场错误必须是新增必填字段");
      assert.ok(r.details.rulesHash, "拒绝详情必须携带规则指纹");
      console.log("✓ 反例一：旧章 passed + 规则新增必填 → 现场失败（假绿根除）");
    } finally { fs.rmSync(env.root, { recursive: true, force: true }); }
  }

  // ── 反例二：旧章 failed + 内容已修复 → 审批现场放行（误拦根除） ──
  {
    const env = createFixture();
    try {
      const service = makeService(env.repo);
      // 内容本身合法（title+product 齐），但历史章是 failed（旧规则时代的遗留）
      const abs = writeArticle(env.repo, "b.md", 'title: 文B\nproduct: 通用\narticle_id: b-1\nvalidation_status: failed\nvalidation_errors: 8\nvalidation_timestamp: "2026-01-01T00:00:00Z"\n');
      await service.transition("b-1", "standardize", { sourcePath: "知识库/raw/precleaned/b.md", contentHash: sha256File(abs) });
      const r = await confirmOrCatch(service, "b-1", { sourcePath: "知识库/raw/precleaned/b.md", contentHash: sha256File(abs) });
      assert.equal(r.ok, true, `内容已修复即应放行（旧 failed 章不裁决）：${r.message || ""}`);
      console.log("✓ 反例二：旧章 failed + 内容已修 → 现场放行（误拦根除）");
    } finally { fs.rmSync(env.root, { recursive: true, force: true }); }
  }

  // ── 反例三：人工豁免保留——现场失败 + override=true → 放行 ──
  {
    const env = createFixture();
    try {
      const service = makeService(env.repo);
      const abs = writeArticle(env.repo, "c.md", 'title: 文C\narticle_id: c-1\nvalidation_status: failed\nvalidation_override: true\n');
      await service.transition("c-1", "standardize", { sourcePath: "知识库/raw/precleaned/c.md", contentHash: sha256File(abs) });
      const r = await confirmOrCatch(service, "c-1", { sourcePath: "知识库/raw/precleaned/c.md", contentHash: sha256File(abs) });
      assert.equal(r.ok, true, `人工豁免（真身侧人工裁定）不被现场计算推翻：${r.message || ""}`);
      console.log("✓ 反例三：override=true 现场失败仍放行（豁免保留）");
    } finally { fs.rmSync(env.root, { recursive: true, force: true }); }
  }

  // ── WP-116 批1 行为钉：validation_override 切分改经文档装载宿主（loadDocument＋docField）——
  // 边界输入产出与迁移前基线探针实测对照：CRLF＋裸 true 豁免照旧生效；未闭合 frontmatter 走
  // legacy 宽容边界放行（旧实现 (B) 分支 return null 同）；引号 "true" 照旧不豁免（引号破旧
  // 正则全行锚定；宿主按 YAML 字符串值同样非布尔 true）。
  {
    const env = createFixture();
    try {
      const service = makeService(env.repo);
      fs.mkdirSync(path.join(env.repo, "知识库", "raw", "precleaned"), { recursive: true });
      // CRLF＋裸 true：豁免生效（旧实现 indexOf("\n---") 与 yaml 库均容忍 CRLF——同产出）
      const absCrlf = path.join(env.repo, "知识库", "raw", "precleaned", "crlf-c.md");
      fs.writeFileSync(absCrlf, "---\r\ntitle: 文CRLF\r\narticle_id: crlf-1\r\nvalidation_status: failed\r\nvalidation_override: true\r\n---\r\n正文\r\n");
      await service.transition("crlf-1", "standardize", { sourcePath: "知识库/raw/precleaned/crlf-c.md", contentHash: sha256File(absCrlf) });
      const r1 = await confirmOrCatch(service, "crlf-1", { sourcePath: "知识库/raw/precleaned/crlf-c.md", contentHash: sha256File(absCrlf) });
      assert.equal(r1.ok, true, `CRLF＋裸 true 豁免放行（与旧口径一致）：${r1.message || ""}`);
      // 未闭合 frontmatter：legacy 宽容边界——不做机器校验直接放行（旧实现 (B) 分支同）
      const absUnclosed = path.join(env.repo, "知识库", "raw", "precleaned", "unclosed.md");
      fs.writeFileSync(absUnclosed, "---\ntitle: 文未闭合\narticle_id: nc-1\nvalidation_status: failed\n");
      await service.transition("nc-1", "standardize", { sourcePath: "知识库/raw/precleaned/unclosed.md", contentHash: sha256File(absUnclosed) });
      const r2 = await confirmOrCatch(service, "nc-1", { sourcePath: "知识库/raw/precleaned/unclosed.md", contentHash: sha256File(absUnclosed) });
      assert.equal(r2.ok, true, `未闭合 frontmatter → legacy 宽容边界放行（与旧口径一致）：${r2.message || ""}`);
      // 引号 "true"：不豁免 → 机器校验执行 → 拦（旧正则引号破全行锚定不豁免——同产出）
      const absQuoted = path.join(env.repo, "知识库", "raw", "precleaned", "quoted.md");
      fs.writeFileSync(absQuoted, "---\ntitle: 文引号\narticle_id: q-1\nvalidation_status: failed\nvalidation_override: \"true\"\n---\n正文\n");
      await service.transition("q-1", "standardize", { sourcePath: "知识库/raw/precleaned/quoted.md", contentHash: sha256File(absQuoted) });
      const r3 = await confirmOrCatch(service, "q-1", { sourcePath: "知识库/raw/precleaned/quoted.md", contentHash: sha256File(absQuoted) });
      assert.equal(r3.ok, false, `引号 "true" 不豁免（与旧口径一致）：${JSON.stringify(r3)}`);
      assert.equal(r3.code, "ARTICLE_VALIDATION_FAILED");
      console.log("✓ WP-116 行为钉：CRLF 豁免／未闭合 legacy 放行／引号不豁免——与旧口径一致");
    } finally { fs.rmSync(env.root, { recursive: true, force: true }); }
  }

  // ── 收据身份：content_hash 重章稳定；rules_hash 随规则变化 ──
  {
    const env = createFixture();
    try {
      const abs = writeArticle(env.repo, "d.md", 'title: 文D\nproduct: 通用\narticle_id: d-1\n');
      const v1 = createArticleValidator({ vaultPath: env.repo });
      const stamped1 = v1.applyValidationStamp
        ? v1.applyValidationStamp(fs.readFileSync(abs, "utf8"), { errors: [], warnings: [] })
        : null;
      assert.ok(stamped1, "validator 需暴露 applyValidationStamp");
      const hash1 = stamped1.match(/^validation_content_hash: (sha256:[0-9a-f]{64})$/m)?.[1];
      assert.ok(hash1, "收据必须携带 content_hash");
      const rules1 = stamped1.match(/^validation_rules_hash: (sha256:[0-9a-f]{64})$/m)?.[1];
      assert.ok(rules1, "收据必须携带 rules_hash");
      // 重章（对已盖章内容再章）→ content_hash 不变（重章不改哈希）
      const stamped2 = v1.applyValidationStamp(stamped1, { errors: [], warnings: [] });
      const hash2 = stamped2.match(/^validation_content_hash: (sha256:[0-9a-f]{64})$/m)?.[1];
      assert.equal(hash2, hash1, "重章不得改变 content_hash");
      // 规则变化 → rules_hash 变
      const fields = YAML.parse(fs.readFileSync(path.join(env.schemaDir, "fields.yaml"), "utf8"));
      fields.fields[0].description = "规则变更探针";
      fs.writeFileSync(path.join(env.schemaDir, "fields.yaml"), YAML.stringify(fields));
      const rules2 = computeRulesHash(env.repo);
      assert.notEqual(rules2, rules1, "规则真身变化必须改变 rules_hash");
      console.log("✓ 收据身份：content_hash 重章稳定 / rules_hash 随规则变化");
    } finally { fs.rmSync(env.root, { recursive: true, force: true }); }
  }

  console.log("\nb3-receipt verdicts: all passed");
})().catch((e) => { console.error(e); process.exit(1); });
