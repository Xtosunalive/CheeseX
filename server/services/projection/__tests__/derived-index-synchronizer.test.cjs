// @tests: server/services/projection/derived-index-synchronizer.cjs
// SPEC-012 WP-C 骨架验收——三源管线：boot 全量重建（连续两遍一致＋耗时基线落 sync_state）、
// 通道挂钩增量、watcher external: 桥接、源缺席空投影、fail-open（失败不抛给调用方）。
// 层级：纯单元＋Adapter 契约（内存库；真实文件库行为由 sqlite-adapter.test.cjs 第⑥⑦项覆盖）。
// SPEC-012 wave-2：迁移属主移 derived-index-store——构造形态改为注入 store（内存库）。
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { openPersistenceDb } = require("../../../shared/persistence/sqlite-adapter.cjs");
const { createDerivedIndexStore } = require("../../../shared/persistence/derived-index-store.cjs");
const { createDerivedIndexSynchronizer } = require("../derived-index-synchronizer.cjs");

function makeFixtureVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "derived-sync-")); process.env.THESCHEMA_DIR = path.join(dir, "知识库", "TheSchema"); // SPEC-023 波 1 钉扎
  fs.mkdirSync(path.join(dir, "知识库", "TheSchema"), { recursive: true });
  fs.writeFileSync(path.join(dir, "知识库", "TheSchema", "enums.yaml"), [
    "arch_categories:",
    "  - 架构层A",
    "tags:",
    "  业务: tag-biz",
  ].join("\n"));
  return dir;
}

function makeSync(vaultPath) {
  const store = createDerivedIndexStore(openPersistenceDb()); // :memory:——单测层
  const warnings = [];
  const sync = createDerivedIndexSynchronizer({
    vaultPath,
    store,
    logger: { info() {}, warn(...a) { warnings.push(a); }, error() {} },
  });
  return { sync, store, warnings };
}

test("boot 全量重建：enums 各顶层节进投影表", () => {
  const vault = makeFixtureVault();
  try {
    const { sync } = makeSync(vault);
    const result = sync.rebuildAll();
    assert.equal(result.sectionCount, 2);
    const projections = sync.projections();
    assert.deepEqual(projections.arch_categories, ["架构层A"]);
    assert.deepEqual(projections.tags, { 业务: "tag-biz" });
    assert.equal(sync.getLastSync().kind, "boot-rebuild");
    assert.equal(sync.getLastSync().status, "ok");
    assert.ok(sync.getLastSync().duration_ms >= 0, "耗时基线应落 sync_state");
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
  }
});

test("连续两遍重建结果一致（幂等——SPEC §四.1 可证伪条的基座）", () => {
  const vault = makeFixtureVault();
  try {
    const { sync } = makeSync(vault);
    const first = sync.rebuildAll();
    const second = sync.rebuildAll();
    assert.equal(first.contentHash, second.contentHash, "两遍投影内容哈希一致");
    assert.deepEqual(sync.projections().arch_categories, ["架构层A"]);
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
  }
});

test("通道挂钩增量：enums.yaml 写事件触发刷新（源改动→投影跟手）", () => {
  const vault = makeFixtureVault();
  try {
    const { sync } = makeSync(vault);
    sync.rebuildAll();
    fs.writeFileSync(path.join(vault, "知识库", "TheSchema", "enums.yaml"), "arch_categories:\n  - 新层\n");
    sync.onChannelWrite({ absPath: path.join(vault, "知识库", "TheSchema", "enums.yaml") });
    assert.deepEqual(sync.projections().arch_categories, ["新层"]);
    assert.equal(sync.getLastSync().kind, "channel-incremental");
    // 家族外路径 no-op
    sync.onChannelWrite({ absPath: path.join(vault, "知识库", "其他.md") });
    assert.equal(sync.getLastSync().kind, "channel-incremental");
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
  }
});

test("watcher external: 桥接：外部写 enums.yaml → 投影刷新并记 external-incremental", () => {
  const vault = makeFixtureVault();
  try {
    const { sync } = makeSync(vault);
    sync.rebuildAll();
    fs.writeFileSync(path.join(vault, "知识库", "TheSchema", "enums.yaml"), "doc_types:\n  - 手册\n");
    sync.notifyExternalWrite([path.join(vault, "知识库", "TheSchema", "enums.yaml")]);
    assert.deepEqual(sync.projections().doc_types, ["手册"]);
    assert.equal(sync.getLastSync().kind, "external-incremental");
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
  }
});

test("源缺席：空投影不炸（派生物缺源降级，fail-open）", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "derived-sync-empty-")); process.env.THESCHEMA_DIR = path.join(dir, "知识库", "TheSchema"); // SPEC-023 波 1 钉扎
  try {
    fs.mkdirSync(path.join(dir, "知识库", "TheSchema"), { recursive: true });
    const { sync } = makeSync(dir);
    const result = sync.rebuildAll();
    assert.equal(result.sectionCount, 0);
    assert.deepEqual(sync.projections(), {});
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("fail-open：投影异常不抛给调用方（rebuildAll 吞错记 warn；增量吞错记 warn）", () => {
  const vault = makeFixtureVault();
  try {
    const { sync, warnings } = makeSync(vault);
    // 破坏源形态：enums.yaml 换成不可解析 YAML → 重建失败必须降级为 warn 结果，不 throw
    fs.writeFileSync(path.join(vault, "知识库", "TheSchema", "enums.yaml"), "a: [unclosed");
    const result = sync.rebuildAll();
    assert.equal(result.failed, true, "失败结果标记 failed 而非抛出");
    assert.equal(sync.getLastSync().status, "failed");
    assert.ok(warnings.length > 0, "失败应产生 warn 日志");
    // 增量路径同样 fail-open
    sync.onChannelWrite({ absPath: path.join(vault, "知识库", "TheSchema", "enums.yaml") });
    assert.equal(sync.getLastSync().kind, "channel-incremental");
    assert.equal(sync.getLastSync().status, "failed");
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
  }
});
