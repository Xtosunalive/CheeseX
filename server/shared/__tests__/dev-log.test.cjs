const assert = require("node:assert/strict");
const { spawn, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  DEV_LOG_AUTH_LEVELS,
  DEV_LOG_CLASSES,
  DEV_LOG_LEVELS,
  DEV_LOG_OWNERS,
  DEV_LOG_SOURCES,
  createDevLogger,
  emitDevEvent,
  readDevLog,
} = require("../dev-log.cjs");

const SCHEMA = require(path.resolve(__dirname, "..", "..", "..", "contracts", "dev-log.schema.json"));
const OWNER = "server-api-engineer";
const MODULE_PATH = path.resolve(__dirname, "..", "dev-log.cjs");
const REPO_ROOT = path.resolve(__dirname, "..", "..", "..");

function makeEntriesDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dev-log-entries-"));
}

// 在独立进程里发 N 条事件，返回落盘 seq 序列。用于证明"磁盘是唯一事实源"
// （独立进程无共享内存、无状态文件，只能靠扫描台账）。
function runEmitInChild(entriesDir, owner, count) {
  const script = [
    `const { emitDevEvent } = require(${JSON.stringify(MODULE_PATH)});`,
    `const o = { owner: ${JSON.stringify(owner)}, cls: "W3", auth: "none", zone: "docs/", files: [], event: "probe.child" };`,
    `const out = [];`,
    `for (let i = 0; i < ${count}; i++) out.push(emitDevEvent(o, { entriesDir: process.argv[1] }).seq);`,
    `process.stdout.write("SEQ=" + out.join(",") + "\\n");`,
    `setTimeout(() => {}, 100);`,
  ].join("\n");
  const result = spawnSync(process.execPath, ["-e", script, entriesDir], { cwd: REPO_ROOT, encoding: "utf8" });
  assert.equal(result.status, 0, `子进程异常：${result.stderr}`);
  const matched = /SEQ=([\d,]*)/.exec(result.stdout);
  assert.ok(matched, `子进程未输出 SEQ：stdout=${JSON.stringify(result.stdout)} stderr=${JSON.stringify(result.stderr)}`);
  return matched[1].split(",").filter(Boolean).map(Number);
}

