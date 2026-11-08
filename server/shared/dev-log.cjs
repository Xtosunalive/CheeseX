// Component: Dev-Log
// @responsible: Emit append-only, machine-numbered dev activity events per owner on top of the shared JSON logger.

const fs = require("node:fs");
const path = require("node:path");
const { Writable } = require("node:stream");
const { createJsonLogger } = require("./json-logger.cjs");

// 规则 8 配置单源化：枚举唯一定义源 = contracts/dev-log.schema.json。
// 门禁 check-dev-log.mjs:readEnum 从同一文件取枚举，两侧不得各留一份副本。
const SCHEMA = require("../../contracts/dev-log.schema.json");
const DEV_LOG_OWNERS = Object.freeze(SCHEMA.properties.owner.enum);
const DEV_LOG_CLASSES = Object.freeze(SCHEMA.properties.cls.enum);
// 授权轴用语义值 none|confirm|accept 而非 L1–L3 编号：本仓 L 已是三义
// （AGENTS.md 约束四层 L1–L4 / 变更档 L0 / src/index.css 字号 L2-L3），编号轴必然混线。
const DEV_LOG_AUTH_LEVELS = Object.freeze(SCHEMA.properties.auth.enum);
const DEV_LOG_SOURCES = Object.freeze(SCHEMA.properties.source.enum);
const DEV_LOG_LEVELS = Object.freeze(SCHEMA.properties.level.enum);
const REQ_PATTERN = new RegExp(SCHEMA.properties.req.pattern);

const DEV_LOG_SUBSYSTEM = "devlog";
// dev.zone.verified（子 agent 辖区核实）专用枚举：与 contracts/dev-log.schema.json 的
// if/then 条件校验同源同值——schema 是唯一事实源，此处常量仅为写入端 fail-fast 的本地引用，
// 值集变更必须先改 schema 再同步此处（check:dev-log 两侧不一致时会以 schema 为准报红）。
const ZONE_VERIFIED_ENUMS = Object.freeze({
  zoneType: Object.freeze(["code", "rule", "gate"]),
  conclusion: Object.freeze(["clean", "issue", "cross_zone"]),
});
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_ENTRIES_DIR = path.resolve(REPO_ROOT, "docs", "dev-log", "entries");
// 取号作用域 = 该 owner 自己的文件（docs/dev-log/entries/<owner>.jsonl）；磁盘是唯一事实源。
// 本常量只指**排他锁目录**：内部只放瞬时锁文件（调用内创建、finally 删除、有 stale 超时），不产生任何持久状态。
// （原名 SEQ_STATE_DIR——随"高水位状态"整块删除后已名不副实；留旧名会让后来者误以为这里存着 seq 状态，
//  而"状态活得比数据久"正是实测过的缺陷：删掉 entries 后 seq 从旧高水位续跳、1..N 永久缺失。）
const DEV_LOG_LOCK_DIR = path.resolve(REPO_ROOT, ".tmp", "dev-log");

// 台账不分片，且**不使用 rotating-file-stream**（不要从 json-logger 误移植轮转配置）。
// 误用会在两处翻车，两处都已实测：
//   ① 语义相反——json-logger 是运行时日志（高频、可丢弃、轮转删除合理），dev-log 是 append-only 账本。
//      实测 createStream({size:"1B",interval:"1d",maxFiles:7}) 会落下 `20260915-0210-01-<owner>.jsonl`
//      这类分片（名字以时间戳开头、owner 在末尾）与 `.jsonl.txt` sidecar；maxFiles 会删除最旧分片
//      = 销毁台账历史；分片名也不等于 `<owner>.jsonl`，取号扫描会漏掉 → seq 从 1 重来撞号。
//   ② 落盘时机不可控——该库异步写，`emitDevEvent` 返回那一刻行还没落盘，
//      "同目录两进程并发取号"的窗口无法关闭（两人独立实测命中：emit 后文件尚不存在 / 落盘 0 行）。
// 结论：改用 createSyncAppendStream —— 单文件 + O_APPEND + 一次 writeSync 写完一行，
// 落盘先于释放排他锁，"磁盘是唯一事实源"才真正成立。
const LOCK_STALE_MS = 5_000;
const LOCK_WAIT_MS = 500;
const LOCK_RETRY_MS = 10;

