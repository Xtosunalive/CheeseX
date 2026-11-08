// SPEC-023 波 3 红队修复批——执法态集成测试（堵三层测试缝）：
// initVaultIO 激活 vault 执法（模拟生产装配）＋ THESCHEMA_DIR 钉仓外目录（模拟真实切换后形态），
// 全部 TheSchema 写路径（enums/fields/versions/article_associations 账本/ontology/dependencies/两投影联动）
// 必须成功——任何一条仍走 vault-io 通道即被目的地执法拦截 → 本测试红（波 3 P0-1 回归锚）。
// WP-075 补实两处空名：③ versions 此前只 require 未写；账本写整条缺席——tr_504310b2 的漏网面。
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const YAML = require("yaml");

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const FIXTURE = path.join(ROOT, "test", "fixtures", "minimal-vault", "知识库", "TheSchema");

test("执法态全写面：initVaultIO 激活＋仓外钉扎——七写路径全通（P0-1 回归锚）", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "enforce-w3-"));
  const schemaDir = path.join(root, "schema"); // 仓外钉扎目录（模拟真实仓内主源的领地语义）
  fs.mkdirSync(schemaDir, { recursive: true });
  for (const n of ["enums.yaml", "versions.yaml"]) fs.copyFileSync(path.join(FIXTURE, n), path.join(schemaDir, n));
  fs.writeFileSync(path.join(schemaDir, "fields.yaml"), `schema_version: 1\nfields:\n  - name: module\n    label: 模块\n    type: list\n    required: 是\n    scope: [entity, article]\n    layer: 业务属性\n    value_domain: { source: modules, resolve: { op: keys } }\n    description: 测试。\n`, "utf8");
  fs.writeFileSync(path.join(schemaDir, "ontology.yaml"), "node_types: {}\nrelation_types: {}\ninference_rules: []\nconstraints: []\n", "utf8");
  fs.writeFileSync(path.join(schemaDir, "dependencies.yaml"), "rules: []\n", "utf8");

  // 生产装配：vault-io 执法激活（钉扎目录在 vault 外——vault 执法对它零放行）
  const vaultRoot = fs.mkdtempSync(path.join(os.tmpdir(), "enforce-vault-"));
  const vio = require("../../../shared/vault-io.cjs");
  vio.initVaultIO({ vaultPath: vaultRoot });
  process.env.THESCHEMA_DIR = schemaDir;
  try {
    // ① enums 写（含解析物联动）
    const { readEnums, writeEnums } = require("../../../services/schema-manager/enums-write-service.cjs");
    const r1 = writeEnums({ vaultPath: vaultRoot, expectedRevision: readEnums(vaultRoot).revision, mutate: (doc) => { if (!doc.has("modules")) doc.set("modules", {}); doc.getIn(["modules"]).set("执法模块", { label: "t" }); } });
    assert.ok(r1.revision.startsWith("sha256:"), "enums 写成功");
    assert.ok(YAML.parse(fs.readFileSync(path.join(schemaDir, "enums.yaml"), "utf8")).modules["执法模块"], "enums 落钉扎领地");

    // ② fields 写（含投影联动）
    const { createFieldsWriteService } = require("../../../services/schema-manager/fields-write-service.cjs");
    const svc = createFieldsWriteService({ vaultPath: vaultRoot, logger: { info() {}, warn() {} } });
    const fields = YAML.parse(fs.readFileSync(path.join(schemaDir, "fields.yaml"), "utf8")).fields;
    const r2 = await svc.writeFields({ fields, expectedRevision: svc.readFields().revision });
    assert.ok(r2.projectionSynced, "fields 写＋投影联动成功");

    // ③ versions 写（WP-075 补实：此行此前只 require 未写——「六写路径全通」对 versions 是空名，
    //    正是 version-registry 分流改造无人可验的缝）
    const { createVersionRegistryService } = require("../../../services/pipeline/version-registry-service.cjs");
    const vrs = createVersionRegistryService({ vaultPath: vaultRoot });
    const registry = vrs.getRegistry();
    const r3 = vrs.writeRegistry(registry.revision, { schema_version: 1, products: registry.products });
    assert.ok(r3.revision, "versions 写成功（落点分流经咽喉→仓内通道）");
    assert.ok(fs.readFileSync(path.join(schemaDir, "versions.yaml"), "utf8").includes("schema_version"), "versions 落钉扎领地");

    // ③b article_associations 账本写（WP-075/P2-8 结项锚）：tr_504310b2 的漏网原因＝本锚从未跑这条
    //     写路径，生产主源翻回仓内后被 F1 目的地执法拦成 500。服务级形态另见 article-association-service.test.cjs。
    const { writeTheSchemaFile } = require("../../../shared/theschema-write.cjs");
    const { contentRevision, ABSENT_REVISION } = require("../../../shared/vault-io.cjs");
    const ledgerPath = path.join(schemaDir, "article_associations.yaml");
    writeTheSchemaFile(ledgerPath, "schema_version: 1\ndecisions: []\n", { vaultPath: vaultRoot, expectedContentHash: ABSENT_REVISION, summary: "锚：账本首建" });
    writeTheSchemaFile(ledgerPath, "schema_version: 1\ndecisions:\n  - articleId: ART-1\n", { vaultPath: vaultRoot, expectedContentHash: contentRevision("schema_version: 1\ndecisions: []\n"), summary: "锚：账本追加" });
    assert.match(fs.readFileSync(ledgerPath, "utf8"), /ART-1/, "账本落钉扎领地（读改写凭据同闸形）");

    // ④ ontology/dependencies 写（schema-write-service 通道）
    const { createSchemaWriteService } = require("../../../services/schema-manager/schema-write-service.cjs");
    const sws = createSchemaWriteService({ vaultPath: vaultRoot });
    // PR-200：乐观锁基线必填——此前 revision:null 走「不比对」直接落盘，现按读到的基线写（同 SHA-256 无缀形）
    const r4 = sws.writeDependencies({ revision: sws.readSchemaYaml("dependencies").revision, patch: { rules: [{ source: "a", target: "b" }] } });
    assert.equal(r4.category, "dependencies");

    // ⑤ 解析物联动产物在领地
    assert.ok(fs.existsSync(path.join(schemaDir, "resolved-domains.json")), "解析物联动落领地");
  } finally {
    // 等待 fire-and-forget 联动排空（否则异步回调在目录删除后跑 → unhandledRejection 假红）
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    delete process.env.THESCHEMA_DIR;
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(vaultRoot, { recursive: true, force: true });
  }
});

test("钉扎领地执法：THESCHEMA_DIR＝仓根/根目录 → 拒（红队 P2-4）", () => {
  const { repoWrite } = require("../../../shared/repo-schema-io.cjs");
  const prev = process.env.THESCHEMA_DIR;
  const canary = path.join(os.tmpdir(), "p24-canary.json"); // 目标用 /tmp 金丝雀——绝不可指向真实仓文件（首轮污染教训）
  for (const bad of [ROOT, "/"]) {
    process.env.THESCHEMA_DIR = bad;
    assert.throws(() => repoWrite(canary, "x"), /钉扎领地非法/, `THESCHEMA_DIR=${bad} 须拒`);
  }
  process.env.THESCHEMA_DIR = prev;
});