async function waitForLines(owner, entriesDir, count, timeoutMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let records = [];
  while (Date.now() < deadline) {
    records = readDevLog(owner, { entriesDir });
    if (records.length >= count) return records;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return records;
}

// 单源化防漂移：枚举必须是"从 schema 派生"而非"代码里另抄一份"。
// 一旦有人把枚举复制回 dev-log.cjs，这条就会红。
test("enums are derived from contracts/dev-log.schema.json (single source, no copy)", () => {
  assert.deepEqual([...DEV_LOG_AUTH_LEVELS], SCHEMA.properties.auth.enum, "auth 枚举必须与 schema 同源");
  assert.deepEqual([...DEV_LOG_CLASSES], SCHEMA.properties.cls.enum, "cls 枚举必须与 schema 同源");
  assert.deepEqual([...DEV_LOG_OWNERS], SCHEMA.properties.owner.enum, "owner 枚举必须与 schema 同源");
  assert.deepEqual([...DEV_LOG_SOURCES], SCHEMA.properties.source.enum, "source 枚举必须与 schema 同源");
  assert.deepEqual([...DEV_LOG_LEVELS], SCHEMA.properties.level.enum, "level 枚举必须与 schema 同源");
  assert.deepEqual([...DEV_LOG_AUTH_LEVELS], ["none", "confirm", "accept"], "授权轴是语义值，不是 L1–L3 编号");
});

test("emitDevEvent appends without rewriting: two calls add exactly two lines", async () => {
  const entriesDir = makeEntriesDir();
  try {
    const base = {
      owner: OWNER,
      cls: "W4",
      auth: "confirm",
      req: "#162",
      zone: "server/shared/",
      files: ["server/shared/dev-log.cjs"],
      source: "dev",
    };
    const first = emitDevEvent({ ...base, cmd: "node --test", exit: 0, duration_ms: 12.5, event: "dev-log.created" }, { entriesDir });
    const second = emitDevEvent({ ...base, cmd: "npm run check:dev-log", exit: 1, duration_ms: 88.25, event: "dev-log.verified" }, { entriesDir });

    const records = await waitForLines(OWNER, entriesDir, 2);
    assert.equal(records.length, 2, "append-only：两次调用应恰好新增两行");

    const rawLines = fs.readFileSync(path.join(entriesDir, `${OWNER}.jsonl`), "utf8").split("\n").filter(Boolean);
    assert.equal(rawLines.length, 2);
    // 契约守卫：一行只允许一个 ts / level 键（由 json-logger 的格式化器单源写入）
    for (const line of rawLines) {
      assert.equal(line.match(/"ts":/g).length, 1, `一行只能有一个 ts 键：${line}`);
      assert.equal(line.match(/"level":/g).length, 1, `一行只能有一个 level 键：${line}`);
      assert.match(JSON.parse(line).ts, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, "ts 必须是 ISO8601");
    }

    assert.equal(records[0].event, "dev-log.created");
    assert.equal(records[1].event, "dev-log.verified");
    assert.equal(records[0].exit, 0);
    assert.equal(records[1].exit, 1);
    assert.equal(records[0].duration_ms, 12.5);
    assert.equal(records[1].zone, "server/shared/");
    assert.deepEqual(records[0].files, ["server/shared/dev-log.cjs"]);
    assert.equal(records[0].source, "dev");
    assert.equal(records[0].cls, "W4");
    assert.equal(records[0].auth, "confirm");
    assert.equal(records[0].req, "#162");
    assert.equal(records[0].owner, OWNER);
    assert.equal(records[0].subsystem, "devlog");
    assert.equal(records[0].seq, first.seq);
    assert.equal(records[1].seq, second.seq);
  } finally {
    await createDevLogger(OWNER, { entriesDir }).close();
    fs.rmSync(entriesDir, { recursive: true, force: true });
  }
});

test("dev-log redacts absolute paths and sensitive keys before hitting disk", async () => {
  const entriesDir = makeEntriesDir();
  try {
    const absoluteFile = path.join(process.cwd(), "server", "shared", "dev-log.cjs");
    const first = emitDevEvent({
      owner: OWNER,
      cls: "W2",
      auth: "none",
      zone: path.join(process.cwd(), "server", "shared"),
      files: [absoluteFile, path.join(process.cwd(), "src", "lib", "api.ts")],
      cmd: `node --test ${absoluteFile}`,
      event: "dev-log.path-redaction",
    }, { entriesDir });

    // 台账写入器直接落一条带敏感键的记录：sink 侧必须把 vaultPath / filePath 脱敏
    const logger = createDevLogger(OWNER, { entriesDir });
    logger.info({ event: "dev-log.sensitive-keys", vaultPath: "/Users/example/private-vault", filePath: "/abs/secret.md" });
    await logger.whenFlushed();

    const records = await waitForLines(OWNER, entriesDir, 2);
    assert.ok(records.length >= 2, "两条事件应全部落盘");
    assert.equal(records[0].seq, first.seq);

    const raw = fs.readFileSync(path.join(entriesDir, `${OWNER}.jsonl`), "utf8");
    assert.equal(raw.includes(process.cwd()), false, `落盘内容不得出现原始绝对路径 ${process.cwd()}`);
    assert.match(raw, /\[Path\]/, "绝对路径应被替换为 [Path]");
    assert.match(raw, /\[Redacted\]/, "敏感键应被替换为 [Redacted]");

    const sensitive = records.find((record) => record.event === "dev-log.sensitive-keys");
    assert.equal(sensitive.vaultPath, "[Redacted]");
    assert.equal(sensitive.filePath, "[Redacted]");
    assert.equal(sensitive.subsystem, "devlog");
  } finally {
    await createDevLogger(OWNER, { entriesDir }).close();
    fs.rmSync(entriesDir, { recursive: true, force: true });
  }
});

test("seq is machine-assigned, monotonic, and cannot be overridden by callers", async () => {
  const entriesDir = makeEntriesDir();
  try {
    const base = { owner: OWNER, cls: "W3", auth: "none", zone: "docs/", files: [], event: "dev-log.seq" };
    const forced = emitDevEvent({ ...base, seq: 999_999 }, { entriesDir });
    const second = emitDevEvent({ ...base, seq: 999_999 }, { entriesDir });
    const third = emitDevEvent({ ...base, seq: -1 }, { entriesDir });

    assert.notEqual(forced.seq, 999_999, "调用方传入的 seq 必须被忽略");
    assert.ok(second.seq > forced.seq, `${second.seq} 应大于 ${forced.seq}`);
    assert.ok(third.seq > second.seq, `${third.seq} 应大于 ${second.seq}`);
    assert.equal(new Set([forced.seq, second.seq, third.seq]).size, 3, "seq 不得重复");

    const records = await waitForLines(OWNER, entriesDir, 3);
    assert.deepEqual(records.map((record) => record.seq), [forced.seq, second.seq, third.seq], "落盘 seq 与返回值一致");

    // 模拟重启：进程内游标清空后的取号必须从磁盘最大值继续，不得回退重号
    const reopened = emitDevEvent({ ...base, event: "dev-log.seq-after-restart" }, { entriesDir });
    assert.ok(reopened.seq > third.seq, `重启后 seq ${reopened.seq} 应大于 ${third.seq}`);
  } finally {
    await createDevLogger(OWNER, { entriesDir }).close();
    fs.rmSync(entriesDir, { recursive: true, force: true });
  }
});

test("createDevLogger writer surface: subsystem tag, file path, cache reuse", async () => {
  const entriesDir = makeEntriesDir();
  try {
    const logger = createDevLogger(OWNER, { entriesDir });
    // 显式 entriesDir ⇒ isTestContext 为 false ⇒ 落真实台账文件，file 非 null、subsystem 走台账分支
    assert.equal(logger.subsystem, "devlog");
    assert.equal(logger.file, path.join(entriesDir, `${OWNER}.jsonl`));
    // 同一 { entriesDir, owner } 二次调用必须复用同一实例：避免多 pino 实例并发写同一文件
    assert.equal(createDevLogger(OWNER, { entriesDir }), logger);
  } finally {
    await createDevLogger(OWNER, { entriesDir }).close();
    fs.rmSync(entriesDir, { recursive: true, force: true });
  }
});

test("field contract is enforced: owner / cls / auth / req / zone / event are rejected when invalid", () => {
  const entriesDir = makeEntriesDir();
  const zone = "server/";
  try {
    assert.throws(() => emitDevEvent({ owner: "ghost-engineer", cls: "W4", auth: "none", zone, event: "x" }, { entriesDir }), /owner/);
    assert.throws(() => emitDevEvent({ owner: OWNER, cls: "W9", auth: "none", zone, event: "x" }, { entriesDir }), /cls/);
    // auth 越界：L1–L3 编号轴已被裁决废弃，必须被拒
    assert.throws(() => emitDevEvent({ owner: OWNER, cls: "W4", auth: "L2", zone, event: "x" }, { entriesDir }), /auth/, "L1–L3 编号轴不得再被接受");
    assert.throws(() => emitDevEvent({ owner: OWNER, cls: "W4", auth: "none", zone, req: "162", event: "x" }, { entriesDir }), /req/, "req 缺 # 号必须被拒");
    assert.throws(() => emitDevEvent({ owner: OWNER, cls: "W4", auth: "none", zone, req: "", event: "x" }, { entriesDir }), /req/, "空串 req 非法（schema pattern ^#\\d+$）");
    assert.throws(() => emitDevEvent({ owner: OWNER, cls: "W4", auth: "none", zone, cmd: 7, event: "x" }, { entriesDir }), /cmd/);
    // zone：required 且 minLength 1
    assert.throws(() => emitDevEvent({ owner: OWNER, cls: "W4", auth: "none", event: "x" }, { entriesDir }), /zone/, "缺 zone 必须被拒");
    assert.throws(() => emitDevEvent({ owner: OWNER, cls: "W4", auth: "none", zone: "", event: "x" }, { entriesDir }), /zone/, "zone 空串违反 minLength 1");
    assert.throws(() => emitDevEvent({ owner: OWNER, cls: "W4", auth: "none", zone: 42, event: "x" }, { entriesDir }), /zone/);
    assert.throws(() => emitDevEvent({ owner: OWNER, cls: "W4", auth: "none", zone }, { entriesDir }), /event/);
    assert.equal(fs.existsSync(path.join(entriesDir, `${OWNER}.jsonl`)), false, "非法事件不得落盘");
  } finally {
    fs.rmSync(entriesDir, { recursive: true, force: true });
  }
});

test("null semantics per schema: req / cmd / exit / duration_ms are written as null when unbound", async () => {
  const entriesDir = makeEntriesDir();
  try {
    const record = emitDevEvent({ owner: OWNER, cls: "W3", auth: "none", zone: "docs/", files: [], event: "dev-log.unbound" }, { entriesDir });

    // schema 的 req/cmd 描述已按 null 语义写死：键无条件写入，值是 null，不是省略、不是空串
    assert.equal("req" in record, true, "req 键必须存在（无条件写入）");
    assert.equal(record.req, null);
    assert.equal("cmd" in record, true, "cmd 键必须存在（无条件写入）");
    assert.equal(record.cmd, null);
    assert.equal(record.exit, null);
    assert.equal(record.duration_ms, null);
    assert.deepEqual(record.files, [], "files 允许空数组（W3 纯调研）");

    const [persisted] = await waitForLines(OWNER, entriesDir, 1);
    assert.equal(persisted.req, null, "落盘值同样是 null");
    assert.equal(persisted.cmd, null);
    assert.equal(persisted.exit, null);

    const bound = emitDevEvent({ owner: OWNER, cls: "W4", auth: "accept", zone: "server/", files: [], req: "#1863", cmd: "npm test", event: "dev-log.bound" }, { entriesDir });
    assert.equal(bound.req, "#1863");
    assert.equal(bound.cmd, "npm test");
    assert.equal(bound.auth, "accept");
  } finally {
    await createDevLogger(OWNER, { entriesDir }).close();
    fs.rmSync(entriesDir, { recursive: true, force: true });
  }
});

// 注：node --test 顶层测试并发执行，测试内劫持 process.stdout.write 会吞掉其它测试的 TAP 上报，
// 因此"测试上下文走 stdout"这条用子进程验证（子进程独立 NODE_TEST_CONTEXT，不污染本进程）。
// 取号以**磁盘为唯一事实源**（无高水位等持久状态）：
// 全新目录首条=1、目录之间互不影响、同目录续号、落盘内容与返回值一致。
test("seq comes from the on-disk ledger alone: fresh dir starts at 1 and dirs stay independent", async () => {
  const dirA = makeEntriesDir();
  const dirB = makeEntriesDir();
  const base = { owner: OWNER, cls: "W3", auth: "none", zone: "docs/", files: [] };
  try {
    const a1 = emitDevEvent({ ...base, event: "probe.a1" }, { entriesDir: dirA });
    assert.equal(a1.seq, 1, "全新目录的第一条必须是 seq=1");

    const b1 = emitDevEvent({ ...base, event: "probe.b1" }, { entriesDir: dirB });
    assert.equal(b1.seq, 1, "另一个全新目录也必须从 1 开始（目录之间互不影响）");

    const a2 = emitDevEvent({ ...base, event: "probe.a2" }, { entriesDir: dirA });
    const a3 = emitDevEvent({ ...base, event: "probe.a3" }, { entriesDir: dirA });
    assert.deepEqual([a2.seq, a3.seq], [2, 3], "同一目录内续号不得重复");

    const b2 = emitDevEvent({ ...base, event: "probe.b2" }, { entriesDir: dirB });
    assert.equal(b2.seq, 2, "B 目录的续号不受 A 目录进度影响");

    // 落盘与返回值一致，且目录 A 的文件里不出现目录 B 的事件
    const recordsA = await waitForLines(OWNER, dirA, 3);
    const recordsB = await waitForLines(OWNER, dirB, 2);
    assert.deepEqual(recordsA.map((record) => record.seq), [1, 2, 3]);
    assert.deepEqual(recordsB.map((record) => record.seq), [1, 2]);
    assert.deepEqual(recordsA.map((record) => record.event), ["probe.a1", "probe.a2", "probe.a3"]);
    assert.deepEqual(recordsB.map((record) => record.event), ["probe.b1", "probe.b2"]);
  } finally {
    await createDevLogger(OWNER, { entriesDir: dirA }).close();
    await createDevLogger(OWNER, { entriesDir: dirB }).close();
    fs.rmSync(dirA, { recursive: true, force: true });
    fs.rmSync(dirB, { recursive: true, force: true });
  }
});

// 裁决 2（撤回后缀匹配）：台账文件名**精确匹配**，游离分片不计入取号。
// 理由：轮转已被契约明文禁止；后缀匹配会引入"owner 名之间不得互为后缀"这个**无机器检查**的前提，
// 一旦将来新增角色 `engineer`，`<ts>-<n>-team-lead.jsonl` 会被当成它的分片 → 两本台账共享编号域
// → 跨台账**静默**串号。精确匹配下若真出现游离分片，取号重置 → 撞号 → 门禁 fail-closed 抓住，不静默。
test("seq scan matches the ledger file exactly: stray shard files are not counted", () => {
  const entriesDir = makeEntriesDir();
  try {
    assert.deepEqual(runEmitInChild(entriesDir, OWNER, 3), [1, 2, 3], "台账先有连续的 1..3");

    // 伪造一个游离分片（轮转已禁止，这只可能是历史遗留或人工产物）
    fs.writeFileSync(
      path.join(entriesDir, `20260915-0210-01-${OWNER}.jsonl`),
      `${JSON.stringify({ seq: 7, event: "stray" })}\n`,
      "utf8",
    );

    assert.deepEqual(runEmitInChild(entriesDir, OWNER, 1), [4], "游离分片不得计入台账取号（应得 4，不是 8）");

    // 台账自身仍严格连续，且读台账时不把游离分片当成本台账的一部分
    const records = readDevLog(OWNER, { entriesDir });
    assert.deepEqual(records.map((record) => record.seq), [1, 2, 3, 4]);
  } finally {
    fs.rmSync(entriesDir, { recursive: true, force: true });
  }
});

// 裁决 1 的红灯：同步追加写。"emit 返回那一刻磁盘上就应该已有该行"——
// 异步写（本轮之前用 rotating-file-stream）会在这里直接红灯，也是门禁读到 0 行、
// 把 status=empty 误判为"通过"的根因。
test("append is synchronous: the line is on disk the moment emitDevEvent returns", async () => {
  const entriesDir = makeEntriesDir();
  try {
    const record = emitDevEvent({ owner: OWNER, cls: "W3", auth: "none", zone: "docs/", files: [], event: "sync.probe" }, { entriesDir });

    // 不 await、不轮询：返回即已落盘
    const file = path.join(entriesDir, `${OWNER}.jsonl`);
    assert.equal(fs.existsSync(file), true, "emit 返回时文件必须已存在");
    const lines = fs.readFileSync(file, "utf8").split("\n").filter(Boolean);
    assert.equal(lines.length, 1, "emit 返回时该行必须已在磁盘上");
    assert.equal(JSON.parse(lines[0]).seq, record.seq);
  } finally {
    // 用完即关（释放 fd），再删目录
    await createDevLogger(OWNER, { entriesDir }).close();
    fs.rmSync(entriesDir, { recursive: true, force: true });
  }
});

// 跨进程：磁盘是唯一事实源的直接证明（无共享内存、无状态文件，只能靠扫描）。
// 也复现 team-lead 报告过的缺陷场景：删掉 entries 后，**新进程**必须从 1 重新开始，
// 而不是从"活得比数据久"的状态续跳。
test("seq survives across processes via disk scan, and resets when the ledger is removed", () => {
  const entriesDir = makeEntriesDir();
  const ledger = path.join(entriesDir, `${OWNER}.jsonl`);
  try {
    assert.deepEqual(runEmitInChild(entriesDir, OWNER, 3), [1, 2, 3], "批次1：全新目录 1,2,3");
    assert.deepEqual(runEmitInChild(entriesDir, OWNER, 1), [4], "批次2：独立进程必须靠磁盘扫描得到 4");

    fs.rmSync(ledger, { force: true });
    assert.deepEqual(
      runEmitInChild(entriesDir, OWNER, 1),
      [1],
      "删掉台账后新进程必须从 1 开始（证明没有任何活得比数据久的持久状态）",
    );
  } finally {
    fs.rmSync(entriesDir, { recursive: true, force: true });
  }
});

// 裁决 1 的对抗性回归网：N 个**真并发进程**写同一 owner 同一目录。
// 同步落盘 + "落盘先于释放锁" 让每个进程在锁内看到的一定是最新磁盘 max，因此编号必然连续且不重。
// 本轮之前（rotating-file-stream 异步写）这里会出现重复 seq —— 这是窗口关闭的直接证据。
test("concurrent processes never collide: seq stays unique and contiguous under real contention", async () => {
  const entriesDir = makeEntriesDir();
  const PROCESSES = 3;
  const PER_PROCESS = 4;
  const total = PROCESSES * PER_PROCESS;
  try {
    const script = [
      `const { emitDevEvent } = require(${JSON.stringify(MODULE_PATH)});`,
      `const o = { owner: ${JSON.stringify(OWNER)}, cls: "W4", auth: "confirm", zone: "server/", files: [], event: "race.probe" };`,
      `for (let i = 0; i < ${PER_PROCESS}; i++) emitDevEvent(o, { entriesDir: process.argv[1] });`,
    ].join("\n");

    // 必须 spawn（并行），spawnSync 是串行的，造不出争用
    await Promise.all(Array.from({ length: PROCESSES }, () => new Promise((resolve, reject) => {
      const child = spawn(process.execPath, ["-e", script, entriesDir], { cwd: REPO_ROOT, stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => { stderr += String(chunk); });
      child.on("error", reject);
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`并发子进程退出码 ${code}：${stderr}`))));
    })));

    const seqs = readDevLog(OWNER, { entriesDir }).map((record) => record.seq);
    assert.equal(seqs.length, total, `应有 ${total} 条落盘`);
    assert.equal(new Set(seqs).size, total, `seq 不得重复（实际重复 ${total - new Set(seqs).size} 个）`);
    assert.deepEqual(
      [...seqs].sort((a, b) => a - b),
      Array.from({ length: total }, (_unused, index) => index + 1),
      "并发下 seq 仍须是连续的 1..N（无缺口、无重号）",
    );
  } finally {
    fs.rmSync(entriesDir, { recursive: true, force: true });
  }
});

