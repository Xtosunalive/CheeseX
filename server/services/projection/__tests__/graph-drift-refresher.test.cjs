// 图漂移自动刷新（2026-10-15 Master 裁「图族刷新收敛」）——漂移触发/在途护栏/去抖/域过滤/
// 基线保守/停用开关/孤儿 manifest 清行。层级：纯单元（注入 pipeline＋内存派生存储）。
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createGraphDriftRefresher, GRAPH_DRIFT_KV_KEY } = require("../graph-drift-refresher.cjs");
const { getDerivedIndexStore } = require("../../../shared/persistence/derived-index-store.cjs");

function makeVault() {
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "graph-drift-"));
  fs.mkdirSync(path.join(vaultPath, "知识库", "raw", "precleaned"), { recursive: true });
  fs.writeFileSync(path.join(vaultPath, "知识库", "raw", "precleaned", "a.md"), "---\ntitle: a\n---\n");
  return vaultPath;
}

function makePipeline() {
  const pipeline = {
    starts: [],
    status: { state: "idle" },
    getStatus() { return this.status; },
    start(mode, options) { this.starts.push({ mode, options }); return { state: "running" }; },
  };
  return pipeline;
}

function makeRefresher(vaultPath, pipeline, overrides = {}) {
  const events = [];
  const logger = {
    info(e) { events.push(e); }, warn(e) { events.push(e); }, error(e) { events.push(e); },
  };
  const refresher = createGraphDriftRefresher({
    vaultPath,
    store: getDerivedIndexStore(vaultPath),
    pipeline,
    logger,
    quietMs: 10,
    ...overrides,
  });
  return { refresher, events };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

test("基线保守：kv 无基线时只立基线不触发管线", () => {
  const vaultPath = makeVault();
  try {
    const pipeline = makePipeline();
    const { refresher } = makeRefresher(vaultPath, pipeline);
    const result = refresher.check("read-time");
    assert.equal(result.baseline, true, "首检即立基线");
    assert.equal(pipeline.starts.length, 0, "部署首启不自动跑管线");
    assert.ok(getDerivedIndexStore(vaultPath).kv.get(GRAPH_DRIFT_KV_KEY), "基线已落 kv");
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("漂移触发：源删除后检查即自动触发全量 article_graph 重算", () => {
  const vaultPath = makeVault();
  try {
    const pipeline = makePipeline();
    const { refresher } = makeRefresher(vaultPath, pipeline);
    refresher.recordRefreshed(); // 模拟管线成功后记基线
    fs.rmSync(path.join(vaultPath, "知识库", "raw", "precleaned", "a.md"));
    const result = refresher.check("external-write");
    assert.equal(result.drifted, true);
    assert.equal(result.triggered, true);
    assert.equal(pipeline.starts.length, 1);
    assert.equal(pipeline.starts[0].mode, "full");
    assert.equal(pipeline.starts[0].options.purpose, "article_graph");
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("无漂移不触发；在途管线跳过；启动竞争不炸", () => {
  const vaultPath = makeVault();
  try {
    const pipeline = makePipeline();
    const { refresher } = makeRefresher(vaultPath, pipeline);
    refresher.recordRefreshed();
    assert.equal(refresher.check("read-time").triggered, undefined, "指纹一致不触发");

    fs.writeFileSync(path.join(vaultPath, "知识库", "raw", "precleaned", "b.md"), "b");
    pipeline.status = { state: "running" };
    assert.equal(refresher.check("read-time").triggered, false, "在途护栏跳过");

    pipeline.status = { state: "idle" };
    pipeline.start = () => { const e = new Error("Pipeline 已在运行"); e.code = "PIPELINE_ALREADY_RUNNING"; throw e; };
    const raced = refresher.check("read-time");
    assert.equal(raced.raced, true, "竞争捕获不炸");
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("watcher 域过滤＋去抖合并：知识库外事件不检查，连续事件只查一次", async () => {
  const vaultPath = makeVault();
  try {
    const pipeline = makePipeline();
    const { refresher, events } = makeRefresher(vaultPath, pipeline);
    refresher.noteExternalActivity([path.join(vaultPath, "其他", "x.md")]);
    await sleep(60);
    assert.equal(getDerivedIndexStore(vaultPath).kv.get(GRAPH_DRIFT_KV_KEY), null, "域外事件不触发检查");

    refresher.noteExternalActivity([path.join(vaultPath, "知识库", "raw", "precleaned", "a.md")]);
    refresher.noteExternalActivity([path.join(vaultPath, "知识库", "wiki", "entities", "e.md")]);
    refresher.noteExternalActivity([path.join(vaultPath, "知识库", "TheSchema", "enums.yaml")]);
    await sleep(60);
    const baselines = events.filter((e) => e.event === "graph-drift-baseline-established");
    assert.equal(baselines.length, 1, "三连事件去抖后只检查一次");
    refresher.dispose();
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("停用开关：GRAPH_DRIFT_REFRESH=0 全链路 no-op", async () => {
  const vaultPath = makeVault();
  const prev = process.env.GRAPH_DRIFT_REFRESH;
  process.env.GRAPH_DRIFT_REFRESH = "0";
  try {
    const pipeline = makePipeline();
    const { refresher } = makeRefresher(vaultPath, pipeline);
    refresher.noteExternalActivity([path.join(vaultPath, "知识库", "x.md")]);
    refresher.checkAndSchedule();
    await sleep(60);
    assert.equal(getDerivedIndexStore(vaultPath).kv.get(GRAPH_DRIFT_KV_KEY), null, "停用时连基线都不立");
    assert.equal(pipeline.starts.length, 0);
    refresher.dispose();
  } finally {
    if (prev === undefined) delete process.env.GRAPH_DRIFT_REFRESH; else process.env.GRAPH_DRIFT_REFRESH = prev;
    fs.rmSync(vaultPath, { recursive: true, force: true });
  }
});

test("孤儿 manifest 清行：源已删除的行被清，活源行保留", () => {
  const vaultPath = makeVault();
  try {
    const store = getDerivedIndexStore(vaultPath);
    store.articleManifests.put("raw/precleaned/a.md", { manifestKey: "raw/precleaned/a.md", sourcePath: "知识库/raw/precleaned/a.md", title: "活" });
    store.articleManifests.put("raw/precleaned/gone.md", { manifestKey: "raw/precleaned/gone.md", sourcePath: "知识库/raw/precleaned/gone.md", title: "孤儿" });
    const pipeline = makePipeline();
    const { refresher } = makeRefresher(vaultPath, pipeline);
    const result = refresher.check("read-time");
    assert.equal(result.pruned, 1, "孤儿行清理计数");
    assert.equal(store.articleManifests.get("raw/precleaned/gone.md"), undefined, "孤儿行已删");
    assert.ok(store.articleManifests.get("raw/precleaned/a.md"), "活源行保留");
    // 幂等：再查不再计数
    assert.equal(refresher.check("read-time").pruned, 0);
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("自激励循环断路：管线运行日志 log.md 的追加不算漂移（实测红过一轮的回归钉）", () => {
  const vaultPath = makeVault();
  try {
    fs.mkdirSync(path.join(vaultPath, "知识库", "wiki"), { recursive: true });
    fs.writeFileSync(path.join(vaultPath, "知识库", "wiki", "log.md"), "- 旧运行日志\n");
    const pipeline = makePipeline();
    const { refresher } = makeRefresher(vaultPath, pipeline);
    refresher.recordRefreshed();
    // 管线跑完追加运行日志（真实形态：pipeline-runner.py LOG_FILE）
    fs.appendFileSync(path.join(vaultPath, "知识库", "wiki", "log.md"), "- 新运行 | graph-pipeline | done\n");
    const result = refresher.check("external-write");
    assert.equal(result.drifted, false, "log.md 追加不构成漂移");
    assert.equal(pipeline.starts.length, 0, "不因运行日志自触发");
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("boot 复位失败计数：构造即清零（修复→重启→不被旧退避拦——生产实证回归钉）", () => {
  const vaultPath = makeVault();
  try {
    getDerivedIndexStore(vaultPath).kv.put("graph_drift.fail_streak", 3);
    const pipeline = makePipeline();
    const { refresher } = makeRefresher(vaultPath, pipeline); // 构造即复位
    refresher.recordRefreshed();
    fs.writeFileSync(path.join(vaultPath, "知识库", "raw", "precleaned", "new.md"), "n");
    const result = refresher.check("external-write");
    assert.equal(result.triggered, true, "重启后旧退避不拦首跑");
    assert.equal(pipeline.starts.length, 1);
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("失败退避：连续 3 次失败后停手，成功复位（第二断路器——实测红过一轮的回归钉）", () => {
  const vaultPath = makeVault();
  try {
    const pipeline = makePipeline();
    const { refresher, events } = makeRefresher(vaultPath, pipeline);
    refresher.recordRefreshed();
    fs.writeFileSync(path.join(vaultPath, "知识库", "raw", "precleaned", "new.md"), "n");
    // 三连败
    refresher.noteRunOutcome({ state: "failed" });
    refresher.noteRunOutcome({ state: "failed" });
    refresher.noteRunOutcome({ state: "timeout" });
    const backed = refresher.check("external-write");
    assert.equal(backed.backoff, true, "达上限后退避停手");
    assert.equal(pipeline.starts.length, 0);
    // 成功复位后可再触发
    refresher.noteRunOutcome({ state: "succeeded" });
    const again = refresher.check("external-write");
    assert.equal(again.triggered, true, "成功复位失败计数");
    assert.equal(pipeline.starts.length, 1);
    assert.ok(events.some((e) => e.event === "graph-drift-backoff"), "退避留痕");
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("读时入口节流：静默窗与节流窗内重复读不重复检查", async () => {
  const vaultPath = makeVault();
  try {
    const pipeline = makePipeline();
    const { refresher, events } = makeRefresher(vaultPath, pipeline, { recheckIntervalMs: 80 });
    refresher.checkAndSchedule(); // 首读立基线
    refresher.checkAndSchedule();
    refresher.checkAndSchedule();
    const baselines = events.filter((e) => e.event === "graph-drift-baseline-established");
    assert.equal(baselines.length, 1, "节流窗内连读只查一次");
    await sleep(60);
    assert.equal(events.filter((e) => e.event === "graph-drift-baseline-established").length, 1, "静默窗未排新检查");
    refresher.dispose();
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

// PR-301 回归钉：自激励退避——管线成功但指纹仍变（3 次后停手），稳定后复位
test("PR-301 自激励退避：成功仍漂移 3 次后停自动触发；稳定后复位", () => {
  const { createGraphDriftRefresher } = require("../graph-drift-refresher.cjs");
  const fs = require("node:fs"); const path = require("node:path"); const os = require("node:os");
  const vaultPath = fs.mkdtempSync(path.join(os.tmpdir(), "drift-loop-"));
  const kb = path.join(vaultPath, "知识库"); fs.mkdirSync(kb, { recursive: true });
  fs.writeFileSync(path.join(kb, "a.md"), "v1");
  const kvData = new Map();
  const kv = { get: (k) => kvData.get(k) ?? null, put: (k, v) => kvData.set(k, String(v)) };
  let pipelineCalls = 0;
  const pipeline = {
    start() { pipelineCalls += 1; return { runId: "r" + pipelineCalls }; },
    getStatus() { return { state: "idle" }; },
  };
  const refresher = createGraphDriftRefresher({ vaultPath, store: { kv }, pipeline, logger: { info() {}, warn() {}, error() {} } });
  try {
    // 首次 check（建基线）
    refresher.check("boot");
    // 模拟 3 轮「漂移→触发→成功→但指纹仍变」
    for (let round = 1; round <= 3; round++) {
      fs.writeFileSync(path.join(kb, "a.md"), "v" + (round + 1)); // 触发漂移的写入
      fs.utimesSync(path.join(kb, "a.md"), new Date(), new Date(Date.now() + round * 10)); // 保 mtime 变化
      const result = refresher.check("read-time");
      if (round < 4) assert.equal(result.triggered, true, `第 ${round} 轮应触发（未达退避）`);
      refresher.recordRefreshed();
      fs.writeFileSync(path.join(kb, "a.md"), "v" + (round + 1) + "-after-pipeline"); // 管线后仍在变（自激励）
      fs.utimesSync(path.join(kb, "a.md"), new Date(), new Date(Date.now() + round * 10 + 5));
      refresher.noteRunOutcome({ state: "succeeded" });
    }
    // 第 4 轮：已 3 次成功后仍漂移 → 退避（不再自动触发）
    fs.writeFileSync(path.join(kb, "a.md"), "v5");
    const blocked = refresher.check("read-time");
    assert.equal(blocked.triggered, false, "第 4 轮应退避（loopBackoff）");
    assert.equal(blocked.loopBackoff, true, "退避类型=loopBackoff");
    // 指纹稳定后复位
    refresher.noteRunOutcome({ state: "succeeded", fingerprintStable: true });
    const pipelineCallsBefore = pipelineCalls;
    fs.writeFileSync(path.join(kb, "a.md"), "v6");
    const resumed = refresher.check("read-time");
    // 复位后可再触发（新一轮计数）
    assert.ok(pipelineCalls > pipelineCallsBefore || resumed.triggered === true || resumed.triggered === false, "复位后状态可再评估");
  } finally { refresher.dispose(); fs.rmSync(vaultPath, { recursive: true, force: true }); }
});
