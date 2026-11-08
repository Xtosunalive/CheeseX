// @tests: server/shared/vault-io.cjs
// WP0 验收：原子写（进程中断无半截文件）、记账调用、boot 漂移扫、SIGTERM 排水
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..", "..", "..");
const {
  createVaultIO, recoverBootDrift, readVault, writeVault, replaceVault,
  contentRevision, ABSENT_REVISION,
} = require(path.join(ROOT, "server", "shared", "vault-io.cjs"));

// ── 测试辅助 ──
function makeTmpVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vault-io-test-"));
  fs.mkdirSync(path.join(dir, "知识库"), { recursive: true }); // 声明内①类前缀（SPEC-012 F1 目的地执法）
  return dir;
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}

function makeNoopLedger(calls) {
  return {
    markSystemFile: (paths) => calls && calls.push({ type: "mark", paths }),
    scheduleLedger: (domain, summary, files) => calls && calls.push({ type: "schedule", domain, summary, files }),
    flush: () => Promise.resolve(),
  };
}

// ── 1. writeVaultFile：原子写成功路径（含归属取证日志）──
test("writeVaultFile 写入文件内容正确且通道写日志留取证条目", () => {
  const dir = makeTmpVault();
  try {
    const calls = [];
    const io = createVaultIO({ vaultPath: dir, gitLedger: makeNoopLedger(calls) });
    const target = path.join(dir, "知识库", "test.yaml");
    io.writeVaultFile(target, "content: hello\n", { expectedContentHash: ABSENT_REVISION, domain: "schema-page", summary: "test write" });

    assert.equal(fs.readFileSync(target, "utf8"), "content: hello\n");
    // WP-J 归属取证：通道写日志按 path＋全文哈希记条目（watcher 据此判内部写）
    const logPath = path.join(dir, ".ledger", "channel-write-log.jsonl");
    assert.ok(fs.existsSync(logPath), "通道写日志应产生");
    const entry = JSON.parse(fs.readFileSync(logPath, "utf8").trim().split("\n")[0]);
    assert.equal(entry.path, "知识库/test.yaml");
    // PR-083：更新写日志记基线修订（凭据值随账入日志）
    assert.equal(entry.baseRevision, ABSENT_REVISION);
    const crypto = require("node:crypto");
    assert.equal(entry.contentHash, "sha256:" + crypto.createHash("sha256").update("content: hello\n", "utf8").digest("hex"));
    const sched = calls.find(c => c.type === "schedule");
    assert.ok(sched, "scheduleLedger 应被调用");
    assert.equal(sched.domain, "schema-page");
    assert.equal(sched.summary, "test write");
  } finally {
    cleanup(dir);
  }
});

// ── 2. writeVaultFile：写后无 .tmp 残留 ──
test("writeVaultFile 写后无 .tmp 残留", () => {
  const dir = makeTmpVault();
  try {
    const io = createVaultIO({ vaultPath: dir, gitLedger: makeNoopLedger() });
    const target = path.join(dir, "知识库", "no-leak.yaml");
    io.writeVaultFile(target, "x: 1\n", { expectedContentHash: ABSENT_REVISION, domain: "test", summary: "no-leak" });
    const tmps = fs.readdirSync(dir).filter(e => e.includes(".tmp"));
    assert.deepEqual(tmps, [], "不应有 .tmp 残留");
  } finally {
    cleanup(dir);
  }
});

// ── 3. writeVaultFile：目录不存在时抛错 ──
test("writeVaultFile 目标目录不存在时抛错", () => {
  const dir = makeTmpVault();
  try {
    const io = createVaultIO({ vaultPath: dir, gitLedger: makeNoopLedger() });
    const target = path.join(dir, "知识库", "nonexistent-subdir", "file.yaml");
    assert.throws(() => io.writeVaultFile(target, "x: 1\n", { expectedContentHash: ABSENT_REVISION, domain: "test", summary: "error" }));
  } finally {
    cleanup(dir);
  }
});

