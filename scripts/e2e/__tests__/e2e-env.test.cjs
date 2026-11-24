#!/usr/bin/env node
// @tests: scripts/e2e/lib/e2e-env.mjs (SPEC-011 WP1 守卫单测)
// 验收：注入真实仓路径 → 拒跑（exit≠0 且 stderr 含指引）
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync, spawnSync } = require("node:child_process");
const path = require("node:path");
const os = require("node:os");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..", "..", "..");

// 读取真实 vault 路径（从 .env）
function readRealVaultPath() {
  const envFile = path.join(ROOT, ".env");
  if (!fs.existsSync(envFile)) return null;
  const line = fs.readFileSync(envFile, "utf8")
    .split("\n")
    .find((l) => l.trim().startsWith("VAULT_PATH="));
  if (!line) return null;
  return line.split("=").slice(1).join("=").trim().replace(/^["']|["']$/g, "");
}

// 辅助：在子进程里调用 e2e-env.mjs 的 requireE2EVault()
// 用 --input-type=module 从 stdin 传 ESM 代码，避免临时文件依赖
function runGuard(vaultPath, envOverrides = {}) {
  const guardPath = path.join(ROOT, "scripts", "e2e", "lib", "e2e-env.mjs");
  const code = `
import { requireE2EVault } from ${JSON.stringify("file://" + guardPath)};
try {
  const p = requireE2EVault();
  process.stdout.write("OK:" + p + "\\n");
  process.exit(0);
} catch (e) {
  process.stderr.write(e.message + "\\n");
  process.exit(1);
}
`;
  const env = { ...process.env, ...envOverrides };
  if (vaultPath === null) {
    delete env.VAULT_PATH;
  } else {
    env.VAULT_PATH = vaultPath;
  }
  return spawnSync("node", ["--input-type=module"], {
    input: code,
    env,
    encoding: "utf8",
    timeout: 10000,
  });
}

function runProtectedGuard(vaultPath, protectedVaultPath) {
  const guardPath = path.join(ROOT, "scripts", "e2e", "lib", "e2e-env.mjs");
  const code = `
import { validateE2EVaultPath } from ${JSON.stringify("file://" + guardPath)};
try {
  const p = validateE2EVaultPath(${JSON.stringify(vaultPath)}, ${JSON.stringify(protectedVaultPath)});
  process.stdout.write("OK:" + p + "\\n");
  process.exit(0);
} catch (e) {
  process.stderr.write(e.message + "\\n");
  process.exit(1);
}
`;
  return spawnSync("node", ["--input-type=module"], {
    input: code,
    encoding: "utf8",
    timeout: 10000,
  });
}

// ── 1. VAULT_PATH 未设置时拒跑 ──
test("requireE2EVault: VAULT_PATH 未设置时退出码非 0 且 stderr 含指引", () => {
  const r = runGuard(null);
  assert.notEqual(r.status, 0, "退出码应非 0");
  assert.ok(r.stderr.includes("E2E guard") || r.stderr.includes("VAULT_PATH"),
    "stderr 应含指引信息");
});

// ── 2. VAULT_PATH 指向真实 vault 时拒跑 ──
test("requireE2EVault: VAULT_PATH=真实 vault 时退出码非 0", () => {
  const realVault = readRealVaultPath();
  if (!realVault) {
    // CI 无 .env 时跳过
    console.log("  (skip: no .env VAULT_PATH found)");
    return;
  }
  const r = runGuard(realVault);
  assert.notEqual(r.status, 0, "真实 vault 路径应被拒绝");
  assert.ok(r.stderr.includes("真实 vault") || r.stderr.includes("real vault") || r.stderr.includes("E2E guard"),
    "stderr 应说明拒绝原因");
});

// ── 3. VAULT_PATH 指向 /tmp/cheese-e2e 时通过 ──
test("requireE2EVault: /tmp/cheese-e2e 路径通过守卫", () => {
  const tmpVault = path.join(os.tmpdir(), "cheese-e2e");
  // 路径不需要实际存在——守卫只做字符串检查
  const r = runGuard(tmpVault);
  assert.equal(r.status, 0, "/tmp/cheese-e2e 应通过守卫");
  assert.ok(r.stdout.startsWith("OK:"), "stdout 应以 OK: 开头");
});

// ── 4. VAULT_PATH 含 'e2e' 但不是真实 vault 时通过 ──
test("requireE2EVault: 含 e2e 字样的路径通过守卫", () => {
  const r = runGuard("/some/path/e2e-vault-test");
  assert.equal(r.status, 0, "含 e2e 的路径应通过守卫");
});

// ── 5. VAULT_PATH 路径无 e2e 且不在 /tmp 时拒跑（非 fixture 路径）──
test("requireE2EVault: 无 e2e 且非 /tmp 路径被拒绝", () => {
  // 生成一个看起来像真实仓但不是真实 vault 的路径（无 e2e、非 /tmp）
  const r = runGuard("/Users/nobody/my-notes-vault");
  assert.notEqual(r.status, 0, "非 fixture 路径应被拒绝");
  assert.ok(r.stderr.includes("E2E guard") || r.stderr.includes("fixture"),
    "stderr 应说明拒绝原因");
});

// ── 双通道守卫（2026-10-27 补丁）：浏览器通道 BASE_URL 同源校验 ──
// 事故实录：单跑 e2e 未设 BASE_URL → 默认 5174 常驻 dev（代理真库 API）→ 浏览器通道
// 写真库 4 篇文章。守卫此前只验 API_BASE（脚本直连），浏览器通道裸奔。
function runScopeGuard(apiBase, baseUrl, fixtureVault, fetchImplLiteral) {
  fs.mkdirSync(fixtureVault, { recursive: true }); // computeVaultId 需真实路径（realpath）
  const guardPath = path.join(ROOT, "scripts", "e2e", "lib", "e2e-env.mjs");
  const code = `
import { requireE2EServiceScope } from ${JSON.stringify("file://" + guardPath)};
const fakeFetch = ${fetchImplLiteral};
try {
  const r = await requireE2EServiceScope(${JSON.stringify(apiBase)}, ${JSON.stringify(fixtureVault)}, {
    fetchImpl: fakeFetch,
    ${baseUrl ? `baseUrl: ${JSON.stringify(baseUrl)},` : ""}
  });
  process.stdout.write("OK:" + r.vaultId + "\\n");
  process.exit(0);
} catch (e) {
  process.stderr.write(e.message + "\\n");
  process.exit(1);
}
`;
  return spawnSync("node", ["--input-type=module"], { input: code, encoding: "utf8", timeout: 10000 });
}

// 统一形态：code 内真算 expected（computeVaultId 对 fixture realpath），fakeFetch 按 url 分流
function runDualGuard(fixtureVault, browserVaultId /* "match" | "mismatch" | "down" */) {
  fs.mkdirSync(fixtureVault, { recursive: true });
  const guardPath = path.join(ROOT, "scripts", "e2e", "lib", "e2e-env.mjs");
  const code = `
import { requireE2EServiceScope } from ${JSON.stringify("file://" + guardPath)};
import { createRequire } from "node:module";
const req = createRequire(${JSON.stringify(guardPath)});
const { computeVaultId } = req("../../../server/shared/vault-id.cjs");
const expected = computeVaultId(${JSON.stringify(fixtureVault)});
const mode = ${JSON.stringify(browserVaultId)};
const fakeFetch = (url) => {
  if (mode === "down" && url.includes("5174")) return Promise.reject(new Error("ECONNREFUSED"));
  return Promise.resolve({ status: 200, json: async () => ({
    data: { vaultId: url.includes("5174") ? (mode === "mismatch" ? "realvault0000000000" : expected) : expected },
  }) });
};
try {
  await requireE2EServiceScope("http://127.0.0.1:18999", ${JSON.stringify(fixtureVault)}, {
    fetchImpl: fakeFetch,
    baseUrl: "http://127.0.0.1:5174",
  });
  process.stdout.write("OK\\n");
  process.exit(0);
} catch (e) {
  process.stderr.write(e.message + "\\n");
  process.exit(1);
}
`;
  return spawnSync("node", ["--input-type=module"], { input: code, encoding: "utf8", timeout: 10000 });
}

test("双通道：BASE_URL 前端代理指向真库（vaultId 不匹配）→ 拒跑（2026-10-27 事故场景复现）", () => {
  const r = runDualGuard(path.join(os.tmpdir(), "cheese-e2e-dual-mismatch"), "mismatch");
  assert.notEqual(r.status, 0, "浏览器通道不匹配必须拒跑");
  assert.ok(r.stderr.includes("browser channel scope mismatch"), "应指明浏览器通道不匹配：" + r.stderr);
});

test("双通道：BASE_URL 前端代理同 fixture → 通过", () => {
  const r = runDualGuard(path.join(os.tmpdir(), "cheese-e2e-dual-ok"), "match");
  assert.equal(r.status, 0, "双通道同 fixture 应通过：" + r.stderr);
});

test("双通道：BASE_URL 前端代理不可达 → 拒跑（unproven）", () => {
  const r = runDualGuard(path.join(os.tmpdir(), "cheese-e2e-dual-down"), "down");
  assert.notEqual(r.status, 0);
  assert.ok(r.stderr.includes("browser channel scope unproven"), r.stderr);
});

function fixtureDir(t, prefix) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test("requireE2EVault: vault 自身是符号链接时拒跑", (t) => {
  const root = fixtureDir(t, "cheese-e2e-symlink-");
  const target = path.join(root, "target");
  const link = path.join(root, "cheese-e2e-link");
  fs.mkdirSync(target);
  fs.symlinkSync(target, link, "dir");
  const result = runGuard(link);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /symbolic link is not allowed/);
});

test("requireE2EVault: 不存在路径经祖先链接时按真实祖先规范化", (t) => {
  const root = fixtureDir(t, "cheese-e2e-ancestor-link-");
  const target = path.join(root, "target");
  const link = path.join(root, "parent-link");
  fs.mkdirSync(target);
  fs.symlinkSync(target, link, "dir");
  const result = runGuard(path.join(link, "missing-e2e"));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), `OK:${path.join(fs.realpathSync(target), "missing-e2e")}`);
});

