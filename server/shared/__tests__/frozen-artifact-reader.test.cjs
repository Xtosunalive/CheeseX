// @tests: server/shared/frozen-artifact-reader.cjs
// PR-084 验收：注册制读侧唯一咽喉——未登记拒（不注册即无读取路径）／缺席与脏数据零值形状（无数据=合法数据态）／
// 格式主版本不符 fail-closed／字节级快照与文档层分工／sa_layout 槽零值。层级：纯单元（内存 derived-index store）。
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const registry = require(path.join(ROOT, "contracts", "frozen-artifacts.registry.json"));
const { getDerivedIndexStore } = require(path.join(ROOT, "server", "shared", "persistence", "derived-index-store.cjs"));
const { readFrozenArtifact, readFrozenArtifactState, readFrozenArtifactSnapshot } = require(
  path.join(ROOT, "server", "shared", "frozen-artifact-reader.cjs"),
);

let scopeSeq = 0;
function scope() { return `/frozen-artifact-test/${process.pid}/${++scopeSeq}`; } // NODE_TEST_CONTEXT 下按键懒建隔离 store

const SA_DOC = { _format_version: "1.0", version: "1.0.0", product: "P", updatedAt: "2026-10-20", components: [{ id: "a" }, { id: "b" }], layers: [], dependencies: [], crosscutting: [] };

// ── 1. 未登记槽名 → fail-closed（结构标尺主证：不注册即无读取路径）──
test("PR-084 未登记槽名 → FROZEN_ARTIFACT_NOT_REGISTERED，三种读法一致拒绝", () => {
  const key = scope();
  for (const fn of [readFrozenArtifact, readFrozenArtifactState, readFrozenArtifactSnapshot]) {
    assert.throws(() => fn(key, "not_a_registered_artifact"), (err) => err.code === "FROZEN_ARTIFACT_NOT_REGISTERED" && err.status === 500);
  }
});

// ── 2. 槽缺席 → 零值形状（文档层：形状合法可直接渲染；present=false）──
test("PR-084 槽缺席 → present=false reason=absent，data 为注册表零值形状（独立拷贝）", () => {
  const key = scope();
  const state = readFrozenArtifactState(key, "sa");
  assert.equal(state.present, false);
  assert.equal(state.reason, "absent");
  assert.deepEqual(state.data, registry.artifacts.sa.zeroValue);
  state.data.components.push("mutated");
  assert.deepEqual(readFrozenArtifact(key, "sa").components, [], "零值每次返回独立拷贝，消费方改动不污染注册表");
});

// ── 3. 脏 JSON → 零值降级（fail-open，不升级 500）──
test("PR-084 脏 JSON → present=false reason=corrupt，仍返回零值形状", () => {
  const key = scope();
  getDerivedIndexStore(key).artifacts.put("sa", "{not json");
  const state = readFrozenArtifactState(key, "sa");
  assert.equal(state.present, false);
  assert.equal(state.reason, "corrupt");
  assert.deepEqual(state.data.components, []);
});

// ── 4. 正常文档 → present=true 原文解析 ──
test("PR-084 合法文档 → present=true reason=ok，data 为解析原文", () => {
  const key = scope();
  getDerivedIndexStore(key).artifacts.put("sa", JSON.stringify(SA_DOC));
  const state = readFrozenArtifactState(key, "sa");
  assert.equal(state.present, true);
  assert.equal(state.reason, "ok");
  assert.equal(state.data.components.length, 2);
  assert.equal(readFrozenArtifact(key, "sa").product, "P");
});

// ── 5. 格式主版本不符 → fail-closed（生产者需重跑，不降级）；缺版本字段 → 放行 ──
test("PR-084 _format_version 主版本不符 → FORMAT_VERSION_MISMATCH；缺字段向后兼容放行", () => {
  const key = scope();
  getDerivedIndexStore(key).artifacts.put("sa", JSON.stringify({ ...SA_DOC, _format_version: "2.0" }));
  assert.throws(() => readFrozenArtifact(key, "sa"), (err) => err.code === "FORMAT_VERSION_MISMATCH");
  const noVersion = { ...SA_DOC }; delete noVersion._format_version;
  getDerivedIndexStore(key).artifacts.put("sa", JSON.stringify(noVersion));
  assert.equal(readFrozenArtifactState(key, "sa").present, true);
});

// ── 6. 字节级快照：有数据带 bytes/revision；缺席 exists=false（字节层「没有就是没有」，零值只属文档层）──
test("PR-084 快照：有数据 revision=sha256 且 path 取自注册表；缺席 exists=false data=null", () => {
  const key = scope();
  const absent = readFrozenArtifactSnapshot(key, "sa");
  assert.equal(absent.exists, false);
  assert.equal(absent.data, null);
  assert.equal(absent.revision, null);
  assert.equal(absent.path, registry.artifacts.sa.stagingPath);
  getDerivedIndexStore(key).artifacts.put("sa", JSON.stringify(SA_DOC));
  const present = readFrozenArtifactSnapshot(key, "sa");
  assert.equal(present.exists, true);
  assert.match(present.revision, /^sha256:[a-f0-9]{64}$/);
  assert.equal(present.data.components.length, 2);
});

// ── 7. sa_layout 槽：注册即有读取路径，零值形状独立 ──
test("PR-084 sa_layout 槽缺席 → 零值 { nodes: [], groups: [] }；无 expectedFormatVersion 不校验版本", () => {
  const key = scope();
  assert.deepEqual(readFrozenArtifact(key, "sa_layout"), { nodes: [], groups: [] });
  getDerivedIndexStore(key).artifacts.put("sa_layout", JSON.stringify({ nodes: [{ id: "n" }], groups: [], _format_version: "9.9" }));
  assert.equal(readFrozenArtifact(key, "sa_layout").nodes.length, 1, "未声明期望版本的槽不做版本校验");
});

// ── 8. 注册表自洽：每槽四字段齐备（注册即口径）──
test("PR-084 注册表每槽 slot/stagingPath/zeroValue 齐备且 zeroValue 为对象", () => {
  for (const [name, entry] of Object.entries(registry.artifacts)) {
    assert.equal(typeof entry.slot, "string", `${name}.slot`);
    assert.match(entry.stagingPath, /^data\/staging\//, `${name}.stagingPath 住 data/staging`);
    assert.equal(typeof entry.zeroValue, "object", `${name}.zeroValue`);
    assert.ok("expectedFormatVersion" in entry, `${name}.expectedFormatVersion 显式声明（null=不校验）`);
  }
});
