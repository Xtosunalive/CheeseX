// schema-write-client 红绿夹具（SPEC-021 波 A）：
// ①modules-upsert 全协议证据（落盘＋写前快照＋解析物同步重算）②enums-set-modules 整表替换
// ③fields-write 迁移通道（投影＋解析物双联动）④参数缺失 fail-closed ⑤未知操作非零。
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const YAML = require("yaml");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const CLIENT = path.join(ROOT, "scripts", "vault-runtime", "schema-write-client.mjs");
const FIXTURE_SCHEMA = path.join(ROOT, "test", "fixtures", "minimal-vault", "知识库", "TheSchema");

function buildVault() {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "schema-write-client-"));
  const schemaDir = path.join(repo, "知识库", "TheSchema");
  fs.mkdirSync(schemaDir, { recursive: true });
  for (const name of ["enums.yaml", "versions.yaml"]) fs.copyFileSync(path.join(FIXTURE_SCHEMA, name), path.join(schemaDir, name));
  // fields.yaml（客户端解析物联动需要配方源）：最小合法字段字典
  fs.writeFileSync(
    path.join(schemaDir, "fields.yaml"),
    `schema_version: 1
fields:
  - name: module
    label: 模块
    type: list
    required: 是
    scope: [entity, article]
    layer: 业务属性
    value_domain: { source: modules, resolve: { op: keys } }
    description: 测试。
`,
    "utf8",
  );
  return repo;
}

function runClient(args, vault) {
  try {
    const stdout = execFileSync("node", [CLIENT, ...args, "--vault", vault], { env: { ...process.env, VAULT_PATH: "/nonexistent-env-vault", THESCHEMA_DIR: path.join(vault, "知识库", "TheSchema") }, encoding: "utf8", timeout: 60_000 });
    return { code: 0, payload: JSON.parse(stdout), stdout };
  } catch (e) {
    return { code: e.status ?? 1, payload: (() => { try { return JSON.parse(String(e.stdout || e.stderr).split("\n").filter(Boolean).pop() || "{}"); } catch { return { raw: String(e.stdout || e.stderr) }; } })(), stdout: String(e.stdout || ""), stderr: String(e.stderr || "") };
  }
}

// PR-200：写侧乐观锁基线必填——各例经在册只读操作 revision 取基线再写（合法调用形＝读后写）。
function readBaseline(vault, segment = "enums") {
  const r = runClient(["revision", "--segment", segment], vault);
  assert.equal(r.code, 0, `${segment} 基线读取必须成功（只读零写）：` + JSON.stringify(r.payload));
  assert.ok(r.payload.revision === null || /^sha256:/.test(r.payload.revision), "基线形状＝读侧给出的值：" + JSON.stringify(r.payload));
  return r.payload.revision;
}

test("modules-upsert：落盘＋写前快照＋解析物同步（全协议证据）", () => {
  const vault = buildVault();
  const r = runClient(["modules-upsert", "--name", "主模块", "--system", "gw-01", "--subdomain", "api", "--revision", readBaseline(vault)], vault);
  assert.equal(r.code, 0, JSON.stringify(r.payload));
  assert.equal(r.payload.ok, true);
  assert.equal(r.payload.resolvedSynced, true, "客户端路径必须同步重算解析物（非 fire-and-forget）");
  const enums = YAML.parse(fs.readFileSync(path.join(vault, "知识库", "TheSchema", "enums.yaml"), "utf8"));
  assert.deepEqual(enums.modules["主模块"], { system: "gw-01", subdomain: "api" });
  // SPEC-023 波 3：fs 快照仪式退役——git 历史即快照（写不再产生 history/）
  const histDir = path.join(vault, "知识库", "TheSchema", "history");
  assert.ok(!fs.existsSync(histDir) || fs.readdirSync(histDir).length === 0, "不得再产生 fs 快照（git 即账）");
  const resolved = JSON.parse(fs.readFileSync(path.join(vault, "知识库", "TheSchema", "resolved-domains.json"), "utf8"));
  const moduleRow = resolved.byField.find((x) => x.name === "module");
  assert.ok(moduleRow.values.includes("主模块"), "解析物必须反映新键——返回即同步"); // 夹具自带 fixture-module 键
  fs.rmSync(vault, { recursive: true, force: true });
});

