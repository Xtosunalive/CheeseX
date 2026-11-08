// Component: vault-git-ledger 单元测试（SPEC-010-W10 WP2；WP-J systemFiles 静态登记）
// 层级标注：纯单元层——gitRunner 注入伪实现，不依赖真实 git/vault；
// 验证对象：合并窗口、提交信息规范、干净跳过、push 容错、DISABLE 开关、系统文件静态登记、
// git 身份显式制（构造预检告警＋useConfigOnly 防假署名），
// 及 watcher 防双记端到端（WP-J 取证形态：通道写日志 path＋contentHash）。
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { createVaultGitLedger } = require("../vault-git-ledger.cjs");
const { createVaultWatcherService } = require("../vault-watcher-service.cjs");

function makeFakeGit(calls, opts = {}) {
  return function fakeGit(args, cb) {
    calls.push(args);
    // 子命令可能带 -c 前缀（如 commit），按数组包含命中而非首元素
    if (opts.failOn && args.includes(opts.failOn)) {
      cb(new Error(opts.failMessage || "git-fail"), "", "stderr");
      return;
    }
    // status --porcelain 返回值可注入
    if (args[0] === "status" && opts.statusOut !== undefined) {
      cb(null, opts.statusOut, "");
      return;
    }
    // git config --get <key> 返回值可注入（身份预检探测）
    if (args[0] === "config" && opts.configOut) {
      const key = args[args.indexOf("--get") + 1];
      cb(null, opts.configOut[key] || "", "");
      return;
    }
    cb(null, "", "");
  };
}

function delay(ms) { return new Promise((r) => setTimeout(r, ms)); }

test("合并窗口：同域两次写合并为一笔提交", async () => {
  const calls = [];
  const ledger = createVaultGitLedger({
    vaultPath: "/tmp/vault",
    logger: { info() {}, warn() {}, error() {} },
    gitRunner: makeFakeGit(calls, { statusOut: "M a.yaml\n" }),
    windowMs: 30,
  });
  ledger.scheduleLedger("schema-page", "写回一", ["/tmp/vault/a.yaml"]);
  ledger.scheduleLedger("schema-page", "写回二", ["/tmp/vault/b.yaml"]);
  await delay(80);
  const commits = calls.filter((a) => a.includes("commit") && a.includes("-m"));
  assert.equal(commits.length, 1, "窗口内两次写只产一笔提交");
  const msg = (a) => a[a.indexOf("-m") + 1];
  assert.match(msg(commits[0]), /^schema-page: /, "提交信息带写者域前缀");
  assert.equal(msg(commits[0]), "schema-page: 写回二", "摘要取窗口内最后一次");
  const adds = calls.filter((a) => a[0] === "add");
  assert.equal(adds.length, 1);
  assert.ok(adds[0].includes("a.yaml") && adds[0].includes("b.yaml"), "两个文件都进同一笔 add");
});

test("干净跳过：status 为空不产 add/commit", async () => {
  const calls = [];
  const ledger = createVaultGitLedger({
    vaultPath: "/tmp/vault",
    logger: { info() {}, warn() {}, error() {} },
    gitRunner: makeFakeGit(calls, { statusOut: "" }),
    windowMs: 20,
  });
  ledger.scheduleLedger("approval", "confirm x", ["相对路径.md"]);
  await delay(60);
  assert.equal(calls.filter((a) => a[0] === "add").length, 0);
  assert.equal(calls.filter((a) => a.includes("commit") && a.includes("-m")).length, 0);
});

test("commit 失败只告警：不抛错不阻断后续", async () => {
  const calls = [];
  const warns = [];
  const ledger = createVaultGitLedger({
    vaultPath: "/tmp/vault",
    logger: { info() {}, warn: (e) => warns.push(e), error() {} },
    gitRunner: makeFakeGit(calls, { statusOut: "M a\n", failOn: "commit" }),
    windowMs: 20,
  });
  ledger.scheduleLedger("entity-growth", "建实体 X", ["wiki/entities/X.md"]);
  await delay(60);
  assert.equal(warns.filter((w) => w.event === "vault-git-ledger-failed").length, 1, "失败记 warn 不抛");
  assert.equal(calls.filter((a) => a[0] === "add").length, 1, "add 仍执行过");
});

test("push 失败容错：本地提交成立，push 只告警", async () => {
  const calls = [];
  const warns = [];
  const ledger = createVaultGitLedger({
    vaultPath: "/tmp/vault",
    logger: { info() {}, warn: (e) => warns.push(e), error() {} },
    gitRunner: makeFakeGit(calls, { statusOut: "M a\n", failOn: "push" }),
    windowMs: 20,
  });
  ledger.scheduleLedger("approval", "publish y", [".ledger/approval-states.json"]);
  await delay(60);
  assert.equal(calls.filter((a) => a.includes("commit") && a.includes("-m")).length, 1, "本地提交不受 push 失败影响");
  assert.equal(warns.filter((w) => w.event === "vault-git-ledger-push-failed").length, 1);
});