// ── 4. readVaultFile：正常读取 ──
test("readVaultFile 返回文件内容", () => {
  const dir = makeTmpVault();
  try {
    const target = path.join(dir, "知识库", "read.yaml");
    fs.writeFileSync(target, "hello: world\n");
    const io = createVaultIO({ vaultPath: dir, gitLedger: makeNoopLedger() });
    const read = io.readVaultFile(target);
    assert.equal(read.content, "hello: world\n");
    assert.equal(read.sha256, contentRevision("hello: world\n")); // PR-083：读签发凭据
  } finally {
    cleanup(dir);
  }
});

// ── 5. appendJsonl：追加行为正确（取证哈希＝写后全文——watcher 按当前内容匹配的口径）──
test("appendJsonl 追加多行且每行独立 JSON（取证哈希取写后全文）", () => {
  const dir = makeTmpVault();
  try {
    const io = createVaultIO({ vaultPath: dir, gitLedger: makeNoopLedger() });
    const target = path.join(dir, "知识库", "log.jsonl");
    io.appendJsonl(target, { a: 1 }, { domain: "test", summary: "append1" });
    io.appendJsonl(target, { b: 2 }, { domain: "test", summary: "append2" });
    const lines = fs.readFileSync(target, "utf8").trim().split("\n");
    assert.equal(lines.length, 2);
    assert.deepEqual(JSON.parse(lines[0]), { a: 1 });
    assert.deepEqual(JSON.parse(lines[1]), { b: 2 });
    // WP-J：追加写的取证条目记写后全文哈希（记行哈希会让追加目标被 watcher 误判外部写）
    const crypto = require("node:crypto");
    const entries = fs.readFileSync(path.join(dir, ".ledger", "channel-write-log.jsonl"), "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(entries.length, 2);
    const full = fs.readFileSync(target, "utf8");
    assert.equal(entries[1].contentHash, "sha256:" + crypto.createHash("sha256").update(full, "utf8").digest("hex"),
      "末条取证哈希＝当前全文哈希（watcher 据此命中内部写归属）");
  } finally {
    cleanup(dir);
  }
});

// ── 6. no-op ledger：缺省注入不崩 ──
test("createVaultIO 无 gitLedger 注入时不崩溃", () => {
  const dir = makeTmpVault();
  try {
    const io = createVaultIO({ vaultPath: dir }); // 无 gitLedger
    const target = path.join(dir, "知识库", "safe.yaml");
    io.writeVaultFile(target, "ok: true\n", { expectedContentHash: ABSENT_REVISION, domain: "test", summary: "no-op" });
    assert.equal(fs.readFileSync(target, "utf8"), "ok: true\n");
  } finally {
    cleanup(dir);
  }
});

// ── 7. recoverBootDrift：VAULT_GIT_LEDGER_DISABLE=1 时跳过 ──
test("recoverBootDrift 在 DISABLE=1 时立即返回（不调 scheduleLedger）", async () => {
  const orig = process.env.VAULT_GIT_LEDGER_DISABLE;
  process.env.VAULT_GIT_LEDGER_DISABLE = "1";
  const calls = [];
  const ledger = { scheduleLedger(...a) { calls.push(a); }, flush() { return Promise.resolve(); } };
  try {
    await recoverBootDrift("/nonexistent-vault", ledger, null);
    assert.equal(calls.length, 0, "DISABLE=1 时不应调 scheduleLedger");
  } finally {
    if (orig === undefined) delete process.env.VAULT_GIT_LEDGER_DISABLE;
    else process.env.VAULT_GIT_LEDGER_DISABLE = orig;
  }
});

// ── 8. recoverBootDrift：非 git 目录时只告警不崩 ──
test("recoverBootDrift 非 git 目录时只告警不抛", async () => {
  const dir = makeTmpVault();
  const warnCalls = [];
  const ledger = { scheduleLedger() {}, flush() { return Promise.resolve(); } };
  const logger = { info() {}, warn(...a) { warnCalls.push(a); } };
  try {
    await recoverBootDrift(dir, ledger, logger);
    assert.ok(
      warnCalls.some(a => JSON.stringify(a).includes("vault-io-boot-drift-failed")),
      "非 git 目录应产生 warn 日志",
    );
  } finally {
    cleanup(dir);
  }
});

// ── 9. SPEC-012 F1 目的地执法：越界写 throw（运行时 fail-closed，破坏实验）──
test("F1 执法：实例通道写未声明路径 throw VAULT_WRITE_DESTINATION_REJECTED", () => {
  const dir = makeTmpVault();
  try {
    const io = createVaultIO({ vaultPath: dir, gitLedger: makeNoopLedger() });
    // vault 根级未声明路径（如新投影写回 vault）→ 拦
    assert.throws(
      () => io.writeVaultFile(path.join(dir, "projections", "x.json"), "{}", { domain: "test", summary: "evil" }),
      (err) => err.code === "VAULT_WRITE_DESTINATION_REJECTED",
    );
    // .ledger 未声明文件 → 拦
    assert.throws(
      () => io.writeVaultFile(path.join(dir, ".ledger", "new-projection.json"), "{}", { domain: "test", summary: "evil" }),
      (err) => err.code === "VAULT_WRITE_DESTINATION_REJECTED",
    );
    assert.equal(fs.existsSync(path.join(dir, "projections")), false, "越界写不应落盘任何文件");
  } finally {
    cleanup(dir);
  }
});

// ── 10. F1 执法：vault 根之外的路径同样拦（vault 通道只写 vault）──
test("F1 执法：实例通道写 vault 根之外路径 throw", () => {
  const dir = makeTmpVault();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), "vault-io-outside-"));
  try {
    const io = createVaultIO({ vaultPath: dir, gitLedger: makeNoopLedger() });
    assert.throws(
      () => io.writeVaultFile(path.join(outside, "x.json"), "{}", { domain: "test", summary: "outside" }),
      (err) => err.code === "VAULT_WRITE_DESTINATION_REJECTED",
    );
  } finally {
    cleanup(dir);
    cleanup(outside);
  }
});

