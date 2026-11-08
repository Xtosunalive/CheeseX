// check-article-lifecycle 门禁自测——红绿双证：违规字面量红、经单源/注释/豁免绿、契约缺角色红。
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "quality", "check-article-lifecycle.mjs");

function runWithFixture(files, contractFixture, envExtra) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gate-fixture-"));
  const serverDir = path.join(dir, "server");
  const contractDir = path.join(dir, "contracts");
  fs.mkdirSync(path.join(serverDir, "nested"), { recursive: true });
  fs.mkdirSync(contractDir, { recursive: true });
  fs.writeFileSync(path.join(contractDir, "article-lifecycle.json"),
    contractFixture || fs.readFileSync(path.join(ROOT, "contracts", "article-lifecycle.json")));
  for (const [rel, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(serverDir, rel), content);
  }
  const env = { ...process.env, CHEESEH_LIFECYCLE_SCAN_ROOT: serverDir, CHEESEH_LIFECYCLE_CONTRACT: path.join(contractDir, "article-lifecycle.json"), ...(envExtra || {}) };
  try {
    const stdout = execFileSync("node", [SCRIPT], { env, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.status, stdout: String(error.stdout || "") + String(error.stderr || "") };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("绿：经单源取用与注释不红", () => {
  const { code, stdout } = runWithFixture({
    "ok.cjs": [
      'const lifecycle = require("../shared/article-lifecycle-paths.cjs");',
      'const d = lifecycle.workingDir(v);',
      '// 注释里写 知识库/raw/precleaned 不算',
      'const x = "precleaned 文章不存在";',
    ].join("\n"),
  });
  assert.equal(code, 0, stdout);
  assert.match(stdout, /article_lifecycle=ok/);
});

test("红：裸拼字面量（含 path.join 段形态与 wiki/articles）即拦", () => {
  const { code, stdout } = runWithFixture({
    "a.cjs": 'const d = path.join(v, "知识库", "raw", "precleaned");',
    "b.cjs": 'if (x.startsWith("知识库/raw/archive/")) return;',
    "c.cjs": 'const r = /^知识库\\/wiki\\/articles\\//;',
  });
  assert.notEqual(code, 0);
  assert.match(stdout, /a\.cjs:1/);
  assert.match(stdout, /b\.cjs:1/);
  assert.match(stdout, /c\.cjs:1/);
});

test("红：契约缺角色/稳态份数越界", () => {
  const broken = JSON.parse(fs.readFileSync(path.join(ROOT, "contracts", "article-lifecycle.json")));
  broken.roles = broken.roles.slice(0, 3);
  const { code, stdout } = runWithFixture({}, JSON.stringify(broken));
  assert.notEqual(code, 0);
  assert.match(stdout, /契约缺角色/);
});

// ── SPEC-028：可变性档三面（红绿双证）──
function stripMutability(contract) {
  return { ...contract, roles: contract.roles.map(({ mutability, ...rest }) => rest) };
}

test("红：角色缺 mutability 声明（SPEC-028 面一）", () => {
  const real = JSON.parse(fs.readFileSync(path.join(ROOT, "contracts", "article-lifecycle.json")));
  const { code, stdout } = runWithFixture({}, JSON.stringify(stripMutability(real)));
  assert.notEqual(code, 0, "缺 mutability 须红");
  assert.match(stdout, /缺 mutability 声明/);
});

test("红：mutability 非法枚举值（SPEC-028 面一）", () => {
  const real = JSON.parse(fs.readFileSync(path.join(ROOT, "contracts", "article-lifecycle.json")));
  const bad = { ...real, roles: real.roles.map((r) => ({ ...r, mutability: "writable" })) };
  const { code, stdout } = runWithFixture({}, JSON.stringify(bad));
  assert.notEqual(code, 0, "非法枚举须红");
  assert.match(stdout, /mutability 非法/);
});

test("红：档位映射与 SPEC-028 §四不符（draft 不得为 read-only-evidence）", () => {
  const real = JSON.parse(fs.readFileSync(path.join(ROOT, "contracts", "article-lifecycle.json")));
  const flipped = { ...real, roles: real.roles.map((r) => (r.id === "draft" ? { ...r, mutability: "read-only-evidence" } : r)) };
  const { code, stdout } = runWithFixture({}, JSON.stringify(flipped));
  assert.notEqual(code, 0, "映射漂移须红");
  assert.match(stdout, /与 SPEC-028 §四映射不符/);
});

test("红：read-only 档执法测试缺位（SPEC-028 面二：声明=执法）", () => {
  const { code, stdout } = runWithFixture({}, null, { CHEESEH_LIFECYCLE_ENFORCE_TEST: "/nonexistent/vault-io.test.cjs" });
  assert.notEqual(code, 0, "执法测试不可读须红（纸面法律防线）");
  assert.match(stdout, /执法测试不可读/);
});

test("绿：真仓契约＋真执法测试——三面全过", () => {
  const { code, stdout } = runWithFixture({});
  assert.equal(code, 0, `真仓面须绿: ${stdout}`);
  assert.match(stdout, /档面=3/);
});