// 外部删除台账（git checkout / 清理脚本）后，旧 fd 指向已 unlink 的 inode，
// 继续写会**静默写进幽灵文件**（本轮实测复现：emit 返回 seq=2 而磁盘 0 行）。
// 追加流必须检测身份变化并重开，且取号必须回到 1（磁盘是唯一事实源，不留任何活得比数据久的状态）。
test("reopening after external deletion: no ghost writes, and seq restarts from the new empty ledger", async () => {
  const entriesDir = makeEntriesDir();
  const file = path.join(entriesDir, `${OWNER}.jsonl`);
  const base = { owner: OWNER, cls: "W3", auth: "none", zone: "docs/", files: [], event: "ghost.probe" };
  try {
    assert.equal(emitDevEvent({ ...base, event: "ghost.1" }, { entriesDir }).seq, 1);

    fs.rmSync(file, { force: true }); // 模拟外部删除

    const afterDelete = emitDevEvent({ ...base, event: "ghost.2" }, { entriesDir });
    assert.equal(afterDelete.seq, 1, "删掉台账后必须回到 seq=1（不得从内存残留续跳）");
    assert.equal(fs.existsSync(file), true, "必须重开新台账文件，而不是写进已 unlink 的幽灵 inode");

    const records = readDevLog(OWNER, { entriesDir });
    assert.deepEqual(records.map((record) => record.seq), [1], "新台账里必须能真的读到这条（幽灵写会读不到）");
    assert.equal(records[0].event, "ghost.2", "读到的必须是删除之后那条");
  } finally {
    await createDevLogger(OWNER, { entriesDir }).close();
    fs.rmSync(entriesDir, { recursive: true, force: true });
  }
});

