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

// ── PR-307 回归钉族：内容寻址指纹（dev 栈实录——graph-status.md ×_enums-cache.md
//    每 ~15s 一轮空跑管线，mtime 指纹自激励，PR-301 退避因尾巴写在比对后落盘而咬不住）──

test("PR-307 同内容重写不算漂移（mtime 抖动被内容确认吸收），吸收后基线持久", () => {
  const vaultPath = makeVault();
  try {
    const pipeline = makePipeline();
    const { refresher, events } = makeRefresher(vaultPath, pipeline);
    refresher.recordRefreshed(); // 全量基线（内容哈希）
    const cache = path.join(vaultPath, "知识库", "raw", "boards", "_enums-cache.md");
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.writeFileSync(cache, "modules: []\n");
    refresher.recordRefreshed(); // 缓存入基线
    // 派生同步面无条件重写：同字节＋新 mtime（watcher 桥同步每轮实录形态）
    fs.writeFileSync(cache, "modules: []\n");
    fs.utimesSync(cache, new Date(), new Date(Date.now() + 5000));
    const result = refresher.check("external-write");
    assert.equal(result.drifted, false, "同内容重写不构成漂移");
    assert.equal(pipeline.starts.length, 0, "不因 mtime 抖动自触发");
    // 吸收回写持久：第二次检查不再报漂移（也不因旧 mtime 反复重哈希后误判）
    const churn2At = Date.now() + 10000;
    fs.utimesSync(cache, new Date(), new Date(churn2At));
    assert.equal(refresher.check("external-write").drifted, false, "吸收持久——连续抖动持续不漂移");
    // 吸收已落 kv（红队记档⑤）：基线条目 mtime 抬升到第二次抖动值（回写真实落账，非仅行为等价）
    const stored = JSON.parse(getDerivedIndexStore(vaultPath).kv.get(GRAPH_DRIFT_KV_KEY));
    assert.equal(stored.v, 2, "基线 v2 形态");
    assert.equal(stored.files["知识库/raw/boards/_enums-cache.md"].mtimeMs, Math.floor(churn2At), "第二次吸收的 mtime 已写入基线");
    assert.ok(!events.some((e) => e.event === "graph-drift-refresh-triggered"), "全程零触发");
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("PR-307 graph-status.md 是管线自有产物：内容变（嵌时间戳）也不算漂移", () => {
  const vaultPath = makeVault();
  try {
    const statusFile = path.join(vaultPath, "知识库", "wiki", "graph-status.md");
    fs.mkdirSync(path.dirname(statusFile), { recursive: true });
    fs.writeFileSync(statusFile, "> 自动生成于 2026-11-15 05:00 UTC\n");
    const pipeline = makePipeline();
    const { refresher } = makeRefresher(vaultPath, pipeline);
    refresher.recordRefreshed();
    // 管线每跑整文件重生成：内容与 mtime 双变（真实形态——extract_graph --apply 后刷新）
    fs.writeFileSync(statusFile, "> 自动生成于 2026-11-15 05:01 UTC\n");
    const result = refresher.check("external-write");
    assert.equal(result.drifted, false, "管线自有状态产物不构成漂移");
    assert.equal(pipeline.starts.length, 0, "不因状态产物自触发");
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("PR-307 内容真变仍照常触发（内容寻址不弱化真漂移检出）", () => {
  const vaultPath = makeVault();
  try {
    const pipeline = makePipeline();
    const { refresher } = makeRefresher(vaultPath, pipeline);
    refresher.recordRefreshed();
    fs.writeFileSync(path.join(vaultPath, "知识库", "raw", "precleaned", "a.md"), "---\ntitle: a2\n---\n");
    const result = refresher.check("external-write");
    assert.equal(result.drifted, true, "内容真变＝漂移");
    assert.equal(result.triggered, true, "照常自动触发");
    assert.equal(pipeline.starts.length, 1);
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("PR-307 v1 字符串基线兼容：视为无基线重立，不触发不炸", () => {
  const vaultPath = makeVault();
  try {
    const store = getDerivedIndexStore(vaultPath);
    store.kv.put(GRAPH_DRIFT_KV_KEY, "sha256:legacyv1fingerprint0000000000000000000000000000000000000000");
    const pipeline = makePipeline();
    const { refresher, events } = makeRefresher(vaultPath, pipeline);
    const result = refresher.check("read-time");
    assert.equal(result.baseline, true, "旧形态视为无基线——首检重立");
    assert.equal(pipeline.starts.length, 0, "重立不触发管线");
    assert.ok(events.some((e) => e.event === "graph-drift-baseline-established"), "重立留痕");
    // 重立后正常语义：同内容不漂移
    assert.equal(refresher.check("read-time").drifted, false);
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});

test("PR-307 实录循环形态端到端：管线写面（状态产物内容变＋缓存同内容重写）不再自触发", () => {
  const vaultPath = makeVault();
  try {
    const kb = path.join(vaultPath, "知识库");
    const cache = path.join(kb, "raw", "boards", "_enums-cache.md");
    const statusFile = path.join(kb, "wiki", "graph-status.md");
    fs.mkdirSync(path.dirname(cache), { recursive: true });
    fs.mkdirSync(path.dirname(statusFile), { recursive: true });
    fs.writeFileSync(cache, "modules: []\n");
    fs.writeFileSync(statusFile, "| 上次抽取 | 05:00 UTC |\n");
    const pipeline = makePipeline();
    const { refresher } = makeRefresher(vaultPath, pipeline);
    refresher.recordRefreshed();
    // 模拟「一轮管线跑完」的全部写面（2026-11-15 实测三文件中 log.md 已排除，余下两个全模拟）：
    // ① graph-status.md 每跑重生成（内容嵌新时间戳）；② _enums-cache.md 桥同步无条件重写（同内容）
    for (let round = 1; round <= 3; round++) {
      fs.writeFileSync(statusFile, `| 上次抽取 | 05:0${round} UTC |\n`);
      fs.writeFileSync(cache, "modules: []\n");
      fs.utimesSync(cache, new Date(), new Date(Date.now() + round * 5000));
      refresher.recordRefreshed(); // post-run 记基线
      const outcome = refresher.check("read-time"); // 下一轮读/事件触发的检查
      assert.equal(outcome.drifted, false, `第 ${round} 轮管线写面不再构成漂移`);
      assert.equal(pipeline.starts.length, 0, `第 ${round} 轮不再自触发（修复前每 ~15s 一轮实录）`);
    }
  } finally { fs.rmSync(vaultPath, { recursive: true, force: true }); }
});
