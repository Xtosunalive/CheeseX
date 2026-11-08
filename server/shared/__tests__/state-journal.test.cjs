// @tests: server/shared/persistence/state-journal.cjs + vault-io channel log
// SPEC-012 F1 修订/F2——通道写日志（哈希取证＋账车）＋③类流水重放（§四.12 kill -9 删库演练）。
// 层级：纯单元（内存库）＋迁移契约演练（真文件流水＋删库重放——先红后绿）。
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { openPersistenceDb } = require("../persistence/sqlite-adapter.cjs");
const { createRuntimeStateStore, initRuntimeStateStore } = require("../persistence/runtime-state-store.cjs");
const { createStateJournal, replayStateJournal, journalPath } = require("../persistence/state-journal.cjs");
const { createVaultIO } = require("../vault-io.cjs");

function makeVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "f2-journal-"));
  fs.mkdirSync(path.join(dir, "知识库"), { recursive: true });
  return dir;
}

test("① ③类写经 store 自动落流水（各族事件形态）", () => {
  const vault = makeVault();
  try {
    const journal = createStateJournal(vault);
    const store = createRuntimeStateStore(openPersistenceDb(), { journal });
    store.approval.put("a1", { status: "confirmed" });
    store.review.append({ action: "approve", reviewer: "journal-test", decidedAt: "t1", source: "s", target: "t" }, "t1");
    store.anomaly.replaceAll({ i1: { status: "open" } });
    store.pipeline.versionPut({ pipeline_run_id: "r1" });
    const lines = fs.readFileSync(journalPath(vault), "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(lines.length, 4);
    assert.deepEqual(
      lines.map((e) => `${e.family}.${e.op}`),
      ["approval.put", "review.append", "anomaly.replaceAll", "pipeline.versionPut"],
    );
    assert.deepEqual(lines[0].args, ["a1", { status: "confirmed" }]);
    // 排除族不落流水
    store.locks.tryAcquire("publish");
    store.migration.markImported("x");
    const after = fs.readFileSync(journalPath(vault), "utf8").trim().split("\n").length;
    assert.equal(after, 4, "locks/migration 不进流水");
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
  }
});

test("② §四.12 演练：kill 后删 runtime-state.db → boot 重放重建一致（先红后绿）", () => {
  const vault = makeVault();
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "f2-db-"));
  try {
    const dbPath = path.join(dataDir, "runtime-state.db");
    // —— 生产期：带流水写一组状态 ——
    const journal = createStateJournal(vault);
    const live = initRuntimeStateStore(openPersistenceDb({ path: dbPath }), { journal });
    live.approval.put("a1", { status: "verified", displaySeq: 1 });
    live.workflow.put({ schemaVersion: "6.0", tasks: [1], articles: [] });
    live.governance.put({ gapId: "g1", action: "resolve", note: "n", resolvedAt: "t" });
    live.inference.putEnvelope({ formatVersion: 1, conflicts: [] });
    live.anomaly.replaceAll({ i1: { status: "open", displaySeq: 1 }, i2: { status: "verified" } });
    live.pipeline.runsInsert({ run_ts: "r1", status: "success", nodes: 5, connections: 2, components: 1, plates: 0, failed_stage: null, error: null, duration_ms: 10 });
    const beforeFp = JSON.stringify({
      a: live.approval.get("a1"), w: live.workflow.get(), g: live.governance.list(),
      i: live.inference.getEnvelope(), an: live.anomaly.all(), r: live.pipeline.runsLatest(),
    });
    live.approval.put("a1", { status: "closed" }); // 后续覆盖也入流水
    const finalFp = JSON.stringify({
      a: live.approval.get("a1"), w: live.workflow.get(), g: live.governance.list(),
      i: live.inference.getEnvelope(), an: live.anomaly.all(), r: live.pipeline.runsLatest(),
    });

    // —— 灾难：删库（kill -9 后文件丢失的等价模拟）——
    for (const suf of ["", "-wal", "-shm"]) fs.rmSync(dbPath + suf, { force: true });

    // —— 先红：无重放直接开库 → 状态空 ——
    const bare = initRuntimeStateStore(openPersistenceDb({ path: dbPath }));
    assert.equal(bare.approval.get("a1"), undefined, "未重放前状态为空（红面）");

    // —— 后绿：boot 重放 → 与灾前一致（含覆盖语义：a1=closed）——
    const replayed = replayStateJournal({ vaultPath: vault, store: bare });
    assert.ok(replayed.replayed >= 7, `应重放 ≥7 笔（实际 ${replayed.replayed}）`);
    const afterFp = JSON.stringify({
      a: bare.approval.get("a1"), w: bare.workflow.get(), g: bare.governance.list(),
      i: bare.inference.getEnvelope(), an: bare.anomaly.all(), r: bare.pipeline.runsLatest(),
    });
    assert.equal(afterFp, finalFp, "重放后状态与灾前一致");
    assert.notEqual(afterFp, beforeFp, "覆盖事件生效（非旧状态）");

    // —— 幂等：再跑一遍重放 → 零新增、状态不变（水位）——
    const again = replayStateJournal({ vaultPath: vault, store: bare });
    assert.equal(again.replayed, 0, "水位后零重放");
    assert.equal(JSON.stringify(bare.approval.get("a1")), JSON.stringify({ status: "closed" }));
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("③ 通道写日志：vault-io 写后落 {路径＋哈希＋域}；日志自身不记（防递归）；账车带上日志文件", () => {
  const vault = makeVault();
  try {
    const ledgerCalls = [];
    const io = createVaultIO({
      vaultPath: vault,
      gitLedger: {
        markSystemFile: () => {},
        scheduleLedger: (domain, summary, files) => ledgerCalls.push({ domain, files }),
      },
    });
    const target = path.join(vault, "知识库", "x.yaml");
    io.writeVaultFile(target, "hello: world\n", { expectedContentHash: "absent", domain: "schema-page", summary: "t" }); // PR-083：新建声明 absent
    const logPath = path.join(vault, ".ledger", "channel-write-log.jsonl");
    assert.ok(fs.existsSync(logPath), "日志文件应产生");
    const entry = JSON.parse(fs.readFileSync(logPath, "utf8").trim().split("\n")[0]);
    assert.equal(entry.path, "知识库/x.yaml");
    assert.equal(entry.domain, "schema-page");
    const crypto = require("node:crypto");
    assert.equal(entry.contentHash, "sha256:" + crypto.createHash("sha256").update("hello: world\n", "utf8").digest("hex"));
    // 账车：提交文件集含目标＋日志
    const sched = ledgerCalls.find((c) => c.domain === "schema-page");
    assert.ok(sched.files.some((f) => f.endsWith("channel-write-log.jsonl")), "日志应搭账车");
    // 再写一笔：日志两行、无自身记录
    io.writeVaultFile(path.join(vault, "知识库", "y.yaml"), "a: 1\n", { expectedContentHash: "absent", domain: "d", summary: "s" }); // PR-083：新建声明 absent
    const lines = fs.readFileSync(logPath, "utf8").trim().split("\n");
    assert.equal(lines.length, 2);
    assert.ok(!lines.some((l) => l.includes("channel-write-log")), "日志自身不记");
  } finally {
    fs.rmSync(vault, { recursive: true, force: true });
  }
});