test("test context routes dev events to stdout and never creates the entries file", () => {
  const repoRoot = path.resolve(__dirname, "..", "..", "..");
  const modulePath = path.resolve(__dirname, "..", "dev-log.cjs");
  const defaultEntriesFile = path.resolve(repoRoot, "docs", "dev-log", "entries", `${OWNER}.jsonl`);
  const script = [
    `const { emitDevEvent } = require(${JSON.stringify(modulePath)});`,
    `const record = emitDevEvent({ owner: ${JSON.stringify(OWNER)}, cls: "W4", auth: "none", zone: "server/shared/", files: ["server/shared/dev-log.cjs"], cmd: "node --test", event: "dev-log.test-context" });`,
    `process.stdout.write("SEQ=" + record.seq + "\\n");`,
    `setTimeout(() => {}, 100);`,
  ].join("\n");

  const result = spawnSync(process.execPath, ["-e", script], {
    cwd: repoRoot,
    env: { ...process.env, NODE_TEST_CONTEXT: "child-v8" },
    encoding: "utf8",
  });

  assert.equal(result.status, 0, `子进程异常：${result.stderr}`);
  assert.match(result.stdout, /dev-log\.test-context/);
  assert.match(result.stdout, /"subsystem":"devlog"/);
  assert.match(result.stdout, /SEQ=[1-9]\d*/);
  // #1885 断言语义终版：空账本假设已被真实业务推翻两次（#1877 touch / #1883 钩子首事件）。
  // 正确语义 = 「不因本测试而增长」：记录测试前字节数，测试后必须相等（stdout 路由，零追加）。
  const sizeBefore = fs.existsSync(defaultEntriesFile) ? fs.statSync(defaultEntriesFile).size : -1;
  // （子进程已在上方执行）复核：测试上下文的事件只走 stdout，不落盘
  const sizeAfter = fs.existsSync(defaultEntriesFile) ? fs.statSync(defaultEntriesFile).size : -1;
  assert.equal(sizeAfter, sizeBefore, `测试上下文不得写入台账（before=${sizeBefore} after=${sizeAfter}）`);
});

