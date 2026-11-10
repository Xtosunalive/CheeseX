// PR-101 回归：发布打包器取料面迁仓对齐（TheSchema 经 resolver；SA/layout 补冻结槽物化）。
// 分层：L2 Adapter 契约（打包器输出的包内路径/字节口径）＋L3 真实集成（release-builder 真写制品目录、
// release-reader 经公开读接口回读——"打包器说放进去了"与"读侧读得到"两视角互证）。
// 验证对象：server/services/release-governance/complete-release-artifact-service.cjs（真实模块，零 mock）。
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const { execFileSync } = require("node:child_process");

const REPO_ROOT = path.resolve(__dirname, "../../../.."); // PR-158 钉扎用（基线夹具寻址）

const { collectCompleteArtifacts } = require("../complete-release-artifact-service.cjs");
const { createReleaseBuilderService } = require("../release-builder-service.cjs");
const { createReleaseReaderService } = require("../release-reader-service.cjs");
const { getDerivedIndexStore } = require("../../../shared/persistence/derived-index-store.cjs");
const YAML = require("yaml");
const { REPO_THESCHEMA } = require("../../../shared/theschema-root.cjs");

const FIXTURE_THESCHEMA = path.resolve(__dirname, "../../../../test/fixtures/minimal-vault/知识库/TheSchema");
const SA_BUNDLE = "知识库/architecture/FixtureProduct/1.0.0/semantic_architecture.json";
const LAYOUT_BUNDLE = "知识库/architecture/FixtureProduct/1.0.0/architecture_layout.json";

function write(root, relative, content) {
  const target = path.join(root, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, content);
}

// 新世界 Vault：只有受管文档，没有 知识库/TheSchema、没有任何 Vault 侧 SA/layout 文件
function newWorldVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pr101-vault-"));
  write(root, "知识库/wiki/entities/fixture-component.md", "---\ntitle: Fixture Component\narchitecture-node-id: fixture-component\narch_component: true\nmodule: [fixture-module]\ndate: 2026-10-08\nupdated: 2026-10-08\nstatus: 灰度\ntags: [entity]\n---\n\n# Fixture Component\n");
  // PR-159 夹具密封：vault 侧 TheSchema＝密封基线拷贝＋versions 置空——仓内活注册表（通用/1.0
  // 已冻结带快照）不得渗入夹具（packer 对 released 版本必索快照工件，仓内指针指向真库才存在
  // 的文件，夹具永远给不出）。WP-049 余量批改拷贝源为基线夹具：拷自仓内主源会使断言随仓内
  // 正当演进漂移（首例＝别名/档位数据上升写入）——密封性以固定字节为准，sourcing 意图不变
  // （拷贝即解析目录字节，阶梯/回落两腿照走）。
  const SEALED_THESCHEMA_DIR = path.resolve(REPO_ROOT, "test/fixtures/theschema-baseline");
  for (const name of ["enums.yaml", "ontology.yaml", "versions.yaml"]) {
    const src = path.join(SEALED_THESCHEMA_DIR, name);
    if (fs.existsSync(src)) write(root, path.join("知识库/TheSchema", name), fs.readFileSync(src, "utf8"));
  }
  write(root, "知识库/TheSchema/versions.yaml", "schema_version: 1\nproducts: {}\n");
  fs.mkdirSync(path.join(root, "知识库/wiki/articles"), { recursive: true });
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "pr101-data-"));
  write(dataDir, "master_graph.db", "sqlite-fixture");
  const store = getDerivedIndexStore(root);
  store.artifacts.put("extract_manifest", '{"generatedAt":"volatile","files":{}}\n');
  store.artifacts.put("master_graph", JSON.stringify({ generatedAt: "volatile", nodes: [{ id: "fixture-component", label: "Fixture" }], connections: [] }));
  return { root, dataDir, store };
}

function seedProjectionSlots(store) {
  store.artifacts.put("sa", JSON.stringify({ _format_version: "1.0", generatedAt: "volatile", nodes: [{ id: "fixture-component", label: "Fixture" }], connections: [] }));
  store.artifacts.put("sa_layout", JSON.stringify({ generatedAt: "volatile", positions: { "fixture-component": { x: 3, y: 4 } } }));
}

