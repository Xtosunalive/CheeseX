// check-py-tests.test.mjs — Python 域测试门禁（SPEC-025 C11/#75）
// 层级：CLI 面（门禁自体行为——pytest 缺失 fail-closed＋正常路径退出码透传）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

test("绿：真仓全量 pytest 退出码 0，且不污染 git 跟踪的治理数据（pipeline-trajectories.jsonl 跑前后字节一致——PR-300 量法修正：环境写入者在场时拒判并点名，不诬告 pytest）", { timeout: 180_000 }, () => {
  const ROOT = path.resolve(HERE, "..", "..", "..");
  const TRAJ = "data/governance/pipeline-trajectories.jsonl";
  const hashOf = () => spawnSync("git", ["hash-object", TRAJ], { cwd: ROOT, encoding: "utf8" }).stdout.trim();
  // PR-300 写入者归因：跑前静默性采样——无 pytest 窗口内账本仍在动＝环境写入者（如常驻 dev
  // 服务 15s 自循环管线）在场，门禁量法对"跑前后哈希差"失去归因力→拒判（fail-safe 指明
  // 凶手待排除），不再把窗口内一切写入记到 pytest 头上（诬告即假红）。
  const quiesceProbe1 = hashOf();
  spawnSync(process.execPath, ["-e", "setTimeout(()=>{},2500)"]);
  const quiesceProbe2 = hashOf();
  const ambientWriter = quiesceProbe1 !== quiesceProbe2;
  const before = quiesceProbe2;
  const r = spawnSync("node", [path.join(HERE, "../check-py-tests.mjs")], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const after = hashOf();
  if (ambientWriter && after !== before) {
    // 拒判≠放行：显式指出归因不可判定，需排掉环境写入者后重跑（PR-301 处置 dev 自循环）
    assert.fail(`pipeline-trajectories.jsonl 在无 pytest 窗口已在被写入（环境写入者在场，PR-300 归因失效）——请先停止常驻 dev 服务（PR-301）后重跑本门禁；本次不判定 pytest 泄漏`);
  }
  assert.equal(after, before, `全量 pytest 往 ${TRAJ} 写入了测试轨迹——测试必须经 PIPELINE_TRAJECTORIES_DIR 隔离`);
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
