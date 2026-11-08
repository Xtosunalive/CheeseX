// ADR-009 W1 单测：主体注册表＋合层读三态（默认零破坏/合层主体优先/未挂载拒）＋契约可段子集。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const YAML = require("yaml");
const { normalizeDocument, validateDocumentStrict } = require("../theschema-loader.cjs");
const { readSubjects, readEnumsForSubject, readEnums } = require("../schema-config.cjs");

const META = `schema_version: 1
domains:
  tech: 技术域
subdomains:
  tech:
    - id: api
      label: 应用程序接口
layers:
  - id: service
    label: 服务
    color: cyan
    layout: central
lifecycle:
  status: [灰度]
  default_status: 灰度
`;

const SUBJECT_FILE = `subdomains:
  tech:
    - id: ceph
      label: 分布式存储
modules:
  Ceph:
    subdomain: ceph
    system: ceph-eceph
    since: '6.0'
    until: ''
arch_categories:
  - 存储
`;

function makeVault({ subjectsYaml, subjectEnums } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "subjects-"));
  const schemaDir = path.join(dir, "知识库", "TheSchema");
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.writeFileSync(path.join(schemaDir, "enums.yaml"), META, "utf8");
  if (subjectsYaml !== undefined) fs.writeFileSync(path.join(schemaDir, "subjects.yaml"), subjectsYaml, "utf8");
  if (subjectEnums !== undefined) {
    fs.mkdirSync(path.join(schemaDir, "subjects", "acme"), { recursive: true });
    fs.writeFileSync(path.join(schemaDir, "subjects", "acme", "enums.yaml"), subjectEnums, "utf8");
  }
  return dir;
}

const MOUNTED = `schema_version: 1
subjects:
  - id: acme
    name: ACME
    status: mounted
    mounted_at: 2026-10-18
`;
const PAUSED = `schema_version: 1
subjects:
  - id: acme
    name: ACME
    status: paused
    archived_from: 知识库/TheSchema/history/enums-legacy-archive-manifest.json
`;

test("W1·默认视角零破坏：无 subjects.yaml/无 subject 参数时 readEnums 行为不变", () => {
  const vault = makeVault();
  const enums = readEnums(vault);
  assert.equal(enums.subdomains.tech[0].id, "api");
  // 无注册表 → 空表
  assert.deepEqual(readSubjects(vault).subjects, []);
  // 显式 subject 但无注册表 → UNKNOWN
  assert.throws(() => readEnumsForSubject(vault, "acme"), (e) => e.code === "SUBJECT_UNKNOWN");
  fs.rmSync(vault, { recursive: true, force: true });
});

test("W1·合层视角：mounted 主体读=元层∪主体层，词条主体优先、modules 并、arch_categories 主体覆盖", () => {
  const vault = makeVault({ subjectsYaml: MOUNTED, subjectEnums: SUBJECT_FILE });
  const merged = readEnumsForSubject(vault, "acme");
  const ids = merged.subdomains.tech.map((e) => e.id);
  assert.deepEqual(ids, ["ceph", "api"], "主体词条在前（优先），元层词条保留");
  assert.equal(merged.modules["Ceph"].system, "ceph-eceph");
  assert.deepEqual(merged.arch_categories, ["存储"], "声明式保底段主体覆盖");
  assert.ok(Array.isArray(merged.layers), "元层共享段随合层可见");
  // 合层对象可过 buildRuleSet（词条归一链路复用）
  const { buildRuleSet } = require("../enums-loader.cjs");
  const ruleSet = buildRuleSet(merged);
  assert.ok(ruleSet.subdomainIds.includes("ceph") && ruleSet.subdomainIds.includes("api"));
  fs.rmSync(vault, { recursive: true, force: true });
});

test("W1·挂起拒读：paused 主体 → SUBJECT_NOT_MOUNTED（fail-closed 不静默回落元层）", () => {
  const vault = makeVault({ subjectsYaml: PAUSED, subjectEnums: SUBJECT_FILE });
  assert.throws(() => readEnumsForSubject(vault, "acme"), (e) => e.code === "SUBJECT_NOT_MOUNTED" && e.status === 409);
  fs.rmSync(vault, { recursive: true, force: true });
});

test("W1·契约：主体层含 layers（元层专属段）→ 严格校验拒（fail-closed 防主体私改画布骨架）", () => {
  const bad = SUBJECT_FILE + "\nlayers:\n  - id: rogue\n";
  const errors = validateDocumentStrict("subject-enums", YAML.parse(bad));
  // additionalProperties 报错在根路径（Ajv 形态不含键名）——拒载语义以「有错+合法对照零错」双面证
  assert.ok(errors.length > 0, "主体层含 layers 必须被契约拒: " + JSON.stringify(errors));
  // 合法主体层零错
  assert.equal(validateDocumentStrict("subject-enums", YAML.parse(SUBJECT_FILE)).length, 0);
});

test("W1·注册表契约：subjects.yaml 畸形降级（脏行剔除不瘫全表）", () => {
  const dirty = `schema_version: 1
subjects:
  - id: acme
    name: ACME
    status: mounted
  - id: 42
`;
  const { data, degradedNodes } = normalizeDocument("subjects", YAML.parse(dirty));
  // 数组脏行降级=占位 null（PR-053 语义，消费方过滤 null）——有效行 1 个
  assert.equal(data.subjects.filter(Boolean).length, 1);
  assert.ok(data.subjects.some((s) => s === null), "脏行以 null 占位有痕");
  assert.ok(degradedNodes.length > 0, "脏行有痕降级");
});

test("W1·真实 vault：AnyShare 注册为 paused 主体（SPEC-016 归档包承接），读取被拒", () => {
  const vaultPath = process.env.VAULT_PATH || path.resolve(__dirname, "..", "..", "..");
  const { resolveTheSchemaDir } = require("../theschema-root.cjs");
  const file = path.join(resolveTheSchemaDir(vaultPath), "subjects.yaml");
  if (!fs.existsSync(file)) return; // 无 vault 且无仓内主源时跳过
  const registry = readSubjects(vaultPath);
  const anyshare = registry.subjects.find((s) => s.id === "anyshare");
  assert.ok(anyshare, "AnyShare 已注册");
  assert.equal(anyshare.status, "paused");
  assert.ok(anyshare.archived_from.includes("enums-legacy-archive-manifest"), "归档指针承接 SPEC-016 预留");
  assert.throws(() => readEnumsForSubject(vaultPath, "anyshare"), (e) => e.code === "SUBJECT_NOT_MOUNTED");
});