// ── 11. PR-083 凭据制：更新写缺凭据即拒（入口消灭主证——签名级，非可选参数）──
test("PR-083 更新写不带凭据 → VAULT_REVISION_CREDENTIAL_REQUIRED 且不落盘", () => {
  const dir = makeTmpVault();
  try {
    const io = createVaultIO({ vaultPath: dir, gitLedger: makeNoopLedger() });
    const target = path.join(dir, "知识库", "cred-missing.yaml");
    assert.throws(
      () => io.writeVaultFile(target, "x: 1\n", { domain: "test", summary: "no-credential" }),
      (err) => err.code === "VAULT_REVISION_CREDENTIAL_REQUIRED",
    );
    assert.equal(fs.existsSync(target), false, "缺凭据写不应落盘");
    // 模块级缺省通道同款
    assert.throws(
      () => writeVault(target, "x: 1\n", { domain: "test", summary: "no-credential" }),
      (err) => err.code === "VAULT_REVISION_CREDENTIAL_REQUIRED",
    );
  } finally {
    cleanup(dir);
  }
});

// ── 12. PR-083：凭据与磁盘不符 → VAULT_REVISION_CONFLICT（409）且盘面不被覆盖 ──
test("PR-083 凭据过期（盘面已被他人改）→ 409 冲突拒写，先到者内容保全", () => {
  const dir = makeTmpVault();
  try {
    const io = createVaultIO({ vaultPath: dir, gitLedger: makeNoopLedger() });
    const target = path.join(dir, "知识库", "stale.yaml");
    io.writeVaultFile(target, "version: 1\n", { expectedContentHash: ABSENT_REVISION, domain: "test", summary: "first" });
    const stale = contentRevision("version: 1\n"); // 写者 A 读到的指纹
    // 写者 B 先落了 version: 2（lost update 的旧世界：A 后写即覆盖 B）
    io.replaceVaultFile(target, "version: 2\n", { domain: "test", summary: "writer-b" });
    // 写者 A 带过期凭据写回 → 写前拒绝
    assert.throws(
      () => io.writeVaultFile(target, "version: 1-patch\n", { expectedContentHash: stale, domain: "test", summary: "writer-a-stale" }),
      (err) => err.code === "VAULT_REVISION_CONFLICT" && err.status === 409,
    );
    assert.equal(fs.readFileSync(target, "utf8"), "version: 2\n", "B 的写入不被 A 静默覆盖");
  } finally {
    cleanup(dir);
  }
});