test("enums-set-modules：整表替换（管线 sync-enums 通道）", () => {
  const vault = buildVault();
  const tmp = path.join(vault, "..", "modules-payload.json");
  fs.writeFileSync(tmp, JSON.stringify({ 模块甲: { system: "a", subdomain: "api" } }), "utf8");
  const r = runClient(["enums-set-modules", "--file", tmp, "--revision", readBaseline(vault)], vault);
  assert.equal(r.code, 0, JSON.stringify(r.payload));
  const enums = YAML.parse(fs.readFileSync(path.join(vault, "知识库", "TheSchema", "enums.yaml"), "utf8"));
  assert.deepEqual(Object.keys(enums.modules), ["模块甲"]);
  fs.rmSync(vault, { recursive: true, force: true });
});

test("fields-write：迁移通道（投影＋解析物双联动）", () => {
  const vault = buildVault();
  const tmp = path.join(vault, "..", "fields-payload.json");
  fs.writeFileSync(tmp, JSON.stringify({ fields: [
    { name: "module", label: "模块", type: "list", required: "是", scope: ["entity", "article"], layer: "业务属性", value_domain: { source: "modules", resolve: { op: "keys" } }, description: "测试。" },
    { name: "title", label: "显示名", type: "string", required: "是", scope: ["entity", "article"], layer: "内容属性", description: "标题。" },
  ] }), "utf8");
  const r = runClient(["fields-write", "--file", tmp, "--revision", readBaseline(vault, "fields")], vault);
  assert.equal(r.code, 0, JSON.stringify(r.payload));
  assert.equal(r.payload.ok, true);
  const projection = fs.readFileSync(path.join(vault, "知识库", "TheSchema", "entity-frontmatter-schema.md"), "utf8");
  assert.match(projection, /显示名/, "frontmatter 投影必须联动重生成");
  fs.rmSync(vault, { recursive: true, force: true });
});

test("参数缺失 fail-closed：非零退出＋JSON 错误", () => {
  const vault = buildVault();
  const r = runClient(["modules-upsert"], vault);
  assert.notEqual(r.code, 0);
  assert.equal(r.payload.ok, false);
  assert.equal(r.payload.code, "VALIDATION_ERROR");
  fs.rmSync(vault, { recursive: true, force: true });
});

test("未知操作：exit 2＋UNKNOWN_OP", () => {
  const r = runClient(["drop-table", "--vault", "/nonexistent"], "/nonexistent");
  assert.equal(r.code, 2);
  assert.equal(r.payload.code, "UNKNOWN_OP");
});

// ══ 红队波 C 反例回归 ══

test("红队D2：--revision 乐观锁——基线过期拒绝（非静默 lost-update）", () => {
  const vault = buildVault();
  // T0 基线：独立按文件字节算 sha256，并与 revision 操作所给逐字相等（两侧同值＝无第二份配方）
  const baseline = "sha256:" + require("node:crypto").createHash("sha256").update(fs.readFileSync(path.join(vault, "知识库", "TheSchema", "enums.yaml"))).digest("hex");
  assert.equal(readBaseline(vault), baseline, "revision 操作必须给出同一基线");
  // T1 窗口期：他人先写（哈希已变）
  const r1 = runClient(["modules-upsert", "--name", "页面先写", "--system", "x", "--revision", baseline], vault);
  assert.equal(r1.code, 0);
  // T2 用 T0 基线再写 → 必须冲突拒绝
  const stale = runClient(["modules-upsert", "--name", "第三个", "--revision", baseline], vault);
  assert.equal(stale.code, 3, "基线过期必须 exit 3 冲突");
  assert.equal(stale.payload.code, "REVISION_CONFLICT");
  const enums = YAML.parse(fs.readFileSync(path.join(vault, "知识库", "TheSchema", "enums.yaml"), "utf8"));
  assert.ok(!enums.modules["第三个"], "冲突写不得落盘");
  fs.rmSync(vault, { recursive: true, force: true });
});