// ── 内部状态（进程内） ────────────────────────────────────────────────────────
// owner 维度复用同一个 logger/stream：避免 pino 多实例并发写同一 jsonl 造成互相覆盖。
const loggerCache = new Map();
// seq 游标：补上"已取号但尚未落盘"的窗口，防止进程内连续取号撞号。
const seqCursors = new Map();

function invalidField(message) {
  return Object.assign(new Error(message), { code: "DEV_LOG_INVALID_FIELD" });
}

function requireEnum(name, value, allowed) {
  if (typeof value !== "string" || !allowed.includes(value)) {
    throw invalidField(`dev-log: ${name} must be one of ${allowed.join("|")}, received ${JSON.stringify(value)}`);
  }
  return value;
}

function requireOwner(owner) {
  return requireEnum("owner", owner, DEV_LOG_OWNERS);
}

// dev.zone.verified 专用：非空字符串字段（minLength 1 与 schema 对齐），append-only 写错无法回收故写入侧拦截。
function requireNonEmptyString(name, value) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidField(`dev-log: ${name} must be a non-empty string, received ${JSON.stringify(value)}`);
  }
  return value;
}

// dev.zone.verified 专用：证据为非空字符串数组（minItems 1 与 schema 对齐）。
function normalizeEvidence(value) {
  if (!Array.isArray(value) || value.length === 0 || value.some((e) => typeof e !== "string" || e.trim().length === 0)) {
    throw invalidField(`dev-log: evidence must be a non-empty array of non-empty strings, received ${JSON.stringify(value)}`);
  }
  return value;
}

function nullable(value) {
  return value === undefined ? null : value;
}

function normalizeFiles(files) {
  if (files === undefined || files === null) return [];
  const list = Array.isArray(files) ? files : [files];
  return list.filter((entry) => typeof entry === "string" && entry.length > 0);
}

function normalizeInteger(value, name) {
  if (value === undefined || value === null) return null;
  if (!Number.isInteger(value)) throw invalidField(`dev-log: ${name} must be an integer or null, received ${JSON.stringify(value)}`);
  return value;
}

function normalizeDuration(value) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw invalidField(`dev-log: duration_ms must be a finite number or null, received ${JSON.stringify(value)}`);
  }
  return value;
}

function resolveEntriesDir(options = {}) {
  return options.entriesDir ? path.resolve(options.entriesDir) : DEFAULT_ENTRIES_DIR;
}

// json-logger 既有约定：测试环境不落盘，走 stdout。显式给出 entriesDir 时按显式优先。
function isTestContext(options = {}) {
  return Boolean(process.env.NODE_TEST_CONTEXT) && !options.entriesDir;
}

function resolveDevLogPath(owner, options = {}) {
  return path.join(resolveEntriesDir(options), `${requireOwner(owner)}.jsonl`);
}

function sleepSync(ms) {
  const shared = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(shared, 0, 0, ms);
}

// ── seq 定号：机器生成、单调、调用方不可覆盖 ──────────────────────────────────
// ADR051：手工取号在本仓撞号 4 次。取号 = max(磁盘落盘最大 seq, 进程内游标) + 1，在排他锁内完成。
// **磁盘是唯一事实源**——不设高水位等持久状态：状态活得比数据久（entries 被删/切分支后仍在）
// 会让同一文件出现 1..N 永久缺失。进程内游标只覆盖"已取号、尚未落盘"的同进程窗口。