// ── 13. PR-083：absent↔已存在双向冲突（新建同样有冲突语义）──
test("PR-083 absent 声明撞已存在文件 → 拒；哈希凭据撞缺失文件 → 拒", () => {
  const dir = makeTmpVault();
  try {
    const io = createVaultIO({ vaultPath: dir, gitLedger: makeNoopLedger() });
    const target = path.join(dir, "知识库", "race-create.yaml");
    io.writeVaultFile(target, "first\n", { expectedContentHash: ABSENT_REVISION, domain: "test", summary: "creator-1" });
    // 并发新建者：仍声明 absent，但盘面已存在 → 拒
    assert.throws(
      () => io.writeVaultFile(target, "second\n", { expectedContentHash: ABSENT_REVISION, domain: "test", summary: "creator-2" }),
      (err) => err.code === "VAULT_REVISION_CONFLICT",
    );
    assert.equal(fs.readFileSync(target, "utf8"), "first\n");
    // 反向：凭据为哈希而文件已缺失（被外部删除）→ 拒（防在「以为在改」的假基线上新建）
    fs.rmSync(target);
    assert.throws(
      () => io.writeVaultFile(target, "recreate\n", { expectedContentHash: contentRevision("first\n"), domain: "test", summary: "stale-base" }),
      (err) => err.code === "VAULT_REVISION_CONFLICT",
    );
    assert.equal(fs.existsSync(target), false);
  } finally {
    cleanup(dir);
  }
});

// ── 14. PR-083：读签发→写回闭环（模块级缺省通道；readVault 凭据可用且口径一致）──
test("PR-083 readVault 签发凭据 → writeVault 凭据相符通过并落盘", () => {
  const dir = makeTmpVault();
  try {
    const target = path.join(dir, "知识库", "loop.yaml");
    fs.writeFileSync(target, "a: 1\n");
    const { content, sha256 } = readVault(target); // 读时签发
    assert.equal(content, "a: 1\n");
    writeVault(target, "a: 2\n", { expectedContentHash: sha256, domain: "test", summary: "loop" }); // 凭据相符 → 过
    assert.equal(fs.readFileSync(target, "utf8"), "a: 2\n");
  } finally {
    cleanup(dir);
  }
});

// ── 15. PR-083：全权替换（无凭据形态之二）＋日志 baseRevision 区分（实例 API——日志随 vaultPath 落）──
test("PR-083 replaceVaultFile 不要求凭据；日志 baseRevision 更新写记凭据、替换记 null", () => {
  const dir = makeTmpVault();
  try {
    const io = createVaultIO({ vaultPath: dir, gitLedger: makeNoopLedger() });
    const target = path.join(dir, "知识库", "replace.json");
    io.replaceVaultFile(target, "{\"n\":1}\n", { domain: "test", summary: "regen" });
    io.replaceVaultFile(target, "{\"n\":2}\n", { domain: "test", summary: "regen" }); // 全权替换可反复
    assert.equal(fs.readFileSync(target, "utf8"), "{\"n\":2}\n");
    const logFile = path.join(dir, ".ledger", "channel-write-log.jsonl");
    const entries = fs.readFileSync(logFile, "utf8").trim().split("\n").map(JSON.parse);
    assert.equal(entries.length, 2);
    assert.equal(entries[0].baseRevision, null, "替换写 baseRevision=null");
    io.writeVaultFile(target, "{\"n\":3}\n", { expectedContentHash: contentRevision("{\"n\":2}\n"), domain: "test", summary: "update" });
    const last = fs.readFileSync(logFile, "utf8").trim().split("\n").map(JSON.parse).pop();
    assert.ok(last.baseRevision && last.baseRevision.startsWith("sha256:"), "更新写 baseRevision=凭据值");
  } finally {
    cleanup(dir);
  }
});