test("DISABLE 开关：不产任何 git 调用", async () => {
  const prev = process.env.VAULT_GIT_LEDGER_DISABLE;
  process.env.VAULT_GIT_LEDGER_DISABLE = "1";
  try {
    const calls = [];
    const ledger = createVaultGitLedger({
      vaultPath: "/tmp/vault",
      logger: { info() {}, warn() {}, error() {} },
      gitRunner: makeFakeGit(calls, { statusOut: "M a\n" }),
      windowMs: 10,
    });
    ledger.scheduleLedger("schema-page", "x", ["a.yaml"]);
    await delay(30);
    assert.equal(calls.length, 0);
  } finally {
    if (prev === undefined) delete process.env.VAULT_GIT_LEDGER_DISABLE;
    else process.env.VAULT_GIT_LEDGER_DISABLE = prev;
  }
});

test("绝对路径转相对：add 收到 vault 内相对路径", async () => {
  const calls = [];
  const ledger = createVaultGitLedger({
    vaultPath: "/tmp/vault",
    logger: { info() {}, warn() {}, error() {} },
    gitRunner: makeFakeGit(calls, { statusOut: "M b\n" }),
    windowMs: 20,
  });
  ledger.scheduleLedger("entity-growth", "建实体 Y", [path.join("/tmp/vault", "wiki/entities/Y.md")]);
  await delay(60);
  const add = calls.find((a) => a[0] === "add");
  assert.ok(add.includes("wiki/entities/Y.md"), "绝对路径已转相对");
  assert.ok(!add.some((s) => String(s).startsWith("/")), "不含绝对路径");
});

// ── WP-J 系统文件静态登记：markSystemFile + isSystemFile（TTL 时间窗已随归属改取证日志退役）──
test("markSystemFile 登记后 isSystemFile 返回 true（登记即系统文件，无过期）", async () => {
  const ledger = createVaultGitLedger({
    vaultPath: "/tmp/vault",
    logger: { info() {}, warn() {}, error() {} },
    gitRunner: makeFakeGit([], {}),
  });
  const absPath = "/tmp/vault/.ledger/state-journal.jsonl";
  assert.strictEqual(ledger.isSystemFile(absPath), false, "登记前应为 false");
  ledger.markSystemFile([absPath]);
  assert.strictEqual(ledger.isSystemFile(absPath), true, "登记后应为 true");
  await delay(80); // 远超旧 TTL 测试的过期窗——静态登记不过期（进程同寿）
  assert.strictEqual(ledger.isSystemFile(absPath), true, "登记即系统文件：无时间窗过期语义");
});

test("markSystemFile 接受 vault 相对路径（登记时归一到绝对）", () => {
  const ledger = createVaultGitLedger({
    vaultPath: "/tmp/vault",
    logger: { info() {}, warn() {}, error() {} },
    gitRunner: makeFakeGit([], {}),
  });
  ledger.markSystemFile([".ledger/channel-write-log.jsonl"]);
  assert.strictEqual(ledger.isSystemFile("/tmp/vault/.ledger/channel-write-log.jsonl"), true, "相对路径登记按 vault 根归一");
  assert.strictEqual(ledger.isSystemFile("/tmp/vault/知识库/TheSchema/enums.yaml"), false, "未登记路径不受影响");
});

