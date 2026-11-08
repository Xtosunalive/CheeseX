// resolver 单源行为验证（SPEC-011 §三·附 撤轨后：默认仓内/显式目录/缺文件 503 语义）
// 原「vault 回退双轨」测试随 PR-016 迁移安全网撤轨删除（2026-10-13）。
// node:test 形态，随 test:node 发现模式（server/**/__tests__/*.test.cjs）自动纳入。
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { resolveVaultRuntimeScript, RUNTIME_DIR } = require("../../shared/vault-runtime-resolver.cjs");

test("resolver: 默认走仓内 vault-runtime（dev 源码位）", () => {
  const p = resolveVaultRuntimeScript("validate-article.py", { vaultPath: "/tmp/any-vault" });
  assert.equal(p, path.join(RUNTIME_DIR, "validate-article.py"));
});

test("resolver: 显式目录完全采信（测试注入点）", () => {
  const prev = process.env.VAULT_RUNTIME_SCRIPTS_DIR;
  process.env.VAULT_RUNTIME_SCRIPTS_DIR = "/tmp/custom-dir";
  try {
    assert.equal(resolveVaultRuntimeScript("x.py"), "/tmp/custom-dir/x.py");
  } finally {
    if (prev === undefined) delete process.env.VAULT_RUNTIME_SCRIPTS_DIR;
    else process.env.VAULT_RUNTIME_SCRIPTS_DIR = prev;
  }
});

test("resolver: 缺文件返回仓内位（调用方 existsSync 报 503，不再回退 vault）", () => {
  const prev = process.env.VAULT_RUNTIME_SCRIPTS_DIR;
  delete process.env.VAULT_RUNTIME_SCRIPTS_DIR;
  try {
    // 即便 vault 侧同名文件存在（真实场景=残留副本），也返回仓内位——单源语义
    const p = resolveVaultRuntimeScript("ghost-never-exists.py", { vaultPath: os.tmpdir() });
    assert.equal(p, path.join(RUNTIME_DIR, "ghost-never-exists.py"));
  } finally {
    if (prev !== undefined) process.env.VAULT_RUNTIME_SCRIPTS_DIR = prev;
  }
});

const os = require("os");
