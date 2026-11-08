// vault-init Node 依赖装配步守护测试（Node 自动装配，Master 2026-11-04 方向「两个都自动安装」）
// 验证对象：probeNodeDeps/ensureNodeDeps 经 main() 注入——fresh 零动作／missing·drifted 自动 npm ci／失败给指引。
// 层级：纯单元＋Adapter（import 注入 repoRoot/npmRunner/logger，真 fs 于 tmp 沙箱）。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..", "..");

function mkRepo({ withInstalled, installedExtras } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wp107-nodedeps-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ dependencies: { alpha: "^1.0.0", beta: "^2.0.0" } }));
  fs.writeFileSync(path.join(dir, "package-lock.json"), JSON.stringify({
    lockfileVersion: 3,
    packages: {
      "": { dependencies: { alpha: "^1.0.0", beta: "^2.0.0" } },
      "node_modules/alpha": { version: "1.2.3" },
      "node_modules/beta": { version: "2.3.4" },
      "node_modules/optional-platform": { version: "9.9.9" }, // 可选平台件——判据不比它
    },
  }));
  if (withInstalled) {
    const packages = {
      "": { dependencies: { alpha: "^1.0.0", beta: "^2.0.0" } },
      "node_modules/alpha": { version: "1.2.3" },
      "node_modules/beta": { version: "2.3.4" },
      ...(installedExtras || {}),
    };
    fs.mkdirSync(path.join(dir, "node_modules"), { recursive: true });
    fs.writeFileSync(path.join(dir, "node_modules", ".package-lock.json"), JSON.stringify({ lockfileVersion: 3, packages }));
  }
  return dir;
}

function mkVaultOutide(repoRoot) {
  return fs.mkdtempSync(path.join(path.dirname(repoRoot), "wp107-vault-"));
}

async function runMain(repoRoot, npmStub, { dry = true } = {}) {
  const { main } = await import(path.join(ROOT, "scripts", "vault-init.mjs"));
  const lines = [];
  const logger = { log: (...a) => lines.push(a.join(" ")), error: (...a) => lines.push(a.join(" ")) };
  const calls = [];
  const npmRunner = npmStub || ((root) => { calls.push(root); });
  const argv = ["--vault", mkVaultOutide(repoRoot), "--no-git"];
  if (dry) argv.push("--dry-run");
  const code = await main(argv, {
    logger, repoRoot, npmRunner, env: {}, interactive: false, prompt: null,
  });
  return { code, lines, calls };
}

test("fresh：直接依赖逐名一致（可选平台件不计）→ 零 npm 调用、node_deps=skipped-fresh", async () => {
  const dir = mkRepo({ withInstalled: true });
  const { code, lines, calls } = await runMain(dir);
  assert.equal(code, 0);
  assert.equal(calls.length, 0, "fresh 不得调用 npm");
  assert.ok(lines.some((l) => l.includes("node_deps=skipped-fresh")), `summary 缺 node_deps 状态：\n${lines.join("\n")}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("missing：node_modules 缺席（新克隆态）→ 自动 npm ci（dry-run 下记 guided 不实装）", async () => {
  const dir = mkRepo({ withInstalled: false });
  const { code, lines, calls } = await runMain(dir);
  assert.equal(code, 0);
  assert.equal(calls.length, 0, "dry-run 不得实调 npm");
  assert.ok(lines.some((l) => l.includes("node 依赖：node_modules 缺席")), "缺席态应有明确日志");
  assert.ok(lines.some((l) => l.includes("node_deps=guided")), `dry-run 应记 guided：\n${lines.join("\n")}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("drifted：实装版本≠声明锁版本 → dry-run 记 drifted 并点名漂移件", async () => {
  const dir = mkRepo({ withInstalled: true, installedExtras: { "node_modules/beta": { version: "2.0.0" } } });
  const { lines } = await runMain(dir);
  assert.ok(lines.some((l) => l.includes("drifted:beta")), `应点名漂移件 beta：\n${lines.join("\n")}`);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("真装路径（非 dry）：桩 npm 落地 .package-lock.json 后复探 fresh → node_deps=installed", async () => {
  const dir = mkRepo({ withInstalled: false });
  const stamp = JSON.stringify({
    lockfileVersion: 3,
    packages: { "": {}, "node_modules/alpha": { version: "1.2.3" }, "node_modules/beta": { version: "2.3.4" } },
  });
  const stubCalls = [];
  const { code, lines } = await runMain(dir, (root) => {
    stubCalls.push(root);
    fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
    fs.writeFileSync(path.join(root, "node_modules", ".package-lock.json"), stamp);
  }, { dry: false });
  assert.equal(code, 0);
  assert.equal(stubCalls.length, 1, "桩 npm 应被调一次");
  assert.ok(lines.some((l) => l.includes("node_deps=installed")), `应记 installed：\n${lines.join("\n")}`);
  fs.rmSync(dir, { recursive: true, force: true });
});