test("防双记端到端（WP-J 取证形态）：通道写日志命中（同 path 同哈希）→ watcher 不产生 external: 提交", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const crypto = require("node:crypto");
  const { channelLogPathFor } = require("../../../../server/shared/vault-io.cjs");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wpj-internal-"));
  try {
    const ledgerCalls = [];
    const ledger = createVaultGitLedger({
      vaultPath: dir,
      logger: { info() {}, warn() {}, error() {} },
      gitRunner: makeFakeGit([], { statusOut: "" }),
    });
    const origSchedule = ledger.scheduleLedger.bind(ledger);
    const trackedLedger = {
      ...ledger,
      scheduleLedger(domain, summary, files) {
        ledgerCalls.push({ domain, summary, files });
        return origSchedule(domain, summary, files);
      },
    };

    // 模拟通道写：目标文件落盘 + 通道写日志追加（vault-io writeVault 同序——写后同步记日志，
    // watcher 5s 防抖后查证时时序必然已就位）
    const absPath = path.join(dir, "知识库", "TheSchema", "enums.yaml");
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    const content = "enums: v1\n";
    fs.writeFileSync(absPath, content, "utf8");
    const hash = "sha256:" + crypto.createHash("sha256").update(content, "utf8").digest("hex");
    fs.mkdirSync(path.dirname(channelLogPathFor(dir)), { recursive: true });
    fs.appendFileSync(channelLogPathFor(dir),
      JSON.stringify({ ts: new Date().toISOString(), path: "知识库/TheSchema/enums.yaml", contentHash: hash, domain: "schema", summary: "t" }) + "\n", "utf8");

    const watcher = createVaultWatcherService({
      vaultPath: dir,
      gitLedger: trackedLedger,
      logger: { info() {}, warn() {}, error() {} },
    });
    watcher.handleEventNow(absPath);

    assert.strictEqual(ledgerCalls.filter((c) => c.domain === "external").length, 0,
      "通道写日志取证命中（同 path 同哈希）——watcher 不应产生 external: 提交");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── git 身份显式制（2026-10-27 直修批）：构造预检告警＋useConfigOnly 防假署名 ──
test("身份预检：config 缺席 → 构造后告警一次并附补救命令", async () => {
  const warns = [];
  createVaultGitLedger({
    vaultPath: "/tmp/vault",
    logger: { info() {}, warn: (e) => warns.push(e), error() {} },
    gitRunner: makeFakeGit([], {}),
  });
  await delay(30);
  const missing = warns.filter((w) => w.event === "vault-git-ledger-identity-missing");
  assert.equal(missing.length, 1, "构造后一次 identity-missing 告警（boot 即暴露，不等落账失败）");
  assert.match(missing[0].hint, /git config user\.name/, "告警附补救命令");
});

test("身份预检：config 在场（仓库级身份）→ 无 identity-missing 告警", async () => {
  const warns = [];
  createVaultGitLedger({
    vaultPath: "/tmp/vault",
    logger: { info() {}, warn: (e) => warns.push(e), error() {} },
    gitRunner: makeFakeGit([], { configOut: { "user.name": "vault-owner", "user.email": "owner@example.invalid" } }),
  });
  await delay(30);
  assert.equal(warns.filter((w) => w.event === "vault-git-ledger-identity-missing").length, 0);
});

test("身份预检：GIT_AUTHOR_*＋GIT_COMMITTER_* 四变量在场 → 无告警", async () => {
  const keys = ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"];
  const prev = keys.map((k) => [k, process.env[k]]);
  for (const k of keys) process.env[k] = "explicit-identity";
  try {
    const warns = [];
    createVaultGitLedger({
      vaultPath: "/tmp/vault",
      logger: { info() {}, warn: (e) => warns.push(e), error() {} },
      gitRunner: makeFakeGit([], {}),
    });
    await delay(30);
    assert.equal(warns.filter((w) => w.event === "vault-git-ledger-identity-missing").length, 0);
  } finally {
    for (const [k, v] of prev) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

test("commit 带 user.useConfigOnly=true：封死自动猜测假署名（vault-init 同原则）", async () => {
  const calls = [];
  const ledger = createVaultGitLedger({
    vaultPath: "/tmp/vault",
    logger: { info() {}, warn() {}, error() {} },
    gitRunner: makeFakeGit(calls, { statusOut: "M a\n" }),
    windowMs: 20,
  });
  ledger.scheduleLedger("schema-page", "写回", ["a.yaml"]);
  await delay(60);
  const commit = calls.find((a) => a.includes("commit") && a.includes("-m"));
  assert.ok(commit, "有一笔 commit");
  assert.deepEqual(commit.slice(0, 2), ["-c", "user.useConfigOnly=true"], "-c 前缀封死猜测身份");
  assert.equal(commit[commit.indexOf("-m") + 1], "schema-page: 写回", "提交信息规范不变");
});

test("防双记端到端（WP-J 取证形态）：未命中（无日志/异哈希）的外部写入产生 external: 提交", () => {
  const fs = require("node:fs");
  const os = require("node:os");

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wpj-external-"));
  try {
    const ledgerCalls = [];
    const ledger = createVaultGitLedger({
      vaultPath: dir,
      logger: { info() {}, warn() {}, error() {} },
      gitRunner: makeFakeGit([], { statusOut: "" }),
    });
    const origSchedule = ledger.scheduleLedger.bind(ledger);
    const trackedLedger = {
      ...ledger,
      scheduleLedger(domain, summary, files) {
        ledgerCalls.push({ domain, summary, files });
        return origSchedule(domain, summary, files);
      },
    };

    const watcher = createVaultWatcherService({
      vaultPath: dir,
      gitLedger: trackedLedger,
      logger: { info() {}, warn() {}, error() {} },
    });

    const absPath = path.join(dir, "知识库", "wiki", "entities", "SomeEntity.md");
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, "Obsidian 手改", "utf8");
    watcher.handleEventNow(absPath); // 无通道写日志（模拟 Obsidian 写入）

    assert.strictEqual(ledgerCalls.filter((c) => c.domain === "external").length, 1,
      "取证未命中的外部写入应产生 external: 提交");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