test("requireE2EVault: .git 目录符号链接拒跑", (t) => {
  const vault = fixtureDir(t, "cheese-e2e-git-link-");
  const target = path.join(vault, "outside-git");
  fs.mkdirSync(target);
  fs.symlinkSync(target, path.join(vault, ".git"), "dir");
  const result = runGuard(vault);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /symbolic link is not allowed/);
});

test("validateE2EVaultPath: 真实 vault 的子路径拒跑", (t) => {
  const root = fixtureDir(t, "cheese-e2e-protected-child-");
  const protectedVault = path.join(root, "protected-vault");
  const child = path.join(protectedVault, "nested-e2e");
  fs.mkdirSync(child, { recursive: true });
  const result = runProtectedGuard(child, protectedVault);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /VAULT_PATH points to real vault/);
});

test("validateE2EVaultPath: 不存在子路径经祖先链接指向真实 vault 时拒跑", (t) => {
  const root = fixtureDir(t, "cheese-e2e-protected-alias-");
  const protectedVault = path.join(root, "protected-vault");
  const link = path.join(root, "protected-link");
  fs.mkdirSync(protectedVault);
  fs.symlinkSync(protectedVault, link, "dir");
  const result = runProtectedGuard(path.join(link, "nested-e2e"), protectedVault);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /VAULT_PATH points to real vault/);
});

