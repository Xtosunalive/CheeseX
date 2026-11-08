// 投影身份状态表（WP-067 / SPEC-067 §二.2）——ADR-009 D5 契约的状态空间单源共表。
// 四态 × {打包器判定, 消费端判定} 双侧同表驱动：新态进表即被测，契约两侧不允许各自为政。
//   · 打包器侧 = collectCompleteArtifacts 真实调用（成对护栏 c0aaa722）
//   · 消费端侧 = 真实 builder/reader/consumer 链（零 mock），半填态经产物层注入构造
//     （护栏后打包器不再铸半身份版——注入是对「存量旧版/外部铸造面」的等价物）
// 层级标注：L2 消费端契约＋L1.5 打包器真实单元（非端到端——端到端由 governance-release-journey 承担）。
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");
const YAML = require("yaml");

const { collectCompleteArtifacts } = require("../complete-release-artifact-service.cjs");
const { createReleaseBuilderService } = require("../release-builder-service.cjs");
const { createReleaseReaderService } = require("../release-reader-service.cjs");
const { createFormalKnowledgeConsumerService } = require("../formal-knowledge-consumer-service.cjs");
const { getDerivedIndexStore } = require("../../../shared/persistence/derived-index-store.cjs");
const { SOURCE_ROOTS } = require("../../projection/document-source-scanner.cjs");

const REPO_ROOT = path.resolve(__dirname, "../../../..");
const FIXTURE_THESCHEMA = path.join(REPO_ROOT, "test/fixtures/minimal-vault/知识库/TheSchema");
const quiet = { info() {}, warn() {}, error() {} };

// ── 状态表（唯一事实源：ADR-009 D5 状态空间）──
// pack: "pass" = 铸版放行；其余 = 期望抛出的错误码
// consume: "unmounted"/"mounted" = projectionIdentity 期望值；其余 = 期望抛出的错误码
const STATES = [
  { name: "双空（未挂载合法空态）", product: "", version: "", pack: "pass", consume: "unmounted" },
  { name: "product 半填（已设产品待冻结）", product: "FixtureProduct", version: "", pack: "RELEASE_PROJECTION_IDENTITY_INVALID", consume: "RELEASE_PROJECTION_IDENTITY_INVALID" },
  { name: "version 半填（版本无产品）", product: "", version: "1.0.0", pack: "RELEASE_PROJECTION_IDENTITY_INVALID", consume: "RELEASE_PROJECTION_IDENTITY_INVALID" },
  { name: "成对（已挂载）", product: "FixtureProduct", version: "1.0.0", pack: "pass", consume: "mounted" },
];

function withEnv(overrides, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(overrides)) { saved[k] = process.env[k]; if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  try { return fn(); } finally { for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; } }
}

// 定制片 TheSchema 目录：夹具复制＋enums 改写为给定状态
function theSchemaFor(state) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "state-theschema-"));
  for (const name of fs.readdirSync(FIXTURE_THESCHEMA)) fs.copyFileSync(path.join(FIXTURE_THESCHEMA, name), path.join(dir, name));
  const enumsPath = path.join(dir, "enums.yaml");
  const enums = YAML.parse(fs.readFileSync(enumsPath, "utf8"));
  enums.architecture_projection = { ...(enums.architecture_projection || {}), product: state.product, version: state.version };
  fs.writeFileSync(enumsPath, YAML.stringify(enums));
  return dir;
}

