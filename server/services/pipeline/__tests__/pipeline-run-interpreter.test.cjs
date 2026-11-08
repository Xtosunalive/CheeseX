const assert = require("assert");
const { EventEmitter } = require("events");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { test } = require("node:test");
const { createPipelineRunService } = require("../pipeline-run-service.cjs");
const { createJsonLogger } = require("../../../shared/json-logger.cjs");

// ADR-002：外部进程调用禁止裸解释器，一律 `PYTHON_PATH || "python3"`。
// 本文件守护重建链路（可从 Vault 重建的唯一通路）的解释器解析。

function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = function () { child.emit("close", 143); };
  return child;
}

function makeVault() {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "pipeline-interpreter-"));
  const scripts = path.join(vault, "知识库", ".claude", "scripts");
  fs.mkdirSync(scripts, { recursive: true });
  fs.writeFileSync(path.join(scripts, "pipeline-runner.py"), "# fixture\n");
  fs.mkdirSync(path.join(vault, ".ledger"), { recursive: true });
  return vault;
}

async function capturedCommand(extraOptions) {
  const calls = [];
  const child = fakeChild();
  const service = createPipelineRunService(Object.assign({
    vaultPath: makeVault(),
    archRepo: "/tmp/rebuild",
    logger: createJsonLogger({ sink: () => {} }),
    spawnProcess(command) { calls.push(command); return child; },
  }, extraOptions));
  service.start("full");
  const command = calls[0];
  child.emit("close", 0);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  return command;
}

test("显式注入解释器路径时，管线调用使用该路径", async () => {
  const command = await capturedCommand({ pythonPath: "/custom/python" });
  assert.strictEqual(command, "/custom/python");
});

test("未注入时回退到环境变量 PYTHON_PATH", async () => {
  const previous = process.env.PYTHON_PATH;
  process.env.PYTHON_PATH = "/env/python";
  try {
    const command = await capturedCommand({});
    assert.strictEqual(command, "/env/python");
  } finally {
    if (previous === undefined) delete process.env.PYTHON_PATH;
    else process.env.PYTHON_PATH = previous;
  }
});

test("两者皆无时回退 python3（不回归）", async () => {
  const previous = process.env.PYTHON_PATH;
  delete process.env.PYTHON_PATH;
  try {
    const command = await capturedCommand({});
    assert.strictEqual(command, "python3");
  } finally {
    if (previous === undefined) delete process.env.PYTHON_PATH;
    else process.env.PYTHON_PATH = previous;
  }
});

test("解释器不可用时产生可见失败而非假成功（H3 · 真实 spawn，非 Mock）", async () => {
  const vault = makeVault();
  const service = createPipelineRunService({
    vaultPath: vault,
    archRepo: "/tmp/rebuild",
    logger: createJsonLogger({ sink: () => {} }),
    pythonPath: "/nonexistent/python-for-lens-test",
  });
  service.start("full");
  let status = service.getStatus();
  for (let i = 0; i < 100; i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
    status = service.getStatus();
    if (status.state !== "running") break;
  }
  assert.strictEqual(status.state, "failed", "解释器不可用必须判定为失败，禁止假成功");
  assert.ok(status.message && status.message.length > 0, "失败原因必须可见，禁止静默");
});
test("服务端与脚本不存在裸 python3 调用点（静态断言）", () => {
  const repoRoot = path.join(__dirname, "..", "..", "..", "..");
  // 2026-10-21 扩面：__tests__ 不再跳过——classify-convergence.test.cjs 的裸 python3 正是藏在
  // 测试目录里躲过本扫描（CI node-tests 假红，Master 审计定位）；test/ 顶层目录一并纳入。
  const skipDirs = new Set(["node_modules", "dist", ".gitnexus", ".git", "test-results"]);
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (skipDirs.has(entry.name)) continue;
        walk(path.join(dir, entry.name));
      } else if (/\.(cjs|mjs)$/.test(entry.name)) {
        const text = fs.readFileSync(path.join(dir, entry.name), "utf-8");
        if (/\(\s*["']python3["']\s*[,)]/.test(text)) offenders.push(path.relative(repoRoot, path.join(dir, entry.name)));
      }
    }
  };
  walk(path.join(repoRoot, "server"));
  walk(path.join(repoRoot, "scripts"));
  walk(path.join(repoRoot, "test"));
  assert.deepStrictEqual(offenders, [], "发现裸 python3 调用点，违反 ADR-002");
});

test("finish 竞态守卫：双次并发 finish 只生效一次（W2 红队 advisory 修复）", async () => {
  const vault = makeVault();
  const child = fakeChild();
  let hookCalls = 0;
  const service = createPipelineRunService({
    vaultPath: vault,
    archRepo: "/tmp/rebuild",
    logger: createJsonLogger({ sink: () => {} }),
    spawnProcess() { return child; },
  });
  service.addCompletionHook(async () => {
    hookCalls++;
    await new Promise((resolve) => setTimeout(resolve, 30)); // 模拟 hooks 挂起窗口
    return { status: "completed" };
  });
  service.start("full");
  // close 触发首调 finish（进入 hooks await 挂起窗口）
  child.emit("close", 0);
  await new Promise((resolve) => setImmediate(resolve));
  // 窗口内注入二调（模拟 bridge close 竞态）：必须被 in-flight 守卫丢弃
  // 直接打内部不可行（不导出），改用真实通道：再 emit 一次 close——守卫应吞掉
  child.emit("close", 1);
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.strictEqual(hookCalls, 1, "completionHooks 必须只跑一次（二调被守卫丢弃）");
  const status = service.getStatus();
  assert.strictEqual(status.state, "succeeded", "终态取首调结果，不被二调污染");
});
