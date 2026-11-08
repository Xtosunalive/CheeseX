#!/usr/bin/env node
// @tests: scripts/e2e/lib/playwright-global-setup.mjs assertFixtureStatusVocabAligned（WP-138 R3／PR-262 判力证明）
//   夹具 status 域守卫的负例用例：注入产品词表外的 status → 守卫必须红；干净夹具 → 必须绿。
//   第三支复刻 PR-262 事故形状（夹具词表缺产品盖章值——旧手写三值词表）→ 必须红。
//   夹具经真实构建器产出（build-e2e-vault.mjs 真跑，非手拼替身）。
// 跑法：node --test scripts/e2e/__tests__/build-e2e-vault-vocab.test.cjs
"use strict";

const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const BUILDER = path.join(ROOT, "scripts", "e2e", "lib", "build-e2e-vault.mjs");
const GUARD_PATH = path.join(ROOT, "scripts", "e2e", "lib", "playwright-global-setup.mjs");
const ENTITY_REL = path.join("知识库", "wiki", "entities", "e2e-complete-component.md");
const ENUMS_REL = path.join("知识库", "TheSchema", "enums.yaml");

let vaultPath;
let originalEntity;
let originalEnums;

// 在子进程里调 ESM 守卫（与 e2e-env.test.cjs 的 --input-type=module 手法同源）：
// 守卫绿＝exit 0 stdout GUARD_OK；守卫红＝exit≠0 stderr GUARD_RED:<消息>
function runGuard() {
  const code = `
import { assertFixtureStatusVocabAligned } from ${JSON.stringify("file://" + GUARD_PATH)};
try {
  const r = assertFixtureStatusVocabAligned(process.env.FIXTURE_VAULT);
  process.stdout.write("GUARD_OK:scannedMd=" + r.scannedMd + "\\n");
  process.exit(0);
} catch (e) {
  process.stderr.write("GUARD_RED:" + String(e?.message || e).split("\\n").join(" | ") + "\\n");
  process.exit(1);
}
`;
  return spawnSync("node", ["--input-type=module"], {
    input: code,
    env: { ...process.env, FIXTURE_VAULT: vaultPath },
    encoding: "utf8",
    timeout: 30000,
  });
}

before(() => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "e2e-vocab-guard-"));
  vaultPath = path.join(tmp, "e2e-vault"); // 路径含 e2e，与 requireE2EVault 的 fixture 判据同形
  execFileSync(process.execPath, [BUILDER, "--target", vaultPath, "--force"], {
    cwd: ROOT, encoding: "utf8", timeout: 180000,
  });
  originalEntity = fs.readFileSync(path.join(vaultPath, ENTITY_REL), "utf8");
  originalEnums = fs.readFileSync(path.join(vaultPath, ENUMS_REL), "utf8");
});

after(() => {
  try { fs.rmSync(path.dirname(vaultPath), { recursive: true, force: true, maxRetries: 3 }); } catch { /* 尽力清理 */ }
});

// ── 支 1：干净夹具（构建器产物）→ 守卫必须绿 ──
test("干净夹具：产品主源构造的 status 域全部命中产品词表，守卫绿", () => {
  const r = runGuard();
  assert.equal(r.status, 0, `干净夹具守卫不应红：stderr=${r.stderr}`);
  assert.ok(r.stdout.includes("GUARD_OK"), `stdout 应含 GUARD_OK：stdout=${r.stdout}`);
});

// ── 支 2：注入产品词表外的 status 值 → 守卫必须红（fail-closed 判力）──
test("注入词表外 status 值：守卫红且点名违规文件与值", () => {
  fs.writeFileSync(path.join(vaultPath, ENTITY_REL), originalEntity.replace(/^status: .*$/m, "status: 测试自造状态"), "utf8");
  try {
    const r = runGuard();
    assert.notEqual(r.status, 0, "注入词表外值后守卫必须红（fail-closed），不应放行");
    assert.ok(r.stderr.includes("GUARD_RED"), `stderr 应含 GUARD_RED：stderr=${r.stderr}`);
    assert.ok(r.stderr.includes("测试自造状态"), `红消息应点名注入值：stderr=${r.stderr}`);
    assert.ok(r.stderr.includes("e2e-complete-component.md"), `红消息应点名违规文件：stderr=${r.stderr}`);
  } finally {
    fs.writeFileSync(path.join(vaultPath, ENTITY_REL), originalEntity, "utf8"); // 还原，不污染支 3
  }
});

// ── 支 3：PR-262 事故形状（夹具词表＝旧手写三值，缺产品盖章值）→ 守卫必须红 ──
test("PR-262 形状（词表缺产品盖章值「灰度」）：守卫红并指认修复路径", () => {
  // 旧 build-e2e-vault.mjs 的手写 lifecycle 段原样注入——正是 2026-11-07 事故现场
  const legacyBlock = [
    "lifecycle:",
    "  status: [制定中, 有效, 已归档]",
    "  default_status: 制定中",
  ].join("\n");
  const mutated = originalEnums.replace(/^lifecycle:\n(?:  .*\n|\n)*?(?=\ndomains:)/m, legacyBlock + "\n\n");
  assert.notEqual(mutated, originalEnums, "夹具 enums.yaml 注入应实际发生（测试自身有效性）");
  fs.writeFileSync(path.join(vaultPath, ENUMS_REL), mutated, "utf8");
  try {
    const r = runGuard();
    assert.notEqual(r.status, 0, "PR-262 形状（缺盖章值）必须红——这是本次事故的回归判据");
    assert.ok(r.stderr.includes("灰度"), `红消息应点名缺失的盖章值：stderr=${r.stderr}`);
    assert.ok(r.stderr.includes("build-e2e-vault.mjs"), `红消息应给出修复路径：stderr=${r.stderr}`);
  } finally {
    fs.writeFileSync(path.join(vaultPath, ENUMS_REL), originalEnums, "utf8");
  }
});
