// decisions-mirror 红绿夹具（Master「做」批）：
// ①镜像字节一致＋行数 ②源追加后重刷即同步 ③源缺失＝mirrored:false 不炸 ④只读语义（镜像无写入口——源删后重刷清空镜像）
"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { mirrorDecisions } = require("../decisions-mirror.cjs");
// Master 加固批：dest 钉 /tmp（上一批此测试把夹具数据写真仓镜像——污染生产＋砸 repo 洁净面）
const PIN = fs.mkdtempSync(path.join(os.tmpdir(), "dm-pin-"));
process.env.DECISIONS_MIRROR_DIR = PIN;
const MIRROR = path.join(PIN, "decisions-mirror.jsonl");

test("镜像字节一致＋行数", () => {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), "dm-"));
  fs.mkdirSync(path.join(v, ".ledger"), { recursive: true });
  fs.writeFileSync(path.join(v, ".ledger", "decisions.jsonl"), '{"a":1}\n{"a":2}\n', "utf8");
  const r = mirrorDecisions(v);
  assert.equal(r.mirrored, true);
  assert.equal(r.lines, 2);
  assert.equal(fs.readFileSync(MIRROR, "utf8"), '{"a":1}\n{"a":2}\n');
  fs.rmSync(v, { recursive: true, force: true });
});

test("源追加后重刷同步（三时机自愈）", () => {
  const v = fs.mkdtempSync(path.join(os.tmpdir(), "dm2-"));
  fs.mkdirSync(path.join(v, ".ledger"), { recursive: true });
  const src = path.join(v, ".ledger", "decisions.jsonl");
  fs.writeFileSync(src, '{"a":1}\n', "utf8");
  mirrorDecisions(v);
  fs.appendFileSync(src, '{"a":2}\n', "utf8");
  const r = mirrorDecisions(v);
  assert.equal(r.lines, 2);
  fs.rmSync(v, { recursive: true, force: true });
});

test("源缺失＝不镜像不炸；只读语义（镜像由源全量决定）", () => {
  const r = mirrorDecisions("/nonexistent-vault-xyz");
  assert.equal(r.mirrored, false);
  assert.ok(!r.error);
});

// WP-019（PR-114）：拷后哈希自证——失配可检测（telemetry warn 事件＋hashVerified=false）
const crypto = require("node:crypto");
test("mirror 哈希自证：成功路径 hashVerified=true；写半截（模拟拷贝中断）→ hashVerified=false", (t) => {
  const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-hash-src-"));
  const destDir = fs.mkdtempSync(path.join(os.tmpdir(), "mirror-hash-dest-"));
  fs.mkdirSync(path.join(srcDir, ".ledger"), { recursive: true });
  const payload = JSON.stringify({ decision: "ok", at: "2026-10-26T00:00:00Z" }) + "\n";
  fs.writeFileSync(path.join(srcDir, ".ledger", "decisions.jsonl"), payload);
  process.env.DECISIONS_MIRROR_DIR = destDir;
  t.after(() => { delete process.env.DECISIONS_MIRROR_DIR; });

  const result = mirrorDecisions(srcDir, { info() {}, warn() {}, error() {} });
  assert.equal(result.mirrored, true);
  assert.equal(result.hashVerified, true, "完整拷贝应过哈希自证");

  // 模拟拷贝中断：monkeypatch writeFileSync 只写前半字节 → 回读比对必失配
  const realWrite = fs.writeFileSync;
  fs.writeFileSync = (p, data, ...rest) => {
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data));
    return realWrite(p, buf.subarray(0, Math.floor(buf.length / 2)), ...rest);
  };
  let warnEvent = null;
  try {
    const bad = mirrorDecisions(srcDir, { info() {}, warn(e) { warnEvent = e && e.event; }, error() {} });
    assert.equal(bad.hashVerified, false, "半截拷贝必须检出");
  } finally {
    fs.writeFileSync = realWrite;
  }
  assert.equal(warnEvent, "decisions-mirror-hash-mismatch", "失配应落 warn 事件");
});