// 夹具 vault（受管骨架＋管线四件——与 unmounted-subject-state 同构）
function vault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "identity-states-vault-"));
  for (const def of SOURCE_ROOTS) fs.mkdirSync(path.join(root, def.relativePath), { recursive: true });
  fs.mkdirSync(path.join(root, "知识库/wiki/articles"), { recursive: true });
  fs.writeFileSync(path.join(root, "知识库/wiki/entities/fixture-component.md"), "---\narchitecture-node-id: fixture-component\nmodule: [fixture-module]\n---\n\n# Fixture Component\n");
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "identity-states-data-"));
  fs.writeFileSync(path.join(dataDir, "master_graph.db"), "sqlite-fixture");
  const store = getDerivedIndexStore(root);
  store.artifacts.put("extract_manifest", '{"generatedAt":"volatile","files":{}}\n');
  store.artifacts.put("master_graph", JSON.stringify({ generatedAt: "volatile", nodes: [{ id: "fixture-component", label: "Fixture" }], connections: [] }));
  store.artifacts.put("sa", JSON.stringify({ _format_version: "1.0", nodes: [{ id: "fixture-component", label: "Fixture" }], connections: [] }));
  store.artifacts.put("sa_layout", JSON.stringify({ positions: {} }));
  require("node:child_process").execFileSync("git", ["init", "-q"], { cwd: root });
  return { root, dataDir };
}

// 打包＋落发布指针（半填态经 artifactOverrides 注入——护栏拦新铸，见文件头）
function publish(root, dataDir, theschemaDir, { artifactOverrides } = {}) {
  const artifacts = withEnv({ THESCHEMA_DIR: theschemaDir, KB_DATA_DIR: dataDir }, () => collectCompleteArtifacts(root));
  for (const [name, content] of Object.entries(artifactOverrides || {})) artifacts[name] = Buffer.from(content, "utf8");
  const releasesDir = path.join(root, ".releases");
  const builder = createReleaseBuilderService({ releasesDir, logger: quiet });
  const manifest = builder.build({ sourceCommit: "2".repeat(40), artifacts });
  fs.writeFileSync(path.join(releasesDir, "current.json"), JSON.stringify({ releaseId: manifest.releaseId, sourceCommit: "2".repeat(40), manifestHash: manifest.manifestHash }));
  return createReleaseReaderService({ builderService: builder, releasesDir, logger: quiet });
}

function enumsBytesFor(state) {
  const enums = YAML.parse(fs.readFileSync(path.join(FIXTURE_THESCHEMA, "enums.yaml"), "utf8"));
  enums.architecture_projection = { ...(enums.architecture_projection || {}), product: state.product, version: state.version };
  return YAML.stringify(enums);
}

for (const state of STATES) {
  test(`状态表·打包器侧：${state.name} → ${state.pack}`, () => {
    const dir = theSchemaFor(state);
    try {
      const { root, dataDir } = vault();
      if (state.pack === "pass") {
        const artifacts = withEnv({ THESCHEMA_DIR: dir, KB_DATA_DIR: dataDir }, () => collectCompleteArtifacts(root));
        assert.ok(artifacts["indexes/document-search.json"], "放行态必须产出产物集");
      } else {
        assert.throws(() => withEnv({ THESCHEMA_DIR: dir, KB_DATA_DIR: dataDir }, () => collectCompleteArtifacts(root)),
          (error) => error.code === state.pack);
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test(`状态表·消费端侧：${state.name} → ${state.consume}`, () => {
    const { root, dataDir } = vault();
    const consumer = createFormalKnowledgeConsumerService({
      releaseReader: publish(root, dataDir, FIXTURE_THESCHEMA, {
        artifactOverrides: { "知识库/TheSchema/enums.yaml": enumsBytesFor(state) },
      }),
    });
    if (state.consume === "unmounted" || state.consume === "mounted") {
      const identity = consumer.withPinnedRelease((ctx) => ctx.projectionIdentity);
      assert.deepEqual(identity, state.consume === "mounted"
        ? { product: state.product, version: state.version, mounted: true }
        : { product: null, version: null, mounted: false });
    } else {
      assert.throws(() => consumer.withPinnedRelease((ctx) => ctx.projectionIdentity),
        (error) => error.code === state.consume && error.status === 500);
    }
    // 清理只清数据目录——vault 侧发布工件经 0444 封存（read-only-evidence 纪律），交由系统临时目录回收
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
}