test("validateE2EVaultPath: 仅同前缀的兄弟路径不误判为真实 vault 子路径", (t) => {
  const root = fixtureDir(t, "cheese-e2e-protected-sibling-");
  const protectedVault = path.join(root, "protected-vault");
  const sibling = path.join(root, "protected-vault-e2e");
  fs.mkdirSync(protectedVault);
  fs.mkdirSync(sibling);
  const result = runProtectedGuard(sibling, protectedVault);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), `OK:${fs.realpathSync(sibling)}`);
});

test("validateE2EVaultPath: 显式空保护路径不得禁用真实 vault 守卫", (t) => {
  const vault = fixtureDir(t, "cheese-e2e-protected-null-");
  for (const protectedVault of [null, ""]) {
    const result = runProtectedGuard(vault, protectedVault);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /protected vault path must be a non-empty string/);
  }
});

test("requireE2EVault: 关键 TheSchema 文件是符号链接时拒跑", (t) => {
  const vault = fixtureDir(t, "cheese-e2e-schema-link-");
  const schemaDir = path.join(vault, "知识库", "TheSchema");
  fs.mkdirSync(schemaDir, { recursive: true });
  const target = path.join(vault, "outside-enums.yaml");
  fs.writeFileSync(target, "domains: {}\n");
  fs.symlinkSync(target, path.join(schemaDir, "enums.yaml"));
  const result = runGuard(vault);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /symbolic link is not allowed/);
});

