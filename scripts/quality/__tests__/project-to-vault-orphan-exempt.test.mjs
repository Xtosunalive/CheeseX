// project-to-vault 无主目录豁免回归——.venv/.zcode 为 gitignored 本机工具目录，不得标无主目录 TODO。
// 回归面：2026-10-26 实发——本地树（有 .venv/.zcode）投影出 2 条无主目录假待办、CI 克隆（无）标零，
// 两侧漂移；同日 Master 裁准豁免登记（与 .idea/.vscode 同类）。红证：豁免前 orphan_dirs: 2（TODO-001 .venv / TODO-002 .zcode）。
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

// 与 .gitignore 同口径：真实开发树两目录存在（Python 虚拟环境 / agent 会话配置），CI 克隆没有——
// 测试只在缺失时自建占位、只删自建的（真实目录原样保留，不碰内容）。
const TOOL_DIRS = [".venv", ".zcode"];

test("豁免清单覆盖 .venv/.zcode：投影不把它们标成无主目录待办", () => {
  const created = [];
  for (const d of TOOL_DIRS) {
    const p = path.join(ROOT, d);
    if (!fs.existsSync(p)) {
      fs.mkdirSync(p);
      created.push(p);
    }
  }
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "ptv-orphan-"));
  try {
    const env = { ...process.env, KB_VAULT: vault };
    delete env.VAULT_PATH;
    const r = spawnSync("node", [SCRIPT], { env, encoding: "utf-8", cwd: ROOT });
    assert.equal(r.status, 0, String(r.stdout || "") + String(r.stderr || ""));
    const zone = fs.readFileSync(path.join(vault, "04-项目", PROJECTION_DIR, "辖区管理.md"), "utf8");
    for (const d of TOOL_DIRS) {
      assert.doesNotMatch(zone, new RegExp(`\\| \\\`\\.${d}/\\\` \\|`), `.${d}/ 被标成无主目录待办——豁免清单失效`);
    }
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
    for (const p of created) fs.rmSync(p, { recursive: true, force: true });
  }
});
