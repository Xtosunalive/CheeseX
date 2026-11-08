// WP-027（PR-142）：图输入写通知缝接线——schema-write-service（ontology/enums/versions 族）
// 与 fields-write-service（fields）成功写后必须回调 onGraphInputWrite；写失败不回调；
// 回调自身抛错 fail-open 不阻断写路径。watcher 桥（TheSchema 四件不分内外部写）单测。
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { createSchemaWriteService } = require("../schema-write-service.cjs");
const { createFieldsWriteService } = require("../fields-write-service.cjs");
const { createVaultWatcherService } = require("../../governance/vault-watcher-service.cjs");

const ONTOLOGY_SEED = `ontology_version: "1"
node_types:
  System:
    description: 系统
    category: 服务
    color: cyan
    icon: box
    allows_relations: []
relation_types: {}
inference_rules: []
constraints: []
`;

const ENUMS_SEED = `domains:
  tech: 技术域
layers:
  - id: service
    label: 服务
    color: cyan
    layout: central
`;

function makeSchemaFixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "graph-notify-"));
  const schemaDir = path.join(dir, "知识库", "TheSchema");
  fs.mkdirSync(path.join(schemaDir, "history"), { recursive: true });
  process.env.THESCHEMA_DIR = schemaDir;
  fs.writeFileSync(path.join(schemaDir, "ontology.yaml"), ONTOLOGY_SEED, "utf8");
  fs.writeFileSync(path.join(schemaDir, "enums.yaml"), ENUMS_SEED, "utf8");
  fs.writeFileSync(path.join(schemaDir, "versions.yaml"), "schema_version: 1\nproducts: {}\n", "utf8");
  fs.writeFileSync(path.join(schemaDir, "fields.yaml"), "schema_version: 1\nfields: []\n", "utf8");
  return { dir, schemaDir };
}

function revisionOfRaw(file) {
  const crypto = require("node:crypto");
  return "sha256:" + crypto.createHash("sha256").update(fs.readFileSync(file, "utf8")).digest("hex");
}

test("writeOntology 成功 → 通知 category=ontology；乐观锁冲突失败 → 不通知", () => {
  const fx = makeSchemaFixture();
  const seen = [];
  const svc = createSchemaWriteService({
    vaultPath: fx.dir,
    logger: { info() {}, warn() {}, error() {} },
    gitLedger: { scheduleLedger() {} },
    onGraphInputWrite: (input) => seen.push(input),
  });
  const ontologyPath = path.join(fx.schemaDir, "ontology.yaml");
  const rev = revisionOfRaw(ontologyPath);
  svc.writeOntology({ revision: rev, patch: { constraints: [{ id: "c1", description: "新增约束", check: "check()", severity: "warning" }] } });
  assert.deepEqual(seen.map((s) => s.category), ["ontology"]);
  assert.equal(seen[0].source, "service");
  // 过期 revision → 409 不写不通知
  assert.throws(() => svc.writeOntology({ revision: rev, patch: {} }), (e) => e.code === "SCHEMA_REVISION_CONFLICT");
  assert.equal(seen.length, 1, "失败路径不通知");
  fs.rmSync(fx.dir, { recursive: true, force: true });
});

test("writeEnums 成功 → 通知 category=enums", () => {
  const fx = makeSchemaFixture();
  const seen = [];
  const svc = createSchemaWriteService({
    vaultPath: fx.dir,
    logger: { info() {}, warn() {}, error() {} },
    gitLedger: { scheduleLedger() {} },
    onGraphInputWrite: (input) => seen.push(input),
  });
  const rev = revisionOfRaw(path.join(fx.schemaDir, "enums.yaml"));
  svc.writeEnums({ revision: rev, patch: { layers: [{ id: "svc", label: "服务", color: "cyan", layout: "central" }] } });
  assert.deepEqual(seen.map((s) => s.category), ["enums"]);
  fs.rmSync(fx.dir, { recursive: true, force: true });
});

