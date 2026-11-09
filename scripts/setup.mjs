#!/usr/bin/env node
// WP-143 波5：一键安装——串 npm install → vault:init → 就绪检查（新用户首次 clone 后跑一条命令即可）
// 用法：node scripts/setup.mjs [--vault <路径>]
//   --vault 缺省时交互终端问一句 [回车跳过则用默认路径 ~/cheeseh-vault]
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const step = (n, msg) => console.log(`\n▸ [${n}/3] ${msg}\n`);
const ok = (msg) => console.log(`  ✓ ${msg}`);

// ── 解析 --vault 参数 ──
const vaultArgIdx = process.argv.indexOf("--vault");
let vaultPath = vaultArgIdx > 0 ? process.argv[vaultArgIdx + 1] : null;

// ── 步骤 1：npm install（只装 Node 依赖）──
// 本仓是独立代码仓：.githooks 属私有治理 kit 的挂载点，普通克隆没有，
// 且 npm 未声明 prepare/postinstall，不会自动改 git config。
// 提交钩子只能由维护者显式跑 `gov:setup --with-hooks` 接线（见文末）。
step(1, "npm install（Node 依赖）");
try {
  execFileSync("npm", ["install"], { cwd: ROOT, stdio: "inherit" });
  ok("依赖安装完成");
} catch (e) {
  console.error(`npm install 失败：${e.message}`); process.exit(1);
}

// ── 步骤 2：vault:init（建 vault＋TheSchema 骨架＋Python venv＋写 .env）──
step(2, "vault:init（建知识库 vault＋TheSchema 骨架＋Python 自动装配）");
if (!vaultPath) {
  if (process.stdin.isTTY) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    vaultPath = await new Promise((resolve) => {
      rl.question("你的 Obsidian vault 路径（回车＝默认 ~/cheeseh-vault）：", (a) => { rl.close(); resolve(a.trim() || path.join(process.env.HOME || "~", "cheeseh-vault")); });
    });
  } else {
    vaultPath = path.join(process.env.HOME || process.env.USERPROFILE || "~", "cheeseh-vault");
    console.log(`  非交互终端，使用默认 vault 路径：${vaultPath}`);
  }
}
try {
  execFileSync("npm", ["run", "vault:init", "--", "--vault", vaultPath], { cwd: ROOT, stdio: "inherit" });
  ok("vault 初始化完成");
} catch (e) {
  console.error(`vault:init 失败：${e.message}`); process.exit(1);
}

// ── 步骤 3：就绪检查（门禁投影零漂移＋冲突标记）──
// 原实现调用 scripts/quality/check-domain-registry.mjs——该脚本在本仓并不存在，
// 于是每次都走 catch 打印「跳过」，是静默假绿。改为两个确实存在的仓内自检，
// 且任一失败即 setup 失败，不再吞掉。
step(3, "就绪检查");
try {
  execFileSync("node", ["scripts/quality/gates-fold.mjs", "--check"], { cwd: ROOT, stdio: "inherit" });
  execFileSync("node", ["scripts/quality/check-conflict-markers.mjs"], { cwd: ROOT, stdio: "inherit" });
  ok("门禁投影与冲突标记检查通过");
} catch (e) {
  console.error(`就绪检查失败：${e.message}`);
  process.exit(1);
}

console.log(`
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✓ 安装完成！下一步：

  npm run dev
  → 打开浏览器 http://localhost:5174

  维护者（持有私有治理 kit）：npm run gov:setup -- <kit路径> --with-hooks
  → 挂载治理件并启用提交钩子；普通克隆不需要这一步。

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