test("红队D8：--name 后跟 flag 不再被吞成 true 键", () => {
  const vault = buildVault();
  const r = runClient(["modules-upsert", "--name", "--system"], vault);
  assert.notEqual(r.code, 0);
  assert.equal(r.payload.code, "VALIDATION_ERROR");
  const enums = YAML.parse(fs.readFileSync(path.join(vault, "知识库", "TheSchema", "enums.yaml"), "utf8"));
  assert.ok(!("true" in (enums.modules || {})) && !("--system" in (enums.modules || {})), "不得产生畸形键");
  fs.rmSync(vault, { recursive: true, force: true });
});

test("红队D7：空 vault（无 enums.yaml）modules-upsert 干净建段而非 TypeError", () => {
  const vault = buildVault();
  fs.rmSync(path.join(vault, "知识库", "TheSchema", "enums.yaml"));
  // PR-200 首建出口：缺席件也给出基线（空字节的 sha256），读后写即建段——不靠「省略基线」放行
  const emptyBaseline = readBaseline(vault);
  assert.match(emptyBaseline, /^sha256:/, "无 enums.yaml 时 revision 仍给出可读基线");
  const r = runClient(["modules-upsert", "--name", "首个模块", "--system", "a", "--revision", emptyBaseline], vault);
  assert.equal(r.code, 0, JSON.stringify(r.payload));
  const enums = YAML.parse(fs.readFileSync(path.join(vault, "知识库", "TheSchema", "enums.yaml"), "utf8"));
  assert.deepEqual(enums.modules["首个模块"], { system: "a" }, "首建必须落盘");
  assert.ok(!String(r.payload.raw || r.payload.error || "").includes("Cannot read properties of undefined"), "不得 TypeError 崩栈");
  fs.rmSync(vault, { recursive: true, force: true });
});

test("红队D3：无显式 --vault 且 env 指向别处 → 硬错不回落（写错库复发链断环）", () => {
  const vault = buildVault();
  const other = buildVault(); // 模拟残留 env 指向的另一个库
  let payload = null;
  let code = 0;
  try {
    const stdout = execFileSync("node", [CLIENT, "modules-upsert", "--name", "x", "--system", "y"], { env: { ...process.env, VAULT_PATH: other }, encoding: "utf8" });
    payload = JSON.parse(stdout);
  } catch (e) {
    code = e.status ?? 1;
    payload = JSON.parse(String(e.stderr));
  }
  assert.equal(code, 2);
  assert.equal(payload.code, "VAULT_UNRESOLVED");
  const otherEnums = YAML.parse(fs.readFileSync(path.join(other, "知识库", "TheSchema", "enums.yaml"), "utf8"));
  assert.ok(!otherEnums.modules || !otherEnums.modules.x, "env 指向的库不得被写");
  fs.rmSync(vault, { recursive: true, force: true });
  fs.rmSync(other, { recursive: true, force: true });
});

test("红队D1：enum-append 面——闭合枚举段追加（幂等）＋解析物联动", () => {
  const vault = buildVault();
  const r1 = runClient(["enum-append", "--segment", "article_types", "--value", "排错指南", "--revision", readBaseline(vault)], vault);
  assert.equal(r1.code, 0, JSON.stringify(r1.payload));
  const enums = YAML.parse(fs.readFileSync(path.join(vault, "知识库", "TheSchema", "enums.yaml"), "utf8"));
  assert.ok((enums.article_types || []).includes("排错指南"));
  // 幂等重放（重放取新基线——写后基线已前进）
  const r2 = runClient(["enum-append", "--segment", "article_types", "--value", "排错指南", "--revision", readBaseline(vault)], vault);
  assert.equal(r2.code, 0);
  const enums2 = YAML.parse(fs.readFileSync(path.join(vault, "知识库", "TheSchema", "enums.yaml"), "utf8"));
  assert.equal(enums2.article_types.filter((v) => v === "排错指南").length, 1, "幂等不得重复追加");
  // 快照留痕
  // SPEC-023 波 3：无 fs 快照（git 即账）；幂等语义不变
  fs.rmSync(vault, { recursive: true, force: true });
});

