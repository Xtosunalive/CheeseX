// Component: State-Journal（F2 ③类耐久性流水）
// @responsible: SPEC-012 F2——③类状态转移事务提交后追加审计事件到⑤类流水（vault git，随 push 远端备份）。
//   丢库不丢账：runtime-state.db 损坏/丢失时，boot 从流水按水位重放重建（§四.12）。
// @inputs: 各族写事务（Node store 层单点挂钩＋Python _runtime_state_db 写后同挂）
// @outputs: createStateJournal(vaultPath, {gitLedger}) → { append(family, op, args) }；replayStateJournal()
// @context: vault .ledger/state-journal.jsonl（⑤类 append-only；原 .ledger，PR-243 批B 退役；构造期 markSystemFile 静态登记
//   防 watcher 误记外部——Node/Python 双侧写都由本进程登记覆盖，WP-J 起 watcher 不再消费时间窗）
//
// 事件形态：每行 { seq, family, op, args, ts }——seq 文件内单调（boot 时数行初始化，进程内递增）；
// 重放按 store[family][op](...args) 分发，水位存 runtime_migration(family='state-journal-watermark')。
// 排除族：locks（瞬态——重放无意义且会制造假锁）、migration（重放标记自身）。

"use strict";

const fs = require("node:fs");
const path = require("node:path");

const JOURNAL_REL = ".ledger/state-journal.jsonl"; // PR-243 批B：实例名残留退役（对账键字面量，与 vault-paths.LEDGER_DIRNAME 同值）
const WATERMARK_FAMILY = "state-journal-watermark";
// WP-052 T2（SPEC-047）：可重放操作白名单唯一事实源——runtime-state-store 经 import 同源消费
// （原两份逐字手抄：一处加类型另一处漏 → 流水记了重启不重放＝假绿；单源后改一处即两侧同变）。
const REPLAYABLE = Object.freeze({
  approval: Object.freeze(["put"]),
  workflow: Object.freeze(["put"]),
  governance: Object.freeze(["put"]),
  review: Object.freeze(["append"]),
  inference: Object.freeze(["putEnvelope"]),
  expectations: Object.freeze(["put"]),
  anomaly: Object.freeze(["replaceAll", "put", "delete"]),
  pipeline: Object.freeze(["statePut", "stateDelete", "runsInsert", "versionPut"]),
});

function journalPath(vaultPath) {
  return path.join(vaultPath, JOURNAL_REL);
}

function readJournalLines(vaultPath) {
  const p = journalPath(vaultPath);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, "utf8").split("\n").filter((l) => l.trim());
}

/**
 * 创建流水追加器（vault-io 之外的独立追加面——③类写不经 vault 通道）。
 * @param {{ vaultPath: string, gitLedger?: object }} input
 */
function createStateJournal(vaultPath, { gitLedger } = {}) {
  try { require("../../vault-paths.cjs").ensureLedgerDir(vaultPath); } catch { /* 已存在——追加自会失败降级 */ } // PR-243 批B：单源
  const ledger = gitLedger || { markSystemFile() {}, scheduleLedger() {} };
  const jp = journalPath(vaultPath);
  let seq = 0;
  for (const line of readJournalLines(vaultPath)) {
    try { const e = JSON.parse(line); if (Number.isInteger(e.seq)) seq = Math.max(seq, e.seq); } catch { /* 半行容忍：跳过 */ }
  }
  // 构造期即登记为系统文件（WP-J）：流水不经 vault 通道、自身不在通道写日志——静态登记是
  // watcher 判内部的唯一面；eager 而非首写时登记，覆盖 Python 侧先于 Node 首写的窗口。
  if (typeof ledger.markSystemFile === "function") ledger.markSystemFile([jp]);

  return {
    journalPath: jp,
    /** 事务后追加一笔（best-effort：失败只吞——流水不得阻断③类写路径）。 */
    append(family, op, args) {
      try {
        seq += 1;
        const event = { seq, family, op, args: args ?? [], ts: new Date().toISOString() };
        fs.appendFileSync(jp, JSON.stringify(event) + "\n", "utf8");
        ledger.scheduleLedger("state-journal", "③类耐久性流水", [jp]);
        return event;
      } catch {
        return null;
      }
    },
  };
}

/**
 * boot 重放：按水位把流水增量重放到 store（幂等；无流水 no-op）。
 * @param {{ vaultPath: string, store: object, logger?: object }} input
 * @returns {{ replayed: number, watermark: number }}
 */
function replayStateJournal({ vaultPath, store, logger }) {
  const log = logger || { info() {}, warn() {}, error() {} };
  const lines = readJournalLines(vaultPath);
  const watermark = Number(store.migration.getWatermark(WATERMARK_FAMILY)) || 0;
  let replayed = 0;
  for (const line of lines) {
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (!Number.isInteger(event.seq) || event.seq <= watermark) continue;
    const ops = REPLAYABLE[event.family];
    if (!ops || !ops.includes(event.op)) continue;
    try {
      // 防回声（SPEC-012 F2 修复批）：重放走裸句柄——包装面会再记流水，形成跨 boot 自我翻倍
      const familyApi = (store.raw || store)[event.family];
      if (!familyApi || typeof familyApi[event.op] !== "function") continue;
      familyApi[event.op](...(event.args || []));
      replayed += 1;
    } catch (error) {
      log.warn({ event: "state-journal-replay-item-failed", seq: event.seq, family: event.family, error: error.message });
    }
  }
  const lastSeq = lines.length > 0 ? (() => { try { return JSON.parse(lines[lines.length - 1]).seq || 0; } catch { return 0; } })() : 0;
  store.migration.markWatermark(WATERMARK_FAMILY, String(lastSeq));
  if (replayed > 0) log.info({ event: "state-journal-replayed", replayed, watermark, newWatermark: lastSeq });
  return { replayed, watermark };
}

module.exports = { createStateJournal, replayStateJournal, journalPath, JOURNAL_REL, WATERMARK_FAMILY, REPLAYABLE };