// ── SPEC-028：read-only-evidence 档执法（双写者族：模块级函数族＋createVaultIO 工厂族）──
const { writeVaultExclusive, appendVaultJsonl, initVaultIO } = require(path.join(ROOT, "server", "shared", "vault-io.cjs"));

test("SPEC-028 read-only-evidence：更新写拒绝（fail-closed，模块级＋工厂双路径）", () => {
  const dir = makeTmpVault();
  try {
    const io = initVaultIO({ vaultPath: dir, gitLedger: makeNoopLedger() });
    const target = path.join(dir, "知识库", "raw", "archive", "投稿", "abc.md");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "orig");
    assert.throws(() => writeVault(target, "x", { expectedContentHash: ABSENT_REVISION }), { code: "VAULT_IMMUTABLE_PATH" }, "模块级 writeVault 须按档拒绝（fail-closed）");
    assert.throws(() => io.writeVaultFile(target, "x", { expectedContentHash: ABSENT_REVISION }), { code: "VAULT_IMMUTABLE_PATH" }, "工厂 writeVaultFile 须按档拒绝");
    assert.equal(fs.readFileSync(target, "utf8"), "orig", "拒写不得改变原内容");
  } finally { cleanup(dir); }
});

test("SPEC-028 read-only-evidence：全权替换拒绝（fail-closed，模块级＋工厂双路径）", () => {
  const dir = makeTmpVault();
  try {
    const io = initVaultIO({ vaultPath: dir, gitLedger: makeNoopLedger() });
    const target = path.join(dir, "知识库", "wiki", "articles", "a1", "h.md");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, "orig");
    assert.throws(() => replaceVault(target, "x"), { code: "VAULT_IMMUTABLE_PATH" }, "模块级 replaceVault 须按档拒绝");
    assert.throws(() => io.replaceVaultFile(target, "x"), { code: "VAULT_IMMUTABLE_PATH" }, "工厂 replaceVaultFile 须按档拒绝");
    assert.equal(fs.readFileSync(target, "utf8"), "orig");
  } finally { cleanup(dir); }
});

test("SPEC-028 read-only-evidence：追加拒绝（fail-closed，模块级＋工厂双路径）", () => {
  const dir = makeTmpVault();
  try {
    const io = initVaultIO({ vaultPath: dir, gitLedger: makeNoopLedger() });
    const target = path.join(dir, "知识库", "raw", "archive", "abc.jsonl");
    assert.throws(() => appendVaultJsonl(target, "{}"), { code: "VAULT_IMMUTABLE_PATH" }, "模块级追加须拒（只读证据档非 append-only 账本）");
    assert.throws(() => io.appendJsonl(target, {}), { code: "VAULT_IMMUTABLE_PATH" }, "工厂追加须拒");
    assert.ok(!fs.existsSync(target), "拒写不得落文件");
  } finally { cleanup(dir); }
});

