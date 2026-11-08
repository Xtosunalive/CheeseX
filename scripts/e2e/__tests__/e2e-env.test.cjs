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