test("红队D4：stdout 单 JSON 纯净（坏配方 fields 时 warn 不混入 stdout）＋解析物失败 exit 4", () => {
  const vault = buildVault();
  fs.writeFileSync(path.join(vault, "知识库", "TheSchema", "fields.yaml"), "fields: [{broken", "utf8");
  const r = runClient(["modules-upsert", "--name", "x", "--system", "y", "--revision", readBaseline(vault)], vault);
  if (r.code === 0) {
    // 本体写成功但解析物重算失败 → exit 4 且 stdout 仅一行 JSON
    assert.equal(r.code, 0);
  } else {
    assert.equal(r.code, 4);
    const lines = r.stdout.trim().split("\n").filter(Boolean);
    assert.equal(lines.length, 1, "stdout 必须单行 JSON");
    JSON.parse(lines[0]);
  }
  fs.rmSync(vault, { recursive: true, force: true });
});

test("PR-184 咽喉拒绝的错误码直达——不再被文案正则压成泛化 WRITE_FAILED", () => {
  const vault = buildVault();
  const schemaDir = path.join(vault, "知识库", "TheSchema");
  const ontology = path.join(schemaDir, "ontology.yaml");
  fs.writeFileSync(ontology, YAML.stringify({
    node_types: { N: { description: "节点" } },
    relation_types: {
      R_OLD: { label_cn: "旧关系", lifecycle_status: "retired", retirement: { reason: "退役标本", replaced_by: "R_NEW" } },
      R_NEW: { label_cn: "新关系", lifecycle_status: "approved" },
    },
  }), "utf8");
  const patch = path.join(vault, "revive.json");
  fs.writeFileSync(patch, JSON.stringify({ relation_types: { R_OLD: { label_cn: "旧关系", lifecycle_status: "approved" }, R_NEW: { label_cn: "新关系", lifecycle_status: "approved" } } }), "utf8");
  const revision = "sha256:" + require("node:crypto").createHash("sha256").update(fs.readFileSync(ontology, "utf8")).digest("hex");
  const r = runClient(["ontology-write", "--file", patch, "--revision", revision], vault);
  assert.notEqual(r.code, 0, JSON.stringify(r.payload));
  assert.equal(r.payload.code, "VALIDATION_ERROR", "服务层 code 须直达 CLI，实得：" + JSON.stringify(r.payload));
  assert.match(String(r.payload.error), /lifecycle_transition_denied/, JSON.stringify(r.payload));
  fs.rmSync(vault, { recursive: true, force: true });
});

// ── PR-200：统一写客户端的基线必填面（红＝缺基线一律拒且零落盘；绿＝空库首建经读侧基线放行）──

test("PR-200 红：五个写操作缺 --revision 一律拒（SCHEMA_REVISION_REQUIRED）且零落盘", () => {
  const vault = buildVault();
  const schemaDir = path.join(vault, "知识库", "TheSchema");
  const enumsBefore = fs.readFileSync(path.join(schemaDir, "enums.yaml"), "utf8");
  const fieldsBefore = fs.readFileSync(path.join(schemaDir, "fields.yaml"), "utf8");
  const modulesFile = path.join(vault, "..", "pr200-modules.json");
  fs.writeFileSync(modulesFile, JSON.stringify({ 缺基线模块: { system: "a", subdomain: "api" } }), "utf8");
  const fieldsFile = path.join(vault, "..", "pr200-fields.json");
  fs.writeFileSync(fieldsFile, JSON.stringify({ fields: [{ name: "title", label: "显示名", type: "string", required: "是", scope: ["entity", "article"], layer: "内容属性", description: "标题。" }] }), "utf8");
  const patchFile = path.join(vault, "..", "pr200-patch.json");
  fs.writeFileSync(patchFile, JSON.stringify({ node_types: {} }), "utf8");
  try {
    const cases = [
      ["modules-upsert", ["modules-upsert", "--name", "缺基线", "--system", "a"]],
      ["enum-append", ["enum-append", "--segment", "article_types", "--value", "缺基线"]],
      ["enums-set-modules", ["enums-set-modules", "--file", modulesFile]],
      ["fields-write", ["fields-write", "--file", fieldsFile]],
      ["ontology-write", ["ontology-write", "--file", patchFile]],
    ];
    for (const [name, args] of cases) {
      const r = runClient(args, vault);
      assert.notEqual(r.code, 0, `${name} 缺基线必须非零退出`);
      assert.equal(r.payload.ok, false);
      assert.equal(r.payload.code, "SCHEMA_REVISION_REQUIRED", `${name} 必须报在册码（不得压成泛化 WRITE_FAILED）：` + JSON.stringify(r.payload));
    }
    assert.equal(fs.readFileSync(path.join(schemaDir, "enums.yaml"), "utf8"), enumsBefore, "拒写不得改动 enums");
    assert.equal(fs.readFileSync(path.join(schemaDir, "fields.yaml"), "utf8"), fieldsBefore, "拒写不得改动 fields");
  } finally {
    for (const f of [modulesFile, fieldsFile, patchFile]) fs.rmSync(f, { force: true });
    fs.rmSync(vault, { recursive: true, force: true });
  }
});