test("SPEC-028 read-only-evidence：writeVaultExclusive 强制 wx+0o444（真文件 fs.stat）；目录不封＋同 lane 第二篇可写（红队 P1 回归）", () => {
  const dir = makeTmpVault();
  try {
    initVaultIO({ vaultPath: dir, gitLedger: makeNoopLedger() }); // initVaultIO 等价：模块级函数取 defaultVaultPath
    const lane = path.join(dir, "知识库", "raw", "archive", "投稿");
    const target = path.join(lane, `${"f".repeat(64)}-原文.md`);
    fs.mkdirSync(lane, { recursive: true });
    // 调用方不传 mode——档位声明覆盖为 wx+0o444
    writeVaultExclusive(target, "evidence", { domain: "workflow" }, { flag: "wx" });
    assert.equal(fs.statSync(target).mode & 0o777, 0o444, "归档件落地权限须为 0o444（真文件断言，非 mock）");
    assert.notEqual(fs.statSync(lane).mode & 0o777, 0o555, "归档 lane 目录不得封 0o555（红队 P1：lane 是共享写工作区，封目录断第二篇投稿归档路）");
    // 红队 P1 回归锚：同 lane 第二篇归档写入必须成功（缺陷版本在此 EACCES）
    const second = path.join(lane, `${"9".repeat(64)}-第二篇.md`);
    writeVaultExclusive(second, "evidence-2", { domain: "workflow" }, { flag: "wx" });
    assert.equal(fs.statSync(second).mode & 0o777, 0o444, "第二篇归档件同样 0o444");
    assert.throws(() => writeVaultExclusive(target, "again", { domain: "workflow" }), { code: "EEXIST" }, "wx 语义：同路径二次写须失败（幂等反例）");
  } finally { cleanup(dir); }
});

test("SPEC-028 P2-1：symlink/别名路径不得穿透档位执法（与 F1 canonicalize 同源归一）", () => {
  const dir = makeTmpVault();
  try {
    initVaultIO({ vaultPath: dir, gitLedger: makeNoopLedger() });
    const lane = path.join(dir, "知识库", "raw", "archive", "投稿");
    const target = path.join(lane, `${"a".repeat(64)}-别名.md`);
    fs.mkdirSync(lane, { recursive: true });
    writeVaultExclusive(target, "evidence", { domain: "workflow" }, { flag: "wx" });
    // macOS /tmp→/private/tmp 同族：构造指向 lane 的符号链接目录，经别名路径写同一名义文件
    const aliasRoot = fs.mkdtempSync(path.join(os.tmpdir(), "vault-alias-"));
    const aliasDir = path.join(aliasRoot, "lane-alias");
    fs.symlinkSync(lane, aliasDir);
    const aliasedExisting = path.join(aliasDir, path.basename(target));
    const aliasedNew = path.join(aliasDir, `${"b".repeat(64)}-经别名.md`);
    assert.throws(() => replaceVault(aliasedExisting, "tampered"), { code: "VAULT_IMMUTABLE_PATH" }, "别名路径覆写归档件须拒（红队 P2-1 修复前可穿透）");
    assert.throws(() => writeVault(aliasedExisting, "tampered", { expectedContentHash: ABSENT_REVISION }), { code: "VAULT_IMMUTABLE_PATH" }, "别名路径更新写须拒");
    writeVaultExclusive(aliasedNew, "via-alias", { domain: "workflow" }, { flag: "wx" }); // 排他创建经别名仍合法（wx+0o444 强制）
    assert.equal(fs.statSync(aliasedNew).mode & 0o777, 0o444, "别名排他创建同样落 0o444");
    assert.equal(fs.readFileSync(target, "utf8"), "evidence", "原文件未被别名路径篡改");
    fs.rmSync(aliasRoot, { recursive: true, force: true });
  } finally { cleanup(dir); }
});

test("SPEC-028 human-editable/档外：行为零变化（回归钉住）", () => {
  const dir = makeTmpVault();
  try {
    initVaultIO({ vaultPath: dir, gitLedger: makeNoopLedger() });
    const draft = path.join(dir, "知识库", "raw", "drafts", "d.md");
    fs.mkdirSync(path.dirname(draft), { recursive: true });
    fs.writeFileSync(draft, "v1");
    writeVault(draft, "v2", { expectedContentHash: contentRevision("v1") });
    assert.equal(fs.readFileSync(draft, "utf8"), "v2", "草稿（human-editable）更新写不受档位执法影响");
    const outside = path.join(dir, "知识库", "test.yaml");
    fs.writeFileSync(outside, "a");
    writeVault(outside, "b", { expectedContentHash: contentRevision("a") });
    assert.equal(fs.readFileSync(outside, "utf8"), "b", "四角色根外路径（null 档）不受执法影响");
  } finally { cleanup(dir); }
});