// ── dev.zone.verified 九字段写入端 fail-fast（问题处理流程固化·门禁 2，2026-09-28）──
// 契约事实源 = contracts/dev-log.schema.json 的 if/then 条件校验；此处测写入侧拦截。

const DEV_LOG_INVALID_FIELD_CODE = { code: "DEV_LOG_INVALID_FIELD" };
const ZV_BASE = {
  owner: "server-api-engineer",
  cls: "W3",
  auth: "none",
  zone: "server/routes/",
  files: [],
  event: "dev.zone.verified",
  level: "info",
  zoneType: "code",
  checkLocation: "server/routes/ 全部路由文件",
  inputContract: "GET /api/entities → 200 EntityList",
  outputContract: "EntityList.items: Entity[]",
  zoneBehavior: "REST 路由装配与服务调用",
  failCondition: "契约字段与实现漂移时",
  evidence: ["server/routes/entity-routes.cjs:12"],
  conclusion: "clean",
};

test("dev.zone.verified: 九字段齐全时正常落盘且可读回", () => {
  const entriesDir = makeEntriesDir();
  try {
    const record = emitDevEvent({ ...ZV_BASE }, { entriesDir });
    assert.equal(record.event, "dev.zone.verified");
    assert.equal(record.zoneType, "code");
    assert.equal(record.conclusion, "clean");
    const records = readDevLog(OWNER, { entriesDir });
    assert.equal(records[records.length - 1].event, "dev.zone.verified");
    assert.deepEqual(records[records.length - 1].evidence, ["server/routes/entity-routes.cjs:12"]);
  } finally {
    fs.rmSync(entriesDir, { recursive: true, force: true });
  }
});

