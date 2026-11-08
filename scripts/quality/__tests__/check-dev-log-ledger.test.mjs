import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

// 纯校验逻辑测试：全部导入自 ../shared/dev-log-ledger.mjs（无 CLI、无报告、无退出码）。
// 编排层（checkDevLog / main / CLI 输出）的测试留在 check-dev-log.test.mjs。
import {
  ENTRIES_RELPATH,
  LEDGER_SIZE_HINT_BYTES,
  OWNER_ZONE_PREFIXES,
  BYTES_PER_EVENT_APPROX,
  checkLedgerFileNames,
  checkSeqUniqueness,
  ledgerSizeHints,
  readEnum,
  readPattern,
  collectEntryFiles,
  readEvents,
} from "../shared/dev-log-ledger.mjs";

// 事实源：contracts/dev-log.schema.json（唯一契约，已落地）。替身已退役，缺正本硬红。
const REAL_SCHEMA_PATH = path.join(import.meta.dirname, "../../../contracts/dev-log.schema.json");
const realSchema = (() => {
  if (!fs.existsSync(REAL_SCHEMA_PATH)) {
    throw new Error(`契约事实源缺失：${REAL_SCHEMA_PATH}——本测试不得在替身上变绿`);
  }
  return JSON.parse(fs.readFileSync(REAL_SCHEMA_PATH, "utf8"));
})();

const OWNER_LEDGER = "quality-gate-engineer.jsonl";

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "dev-log-ledger-"));
}

function makeEntries(root, files) {
  const entries = path.join(root, ENTRIES_RELPATH);
  fs.mkdirSync(entries, { recursive: true });
  for (const [name, lines] of Object.entries(files)) {
    fs.writeFileSync(path.join(entries, name), `${lines.join("\n")}\n`);
  }
  return entries;
}

// ── 台账文件名↔owner（一 owner 一台账、禁分片）──

test("checkLedgerFileNames 直接可测：合法名全绿；游离名/前缀名/后缀名判红", () => {
  assert.deepEqual(checkLedgerFileNames([OWNER_LEDGER], realSchema), []);
  assert.equal(checkLedgerFileNames(["a.jsonl"], realSchema)[0].kind, "dev_log_ledger_filename_invalid");
  // 轮转时代产物：前缀时间戳 / 后缀 owner 形态一律判红
  assert.equal(
    checkLedgerFileNames(["20260915-0209-01-quality-gate-engineer.jsonl"], realSchema)[0].kind,
    "dev_log_ledger_filename_invalid",
  );
  assert.equal(
    checkLedgerFileNames(["x-quality-gate-engineer.jsonl"], realSchema)[0].kind,
    "dev_log_ledger_filename_invalid",
  );
});

test("checkLedgerFileNames：游离分片即使为空（0 事件）也违规（与事件条数无关）", () => {
  const errs = checkLedgerFileNames(["20260915-0209-01-quality-gate-engineer.jsonl"], realSchema);
  assert.equal(errs.length, 1);
  assert.equal(errs[0].kind, "dev_log_ledger_filename_invalid");
});

test("checkLedgerFileNames：owner 枚举源缺失 → dev_log_ledger_owner_source_missing，fail-closed", () => {
  const noOwner = { ...realSchema, properties: { ...realSchema.properties, owner: { type: "string" } } };
  const errs = checkLedgerFileNames([OWNER_LEDGER], noOwner);
  assert.equal(errs[0].kind, "dev_log_ledger_owner_source_missing");
});

// ── seq（ADR051:13 撞号 4 次）──

test("checkSeqUniqueness 直接可测：文件内撞号与跳号各报一条，连续则不报", () => {
  const mk = (seq, file = "a.jsonl") => ({ file, line: seq, value: { seq } });
  assert.equal(checkSeqUniqueness([mk(1), mk(2), mk(3)]).length, 0);
  assert.equal(checkSeqUniqueness([mk(1), mk(1)]).filter((e) => e.kind === "dev_log_seq_duplicate").length, 1);
  assert.equal(checkSeqUniqueness([mk(1), mk(5)]).filter((e) => e.kind === "dev_log_seq_discontinuous").length, 1);
});

