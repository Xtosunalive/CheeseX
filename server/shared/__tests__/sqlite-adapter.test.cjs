// @tests: server/shared/persistence/sqlite-adapter.cjs
// SPEC-012 WP-C 前置件——适配器契约：迁移幂等/checksum 守门/版本超前拒绝/WAL/事务/跨连接并发。
// 层级标注：①-⑤ 为纯单元（内存库）；⑥-⑦ 为真实集成（真库文件、双连接并发——SPEC §四.9 第三层）。
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { openPersistenceDb } = require("../persistence/sqlite-adapter.cjs");

const MIGRATIONS = [
  { id: "0001-demo", sql: "CREATE TABLE demo (id TEXT PRIMARY KEY, value TEXT NOT NULL)" },
];

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "sqlite-adapter-"));
}

test("① 内存库：建表/插入/查询往返", () => {
  const db = openPersistenceDb();
  try {
    db.applyMigrations(MIGRATIONS);
    db.prepare("INSERT INTO demo (id, value) VALUES (?, ?)").run("a", "1");
    const row = db.prepare("SELECT * FROM demo WHERE id = ?").get("a");
    assert.equal(row.value, "1");
  } finally {
    db.close();
  }
});

test("② 迁移幂等：重复应用为 no-op", () => {
  const db = openPersistenceDb();
  try {
    db.applyMigrations(MIGRATIONS);
    db.applyMigrations(MIGRATIONS); // 第二遍不报错不重复
    const count = db.prepare("SELECT COUNT(*) AS n FROM persistence_migrations").get();
    assert.equal(count.n, 1);
  } finally {
    db.close();
  }
});

test("③ checksum 守门：已应用迁移的 sql 被改动 → 拒绝", () => {
  const db = openPersistenceDb();
  try {
    db.applyMigrations(MIGRATIONS);
    assert.throws(
      () => db.applyMigrations([{ id: "0001-demo", sql: "CREATE TABLE demo2 (x)" }]),
      (err) => err.code === "PERSISTENCE_MIGRATION_CHECKSUM_MISMATCH",
    );
  } finally {
    db.close();
  }
});

test("④ 版本超前守门：库内存在代码不认识的条目 → 拒绝（旧代码不读新格式）", () => {
  const db = openPersistenceDb();
  try {
    db.applyMigrations([
      ...MIGRATIONS,
      { id: "0002-extra", sql: "CREATE TABLE extra (x)" },
    ]);
    // 模拟旧代码：只认识 0001
    assert.throws(
      () => db.applyMigrations(MIGRATIONS),
      (err) => err.code === "PERSISTENCE_MIGRATION_AHEAD",
    );
  } finally {
    db.close();
  }
});

test("⑤ 事务：异常 ROLLBACK，已写数据不留半状态（③类事务性语义）", () => {
  const db = openPersistenceDb();
  try {
    db.applyMigrations(MIGRATIONS);
    assert.throws(() =>
      db.transaction(() => {
        db.prepare("INSERT INTO demo (id, value) VALUES (?, ?)").run("t1", "x");
        throw new Error("boom");
      }));
    const row = db.prepare("SELECT COUNT(*) AS n FROM demo").get();
    assert.equal(row.n, 0, "回滚后不留半状态");
    // 提交路径
    db.transaction(() => {
      db.prepare("INSERT INTO demo (id, value) VALUES (?, ?)").run("t2", "ok");
    });
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM demo").get().n, 1);
  } finally {
    db.close();
  }
});

