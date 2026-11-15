// releases-dir resolver 测试（WP-023/PR-127）。分层：
//   L1 纯解析——显式注入＞RELEASES_DIR env＞新家 .releases/；两家皆无＝新家
//   退役钉（2026-11-15 PR-243 终裁「都清」）——旧家 .git/anyshare-releases 在场也被无视：
//   不读、不迁、不建（真仓实测旧目录无存量数据，回落与一次性搬迁逻辑整件退役）
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

test("退役钉：仅旧家在场 → 照常解析新家，不读不迁不建（旧目录回落已整件退役）", () => {
  const root = tmpRoot();
  const legacy = path.join(root, ".git", "anyshare-releases");
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, "current.json"), '{"releaseId":"release-abc"}');

  const r = resolveReleasesDir({ vaultPath: root });
  assert.equal(r.dir, path.join(root, ".releases"));
  assert.equal(fs.existsSync(path.join(root, ".releases")), false, "不搬迁：新家不因旧家在场而创建");
  assert.ok(fs.existsSync(path.join(legacy, "current.json")), "旧家原地不动（git 内部内容不删）");
});