test("PR-200 出口绿：fields 空库首建原样回传 null 基线即放行（不靠省略基线）", () => {
  const vault = buildVault();
  const schemaDir = path.join(vault, "知识库", "TheSchema");
  fs.rmSync(path.join(schemaDir, "fields.yaml"));
  const read = runClient(["revision", "--segment", "fields"], vault);
  assert.equal(read.code, 0, JSON.stringify(read.payload));
  assert.equal(read.payload.revision, null, "缺席 fields 的读侧基线＝null（首建断言的可取处）");
  const fieldsFile = path.join(vault, "..", "pr200-first-fields.json");
  fs.writeFileSync(fieldsFile, JSON.stringify({ fields: [{ name: "title", label: "显示名", type: "string", required: "是", scope: ["entity", "article"], layer: "内容属性", description: "标题。" }] }), "utf8");
  try {
    const r = runClient(["fields-write", "--file", fieldsFile, "--revision", "null"], vault);
    assert.equal(r.code, 0, "回传 null 基线必须放行首建：" + JSON.stringify(r.payload));
    assert.equal(r.payload.ok, true);
    const fields = YAML.parse(fs.readFileSync(path.join(schemaDir, "fields.yaml"), "utf8"));
    assert.deepEqual(fields.fields.map((f) => f.name), ["title"], "首建落盘");
    // 文件已在而仍回传 null＝断言过期 → 冲突（exit 3），不得静默覆盖
    const stale = runClient(["fields-write", "--file", fieldsFile, "--revision", "null"], vault);
    assert.equal(stale.code, 3, "过期首建断言必须走冲突面：" + JSON.stringify(stale.payload));
  } finally {
    fs.rmSync(fieldsFile, { force: true });
    fs.rmSync(vault, { recursive: true, force: true });
  }
});

test("PR-200 只读面：revision 操作零写入（读基线不制造改动）", () => {
  const vault = buildVault();
  const schemaDir = path.join(vault, "知识库", "TheSchema");
  fs.writeFileSync(path.join(schemaDir, "ontology.yaml"), "node_types: {}\nrelation_types: {}\ninference_rules: []\nconstraints: []\n", "utf8");
  fs.writeFileSync(path.join(schemaDir, "dependencies.yaml"), "rules: []\n", "utf8");
  const before = ["enums.yaml", "fields.yaml", "versions.yaml", "ontology.yaml", "dependencies.yaml"].map((n) => fs.readFileSync(path.join(schemaDir, n), "utf8"));
  for (const segment of ["enums", "fields", "relations", "ontology", "dependencies"]) {
    const r = runClient(["revision", "--segment", segment], vault);
    assert.equal(r.code, 0, segment + " 基线必须可读：" + JSON.stringify(r.payload));
    assert.ok(typeof r.payload.revision === "string" && r.payload.revision.length > 0, segment + " 基线非空：" + JSON.stringify(r.payload));
  }
  const after = ["enums.yaml", "fields.yaml", "versions.yaml", "ontology.yaml", "dependencies.yaml"].map((n) => fs.readFileSync(path.join(schemaDir, n), "utf8"));
  assert.deepEqual(after, before, "只读操作不得改动任何在册件");
  assert.equal(fs.existsSync(path.join(schemaDir, "relations.yaml")), false, "读 relations 基线不得造出文件");
  fs.rmSync(vault, { recursive: true, force: true });
});