// 台账文件名**精确匹配**，不做后缀匹配（`-<owner>.jsonl` 那条已撤回）。
// 理由：轮转已被契约明文禁止，对"禁止状态"做防御会引入一个**无机器检查**的前提
// （owner 名之间不得互为后缀；将来若新增角色 `engineer`，`<ts>-<n>-team-lead.jsonl` 会被当成
// 它的分片 → 两本台账共享编号域 → 跨台账串号，且是**静默**污染）。
// 精确匹配下万一真出现游离分片，后果是取号重置 → 撞号 → 门禁 fail-closed 抓住，不静默。
// 游离分片该由门禁单独报为"不连续文件"，那是门禁的职责，不是取号器的。
function scanMaxSeq(entriesDir, owner) {
  if (!fs.existsSync(entriesDir)) return 0;
  let names = [];
  try {
    names = fs.readdirSync(entriesDir);
  } catch (_error) {
    return 0;
  }
  let max = 0;
  for (const name of names) {
    if (name !== `${owner}.jsonl`) continue;
    let content = "";
    try {
      content = fs.readFileSync(path.join(entriesDir, name), "utf8");
    } catch (_error) {
      continue;
    }
    for (const line of content.split("\n")) {
      if (!line.trim()) continue;
      try {
        const record = JSON.parse(line);
        if (Number.isInteger(record.seq) && record.seq > max) max = record.seq;
      } catch (_error) { /* 半行 / 损坏行跳过，不阻塞取号 */ }
    }
  }
  return max;
}

function isStaleLock(lockPath) {
  try {
    return Date.now() - fs.statSync(lockPath).mtimeMs > LOCK_STALE_MS;
  } catch (_error) {
    return true;
  }
}

// 拿不到锁一律 fail-open：取号继续（取当前可见最大值 + 1），不丢事件。
// 锁是**瞬时**文件（finally 删除 + stale 超时），只防御"同目录两进程同时取号"；不承载任何状态。
function withSeqLock(owner, operation) {
  const lockPath = path.join(DEV_LOG_LOCK_DIR, `.${owner}.lock`);
  const startedAt = Date.now();
  try {
    fs.mkdirSync(DEV_LOG_LOCK_DIR, { recursive: true });
  } catch (_error) {
    return operation();
  }
  for (;;) {
    let fd = null;
    try {
      fd = fs.openSync(lockPath, "wx");
    } catch (error) {
      if (!error || error.code !== "EEXIST") return operation();
      if (Date.now() - startedAt > LOCK_WAIT_MS) return operation();
      if (isStaleLock(lockPath)) {
        try { fs.unlinkSync(lockPath); } catch (_error) { /* 竞态下已被他人清理 */ }
        continue;
      }
      sleepSync(LOCK_RETRY_MS);
      continue;
    }
    try {
      fs.writeSync(fd, String(process.pid));
      return operation();
    } finally {
      try { fs.closeSync(fd); } catch (_error) { /* best-effort */ }
      try { fs.unlinkSync(lockPath); } catch (_error) { /* best-effort */ }
    }
  }
}

// 仅在**已持有排他锁**时调用：seq = 磁盘台账现有最大 seq + 1。
// 这里**刻意不再叠加进程内游标**：同步落盘已经消灭了"已取号未落盘"的窗口，
// 游标此时唯一的作用是省一次扫盘，却会在"台账被外部删除/清空"时变成"活得比数据久"的状态——
// 实测后遗症：同一进程内删掉台账后再发，磁盘新文件第一条从 N+1 起跳（1..N 永久缺失）。
// 磁盘是唯一事实源 ⇒ 每次取号都以扫盘结果为准，seq 与台账内容因此恒满足 seq = max+1。
function nextSeqLocked(owner, entriesDir) {
  return scanMaxSeq(entriesDir, owner) + 1;
}

// 测试上下文（stdout）没有台账可扫，单调性只能来自进程内游标（仅此路径使用）。
function allocateEphemeralSeq(owner, entriesDir) {
  const key = `${entriesDir}::${owner}`;
  const seq = Number(seqCursors.get(key) || 0) + 1;
  seqCursors.set(key, seq);
  return seq;
}

// ── logger ──────────────────────────────────────────────────────────────────

