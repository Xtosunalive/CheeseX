// Component: Schema-Write-Service Tests
// @responsible: 验证权威源 Schema 直接写回（乐观锁 + 原子写回 + 备份 + 快照 + 委托复用）。
// @inputs: 临时 Vault Schema 文件
// @outputs: 单元测试断言
// @context: Schema-Manager

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { gitFixtureEnv } = require("../../../../scripts/quality/shared/git-fixture-env.cjs");
const { createSchemaWriteService, sha256 } = require("../schema-write-service.cjs");

function git(repo, args) {
  return execFileSync("git", args, { env: gitFixtureEnv(process.env), cwd: repo, encoding: "utf8"}).trim();
}

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "schema-write-")); process.env.THESCHEMA_DIR = path.join(root, "知识库", "TheSchema"); process.env.THESCHEMA_DIR = path.join(root, "vault", "知识库", "TheSchema"); // SPEC-023 波 3 钉扎（夹具库在 root/vault 子层） // SPEC-023 波 3 钉扎
  const repo = path.join(root, "vault");
  fs.mkdirSync(repo);
  git(repo, ["init", "-b", "main"]);
  git(repo, ["config", "user.email", "fixture@example.invalid"]);
  git(repo, ["config", "user.name", "Fixture"]);
  const schemaDir = path.join(repo, "知识库", "TheSchema");
  fs.mkdirSync(schemaDir, { recursive: true });
  const fixtureSchema = path.resolve(__dirname, "../../../../test/fixtures/minimal-vault/知识库/TheSchema");
  for (const name of ["ontology.yaml", "enums.yaml", "versions.yaml"]) {
    fs.copyFileSync(path.join(fixtureSchema, name), path.join(schemaDir, name));
  }
  fs.writeFileSync(path.join(schemaDir, "dependencies.yaml"), "rules: []\n");
  fs.mkdirSync(path.join(repo, "知识库", "wiki", "entities"), { recursive: true });
  fs.writeFileSync(path.join(repo, "知识库", "wiki", "entities", "child.md"), "---\narchitecture-node-id: child\ntitle: Child\n---\n\n# Child\n");
  fs.writeFileSync(path.join(repo, "知识库", "wiki", "entities", "parent.md"), "---\narchitecture-node-id: parent\ntitle: Parent\n---\n\n# Parent\n");
  git(repo, ["add", "-A"]);
  git(repo, ["commit", "-m", "fixture"]);
  return { root, repo };
}

function makeWritable(target) {
  if (!fs.existsSync(target)) return;
  const stat = fs.lstatSync(target);
  if (stat.isDirectory()) {
    fs.chmodSync(target, 0o755);
    for (const entry of fs.readdirSync(target)) makeWritable(path.join(target, entry));
  } else {
    fs.chmodSync(target, 0o644);
  }
}

function readYaml(repo, relative) {
  return fs.readFileSync(path.join(repo, relative), "utf8");
}

const ontologyPath = "知识库/TheSchema/ontology.yaml";

function revisionOf(repo, relative) {
  return sha256(readYaml(repo, relative));
}