// 作用域回归：此前按全局校验会把合法的 per-owner 编号误判为撞号（假阳性）。
test("checkSeqUniqueness 作用域=文件：跨文件同号不报，各文件独立 1..N", () => {
  const mk = (seq, file) => ({ file, line: 1, value: { seq } });
  // 两个文件各有 seq=1 —— 合法且预期（落盘器按 owner 取号，无全局计数器）
  assert.equal(checkSeqUniqueness([mk(1, "a.jsonl"), mk(1, "b.jsonl")]).length, 0);
  // 各自文件内连续即可，无需跨文件连续
  assert.equal(checkSeqUniqueness([mk(1, "a.jsonl"), mk(2, "a.jsonl"), mk(1, "b.jsonl")]).length, 0);
  // 同一文件内同号仍是撞号，且错误点名该文件
  const dup = checkSeqUniqueness([mk(1, "a.jsonl"), mk(1, "a.jsonl"), mk(1, "b.jsonl")]);
  assert.equal(dup.filter((e) => e.kind === "dev_log_seq_duplicate").length, 1);
  assert.equal(dup[0].file, "a.jsonl");
  // 同一文件内的跳号同样点名该文件
  const gap = checkSeqUniqueness([mk(1, "a.jsonl"), mk(3, "a.jsonl"), mk(1, "b.jsonl")]);
  assert.equal(gap.filter((e) => e.kind === "dev_log_seq_discontinuous").length, 1);
  assert.equal(gap[0].file, "a.jsonl");
});

// ── schema 读取（枚举/模式唯一事实源在 schema，脚本不抄字面量）──

test("readEnum 支持 properties 直接声明与 $defs 引用两种形式", () => {
  assert.deepEqual(readEnum(realSchema, "cls"), readEnum(realSchema, "cls"));
  const schema = { properties: { cls: { $ref: "#/$defs/clsEnum" } }, $defs: { clsEnum: { enum: ["W1", "W2"] } } };
  assert.deepEqual(readEnum(schema, "cls"), ["W1", "W2"]);
  // 未声明 / 空 enum → 返回 null（交给调用方 fail-closed）
  assert.equal(readEnum({ properties: {} }, "cls"), null);
  assert.equal(readEnum({ properties: { cls: { type: "string" } } }, "cls"), null);
});

test("readPattern 从 schema 取模式（支持 $ref 解析；非法正则/缺声明返回 null）", () => {
  const p = readPattern(realSchema, "req");
  assert.ok(p instanceof RegExp, "正本 req.pattern 应可解析为 RegExp");
  assert.equal(p.source, "^#\\d+$");
  const viaRef = { properties: { req: { $ref: "#/$defs/p" } }, $defs: { p: { pattern: "^#\\d+$" } } };
  assert.equal(readPattern(viaRef, "req").source, "^#\\d+$");
  assert.equal(readPattern({ properties: {} }, "req"), null);
  assert.equal(readPattern({ properties: { req: { pattern: "" } } }, "req"), null);
  assert.equal(readPattern({ properties: { req: { pattern: "[" } } }, "req"), null);
});

// ── 台账体积护栏（只提示，不改退出码）──

test("ledgerSizeHints：未越线保持安静，越线给出体积与约当事件数", () => {
  const sizes = [
    { file: `${ENTRIES_RELPATH}/a.jsonl`, bytes: 1024 },
    { file: `${ENTRIES_RELPATH}/b.jsonl`, bytes: LEDGER_SIZE_HINT_BYTES },
    { file: `${ENTRIES_RELPATH}/c.jsonl`, bytes: LEDGER_SIZE_HINT_BYTES * 3 },
  ];
  const hints = ledgerSizeHints(sizes);
  assert.equal(hints.length, 2, "只有达到/超过提示线的台账才提示");
  assert.match(hints[0], /b\.jsonl/);
  assert.match(hints[0], /10\.0 MiB/, "应显示体积");
  assert.match(hints[0], /约 \d+ 条事件/, "应给出约当事件数");
  assert.match(hints[1], /c\.jsonl/);
  assert.match(hints[1], /30\.0 MiB/);
  assert.match(hints[0], /禁止删除\/截断\/轮转/, "提示必须点明不可回收、不得删改");
});