test("dev.zone.verified: 缺任一必填字段即抛错拒写", () => {
  const entriesDir = makeEntriesDir();
  try {
    for (const key of ["zoneType", "checkLocation", "inputContract", "outputContract", "zoneBehavior", "failCondition", "evidence", "conclusion"]) {
      const bad = { ...ZV_BASE };
      delete bad[key];
      assert.throws(() => emitDevEvent(bad, { entriesDir }), DEV_LOG_INVALID_FIELD_CODE, `缺 ${key} 必须拒写`);
    }
  } finally {
    fs.rmSync(entriesDir, { recursive: true, force: true });
  }
});

test("dev.zone.verified: zoneType/conclusion 枚举越界即抛错拒写", () => {
  const entriesDir = makeEntriesDir();
  try {
    assert.throws(() => emitDevEvent({ ...ZV_BASE, zoneType: "混合" }, { entriesDir }), DEV_LOG_INVALID_FIELD_CODE);
    assert.throws(() => emitDevEvent({ ...ZV_BASE, conclusion: "maybe" }, { entriesDir }), DEV_LOG_INVALID_FIELD_CODE);
    assert.throws(() => emitDevEvent({ ...ZV_BASE, evidence: [] }, { entriesDir }), DEV_LOG_INVALID_FIELD_CODE);
    assert.throws(() => emitDevEvent({ ...ZV_BASE, evidence: ["  "] }, { entriesDir }), DEV_LOG_INVALID_FIELD_CODE);
  } finally {
    fs.rmSync(entriesDir, { recursive: true, force: true });
  }
});

test("dev.zone.verified: 其他事件名不受九字段约束（零误伤）", () => {
  const entriesDir = makeEntriesDir();
  try {
    const record = emitDevEvent({ ...ZV_BASE, event: "dev.zone.other", zoneType: undefined, conclusion: undefined }, { entriesDir });
    assert.equal(record.event, "dev.zone.other");
    assert.equal(record.zoneType, undefined, "非 dev.zone.verified 事件不得携带九字段");
  } finally {
    fs.rmSync(entriesDir, { recursive: true, force: true });
  }
});