// 层级：真实集成/故障恢复。真实子进程持锁，公开 SQL 触发 SQLITE_BUSY；无模拟驱动。
test("WP-093 事务启动锁超时后，同句柄恢复、重复提交与重新开库均可见", async (t) => {
  const dir = tmpDir();
  const dbPath = path.join(dir, "recover.db");
  const db = openPersistenceDb({ path: dbPath, migrations: [] });
  db.applyMigrations(MIGRATIONS);
  const { spawn } = require("node:child_process");
  const child = spawn(process.execPath, ["-e", `
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(process.argv[1]);
    db.exec('BEGIN IMMEDIATE');
    process.send('locked');
    process.on('message', () => { db.exec('COMMIT'); db.close(); process.exit(0); });
  `, dbPath], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(`holder exit=${code}`)));
  });
  t.after(() => { if (child.exitCode === null) child.kill(); fs.rmSync(dir, { recursive: true, force: true }); });
  try {
    await Promise.race([
      new Promise((resolve) => child.once("message", resolve)),
      done.then(() => { throw new Error("holder exited before lock"); }),
    ]);
    db.exec("PRAGMA busy_timeout=25");
    let entered = false;
    assert.throws(() => db.transaction(() => { entered = true; }), /locked/);
    assert.equal(entered, false, "事务未取得锁不得执行写入体");
    child.send("release");
    await done;
    for (const id of ["retry-1", "retry-2"]) {
      db.transaction(() => db.prepare("INSERT INTO demo VALUES (?, ?)").run(id, "recovered"));
    }
    const reader = openPersistenceDb({ path: dbPath });
    try { assert.equal(reader.prepare("SELECT COUNT(*) AS n FROM demo").get().n, 2); }
    finally { reader.close(); }
  } finally { db.close(); }
  const reopened = openPersistenceDb({ path: dbPath });
  try { assert.equal(reopened.prepare("SELECT COUNT(*) AS n FROM demo").get().n, 2); }
  finally { reopened.close(); }
});

test("⑥ 真实集成：文件库 WAL 模式生效且跨连接可见", () => {
  const dir = tmpDir();
  try {
    const dbPath = path.join(dir, "runtime-state.db");
    const writer = openPersistenceDb({ path: dbPath });
    writer.applyMigrations(MIGRATIONS);
    assert.equal(
      writer.prepare("PRAGMA journal_mode").get().journal_mode,
      "wal",
      "文件库应为 WAL 模式",
    );
    writer.prepare("INSERT INTO demo (id, value) VALUES (?, ?)").run("cross", "visible");
    // 第二连接（模拟 Python 跨进程读者）立即可见
    const reader = openPersistenceDb({ path: dbPath });
    try {
      const row = reader.prepare("SELECT * FROM demo WHERE id = ?").get("cross");
      assert.equal(row.value, "visible");
    } finally {
      reader.close();
    }
    writer.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("⑦ 真实集成：跨进程写竞争由 busy_timeout 消解（子进程持写锁期间本进程等待后落库）", async () => {
  const dir = tmpDir();
  try {
    const dbPath = path.join(dir, "runtime-state.db");
    const db = openPersistenceDb({ path: dbPath });
    db.applyMigrations(MIGRATIONS);

    // 子进程＝模拟 Python 跨进程写者：BEGIN IMMEDIATE 持锁后提交。持锁事实经 marker 文件同步
    // （原版固定 sleep 200ms 头start，机器负载下父事务可能落在 800ms 窗口之后→假红；同步后仅当
    // 父进程被延迟 >HOLD_MS 才可能失配，窗口放宽到 1500ms＋断言容差 250ms——2026-10-24 加固）。
    const HOLD_MS = 1500;
    const marker = path.join(dir, "lock-held");
    const holderScript = `
      const fs = require("node:fs");
      const { DatabaseSync } = require("node:sqlite");
      const db = new DatabaseSync(${JSON.stringify(dbPath)});
      db.exec("PRAGMA busy_timeout = 5000");
      db.exec("BEGIN IMMEDIATE");
      db.prepare("INSERT INTO demo (id, value) VALUES (?, ?)").run("cross-process", "child");
      fs.writeFileSync(${JSON.stringify(marker)}, "held");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ${HOLD_MS});
      db.exec("COMMIT");
      db.close();
    `;
    const child = require("node:child_process").spawn(process.execPath, ["-e", holderScript]);
    const childDone = new Promise((resolve, reject) => {
      child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`holder exit ${code}`))));
    });
    const syncDeadline = Date.now() + 5000;
    while (!fs.existsSync(marker)) {
      if (Date.now() > syncDeadline) throw new Error("子进程 5s 内未取得写锁（marker 未出现）");
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    const startedAt = Date.now();
    db.transaction(() => {
      db.prepare("INSERT INTO demo (id, value) VALUES (?, ?)").run("waiter", "parent");
    });
    const waitedMs = Date.now() - startedAt;
    // 等待须真实发生（busy_timeout 生效而非立即失败/立即成功）；容差吸收调度噪声，仍能抓住「1ms 即返」回归
    assert.ok(waitedMs >= 250, `应真实等待持锁窗口（实际 ${waitedMs}ms，持锁 ${HOLD_MS}ms）`);
    await childDone;
    const rows = db.prepare("SELECT COUNT(*) AS n FROM demo").get();
    assert.equal(rows.n, 2, "跨进程双写均落库（无丢失更新）");
    db.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