test("ledgerSizeHints：空输入与未越线 → 零提示；约当事件数按 BYTES_PER_EVENT_APPROX 估算", () => {
  assert.deepEqual(ledgerSizeHints([]), []);
  assert.deepEqual(ledgerSizeHints(null), []);
  assert.deepEqual(ledgerSizeHints([{ file: "a.jsonl", bytes: LEDGER_SIZE_HINT_BYTES - 1 }]), []);
  // 必须越过 10 MiB 提示线才会产出提示；约当事件数按 BYTES_PER_EVENT_APPROX 估算。
  const bytes = LEDGER_SIZE_HINT_BYTES + BYTES_PER_EVENT_APPROX * 3;
  const approx = Math.round(bytes / BYTES_PER_EVENT_APPROX);
  const single = ledgerSizeHints([{ file: "a.jsonl", bytes }]);
  assert.equal(single.length, 1);
  assert.match(single[0], new RegExp(`约 ${approx} 条事件`));
});

// ── 事件读取（纯函数级）──

test("collectEntryFiles：目录缺失返回 null；存在时返回排序后的 .jsonl 名（忽略非 .jsonl）", () => {
  const missing = collectEntryFiles(path.join(tmpRoot(), "nope"));
  assert.equal(missing, null, "目录不存在 → null（合法空态的一种）");
  const root = tmpRoot();
  const entries = makeEntries(root, {
    [OWNER_LEDGER]: ["{}"],
    "server-api-engineer.jsonl": ["{}"],
    "notes.md": ["ignored"],
    "a.jsonl": ["{}"],
  });
  const names = collectEntryFiles(entries);
  assert.deepEqual(names, ["a.jsonl", OWNER_LEDGER, "server-api-engineer.jsonl"], "仅 .jsonl、按名升序");
});

test("readEvents：逐行解析为带 file/line 的事件；非法 JSON 标红；空行跳过；记录台账字节数", () => {
  const root = tmpRoot();
  const entries = makeEntries(root, {
    [OWNER_LEDGER]: ['{"seq":1}', "", '   ', "not json", '{"seq":2}'],
  });
  const { events, parseErrors, ledgerSizes } = readEvents(entries, [OWNER_LEDGER]);
  assert.equal(events.length, 2, "两条合法 JSON 对象被解析");
  assert.equal(events[0].seq ?? events[0].value.seq, 1);
  assert.equal(events[0].file, `${ENTRIES_RELPATH}/${OWNER_LEDGER}`);
  assert.equal(events[0].line, 1, "行号从 1 计");
  assert.equal(events[1].line, 5, "跳过的空行不计入行号");
  assert.equal(parseErrors.length, 1, "第 4 行非法 JSON 一条错误");
  assert.equal(parseErrors[0].kind, "dev_log_invalid_json");
  assert.equal(parseErrors[0].line, 4);
  assert.equal(ledgerSizes.length, 1);
  assert.ok(ledgerSizes[0].bytes > 0);
});

test("readEvents：非对象 JSON（数组/标量/null）一律标红，不构成事件", () => {
  const root = tmpRoot();
  const entries = makeEntries(root, {
    [OWNER_LEDGER]: ["[]", "42", "null", '"str"', '{"seq":1}'],
  });
  const { events, parseErrors } = readEvents(entries, [OWNER_LEDGER]);
  assert.equal(events.length, 1, "仅对象被接纳");
  assert.equal(parseErrors.length, 4, "数组/标量/null/字符串各一条错误");
  assert.ok(parseErrors.every((e) => e.kind === "dev_log_invalid_json"));
});

// ── 契约唯一性防护 ──

test("归属映射的键必须与 schema 的 owner 枚举完全一致（防漂移）", () => {
  const schemaOwners = readEnum(realSchema, "owner");
  assert.ok(schemaOwners, "schema 必须声明 owner 枚举");
  assert.deepEqual(
    Object.keys(OWNER_ZONE_PREFIXES).sort(),
    [...schemaOwners].sort(),
    "OWNER_ZONE_PREFIXES 的键必须与 contracts/dev-log.schema.json 的 owner 枚举一一对应",
  );
});

test("替身已退役：scripts/quality/fixtures/dev-log 不得存在（防契约第二副本回流）", () => {
  const fixtureDir = path.join(import.meta.dirname, "../fixtures/dev-log");
  assert.equal(
    fs.existsSync(fixtureDir),
    false,
    `契约替身目录必须退役，否则测试会在非契约的 schema 上变绿：${fixtureDir}`,
  );
});
