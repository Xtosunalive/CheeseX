// releases-dir resolver 测试（WP-023/PR-127）。分层：
//   L1 纯解析——显式注入＞RELEASES_DIR env＞新家＞两家皆无
//   L2 存量迁移——仅旧家在场 → 一次性搬迁至新家（rename 原子）＋内容完整；旧家只读库跨设备回落 copy（旧家保留）
//   L2 写入恒新家——新家已存在时旧家不再被读
"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { resolveReleasesDir } = require("../releases-dir.cjs");

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "reldir-"));
}

test("L1 解析次序：显式 releasesDir ＞ RELEASES_DIR env ＞ 新家 .releases/；两家皆无＝新家", () => {
  const root = tmpRoot();
  assert.equal(resolveReleasesDir({ vaultPath: root, releasesDir: "/x/y" }).dir, "/x/y");
  process.env.RELEASES_DIR = "/env/z";
  try {
    assert.equal(resolveReleasesDir({ vaultPath: root }).dir, "/env/z");
  } finally { delete process.env.RELEASES_DIR; }
  assert.equal(resolveReleasesDir({ vaultPath: root }).dir, path.join(root, ".releases"));
});

test("L2 存量迁移：仅旧家在场 → 搬迁至新家（内容完整、migrated=true）；二次解析＝新家直读（已迁后不再动）", () => {
  const root = tmpRoot();
  const legacy = path.join(root, ".git", "anyshare-releases");
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, "current.json"), '{"releaseId":"release-abc"}');
  fs.mkdirSync(path.join(legacy, "release-abc"));

  const first = resolveReleasesDir({ vaultPath: root });
  assert.equal(first.dir, path.join(root, ".releases"));
  assert.equal(first.migrated, true, "存量库一次性搬迁");
  assert.ok(fs.existsSync(path.join(root, ".releases", "current.json")), "内容随迁");
  assert.ok(fs.existsSync(path.join(root, ".releases", "release-abc")), "制品目录随迁");

  const second = resolveReleasesDir({ vaultPath: root });
  assert.equal(second.migrated, false);
  assert.equal(second.legacy, false, "新家在场即新家语义");
});

test("L2 新家优先：两家皆在场 → 新家（旧家不读不搬——避免二次覆盖新内容）", () => {
  const root = tmpRoot();
  fs.mkdirSync(path.join(root, ".git", "anyshare-releases"), { recursive: true });
  fs.mkdirSync(path.join(root, ".releases"), { recursive: true });
  const r = resolveReleasesDir({ vaultPath: root });
  assert.equal(r.dir, path.join(root, ".releases"));
  assert.equal(r.migrated, false);
});