test("requireE2EVault: 嵌套 ledger 文件是符号链接时拒跑", (t) => {
  const vault = fixtureDir(t, "cheese-e2e-ledger-link-");
  const ledgerDir = path.join(vault, ".ledger");
  fs.mkdirSync(ledgerDir);
  const target = path.join(vault, "outside-ledger.jsonl");
  fs.writeFileSync(target, "");
  fs.symlinkSync(target, path.join(ledgerDir, "channel-write-log.jsonl"));
  const result = runGuard(vault);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /symbolic link is not allowed/);
});

test("requireE2EVault: 合法只读运行时脚本链接通过守卫", (t) => {
  const vault = fixtureDir(t, "cheese-e2e-runtime-link-");
  const scriptsDir = path.join(vault, "知识库", ".claude", "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });
  for (const name of ["schema-write-client.mjs", "article-validator-lib.cjs"]) {
    fs.symlinkSync(path.join(ROOT, "scripts", "vault-runtime", name), path.join(scriptsDir, name));
  }
  const result = runGuard(vault);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.startsWith("OK:"), result.stdout);
});

test("requireE2EVault: 运行时脚本位置不得链接到 vault 外任意文件", (t) => {
  const vault = fixtureDir(t, "cheese-e2e-runtime-escape-");
  const scriptsDir = path.join(vault, "知识库", ".claude", "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });
  const target = path.join(vault, "outside.cjs");
  fs.writeFileSync(target, "module.exports = {};\n");
  fs.symlinkSync(target, path.join(scriptsDir, "schema-write-client.mjs"));
  const result = runGuard(vault);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /symbolic link is not allowed/);
});

test("requireE2EVault: worktree .git 指针拒跑", (t) => {
  const vault = fixtureDir(t, "cheese-e2e-worktree-");
  fs.writeFileSync(path.join(vault, ".git"), "gitdir: /tmp/elsewhere\n");
  const result = runGuard(vault);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /linked worktree \.git pointer is not allowed/);
});

test("requireE2EVault: 真实 vault 的目录链接别名按 realpath 拒跑", (t) => {
  const realVault = readRealVaultPath();
  if (!realVault || !fs.existsSync(realVault)) {
    t.skip("CI 无真实 vault 路径，无法构造目录别名反例");
    return;
  }
  const root = fixtureDir(t, "cheese-e2e-realpath-");
  const parent = path.dirname(fs.realpathSync(realVault));
  fs.symlinkSync(parent, path.join(root, "parent-link"), "dir");
  const alias = path.join(root, "parent-link", path.basename(realVault));
  const result = runGuard(alias);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /(VAULT_PATH points to real vault|指向真实 vault)/);
});
