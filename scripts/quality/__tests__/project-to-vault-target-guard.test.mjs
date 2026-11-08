// project-to-vault 投影目标守卫——红绿双证：KB_VAULT 解析到仓根/仓内子目录红（拒绝且不落盘）、仓外 Vault 绿（正常投影）。
// 回归面：7a52c9c1 曾把「04-项目/专家团管控项目进度-cheeseh/」整目录写进代码仓并入库。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "quality", "dev-log", "project-to-vault.mjs");
const PROJECTION_DIR = `专家团管控项目进度-${path.basename(ROOT)}`;

function run(kbVault) {
  const env = { ...process.env, KB_VAULT: kbVault };
  delete env.VAULT_PATH;
  const r = spawnSync("node", [SCRIPT], { env, encoding: "utf-8", cwd: ROOT });
  return { code: r.status, out: String(r.stdout || "") + String(r.stderr || "") };
}

test("KB_VAULT 指向仓根：拒绝（exit 非 0）且不在仓内落盘", () => {
  const leaked = path.join(ROOT, "04-项目", PROJECTION_DIR);
  assert.equal(fs.existsSync(leaked), false, "前置：仓内不应已有投影目录");
  const r = run(ROOT);
  try {
    assert.notEqual(r.code, 0);
    assert.match(r.out, /refused/);
    assert.equal(fs.existsSync(leaked), false, "守卫失效：投影目录被写进代码仓");
  } finally {
    fs.rmSync(path.join(ROOT, "04-项目"), { recursive: true, force: true });
  }
});

test("KB_VAULT 指向仓内子目录：同样拒绝", () => {
  const leaked = path.join(ROOT, "docs", "04-项目");
  const r = run(path.join(ROOT, "docs"));
  try {
    assert.notEqual(r.code, 0);
    assert.match(r.out, /refused/);
    assert.equal(fs.existsSync(leaked), false);
  } finally {
    fs.rmSync(leaked, { recursive: true, force: true });
  }
});

test("KB_VAULT 指向仓外 Vault：正常投影到 <vault>/04-项目/<带仓名目录>", () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "ptv-vault-"));
  try {
    const r = run(vault);
    assert.equal(r.code, 0, r.out);
    const overview = path.join(vault, "04-项目", PROJECTION_DIR, "专家团进度总览.md");
    assert.equal(fs.existsSync(overview), true, "仓外投影未产出总览页");
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
  }
});