// 同步追加流：单文件、O_APPEND、一次 writeSync 写完一行。
// pino 对自定义 Writable 的 write() 在未 cork / 未 busy 时**同步**调用 _write，而这里 _write 同步
// 调用 callback ⇒ createJsonLogger({ stream }) 的写入在调用栈内就落盘，
// 于是 emitDevEvent 可以在**释放排他锁之前**完成落盘，关掉"取号→落盘"的跨进程窗口。
// 落盘形态即一个 `<owner>.jsonl`：无分片、无 sidecar、无轮转。
//
// 每次写入前核对"路径仍指向我们打开的 inode"：台账被外部删除/替换（git checkout、清理脚本）后，
// 旧 fd 指向的是已 unlink 的 inode，继续写会**静默写进幽灵文件**（实测：emit 返回 seq=2 而磁盘 0 行）。
// 发现身份不符就重开，把静默丢失变成正常追加 —— 与 json-logger "sink 失败不静默" 同一取向。
function createSyncAppendStream(entriesDir, owner) {
  fs.mkdirSync(entriesDir, { recursive: true });
  const filePath = path.join(entriesDir, `${owner}.jsonl`);
  let fd = -1;
  let inode = null;

  const openFile = () => {
    fd = fs.openSync(filePath, "a");
    try {
      inode = fs.fstatSync(fd).ino;
    } catch (_error) {
      inode = null;
    }
  };
  const closeFd = () => {
    if (fd === -1) return;
    const target = fd;
    fd = -1;
    inode = null;
    try { fs.closeSync(target); } catch (_error) { /* best-effort */ }
  };
  const ensureCurrentFile = () => {
    if (fd !== -1 && inode !== null) {
      try {
        if (fs.statSync(filePath).ino === inode) return;
      } catch (_error) { /* 路径已不存在 → 落到下面重开 */ }
    }
    closeFd();
    openFile();
  };

  openFile();

  const stream = new Writable({
    write(chunk, _encoding, callback) {
      try {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
        ensureCurrentFile();
        const written = fs.writeSync(fd, buffer, 0, buffer.length);
        if (written !== buffer.length) throw new Error(`dev-log: partial write ${written}/${buffer.length}`);
        callback();
      } catch (error) {
        callback(error);
      }
    },
    final(callback) {
      closeFd();
      callback();
    },
    destroy(error, callback) {
      closeFd();
      callback(error);
    },
  });

  // 与 json-logger 同款降级信号：真实文件 sink 故障不静默。
  stream.on("error", (streamError) => {
    try {
      process.stderr.write(`[dev-log] entries sink error (${owner}): ${streamError && streamError.message ? streamError.message : String(streamError)}\n`);
    } catch (_error) { /* best-effort: 清理/降级失败静默可接受 */ }
  });
  return stream;
}

/**
 * 创建某成员的 dev-log logger（**仅供 emitDevEvent 内部作为台账写入器使用**）。
 * 具备 info/error/warn/debug(fields) 形态，每条记录强制带 subsystem:"devlog"，
 * 与 emitDevEvent 汇入同一台账事件流。
 */
function createDevLogger(owner, options = {}) {
  requireOwner(owner);
  const entriesDir = resolveEntriesDir(options);
  const cacheKey = `${entriesDir}::${owner}`;
  if (!options.stream && loggerCache.has(cacheKey)) return loggerCache.get(cacheKey);

  const toStdout = isTestContext(options);
  const stream = options.stream || (toStdout ? process.stdout : createSyncAppendStream(entriesDir, owner));
  const base = createJsonLogger({ stream });
  // subsystem 强制为 devlog 且不可被调用方覆盖；owner 作为默认值，允许显式覆盖。
  const write = (level, fields = {}) => base[level]({ owner, ...fields, subsystem: DEV_LOG_SUBSYSTEM });

  const logger = {
    owner,
    subsystem: DEV_LOG_SUBSYSTEM,
    file: toStdout ? null : path.join(entriesDir, `${owner}.jsonl`),
    stream,
    debug: (fields) => write("debug", fields),
    info: (fields) => write("info", fields),
    warn: (fields) => write("warn", fields),
    error: (fields) => write("error", fields),
    flush() {
      try { base.flush(); } catch (_error) { /* best-effort */ }
    },
    /**
     * 保留 API 形状（调用方与测试在 await 它），语义变为"已落盘恒真"：
     * 同步追加流在 write 返回前就完成落盘，因此这里无需任何等待/屏障。
     * 顺带消掉"未 flush 时门禁读到 0 行文件、把 status=empty 误判为通过"的坑。
     */
    whenFlushed() {
      return Promise.resolve();
    },
    /** 关闭底层流并移出进程内缓存（测试与短命进程用）。 */
    close() {
      loggerCache.delete(cacheKey);
      try { base.flush(); } catch (_error) { /* best-effort */ }
      if (!stream || stream === process.stdout || typeof stream.end !== "function") return Promise.resolve();
      return new Promise((resolve) => {
        try {
          stream.end(() => resolve());
        } catch (_error) {
          resolve();
        }
      });
    },
  };

  if (!options.stream) loggerCache.set(cacheKey, logger);
  return logger;
}

