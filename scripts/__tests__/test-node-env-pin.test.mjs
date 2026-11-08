// test-node 运行器环境钉回归（PR-116）——buildRunnerEnv 纯函数直证：
// ①两钉（DECISIONS_MIRROR_DIR/KB_DATA_DIR）缺省注入一次性目录（含 pid 防跨跑互踩）
// ②显式给出者不覆盖（e2e/单测自钉优先）③未钉键原样透传
// 面向的缺陷面：server/main.cjs 顶层 dataDbPath() 缺省落 repo data/——起真服务的测试
// 漏注入 KB_DATA_DIR 时夹具行进任务树 data/derived-index.db（PR-116 本机实测）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRunnerEnv } from "../test-node.mjs";

test("缺省双钉：镜像与持久层各注入一次性目录（pid 入名）", () => {
  const env = buildRunnerEnv({ PATH: "/bin" }, 4242);
  assert.match(env.DECISIONS_MIRROR_DIR, /test-node-mirror-4242$/);
  assert.match(env.KB_DATA_DIR, /test-node-data-4242$/);
  // runtime-scope 波4：写面四钉齐（轨迹＋分类观察账本——launch_pins_full_set）
  assert.match(env.PIPELINE_TRAJECTORIES_DIR, /test-node-trajectories-4242$/);
  assert.match(env.TAXONOMY_OBSERVATIONS_FILE, /test-node-taxonomy-4242\/taxonomy-observations\.jsonl$/);
  assert.equal(env.PATH, "/bin", "未钉键原样透传");
});

test("显式不覆盖：e2e/单测自钉的 KB_DATA_DIR 优先", () => {
  const env = buildRunnerEnv({ KB_DATA_DIR: "/e2e-data", DECISIONS_MIRROR_DIR: "/m" }, 1);
  assert.equal(env.KB_DATA_DIR, "/e2e-data");
  assert.equal(env.DECISIONS_MIRROR_DIR, "/m");
});
