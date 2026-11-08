// check-py-tests.test.mjs — Python 域测试门禁（SPEC-025 C11/#75）
// 层级：CLI 面（门禁自体行为——pytest 缺失 fail-closed＋正常路径退出码透传）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

test("绿：真仓全量 pytest 退出码 0，且不污染 git 跟踪的治理数据（pipeline-trajectories.jsonl 跑前后字节一致）", () => {
  const ROOT = path.resolve(HERE, "..", "..", "..");
  const TRAJ = "data/governance/pipeline-trajectories.jsonl";
  const hashOf = () => spawnSync("git", ["hash-object", TRAJ], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  const before = hashOf();
  const r = spawnSync("node", [path.join(HERE, "../check-py-tests.mjs")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.equal(hashOf(), before, `全量 pytest 往 ${TRAJ} 写入了测试轨迹——测试必须经 PIPELINE_TRAJECTORIES_DIR 隔离`);
});

test("红：PATH 无 python3 时 fail-closed 拦截（非静默跳过）", () => {
  const nodeBin = process.execPath; // PATH 失效时 spawn("node") 会 ENOENT——用当前 node 绝对路径
  // 场景＝解释器完全不可达：PATH 失效之外还须剔除外部 PYTHON_PATH（开发机 .env/shell 常设——继承即绕过场景，测试假红）
  const env = { ...process.env, PATH: "/nonexistent" };
  delete env.PYTHON_PATH;
  const r = spawnSync(nodeBin, [path.join(HERE, "../check-py-tests.mjs")], { encoding: "utf8", env });
  assert.ok(r.status !== 0 && r.status !== null, "pytest 不可用必须非零退出（status=" + r.status + "）");
  assert.match(r.stderr + r.stdout, /py_tests=FAIL/);
});