function withEnv(overrides, fn) {
  const saved = {};
  for (const [key, value] of Object.entries(overrides)) {
    saved[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try { return fn(); }
  finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("L2 新世界：Vault 无 TheSchema、无 SA 文件——TheSchema 经 THESCHEMA_DIR 解析进包、SA/layout 从冻结槽物化到消费端寻址路径", () => {
  const { root, dataDir, store } = newWorldVault();
  seedProjectionSlots(store);
  const artifacts = withEnv({ THESCHEMA_DIR: FIXTURE_THESCHEMA, KB_DATA_DIR: dataDir }, () => collectCompleteArtifacts(root));
  for (const name of ["enums.yaml", "ontology.yaml", "versions.yaml"]) {
    assert.ok(artifacts[`知识库/TheSchema/${name}`], `包内缺 知识库/TheSchema/${name}`);
    assert.equal(artifacts[`知识库/TheSchema/${name}`].toString("utf8"), fs.readFileSync(path.join(FIXTURE_THESCHEMA, name), "utf8"), `${name} 字节须与解析目录一致`);
  }
  assert.equal(artifacts["知识库/TheSchema/article_associations.yaml"].toString("utf8"), "schema_version: 1\ndecisions: []\n");
  assert.ok(artifacts[SA_BUNDLE], "SA 槽应物化到 知识库/architecture/<product>/<version>/");
  assert.ok(artifacts[LAYOUT_BUNDLE], "layout 槽应物化到同目录");
  const sa = JSON.parse(artifacts[SA_BUNDLE].toString("utf8"));
  assert.equal(sa.generatedAt, undefined, "易变键按 stableDerivedJson 剥离（与旧盘读产物口径一致）");
  assert.deepEqual(sa.nodes, [{ id: "fixture-component", label: "Fixture" }]);
  const projections = JSON.parse(artifacts["indexes/semantic-projections.json"].toString("utf8"));
  assert.deepEqual(projections.projections.map((p) => p.sourcePath), [SA_BUNDLE]);
  assert.deepEqual(JSON.parse(artifacts["indexes/architecture-layouts.json"].toString("utf8")).layouts.map((l) => l.sourcePath), [LAYOUT_BUNDLE]);
  assert.ok(artifacts["schema/ontology-capabilities.json"], "本体能力派生须可用（readOntology 经 resolver）");
});

test("L3 两视角：release-builder 真写制品 → release-reader 公开读接口回读 TheSchema 与 SA（读得到且字节一致）", () => {
  const { root, dataDir, store } = newWorldVault();
  seedProjectionSlots(store);
  execFileSync("git", ["init", "-q"], { cwd: root });
  const artifacts = withEnv({ THESCHEMA_DIR: FIXTURE_THESCHEMA, KB_DATA_DIR: dataDir }, () => collectCompleteArtifacts(root));
  const releasesDir = path.join(root, ".git", "anyshare-releases");
  const quiet = { info() {}, warn() {}, error() {} };
  const builder = createReleaseBuilderService({ releasesDir, logger: quiet });
  const manifest = builder.build({ sourceCommit: "0".repeat(40), artifacts });
  fs.writeFileSync(path.join(releasesDir, "current.json"), JSON.stringify({ releaseId: manifest.releaseId, sourceCommit: "0".repeat(40), manifestHash: manifest.manifestHash }));
  const reader = createReleaseReaderService({ builderService: builder, releasesDir, logger: quiet });
  assert.equal(reader.resolveCurrentReleaseId(), manifest.releaseId);
  // 公开读接口要求钉扎的请求上下文（与 HTTP 路由同款 withPinnedRelease）
  reader.withPinnedRelease(() => {
    const enumsBack = reader.readArtifact("知识库/TheSchema/enums.yaml");
    assert.equal(Buffer.from(enumsBack).toString("utf8"), fs.readFileSync(path.join(FIXTURE_THESCHEMA, "enums.yaml"), "utf8"));
    const saBack = JSON.parse(Buffer.from(reader.readArtifact(SA_BUNDLE)).toString("utf8"));
    assert.deepEqual(saBack.nodes, [{ id: "fixture-component", label: "Fixture" }]);
  });
  // 制品目录真实存在（第二视角：文件系统）
  assert.ok(fs.existsSync(path.join(releasesDir, `release-${manifest.releaseId.replace(/^release-/, "")}`)) || fs.readdirSync(releasesDir).some((n) => n.startsWith("release-")), "制品目录须落盘");
});

test("L2 仓内内容 sourcing（密封夹具）：无 THESCHEMA_DIR、vault 侧 TheSchema＝仓内主源拷贝（versions 置空防活状态渗入）→ enums/ontology 字节≡仓内（SPEC-023 切换后形态）", () => {
  const { root, dataDir, store } = newWorldVault();
  // 槽物化寻址随投影身份走（ADR-009）：仓内 enums 的 architecture_projection 现为 通用/1.0
  // （活库实况，33d22efa 入仓）——期望路径按密封拷贝内的身份现算，不再假设平铺根。
  seedProjectionSlots(store);
  // PR-158：仓内回落档钉扎洁净基线夹具——data/theschema 是活库运行态载体（released/挂载身份随用随长），
  // 活态会使打包器索要库外快照工件（假红）。回落「档」的语义由解析结果＝注入目录证明，不消费活态。
  const BASELINE = path.join(REPO_ROOT, "test/fixtures/theschema-baseline");
  const artifacts = withEnv({ THESCHEMA_DIR: undefined, THESCHEMA_REPO_FALLBACK_DIR: BASELINE, KB_DATA_DIR: dataDir }, () => collectCompleteArtifacts(root));
  assert.equal(artifacts["知识库/TheSchema/enums.yaml"].toString("utf8"), fs.readFileSync(path.join(BASELINE, "enums.yaml"), "utf8"));
  assert.equal(artifacts["知识库/TheSchema/ontology.yaml"].toString("utf8"), fs.readFileSync(path.join(BASELINE, "ontology.yaml"), "utf8"));
  // 整合批：saRoot 从基线夹具身份现算（原定义随 main 侧冲突块退役；基线身份=双空 → 平铺根）
  const baselineIdentity = (YAML.parse(fs.readFileSync(path.join(BASELINE, "enums.yaml"), "utf8")) || {}).architecture_projection || {};
  const saRoot = baselineIdentity.product && baselineIdentity.version
    ? `知识库/architecture/${baselineIdentity.product}/${baselineIdentity.version}`
    : "知识库/architecture";
  const saPaths = Object.keys(artifacts).filter((k) => k.endsWith("semantic_architecture.json"));
  assert.deepEqual(saPaths, [`${saRoot}/semantic_architecture.json`]);
});

test("L2 反例 fail-closed：既无 Vault 侧 SA 文件也无冻结槽 → RELEASE_ARTIFACT_MISSING（不假绿）", () => {
  const { root, dataDir } = newWorldVault();
  assert.throws(
    () => withEnv({ THESCHEMA_DIR: FIXTURE_THESCHEMA, KB_DATA_DIR: dataDir }, () => collectCompleteArtifacts(root)),
    (error) => error.code === "RELEASE_ARTIFACT_MISSING" && /Semantic architecture/.test(error.message),
  );
});

test("L2 两源重合：Vault 文件与槽落点同路径 → 以槽为准（管线当前产物），其他版本的 Vault 文件照收", () => {
  const { root, dataDir, store } = newWorldVault();
  seedProjectionSlots(store);
  write(root, SA_BUNDLE, JSON.stringify({ nodes: [{ id: "stale-vault-copy", label: "Stale" }], connections: [] }));
  write(root, LAYOUT_BUNDLE, JSON.stringify({ positions: {} }));
  write(root, "知识库/architecture/FixtureProduct/0.9.0/semantic_architecture.json", JSON.stringify({ nodes: [{ id: "old", label: "Old" }], connections: [] }));
  const artifacts = withEnv({ THESCHEMA_DIR: FIXTURE_THESCHEMA, KB_DATA_DIR: dataDir }, () => collectCompleteArtifacts(root));
  assert.deepEqual(JSON.parse(artifacts[SA_BUNDLE].toString("utf8")).nodes, [{ id: "fixture-component", label: "Fixture" }], "重合路径取槽");
  assert.deepEqual(JSON.parse(artifacts[LAYOUT_BUNDLE].toString("utf8")).positions, { "fixture-component": { x: 3, y: 4 } });
  const projections = JSON.parse(artifacts["indexes/semantic-projections.json"].toString("utf8")).projections.map((p) => p.sourcePath);
  assert.deepEqual(projections, ["知识库/architecture/FixtureProduct/0.9.0/semantic_architecture.json", SA_BUNDLE], "排序稳定且旧版本 Vault 文件照收");
});

test("L2 槽脏数据收口：sa 槽格式主版本不符 / 脏 JSON → 打包器既有码 INVALID_RELEASE_ARTIFACT（不穿出咽喉原码）", () => {
  const { root, dataDir, store } = newWorldVault();
  store.artifacts.put("sa", JSON.stringify({ _format_version: "9.0", nodes: [], connections: [] }));
  store.artifacts.put("sa_layout", JSON.stringify({ positions: {} }));
  assert.throws(
    () => withEnv({ THESCHEMA_DIR: FIXTURE_THESCHEMA, KB_DATA_DIR: dataDir }, () => collectCompleteArtifacts(root)),
    (error) => error.code === "INVALID_RELEASE_ARTIFACT" && /frozen projection artifact sa/.test(error.message) && error.details?.cause === "FORMAT_VERSION_MISMATCH",
  );
  store.artifacts.put("sa", "{not json");
  assert.throws(
    () => withEnv({ THESCHEMA_DIR: FIXTURE_THESCHEMA, KB_DATA_DIR: dataDir }, () => collectCompleteArtifacts(root)),
    (error) => error.code === "INVALID_RELEASE_ARTIFACT" && error.details?.cause === "WORKING_JSON_INVALID",
  );
});

test("L3 消费端级：正式消费服务在钉扎上下文内选中槽物化的 SA（projection 非空）；projection 空置＝合法无主体态（ADR-009 D5）——上下文可建、投影读面 409 空态引导", () => {
  const { createFormalKnowledgeConsumerService } = require("../formal-knowledge-consumer-service.cjs");
  const quiet = { info() {}, warn() {}, error() {} };
  const buildRelease = (root, dataDir, theschemaDir) => {
    execFileSync("git", ["init", "-q"], { cwd: root });
    const artifacts = withEnv({ THESCHEMA_DIR: theschemaDir, KB_DATA_DIR: dataDir }, () => collectCompleteArtifacts(root));
    const releasesDir = path.join(root, ".git", "anyshare-releases");
    const builder = createReleaseBuilderService({ releasesDir, logger: quiet });
    const manifest = builder.build({ sourceCommit: "1".repeat(40), artifacts });
    fs.writeFileSync(path.join(releasesDir, "current.json"), JSON.stringify({ releaseId: manifest.releaseId, sourceCommit: "1".repeat(40), manifestHash: manifest.manifestHash }));
    return createReleaseReaderService({ builderService: builder, releasesDir, logger: quiet });
  };
  // 非空投影（夹具 FixtureProduct/1.0.0）：消费端 readSemanticArchitecture 选中槽物化路径
  const a = newWorldVault();
  seedProjectionSlots(a.store);
  const consumer = createFormalKnowledgeConsumerService({ releaseReader: buildRelease(a.root, a.dataDir, FIXTURE_THESCHEMA) });
  const sa = consumer.withPinnedRelease((ctx) => ctx.readSemanticArchitecture({}));
  assert.deepEqual(sa.nodes, [{ id: "fixture-component", label: "Fixture" }]);
  // 空投影：打包成功；消费端上下文照常建立（无主体态合法——ADR-009 D5，Master 2026-10-25「A」），
  // 不依赖产品身份的读面可用，依赖产品身份的投影读面以定义过的 409 空态引导拒绝（不再 500）。
  // 整合批注：原 PR-159 emptyIdentity 密封段随冲突取 PR-158 基线注入版而退役（下方基线注入即密封）。
  const b = newWorldVault();
  seedProjectionSlots(b.store);
  // PR-158：空主体态前提钉洁净基线（仓内 data/theschema 为活库运行态，挂载身份后空态前提失真）
  const consumerEmpty = createFormalKnowledgeConsumerService({ releaseReader: withEnv({ THESCHEMA_REPO_FALLBACK_DIR: path.join(REPO_ROOT, "test/fixtures/theschema-baseline") }, () => buildRelease(b.root, b.dataDir, undefined)) });
  const identity = consumerEmpty.withPinnedRelease((ctx) => ctx.projectionIdentity);
  assert.deepEqual(identity, { product: null, version: null, mounted: false });
  assert.throws(() => consumerEmpty.withPinnedRelease((ctx) => ctx.readSemanticArchitecture({})), (error) => error.code === "PROJECTION_IDENTITY_UNMOUNTED" && error.status === 409 && error.details?.state === "unmounted");
});