/**
 * 记录一条开发活动事件。
 * seq 由函数机器定号（调用方传入的 seq 一律忽略），ts 由函数补齐，其余字段按契约校验。
 * req / cmd 未提供时落盘 null（schema 已按 null 语义写死：键无条件写入，不是省略、不是空串）。
 * @returns 完整事件记录（含 seq / ts），与落盘内容一致。
 *
 * ⛔ 勿用：业务运行时事件（observeOperation 的 `*.started/.completed/.failed`）**不得**写入本台账——
 *    它们缺 `seq` / `cls` / `auth` / `zone` / `files`，且本质不是"开发活动"。
 *    业务运行时日志归 server/shared/json-logger.cjs（.tmp/logs/runtime.jsonl）。
 *
 * 单写者约束：seq 的作用域是"**该 owner 自己的文件**"（docs/dev-log/entries/<owner>.jsonl），
 *    不是全目录全局计数器。同一 owner 同一时刻只应有一个写者；同一角色被派生多实例（-2 版本）时，
 *    **必须写基础角色名**（不带 `-2`），否则合并后同一文件会出现重复 seq（门禁报
 *    dev_log_seq_duplicate）。
 */
function emitDevEvent(fields = {}, options = {}) {
  if (!fields || typeof fields !== "object") throw invalidField("dev-log: event fields are required");
  const owner = requireOwner(fields.owner);
  const cls = requireEnum("cls", fields.cls, DEV_LOG_CLASSES);
  const auth = requireEnum("auth", fields.auth, DEV_LOG_AUTH_LEVELS);
  if (typeof fields.event !== "string" || fields.event.length === 0) {
    throw invalidField("dev-log: event must be a non-empty string");
  }
  // zone 在 schema 中 required 且 minLength 1：append-only 日志写错无法回收，必须写入侧拦住。
  if (typeof fields.zone !== "string" || fields.zone.length === 0) {
    throw invalidField(`dev-log: zone must be a non-empty string, received ${JSON.stringify(fields.zone)}`);
  }
  if (fields.req !== undefined && fields.req !== null && (typeof fields.req !== "string" || !REQ_PATTERN.test(fields.req))) {
    throw invalidField(`dev-log: req must be null or match ${REQ_PATTERN}, received ${JSON.stringify(fields.req)}`);
  }
  if (fields.cmd !== undefined && fields.cmd !== null && typeof fields.cmd !== "string") {
    throw invalidField(`dev-log: cmd must be a string or null, received ${JSON.stringify(fields.cmd)}`);
  }
  const source = requireEnum("source", nullable(fields.source) ?? "dev", DEV_LOG_SOURCES);
  const level = requireEnum("level", nullable(fields.level) ?? "info", DEV_LOG_LEVELS);
  const entriesDir = resolveEntriesDir(options);
  const target = createDevLogger(owner, options);

  const buildRecord = (seq) => ({
    // seq 机器定号：不读取 fields.seq，调用方无法覆盖。
    seq,
    ts: new Date().toISOString(),
    source,
    cls,
    auth,
    req: nullable(fields.req),
    owner,
    zone: fields.zone,
    files: normalizeFiles(fields.files),
    cmd: nullable(fields.cmd),
    exit: normalizeInteger(nullable(fields.exit), "exit"),
    duration_ms: normalizeDuration(nullable(fields.duration_ms)),
    event: fields.event,
    level,
    // #1883 语义层透传：summary/modules 仅 dev.task.summarized 事件携带（门禁校验错位即拦）。
    // #1885 假解决闭环透传：regressed（解监理记复现）/ reopened（责任角色返工）。
    ...(fields.event === "dev.task.summarized"
      ? {
          summary: typeof fields.summary === "string" ? fields.summary : null,
          modules: Array.isArray(fields.modules) ? fields.modules : undefined,
        }
      : {}),
    ...(fields.event === "dev.task.regressed" || fields.event === "dev.task.reopened"
      ? {
          reopened_of: typeof fields.reopened_of === "string" ? fields.reopened_of : null,
          rework_note: typeof fields.rework_note === "string" ? fields.rework_note : null,
        }
      : {}),
    // 问题处理流程（2026-09-28 门禁 2）：子 agent 辖区核实事件九字段透传 + 写入端 fail-fast。
    // 字段契约唯一事实源 = contracts/dev-log.schema.json 的 if/then 条件校验；此处只做形状与枚举的
    // 写入侧拦截（append-only 台账写错无法回收），语义校验由 check:dev-log 的 ajv 全量校验兜底。
    ...(fields.event === "dev.zone.verified"
      ? {
          zoneType: requireEnum("zoneType", fields.zoneType, ZONE_VERIFIED_ENUMS.zoneType),
          checkLocation: requireNonEmptyString("checkLocation", fields.checkLocation),
          inputContract: requireNonEmptyString("inputContract", fields.inputContract),
          outputContract: requireNonEmptyString("outputContract", fields.outputContract),
          zoneBehavior: requireNonEmptyString("zoneBehavior", fields.zoneBehavior),
          failCondition: requireNonEmptyString("failCondition", fields.failCondition),
          evidence: normalizeEvidence(fields.evidence),
          conclusion: requireEnum("conclusion", fields.conclusion, ZONE_VERIFIED_ENUMS.conclusion),
        }
      : {}),
  });

  const persist = (record) => {
    // ts / level 不进 payload：json-logger 的 timestamp / level 格式化器已按同语义写入，
    // 重复传会造成一行里出现两个 ts / level 键（不同消费者取值不一致）。落盘值即为事件时间与 level。
    const { ts: _ts, level: _level, ...payload } = record;
    target[record.level](payload);
  };

  if (isTestContext(options)) {
    const record = buildRecord(allocateEphemeralSeq(owner, entriesDir));
    persist(record);
    return record;
  }

  // 顺序不可调换：取号 → **同步落盘** → 才释放排他锁。
  // 落盘先于解锁，"磁盘是唯一事实源"才成立（否则另一进程会在锁内扫到旧 max 而重号）。
  let emitted = null;
  withSeqLock(owner, () => {
    emitted = buildRecord(nextSeqLocked(owner, entriesDir));
    persist(emitted);
  });
  return emitted;
}