async function run() { // PR-056：freezeVersion 异步化随迁
  // 1. ontology 直接写回 + 乐观锁冲突
  let env = createFixture();
  try {
    const svc = createSchemaWriteService({ vaultPath: env.repo });
    const before = readYaml(env.repo, ontologyPath);
    const revision = sha256(before);
    const result = svc.writeOntology({ revision, patch: { fixture_flag: true } });
    assert.equal(result.category, "ontology");
    assert.equal(result.revision, revisionOf(env.repo, ontologyPath));
    assert.match(readYaml(env.repo, ontologyPath), /fixture_flag: true/);
    assert.ok(result.backupPath.endsWith(".bak"), "write must produce a backup");
    // 乐观锁：旧 revision 再写必须 409
    assert.throws(() => svc.writeOntology({ revision, patch: { fixture_flag: false } }), (e) => e.code === "SCHEMA_REVISION_CONFLICT");
  } finally { makeWritable(env.root); fs.rmSync(env.root, { recursive: true, force: true }); }

  // 2. ontology 缺 revision fail-closed
  env = createFixture();
  try {
    const svc = createSchemaWriteService({ vaultPath: env.repo });
    assert.throws(() => svc.writeOntology({ patch: { fixture_flag: true } }), (e) => e.code === "SCHEMA_REVISION_REQUIRED");
  } finally { makeWritable(env.root); fs.rmSync(env.root, { recursive: true, force: true }); }

  // 3. dependencies 直接写回
  env = createFixture();
  try {
    const svc = createSchemaWriteService({ vaultPath: env.repo });
    const dep = readYaml(env.repo, "知识库/TheSchema/dependencies.yaml");
    const result = svc.writeDependencies({ revision: sha256(dep), patch: { rules: [{ source: "a", target: "b" }] } });
    assert.equal(result.category, "dependencies");
    assert.match(readYaml(env.repo, "知识库/TheSchema/dependencies.yaml"), /source: a/);
  } finally { makeWritable(env.root); fs.rmSync(env.root, { recursive: true, force: true }); }

  // 4. enums 直接写回 + 快照（复用 enums-write-service）
  env = createFixture();
  try {
    const svc = createSchemaWriteService({ vaultPath: env.repo });
    const enumsBefore = readYaml(env.repo, "知识库/TheSchema/enums.yaml");
    const rawBefore = fs.readFileSync(path.join(env.repo, "知识库", "TheSchema", "enums.yaml"));
    const result = svc.writeEnums({ revision: sha256(rawBefore), patch: { modules: { ...(enumsBefore.modules || {}), 写回探针: { system: "a" } } } });
    assert.equal(result.category, "enums");
    // SPEC-023 波 3：fs 快照退役——git 即账（不再产生 history/）
    const historyDir = path.join(env.repo, "知识库", "TheSchema", "history");
    assert.ok(!fs.existsSync(historyDir) || fs.readdirSync(historyDir).length === 0, "不得再产生 fs 快照");
  } finally { makeWritable(env.root); fs.rmSync(env.root, { recursive: true, force: true }); }

  // 4b. enums 前端节键映射写回（回归：前端键 categories 必须落为 yaml 键 arch_categories，
  // 不得写出孤儿 categories 顶层键导致读侧静默不生效）＋A5 回标——矩阵未配置＝fallback
  env = createFixture();
  try {
    const svc = createSchemaWriteService({ vaultPath: env.repo });
    const enumsBefore = readYaml(env.repo, "知识库/TheSchema/enums.yaml");
    const result = svc.writeEnums({ revision: sha256(enumsBefore), patch: { categories: ["应用组件"] } });
    assert.equal(result.category, "enums");
    assert.equal(result.derivedDirectEdit.segment, "arch_categories");
    assert.equal(result.derivedDirectEdit.mode, "fallback", "矩阵未配置：派生源缺失期直改（ADR-006 保底）须回标");
    const written = require("yaml").parse(readYaml(env.repo, "知识库/TheSchema/enums.yaml"));
    assert.deepEqual(written.arch_categories, ["应用组件"], "前端键 categories 应更新 yaml 键 arch_categories");
    assert.equal(written.categories, undefined, "不得写出孤儿 categories 顶层键");
  } finally { makeWritable(env.root); fs.rmSync(env.root, { recursive: true, force: true }); }

  // 4c. A5 回标双模式——矩阵配置后 categories 写转 shadow（影子写：派生忽略、改动不生效）；
  // 且不触 arch_categories 的写（如 tags）不带回标字段
  env = createFixture();
  try {
    const svc = createSchemaWriteService({ vaultPath: env.repo });
    const before = readYaml(env.repo, "知识库/TheSchema/enums.yaml");
    // PR-054 写前语义闸随批：矩阵键改用夹具真实在册子域/域/类别（原 architecture 键＝unknown
    // subdomain/domain——写前无闸时代的语义非法标本，本闸上线后必须用合法形态）
    const step1 = svc.writeEnums({ revision: sha256(before), patch: { subdomain_constraints: { maintain: { domain_id: "ops", allowed_categories: ["服务"] } } } });
    assert.equal(step1.derivedDirectEdit, undefined, "subdomain_constraints 写本身不是派生段直改，不带回标");
    const after1 = readYaml(env.repo, "知识库/TheSchema/enums.yaml");
    const step2 = svc.writeEnums({ revision: sha256(after1), patch: { categories: ["架构", "新增类别"] } });
    assert.equal(step2.derivedDirectEdit.mode, "shadow", "矩阵已配置：arch_categories 写为影子写须回标");
    assert.ok(step2.derivedDirectEdit.reason.includes("影子写"));
    // 红队 F4 退化角：矩阵有条目但 allowed_categories 并集为空 → 读侧回退保底，本写生效，标 fallback
    const after2 = readYaml(env.repo, "知识库/TheSchema/enums.yaml");
    const step3 = svc.writeEnums({ revision: sha256(after2), patch: { subdomain_constraints: { maintain: { domain_id: "ops", allowed_categories: [] } }, categories: ["退化角类别"] } });
    assert.equal(step3.derivedDirectEdit.mode, "fallback", "并集为空的矩阵＝未配置（读侧同口径），不得误标 shadow");
  } finally { makeWritable(env.root); fs.rmSync(env.root, { recursive: true, force: true }); }

  // 4c-2. PR-054/035 写前语义闸（红面）——矩阵的形态/语义非法在写路径 400 拒绝，未落盘
  env = createFixture();
  try {
    const svc = createSchemaWriteService({ vaultPath: env.repo });
    const before = readYaml(env.repo, "知识库/TheSchema/enums.yaml");
    const currentSha = () => sha256(readYaml(env.repo, "知识库/TheSchema/enums.yaml"));
    const probe = (patch, fragment) => {
      let threw = null;
      try { svc.writeEnums({ revision: currentSha(), patch }); } catch (e) { threw = e; }
      assert.ok(threw, "非法矩阵必须被拒");
      assert.equal(threw.status, 400, "拒绝须为 400");
      assert.ok((threw.message || "").includes(fragment), `错误须含「${fragment}」，实得：${threw.message}`);
      const onDisk = readYaml(env.repo, "知识库/TheSchema/enums.yaml");
      assert.ok(!onDisk.includes("ghost"), "拒绝后源文件不得变化");
    };
    // 语义：未知子域 / 未知 domain（unknown category 不在红面——arch_categories 是矩阵派生视图
    // 〔ADR-006 修订A〕，矩阵写宣告新类别＝语义内放行，下方正例断言其派生落盘）
    probe({ subdomain_constraints: { ghost: { domain_id: "ops", allowed_categories: ["服务"] } } }, "unknown subdomain");
    probe({ subdomain_constraints: { maintain: { domain_id: "ghost", allowed_categories: ["服务"] } } }, "unknown domain");
    // 形态：allowed_categories 非数组
    probe({ subdomain_constraints: { maintain: { domain_id: "ops", allowed_categories: "服务" } } }, "allowed_categories");
    // 正例：合法矩阵写通过；宣告新类别随派生重算落 arch_categories（写时立类＝ADR-006 语义）
    const okWrite = svc.writeEnums({ revision: currentSha(), patch: { subdomain_constraints: { maintain: { domain_id: "ops", allowed_categories: ["幽灵类别"] } } } });
    assert.ok(okWrite.revision, "合法矩阵写须成功");
    assert.ok(readYaml(env.repo, "知识库/TheSchema/enums.yaml").includes("幽灵类别"), "矩阵宣告的类别须随派生重算落 arch_categories");
  } finally { makeWritable(env.root); fs.rmSync(env.root, { recursive: true, force: true }); }

  // 4d. PR-088 接线二：discoveryEdit field=policy——组合裁定写 subdomain_constraints（立契动作进生长通道）
  // 夹具词表：subdomains.ops=[maintain]，arch_categories=[应用组件, 服务]
  // PR-156 刀二对齐：arch_categories 已是矩阵派生段（写矩阵即重算）——夹具预置 doc 行使两类别
  // 在派生口径下正式在册（旧夹具手填 arch_categories 而矩阵为空，属构造性漂移，派生随写后不复存在）
  env = createFixture();
  try {
    const enumsPath = path.join(env.repo, "知识库", "TheSchema", "enums.yaml");
    const enumsDoc = require("yaml").parse(fs.readFileSync(enumsPath, "utf8"));
    enumsDoc.subdomain_constraints = { ...(enumsDoc.subdomain_constraints || {}), doc: { domain_id: "meta", allowed_categories: ["应用组件", "服务"] } };
    fs.writeFileSync(enumsPath, require("yaml").stringify(enumsDoc));
    git(env.repo, ["add", "-A"]); git(env.repo, ["commit", "-m", "fixture matrix seed"]);
    const svc = createSchemaWriteService({ vaultPath: env.repo });
    const rev = () => sha256(readYaml(env.repo, "知识库/TheSchema/enums.yaml"));
    const r1 = svc.discoveryEdit({ revision: rev(), patch: { field: "policy", subdomain: "maintain", category: "服务" } });
    assert.equal(r1.category, "discovery");
    assert.deepEqual(r1.policy, { subdomain: "maintain", category: "服务" });
    const w1 = require("yaml").parse(readYaml(env.repo, "知识库/TheSchema/enums.yaml"));
    assert.deepEqual(w1.subdomain_constraints.maintain, { domain_id: "ops", allowed_categories: ["服务"] }, "首次立契：新建行带 domain_id（schema 形状合法）");
    const r2 = svc.discoveryEdit({ revision: rev(), patch: { field: "policy", subdomain: "maintain", category: "应用组件" } });
    assert.ok(r2.revision);
    const w2 = require("yaml").parse(readYaml(env.repo, "知识库/TheSchema/enums.yaml"));
    assert.deepEqual(w2.subdomain_constraints.maintain.allowed_categories, ["服务", "应用组件"], "二次立契：同行追加");
    assert.throws(() => svc.discoveryEdit({ revision: rev(), patch: { field: "policy", subdomain: "maintain", category: "服务" } }), (e) => e.code === "SCHEMA_VALUE_CONFLICT" && e.status === 409, "已 allow 组合 → 409");
    assert.throws(() => svc.discoveryEdit({ revision: rev(), patch: { field: "policy", subdomain: "maintain", category: "野生类别" } }), (e) => e.code === "INVALID_DISCOVERY_PATCH", "野生类别 → 400（先走词表晋升）");
    assert.throws(() => svc.discoveryEdit({ revision: rev(), patch: { field: "policy", subdomain: "wildsub", category: "服务" } }), (e) => e.code === "INVALID_DISCOVERY_PATCH", "野生子域 → 400");
    assert.throws(() => svc.discoveryEdit({ revision: rev(), patch: { field: "policy", subdomain: "maintain" } }), (e) => e.code === "INVALID_DISCOVERY_PATCH", "缺 category → 400");
  } finally { makeWritable(env.root); fs.rmSync(env.root, { recursive: true, force: true }); }

  // 4e. B1=b＋WP-064 修正：冻结对象＝arch_categories 派生视图直改（yaml 键旁路）——403 维持；
  // categories 声明宿主晋升通道恢复（PR-054/035 原设计：矩阵未配置 fallback 直改＝配置路径）——
  // 写入落地 enums.yaml；layers 晋升不误伤。
  env = createFixture();
  try {
    const svc = createSchemaWriteService({ vaultPath: env.repo });
    const enumsAbs = path.join(env.repo, "知识库", "TheSchema", "enums.yaml");
    const before = fs.readFileSync(enumsAbs);
    assert.throws(
      () => svc.discoveryEdit({ revision: sha256(readYaml(env.repo, "知识库/TheSchema/enums.yaml")), patch: { field: "arch_categories", value: "新类别", mode: "formal" } }),
      (e) => e.code === "DERIVED_SEGMENT_READ_ONLY" && e.status === 403,
      "absorb arch_categories 必须 403 拒收（派生视图直改旁路）"
    );
    assert.deepEqual(fs.readFileSync(enumsAbs), before, "拒收不得触达写路径");
    const okCat = svc.discoveryEdit({ revision: sha256(readYaml(env.repo, "知识库/TheSchema/enums.yaml")), patch: { field: "categories", value: "新类别", mode: "formal" } });
    assert.equal(okCat.category, "discovery", "categories 晋升通道恢复（声明宿主配置路径）");
    // WP-072 修正（基线红①）：categories 前端键须落 arch_categories yaml 键（SECTION_YAML_KEY_MAP 单源），
    // 不得写孤儿独立 categories 键（写守卫 ENUMS_SEGMENT_UNREGISTERED 即此捕获）。读回实测：
    const writtenAfterCat = require("yaml").parse(readYaml(env.repo, "知识库/TheSchema/enums.yaml"));
    assert.ok(writtenAfterCat.arch_categories.includes("新类别"), "categories 写后 arch_categories 须含新值（键映射生效）");
    assert.equal(writtenAfterCat.categories, undefined, "不得写出孤儿 categories 顶层键（物理键只有 arch_categories）");
    const okLayers = svc.discoveryEdit({ revision: sha256(readYaml(env.repo, "知识库/TheSchema/enums.yaml")), patch: { field: "layers", value: "edge-layer", mode: "formal" } });
    assert.equal(okLayers.category, "discovery", "layers 晋升不受冻结影响（不误伤）");
  } finally { makeWritable(env.root); fs.rmSync(env.root, { recursive: true, force: true }); }

  // 5. versions/product-identity/freeze 委托 version-registry-service（mock factory 验证委托）
  const registryCalls = [];
  const svc = createSchemaWriteService({
    vaultPath: "/unused",
    versionRegistryServiceFactory: () => ({
      writeRegistry: (revision, payload) => { registryCalls.push(["writeRegistry", revision, payload]); return { revision: "sha256:reg" }; },
      writeProductIdentity: (revision, aliases) => { registryCalls.push(["writeProductIdentity", revision, aliases]); return { revision: "sha256:pi" }; },
      freezeVersion: (revision, product, version) => { registryCalls.push(["freezeVersion", revision, product, version]); return { revision: "sha256:fz", product, version }; },
    }),
  });
  assert.equal(svc.writeVersions({ revision: "sha256:v", patch: { products: {} } }).revision, "sha256:reg");
  assert.equal(svc.writeProductIdentity({ revision: "sha256:p", patch: { aliases: ["x"] } }).revision, "sha256:pi");
  const fz = await svc.freezeVersion({ revision: "sha256:f", product: "P", version: "1.0.0" }); // PR-056：freezeVersion 异步化
  assert.equal(fz.version, "1.0.0");
  assert.deepEqual(registryCalls.map(([op]) => op), ["writeRegistry", "writeProductIdentity", "freezeVersion"]);

  // 6. entity-parent 直接写回
  env = createFixture();
  try {
    const svc = createSchemaWriteService({ vaultPath: env.repo });
    const result = svc.writeEntityParent({ patch: { childId: "child", parentId: "parent" } });
    assert.equal(result.category, "entity-parent");
    assert.match(readYaml(env.repo, "知识库/wiki/entities/child.md"), /parent_id: parent/);
  } finally { makeWritable(env.root); fs.rmSync(env.root, { recursive: true, force: true }); }

  // 7. PR-049 防回归：野生 tag 裁定为别名（discoveryEdit field=tags assignMode=alias）——
  // 写入的 tag_aliases.<value> 必须是数组（validateStringMap 与 /api/schema/enums 契约均按数组校验；
  // 旧写法落标量 → 一处脏值整库枚举 enforce 500，实战触发于 2026-10-12 tag_aliases.test 事件）。
  env = createFixture();
  try {
    const svc = createSchemaWriteService({ vaultPath: env.repo });
    const enumsBefore = readYaml(env.repo, "知识库/TheSchema/enums.yaml");
    // fixture 无 tags 分组，先经 writeEnums 补一个正式分组（别名目标必须是已有正式 tag）
    const withTags = svc.writeEnums({ revision: sha256(enumsBefore), patch: {} });
    void withTags;
    const yamlDoc = require("yaml");
    const patched = yamlDoc.parse(readYaml(env.repo, "知识库/TheSchema/enums.yaml")) || {};
    patched.tags = { 运维: ["运维"] };
    const raw = yamlDoc.stringify(patched);
    fs.writeFileSync(path.join(env.repo, "知识库", "TheSchema", "enums.yaml"), raw, "utf8");
    const beforeAlias = readYaml(env.repo, "知识库/TheSchema/enums.yaml");
    const result = svc.discoveryEdit({ revision: sha256(beforeAlias), patch: { field: "tags", value: "test", assignMode: "alias", aliasTarget: "运维" } });
    void result;
    const after = yamlDoc.parse(readYaml(env.repo, "知识库/TheSchema/enums.yaml")) || {};
    const aliasValue = (after.tag_aliases || {}).test;
    assert.ok(Array.isArray(aliasValue), "PR-049: tag_aliases.<value> must be an array (was scalar string)");
    assert.deepEqual(aliasValue, ["运维"]);
    // 与校验器同契约：validateStringMap 必须通过（PR-049 写读同契约）
    const { validateStringMap } = require("../schema-validators.cjs");
    const errors = validateStringMap(after.tag_aliases, "tag_aliases");
    assert.deepEqual(errors, [], "PR-049: written tag_aliases must pass validateStringMap");
  } finally { makeWritable(env.root); fs.rmSync(env.root, { recursive: true, force: true }); }

  // 8. Master 2026-10-17 裁决「发现的时候就写好」：subdomain absorb 必填 label——
  // 缺 label 400 拒写；带 label 写入 {id,label} 对象词条（出生即带义）。
  {
    env = createFixture();
    try {
      const svc = createSchemaWriteService({ vaultPath: env.repo });
      const before = readYaml(env.repo, "知识库/TheSchema/enums.yaml");
      // 缺 label → 400 INVALID_DISCOVERY_LABEL
      let rejected = false;
      try { svc.discoveryEdit({ revision: sha256(before), patch: { field: "subdomains", value: "storage", mode: "formal", domain: "ops" } }); }
      catch (e) { rejected = e.code === "INVALID_DISCOVERY_LABEL" && e.status === 400; }
      assert.ok(rejected, "缺 label 必须 400 INVALID_DISCOVERY_LABEL");
      // 带 label → {id,label} 落盘
      svc.discoveryEdit({ revision: sha256(before), patch: { field: "subdomains", value: "storage", mode: "formal", domain: "ops", label: "对象存储" } });
      const yamlDoc2 = require("yaml");
      const after2 = yamlDoc2.parse(readYaml(env.repo, "知识库/TheSchema/enums.yaml")) || {};
      const entries = ((after2.subdomains || {}).ops) || [];
      const stored = entries.find((e) => (typeof e === "string" ? e : e && e.id) === "storage");
      assert.ok(stored && typeof stored === "object" && stored.label === "对象存储", "subdomain absorb 须写入 {id,label} 对象词条");
    } finally { makeWritable(env.root); fs.rmSync(env.root, { recursive: true, force: true }); }
  }

  // 9. PR-178 收口：不经 PUT 的写口（统一写客户端走的正是本函数）同经迁移判定
  env = createFixture();
  try {
    const svc = createSchemaWriteService({ vaultPath: env.repo });
    const ont = "知识库/TheSchema/ontology.yaml";
    const rel = (status, extra) => Object.assign({ label_cn: "收口关系", lifecycle_status: status }, extra || {});
    svc.writeOntology({ revision: revisionOf(env.repo, ont), patch: { relation_types: { R: rel("approved"), S: rel("approved") } } });
    svc.writeOntology({ revision: revisionOf(env.repo, ont), patch: { relation_types: { R: rel("retired", { retirement: { reason: "收口批", replaced_by: "S" } }), S: rel("approved") } } });
    const bytes = readYaml(env.repo, ont);
    let revived = null;
    try { svc.writeOntology({ revision: revisionOf(env.repo, ont), patch: { relation_types: { R: rel("approved"), S: rel("approved") } } }); } catch (e) { revived = e; }
    assert.ok(revived, "咽喉必须拦住 retired→approved 原地复活（PR-178 实测绕过面）");
    assert.equal(revived.code, "VALIDATION_ERROR", "复用已登记错误码，不新生未入册码（PR-172 口径）");
    assert.equal(revived.status, 400);
    assert.match(revived.message, /lifecycle_transition_denied/);
    assert.equal(readYaml(env.repo, ont), bytes, "咽喉拒写不改源");
    let removal = null;
    try { svc.writeOntology({ revision: revisionOf(env.repo, ont), patch: { relation_types: { S: rel("approved") } } }); } catch (e) { removal = e; }
    assert.ok(removal && /lifecycle_retired_removal_denied/.test(removal.message), "在册退役元素被删必须拒（PR-179）：" + (removal && removal.message));
    assert.equal(readYaml(env.repo, ont), bytes, "禁删拒写同样不改源");
  } finally { makeWritable(env.root); fs.rmSync(env.root, { recursive: true, force: true }); }

  // 9b. PR-190 咽喉端到端：整段置 null／补丁不带该段——整档终态按清空判，补丁面不得假红
  env = createFixture();
  try {
    const svc = createSchemaWriteService({ vaultPath: env.repo });
    const ont = "知识库/TheSchema/ontology.yaml";
    const rel = (status, extra) => Object.assign({ label_cn: "段级清空关系", lifecycle_status: status }, extra || {});
    svc.writeOntology({ revision: revisionOf(env.repo, ont), patch: { relation_types: { R: rel("approved"), S: rel("approved") } } });
    svc.writeOntology({ revision: revisionOf(env.repo, ont), patch: { relation_types: { R: rel("retired", { retirement: { reason: "段级钉", replaced_by: "S" } }), S: rel("approved") } } });
    const bytes = readYaml(env.repo, ont);
    let cleared = null;
    try { svc.writeOntology({ revision: revisionOf(env.repo, ont), patch: { relation_types: null } }); } catch (e) { cleared = e; }
    assert.ok(cleared, "整段写成 null 必须拒——落盘终态里这段就是没了（PR-190 咽喉面）");
    assert.equal(cleared.code, "VALIDATION_ERROR");
    assert.equal(cleared.status, 400);
    assert.match(cleared.message, /lifecycle_retired_removal_denied/);
    assert.equal(readYaml(env.repo, ont), bytes, "段级清空拒写不改源");
    // 反向对照：只写别的段（补丁不带 relation_types）＝本次不改这段，不得凭空假红
    const untouched = svc.writeOntology({ revision: revisionOf(env.repo, ont), patch: { node_types: { N: { label_cn: "只动这段", lifecycle_status: "draft" } } } });
    assert.equal(untouched.category, "ontology", "未带段＝不改该段（补丁入口的正常写入必须放行）");
  } finally { makeWritable(env.root); fs.rmSync(env.root, { recursive: true, force: true }); }

  // 10. PR-178 回滚腿端到端红绿双例（2026-11-02 二次反例复核指出「接线无回归承载」，本组补钉）
  //     io 注入只为可测性：resolver 在夹具无 知识库/TheSchema/enums.yaml 时回落仓内 data/theschema，
  //     走真实 repoWrite 的绿例会改写仓内真件（PR-177 同族污染）——生产路径不传 io，行为不变。
  env = createFixture();
  try {
    const { rollbackSnapshot } = require("../schema-history-service.cjs");
    const YAML = require("yaml");
    const svc = createSchemaWriteService({ vaultPath: env.repo });
    const ont = "知识库/TheSchema/ontology.yaml";
    const rel = (status, extra) => Object.assign({ label_cn: "回滚关系", lifecycle_status: status }, extra || {});
    svc.writeOntology({ revision: revisionOf(env.repo, ont), patch: { relation_types: { R: rel("approved"), S: rel("approved") } } });
    svc.writeOntology({ revision: revisionOf(env.repo, ont), patch: { relation_types: { R: rel("retired", { retirement: { reason: "回滚钉", replaced_by: "S" } }), S: rel("approved") } } });
    const currentRaw = readYaml(env.repo, ont);
    const reviveSnapshot = YAML.stringify({ relation_types: { R: rel("approved"), S: rel("approved") } });
    const writes = [];
    let threw = null;
    try { rollbackSnapshot(env.repo, "ontology", sha256(currentRaw), "a".repeat(40), { readGitSnapshot: () => reviveSnapshot, repoWrite: (p, raw) => writes.push(raw) }); } catch (e) { threw = e; }
    assert.ok(threw, "回滚把 retired 元素复位成 approved 必须被拒（PR-178 回滚腿）");
    assert.equal(threw.code, "VALIDATION_ERROR");
    assert.match(threw.message, /lifecycle_transition_denied/);
    assert.deepEqual(writes, [], "被拒回滚不得写回任何字节");
    // 绿例对照——同态快照正常回滚，证明上面不是「恒拒」造成的假绿
    const ok = rollbackSnapshot(env.repo, "ontology", sha256(currentRaw), "a".repeat(40), { readGitSnapshot: () => currentRaw, repoWrite: (p, raw) => writes.push(raw) });
    assert.equal(ok.category, "ontology");
    assert.equal(writes.length, 1, "同态回滚须放行（恒拒＝假绿，此处反证）");
  } finally { makeWritable(env.root); fs.rmSync(env.root, { recursive: true, force: true }); }

  // 11. PR-183 律文表逐边附加条件同咽喉执法：不经 PUT 也躲得过路由三件套校验的口子已关
  env = createFixture();
  try {
    const svc = createSchemaWriteService({ vaultPath: env.repo });
    const ont = "知识库/TheSchema/ontology.yaml";
    const rel = (status, extra) => Object.assign({ label_cn: "附加条件关系", lifecycle_status: status }, extra || {});
    svc.writeOntology({ revision: revisionOf(env.repo, ont), patch: { relation_types: { R: rel("approved"), S: rel("approved") } } });
    const seeded = readYaml(env.repo, ont);
    // 红例一：approved→retired 是表内合法边，但缺 retirement 三件套——路由会拦，咽喉此前放行
    let noReason = null;
    try { svc.writeOntology({ revision: revisionOf(env.repo, ont), patch: { relation_types: { R: rel("retired"), S: rel("approved") } } }); } catch (e) { noReason = e; }
    assert.ok(noReason, "无 retirement.reason 的退役必须被咽喉拒（PR-183）：" + JSON.stringify(noReason && noReason.code));
    assert.equal(noReason.code, "VALIDATION_ERROR");
    assert.match(noReason.message, /retirement\.reason/);
    assert.equal(readYaml(env.repo, ont), seeded, "附加条件拒写不改源");
    // 绿例对照：补齐三件套后同一迁移正常落盘（证明红不是恒拒）
    svc.writeOntology({ revision: revisionOf(env.repo, ont), patch: { relation_types: { R: rel("retired", { retirement: { reason: "附加条件对照", replaced_by: "S" } }), S: rel("approved") } } });
    assert.match(readYaml(env.repo, ont), /retirement/);
    // 红例二：关系回 approved 须重过能力锚（律文表 submitted／reserved→approved 行的附加条件）
    // 红例二：关系回现役须重过能力锚——用另一枚关系 Q 走 reserved→approved（表内合法边），
    //   上一稿误把已 retired 的 R 挪去 reserved，被迁移表正确拒住（测试自身写错，非判据漏网）
    const retiredState = { R: rel("retired", { retirement: { reason: "附加条件对照", replaced_by: "S" } }), S: rel("approved") };
    svc.writeOntology({ revision: revisionOf(env.repo, ont), patch: { relation_types: { ...retiredState, Q: rel("reserved") } } });
    const beforeAnchor = readYaml(env.repo, ont);
    let anchor = null;
    try { svc.writeOntology({ revision: revisionOf(env.repo, ont), patch: { relation_types: { ...retiredState, Q: rel("approved", { brand_new_capability: true }) } } }); } catch (e) { anchor = e; }
    assert.ok(anchor && anchor.code === "CAPABILITY_CONSUMER_ANCHOR_INVALID", "无消费锚的能力字段回现役必须被咽喉拒：" + JSON.stringify(anchor && anchor.code));
    assert.equal(readYaml(env.repo, ont), beforeAnchor, "能力锚拒写不改源");
  } finally { makeWritable(env.root); fs.rmSync(env.root, { recursive: true, force: true }); }

  // 12. PR-187 退役块事后可改写（三轮复核确认的后门）：态别未变、只清空 reason 或改指他类型——咽喉必须拒
  env = createFixture();
  try {
    const svc = createSchemaWriteService({ vaultPath: env.repo });
    const ont = "知识库/TheSchema/ontology.yaml";
    const rel = (status, extra) => Object.assign({ label_cn: "退役块关系", lifecycle_status: status }, extra || {});
    const okRetire = { reason: "初版退役", replaced_by: "S" };
    svc.writeOntology({ revision: revisionOf(env.repo, ont), patch: { relation_types: { A: rel("retired", { retirement: okRetire }), S: rel("approved") } } });
    const seeded = readYaml(env.repo, ont);
    // 红例一：不改态，把 reason 清空
    let cleared = null;
    try { svc.writeOntology({ revision: revisionOf(env.repo, ont), patch: { relation_types: { A: rel("retired", { retirement: { reason: "", replaced_by: "S" } }), S: rel("approved") } } }); } catch (e) { cleared = e; }
    assert.ok(cleared && /retirement\.reason/.test(cleared.message || ""), "清空退役理由必须被咽喉拒（PR-187）：" + JSON.stringify(cleared && cleared.code));
    assert.equal(readYaml(env.repo, ont), seeded, "拒写不改源");
    // 红例二：不改态，把 replaced_by 改指不同元素类型
    let crossType = null;
    try { svc.writeOntology({ revision: revisionOf(env.repo, ont), patch: { relation_types: { A: rel("retired", { retirement: { reason: "初版退役", replaced_by: "N" } }), S: rel("approved") } } }); } catch (e) { crossType = e; }
    assert.ok(crossType && /same element type|unknown replacement/.test(crossType.message || ""), "退役替代目标被改成他类型/不存在必须被拒：" + JSON.stringify(crossType && crossType.message));
    assert.equal(readYaml(env.repo, ont), seeded, "拒写不改源（第二次）");
    // 红例三：新落盘元素一出生就 retired 却无三件套
    let born = null;
    try { svc.writeOntology({ revision: revisionOf(env.repo, ont), patch: { relation_types: { A: rel("retired", { retirement: okRetire }), S: rel("approved"), Z: rel("retired") } } }); } catch (e) { born = e; }
    assert.ok(born && /retirement/.test(born.message || ""), "新建即退役缺三件套必须被拒：" + JSON.stringify(born && born.message));
    // 绿例对照：退役块逐字未动的同值重写必须放行（证明上面不是恒拒）
    const sameRewrite = svc.writeOntology({ revision: revisionOf(env.repo, ont), patch: { relation_types: { A: rel("retired", { retirement: okRetire }), S: rel("approved") } } });
    assert.equal(sameRewrite.category, "ontology", "同值重写（未触碰退役块）应放行：" + JSON.stringify(sameRewrite));
  } finally { makeWritable(env.root); fs.rmSync(env.root, { recursive: true, force: true }); }

  // 12. PR-189 整档取值域进咽喉：非退役元素把 lifecycle_status 写成非法值也拒（此前迁移判定与附加条件两层皆零判）
  env = createFixture();
  try {
    const svc = createSchemaWriteService({ vaultPath: env.repo });
    const ont = "知识库/TheSchema/ontology.yaml";
    const rel = (status, extra) => Object.assign({ label_cn: "取值域关系", lifecycle_status: status }, extra || {});
    svc.writeOntology({ revision: revisionOf(env.repo, ont), patch: { relation_types: { R: rel("approved"), S: rel("approved") } } });
    const seeded = readYaml(env.repo, ont);
    let invalid = null;
    try { svc.writeOntology({ revision: revisionOf(env.repo, ont), patch: { relation_types: { R: { label_cn: "取值域关系", lifecycle_status: 123 }, S: rel("approved") } } }); } catch (e) { invalid = e; }
    assert.ok(invalid && invalid.code === "VALIDATION_ERROR", "非退役元素写非法 lifecycle_status 必须被咽喉拒（PR-189）：" + JSON.stringify(invalid && invalid.code));
    assert.match(invalid.message, /lifecycle_status: must be one of/);
    assert.match(invalid.message, /relation_types\.R/, "报错必须点名元素：" + invalid.message);
    assert.equal(readYaml(env.repo, ont), seeded, "取值域拒写不改源");
    // 反向对照：只改描述、生命周期值原样不动 ⇒ 不因整段替换而把未触及元素判成非法（作用域收窄必须真成立）
    svc.writeOntology({ revision: revisionOf(env.repo, ont), patch: { relation_types: { R: { label_cn: "只改名字", lifecycle_status: "approved" }, S: rel("approved") } } });
    assert.match(readYaml(env.repo, ont), /只改名字/);
  } finally { makeWritable(env.root); fs.rmSync(env.root, { recursive: true, force: true }); }

  // 13. PR-191 复核抓到的活出口：以 __proto__ 作元素键——条件层按键赋值会把它吃掉，退役三件套可被无痕抹成 []
  env = createFixture();
  try {
    const svc = createSchemaWriteService({ vaultPath: env.repo });
    const ont = "知识库/TheSchema/ontology.yaml";
    const rel = (status, extra) => Object.assign({ label_cn: "原型键关系", lifecycle_status: status }, extra || {});
    const PROTO = "__proto__"; // 计算键才造自有属性；字面量 __proto__: 是设原型
    svc.writeOntology({ revision: revisionOf(env.repo, ont), patch: { relation_types: { KEEP: rel("approved") } } });
    const seeded = readYaml(env.repo, ont);
    let proto = null;
    try { svc.writeOntology({ revision: revisionOf(env.repo, ont), patch: { relation_types: { KEEP: rel("approved"), [PROTO]: rel("retired", { retirement: [] }) } } }); } catch (e) { proto = e; }
    assert.ok(proto && proto.code === "VALIDATION_ERROR", "以 __proto__ 为元素键的写入必须被咽喉拒（PR-191）：" + JSON.stringify(proto && proto.code));
    assert.match(proto.message, /lifecycle_element_id_reserved/);
    assert.match(proto.message, /relation_types\.__proto__/, "须点名是哪个元素");
    assert.equal(readYaml(env.repo, ont), seeded, "身份键拒写不改源");
    // 反向对照：原型上的数据属性键作在册 id 仍合法（route 套件「与对象原型同名的自身注册键仍合法」是已签收判据，不得连坐）
    svc.writeOntology({ revision: revisionOf(env.repo, ont), patch: { relation_types: { KEEP: rel("approved"), constructor: rel("approved") } } });
    assert.match(readYaml(env.repo, ont), /constructor/, "constructor 作自有注册键须照常落盘");
  } finally { makeWritable(env.root); fs.rmSync(env.root, { recursive: true, force: true }); }

  // 14. PR-192 复核抓到的假红错位：迁走在册退役元素唯一的现役替换目标，必须在这一笔当场拒并点名本次动的元素
  env = createFixture();
  try {
    const svc = createSchemaWriteService({ vaultPath: env.repo });
    const ont = "知识库/TheSchema/ontology.yaml";
    const rel = (status, extra) => Object.assign({ label_cn: "链目标关系", lifecycle_status: status }, extra || {});
    const retire = { reason: "退役钉", replaced_by: "T" };
    svc.writeOntology({ revision: revisionOf(env.repo, ont), patch: { relation_types: { A: rel("retired", { retirement: retire }), T: rel("approved"), U: rel("approved") } } });
    const seeded = readYaml(env.repo, ont);
    let broken = null;
    try { svc.writeOntology({ revision: revisionOf(env.repo, ont), patch: { relation_types: { A: rel("retired", { retirement: retire }), T: rel("reserved"), U: rel("approved") } } }); } catch (e) { broken = e; }
    assert.ok(broken && broken.code === "VALIDATION_ERROR", "把唯一现役替换目标迁出 approved 必须当场被拒（PR-192）：" + JSON.stringify(broken && broken.message));
    assert.match(broken.message, /lifecycle_retirement_chain_scope/, "首条错误必须点名本次动的元素（此前只在日后无关写入上报未触及的 A）：" + broken.message);
    assert.match(broken.message, /relation_types\.T/);
    assert.equal(readYaml(env.repo, ont), seeded, "断链拒写不改源");
    // 反向对照：改的是与退役链无关的 U ⇒ 放行。判据加宽若变成恒拒即是假红
    svc.writeOntology({ revision: revisionOf(env.repo, ont), patch: { relation_types: { A: rel("retired", { retirement: retire }), T: rel("approved"), U: rel("reserved") } } });
    assert.match(readYaml(env.repo, ont), /reserved/);
  } finally { makeWritable(env.root); fs.rmSync(env.root, { recursive: true, force: true }); }

  // 15. PR-195（六轮复核 ①）：删除链上节点＝断链的第二条形。非退役件本就可删，删掉唯一现役替换目标不得零判落盘
  env = createFixture();
  try {
    const svc = createSchemaWriteService({ vaultPath: env.repo });
    const ont = "知识库/TheSchema/ontology.yaml";
    const rel = (status, extra) => Object.assign({ label_cn: "删目标关系", lifecycle_status: status }, extra || {});
    const retire = { reason: "删目标钉", replaced_by: "T" };
    svc.writeOntology({ revision: revisionOf(env.repo, ont), patch: { relation_types: { A: rel("retired", { retirement: retire }), T: rel("approved"), U: rel("approved") } } });
    // 反向对照（先跑）：删掉与链无关的 U 必须放行——触发面加宽不得变成禁删一切
    svc.writeOntology({ revision: revisionOf(env.repo, ont), patch: { relation_types: { A: rel("retired", { retirement: retire }), T: rel("approved") } } });
    assert.doesNotMatch(readYaml(env.repo, ont), /U:/, "无关元素可删（对照前提）");
    const seeded = readYaml(env.repo, ont);
    let removed = null;
    try { svc.writeOntology({ revision: revisionOf(env.repo, ont), patch: { relation_types: { A: rel("retired", { retirement: retire }) } } }); } catch (e) { removed = e; }
    assert.ok(removed && removed.code === "VALIDATION_ERROR", "删掉唯一现役替换目标必须当场被拒（PR-195）：" + JSON.stringify(removed && removed.message));
    assert.match(removed.message, /lifecycle_retirement_chain_scope/, "首条须点名本次移除的元素：" + removed.message);
    assert.match(removed.message, /relation_types\.T/);
    assert.equal(readYaml(env.repo, ont), seeded, "断链删除拒写不改源");
  } finally { makeWritable(env.root); fs.rmSync(env.root, { recursive: true, force: true }); }

  // WP-107 D3：生长铸造的身份接同一唯一性判据（原面只查同名文件，slug 归一可铸出同一身份）
  env = createFixture();
  try {
    const svc = createSchemaWriteService({ vaultPath: env.repo });
    const grow = (name) => svc.discoveryEdit({ revision: null, patch: { field: "entity", value: name, assignMode: "create", sources: ["知识库/raw/precleaned/x.md"] } });
    const first = grow("复核 网关");
    assert.equal(first.action, "create", "首笔生长应正常建实体");
    assert.throws(() => grow("复核-网关"), (e) => e.code === "SCHEMA_VALUE_CONFLICT" && e.status === 409 && String(e.message).includes("grown-复核-网关"), "连字符写法归一成同一身份 → 必须拒并点名身份");
    assert.throws(() => grow("复核_网关"), (e) => e.code === "SCHEMA_VALUE_CONFLICT", "下划线写法同理被拒");
    const kept = fs.readFileSync(path.join(env.repo, "知识库", "wiki", "entities", "复核 网关.md"), "utf8");
    assert.match(kept, /architecture-node-id: grown-复核-网关/, "被拒不影响首笔落盘");
  } finally { makeWritable(env.root); fs.rmSync(env.root, { recursive: true, force: true }); }
  console.log("Schema write service tests passed");
}

run().catch((e) => { console.error(e); process.exitCode = 1; });