test("writeVersions 成功 → 通知 category=versions（registry 经 mock 工厂）", () => {
  const fx = makeSchemaFixture();
  const seen = [];
  const svc = createSchemaWriteService({
    vaultPath: fx.dir,
    logger: { info() {}, warn() {}, error() {} },
    gitLedger: { scheduleLedger() {} },
    versionRegistryServiceFactory: () => ({ writeRegistry: () => ({ revision: "sha256:x" }) }),
    onGraphInputWrite: (input) => seen.push(input),
  });
  svc.writeVersions({ revision: "sha256:x", patch: { products: {} } });
  assert.deepEqual(seen.map((s) => s.category), ["versions"]);
  fs.rmSync(fx.dir, { recursive: true, force: true });
});

test("fields 写成功 → 通知 category=fields；回调抛错 fail-open 写路径不受阻", async () => {
  const fx = makeSchemaFixture();
  const seen = [];
  const svc = createFieldsWriteService({
    vaultPath: fx.dir,
    logger: { info() {}, warn() {} },
    onGraphInputWrite: (input) => { seen.push(input); throw new Error("bridge boom"); },
  });
  const fields = [{ name: "title", label: "显示名", type: "string", required: "是", scope: ["entity", "article"], layer: "内容属性", description: "标题" }];
  await assert.doesNotReject(() => svc.writeFields({ fields, expectedRevision: svc.readFields().revision }), "回调抛错不得阻断 fields 写");
  assert.deepEqual(seen.map((s) => s.category), ["fields"]);
  fs.rmSync(fx.dir, { recursive: true, force: true });
});

test("watcher 桥：TheSchema 五件写事件桥接（含内部写——先于归属判定）；非 schema 文件不桥接", () => {
  const fx = makeSchemaFixture();
  const bridged = [];
  const watcher = createVaultWatcherService({
    vaultPath: fx.dir,
    gitLedger: { markSystemFile() {}, isSystemFile: () => false, scheduleLedger() {} },
    logger: { info() {}, warn() {}, error() {} },
    onExternalWrite: () => { throw new Error("不应走到外部桥（本例文件无通道日志＝外部写——但断言只看 schema 桥）"); },
    onSchemaInputWrite: (paths) => bridged.push(paths[0]),
  });
  // 内部写情形：登记为系统文件（isInternalWrite=true）——schema 桥仍必须触发
  const gitLedgerInternal = { markSystemFile() {}, isSystemFile: (p) => p.endsWith("enums.yaml"), scheduleLedger() {} };
  const watcher2 = createVaultWatcherService({
    vaultPath: fx.dir,
    gitLedger: gitLedgerInternal,
    logger: { info() {}, warn() {}, error() {} },
    onSchemaInputWrite: (paths) => bridged.push(paths[0]),
  });
  watcher2.handleEventNow(path.join(fx.schemaDir, "enums.yaml"));
  assert.equal(bridged.length, 1, "内部写（系统文件登记）也桥接");
  watcher2.handleEventNow(path.join(fx.dir, "知识库", "wiki", "doc.md"));
  assert.equal(bridged.length, 1, "非 schema 文件不桥接");
  // WP-049 余量批（PR-141 已落地）：dependencies.yaml 是抽取输入——五件全桥接（清单经端口
  // VOCAB_FILE_NAMES 派生，与抽取指纹/新鲜度面同源；旧「四件」口径随 PR-141 终结）
  watcher2.handleEventNow(path.join(fx.dir, "知识库", "TheSchema", "dependencies.yaml"));
  assert.equal(bridged.length, 2, "dependencies.yaml 是图输入（PR-141）——桥接");
  watcher.handleEventNow(path.join(fx.schemaDir, "ontology.yaml"));
  assert.equal(bridged.length, 3);
  fs.rmSync(fx.dir, { recursive: true, force: true });
});