/** 读取某成员的事件流（跳过不可解析行），供进度派生使用。 */
function readDevLog(owner, options = {}) {
  const filePath = resolveDevLogPath(owner, options);
  if (!fs.existsSync(filePath)) return [];
  const records = [];
  for (const line of fs.readFileSync(filePath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch (_error) { /* 半行跳过 */ }
  }
  return records;
}

// ── 提交号拼法与「是否已落账」判据（PR-251 根治：两写入者共用一份，比较不再靠字面串相等）──
//
// 现场事实（2026-11-06 实测）：在册 git:commit 行按哈希长度并存两种拼法——7 位 1281 行、8 位 2302 行。
// 钩子侧此前用 `content.includes("git:commit <8位>\"")` 字面相等判「已落账」，回填器侧用 `slice(0,7)` 集合，
// 两套判据对同一事实互不相认——谁先把两侧判据读成"另一套的绿灯"，谁就写出双记（PR-251 那次实测追加 1336 条）。
// 本块把两件事收成一份：①出串只经 commitCmdOf；②认「已落账」只经前缀包含（长度不整的历史行照样命中，
// 前缀不同则不命中——不会把另一笔提交当冒牌）。
const COMMIT_CMD_PREFIX = "git:commit ";
/** 台账里提交号的在册拼法长度（本仓 `git rev-parse --short` 当前读数＝8；长度是仓库规模的函数，
 *  若 git 自加长，改这一处并同批重跑 `npm run check:dev-log`——两写入者都经 commitCmdOf 出串，不会分叉）。 */
const COMMIT_HASH_LEN = 8;
const HEX_HASH_RE = /^[0-9a-f]{7,40}$/;

/** 落账用的 cmd 原文：`git:commit <短号>`。fullHash 必须是 40 位全哈希，防把短号再截一次。 */
function commitCmdOf(fullHash) {
  const hex = String(fullHash || "").trim().toLowerCase();
  if (!HEX_HASH_RE.test(hex) || hex.length !== 40) {
    throw invalidField(`commitCmdOf 需 40 位全哈希，收到 "${String(fullHash).slice(0, 12)}"`);
  }
  return `${COMMIT_CMD_PREFIX}${hex.slice(0, COMMIT_HASH_LEN)}`;
}

/** 扫台账（全部 owner 文件）取出册的提交号原串——原样返回，不做长度归一（历史行 7/8 位并存）。 */
function readRecordedCommitHashes(entriesDir = DEFAULT_ENTRIES_DIR) {
  const raws = [];
  if (!fs.existsSync(entriesDir)) return raws;
  for (const file of fs.readdirSync(entriesDir)) {
    if (!file.endsWith(".jsonl")) continue;
    let text = "";
    try {
      text = fs.readFileSync(path.join(entriesDir, file), "utf8");
    } catch (_error) {
      continue; // 读不到即不计入，与 check-dev-log 的损坏行处置分工一致
    }
    for (const line of text.split("\n")) {
      if (!line.trim()) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch (_error) {
        continue; // 半行交给门禁报，不在这里猜
      }
      const cmd = typeof record.cmd === "string" ? record.cmd : "";
      if (!cmd.startsWith(COMMIT_CMD_PREFIX)) continue;
      const hex = cmd.slice(COMMIT_CMD_PREFIX.length).trim().toLowerCase();
      if (HEX_HASH_RE.test(hex)) raws.push(hex);
    }
  }
  return raws;
}

/**
 * 「这笔提交是否已落账」的索引。键取前 7 位分桶（在册串与待判哈希都够长），
 * 命中判据＝前缀包含（任一侧为另一侧的前缀），故 7 位历史行与 8 位新行互认。
 */
function createCommitRecordIndex(entriesDirOrHashes = DEFAULT_ENTRIES_DIR) {
  const raws = Array.isArray(entriesDirOrHashes) ? entriesDirOrHashes : readRecordedCommitHashes(entriesDirOrHashes);
  const buckets = new Map();
  for (const hex of raws) {
    const key = hex.slice(0, 7);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(hex);
  }
  return {
    size: raws.length,
    has(fullHash) {
      const hex = String(fullHash || "").trim().toLowerCase();
      if (!HEX_HASH_RE.test(hex)) return false;
      const bucket = buckets.get(hex.slice(0, 7));
      if (!bucket) return false;
      return bucket.some((recorded) => hex.startsWith(recorded) || recorded.startsWith(hex));
    },
  };
}

module.exports = {
  DEV_LOG_AUTH_LEVELS,
  DEV_LOG_CLASSES,
  DEV_LOG_LEVELS,
  DEV_LOG_OWNERS,
  DEV_LOG_SOURCES,
  DEV_LOG_SUBSYSTEM,
  COMMIT_CMD_PREFIX,
  commitCmdOf,
  createCommitRecordIndex,
  readRecordedCommitHashes,
  createDevLogger,
  emitDevEvent,
  readDevLog,
  resolveDevLogPath,
};
