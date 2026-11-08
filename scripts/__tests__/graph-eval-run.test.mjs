// L3真实集成：运行公开评分命令及真实Python抽取/评分进程；不操作真实Vault。
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const RUNNER = path.join(ROOT, "scripts/quality/graph-eval-run.mjs");

for (const mode of ["unset", "foreign"]) {
  test(`L3评分器：${mode}数据目录环境下连续两次真实运行一致且不写父目录`, {
    skip: !process.env.PYTHON_PATH && "真实Python集成需显式配置PYTHON_PATH",
    timeout: 60_000,
  }, (t) => {
    const foreign = fs.mkdtempSync(path.join(os.tmpdir(), "graph-eval-parent-"));
    t.after(() => fs.rmSync(foreign, { recursive: true, force: true }));
    const env = { ...process.env };
    delete env.KB_DATA_DIR;
    if (mode === "foreign") env.KB_DATA_DIR = foreign;
    const results = [];
    for (let round = 0; round < 2; round += 1) {
      const run = spawnSync(process.execPath, [RUNNER, "--json"], {
        cwd: ROOT, env, encoding: "utf8", timeout: 25_000, maxBuffer: 4 * 1024 * 1024,
      });
      assert.equal(run.status, 0, `${run.error || ""}\n${run.stdout || ""}\n${run.stderr || ""}`);
      const { graph, truth: _truth, ...result } = JSON.parse(run.stdout);
      assert.ok(result.nodes.tp > 0 && result.edges.tp > 0, "必须真正抽取并评分，空报告不是成功");
      assert.ok(result.missing_edges.includes("e2e-complete-component|entity-e2e-incomplete-component|DEPENDS_ON"), "已知缺边须保留，不改truth冒充满分");
      assert.equal(fs.existsSync(path.dirname(graph)), false, "本轮临时产物应在运行后清理");
      assert.deepEqual(fs.readdirSync(foreign), [], "父环境数据目录不能被本次抽取写入");
      results.push(result);
    }
    assert.deepEqual(results[0], results[1], "连续两次评分应一致，不能混入前轮产物");
  });
}
