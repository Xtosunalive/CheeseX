// @tests: server/services/governance/vault-watcher-service.cjs
// WP3 验收：外部写事件 → external: 账；WP-J 归属取证（通道写日志 path＋contentHash；⑤类系统文件静态登记）
// ignore 白名单；PR-058：frontmatter 解析用 yaml 库（列表值/多行值不再静默丢失）
"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const { createVaultWatcherService, parseFrontmatter } = require(
  path.join(ROOT, "server", "services", "governance", "vault-watcher-service.cjs"),
);
const { CHANNEL_LOG_REL } = require(path.join(ROOT, "server", "shared", "vault-io.cjs"));

test("外部正文和字段变更只更新一次稳定哈希，桥接读到新值", () => {
  const dir = makeTmpDir();
  try {
    const file = path.join(dir, "知识库", "raw", "precleaned", "文章.md");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "---\ntitle: 初稿\ncontent_hash: sha256:old\n---\n正文一\n");
    const observed = [];
    const svc = createVaultWatcherService({ vaultPath: dir, gitLedger: makeTestLedger([]), onExternalWrite: () => observed.push(fs.readFileSync(file, "utf8")) });
    svc.handleEventNow(file);
    const first = fs.readFileSync(file, "utf8");
    assert.match(first, /content_hash: sha256:[0-9a-f]{64}/);
    assert.equal(observed[0], first);
    svc.handleEventNow(file);
    assert.equal(fs.readFileSync(file, "utf8"), first, "自身派生字段不得造成第二次改写");
    fs.writeFileSync(file, first.replace("正文一", "正文二"));
    svc.handleEventNow(file);
    const changed = fs.readFileSync(file, "utf8");
    assert.notEqual(changed.match(/content_hash: (\S+)/)[1], first.match(/content_hash: (\S+)/)[1]);
    assert.equal(observed[2], changed);
  } finally { cleanup(dir); }
});

test("原文归档外部变更不会被监听器二次改写", () => {
  const dir = makeTmpDir();
  try {
    const file = path.join(dir, "知识库", "raw", "archive", "稿.md");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const original = "---\ntitle: 原稿\n---\n正文\n";
    fs.writeFileSync(file, original);
    createVaultWatcherService({ vaultPath: dir, gitLedger: makeTestLedger([]) }).handleEventNow(file);
    assert.equal(fs.readFileSync(file, "utf8"), original);
  } finally { cleanup(dir); }
});

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "vault-watcher-test-"));
}
function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
}
function makeTestLedger(calls) {
  return {
    markSystemFile: (paths) => calls.push({ type: "mark", paths }),
    isSystemFile: () => false, // 未登记默认非系统文件
    scheduleLedger: (domain, summary, files) => calls.push({ type: "schedule", domain, summary, files }),
  };
}

// 通道写日志种子（SPEC-012 F1 修订形态：{ts, path, contentHash, domain, summary}）
function sha256Of(content) {
  return "sha256:" + crypto.createHash("sha256").update(content, "utf8").digest("hex");
}
function seedChannelLog(vaultRoot, entries) {
  fs.mkdirSync(path.join(vaultRoot, ".ledger"), { recursive: true });
  const lines = entries.map((e) => JSON.stringify({ ts: new Date().toISOString(), domain: null, summary: null, ...e }));
  fs.writeFileSync(path.join(vaultRoot, CHANNEL_LOG_REL), lines.join("\n") + "\n", "utf8");
}

// ── 1. 服务创建不崩溃 ──
test("createVaultWatcherService 创建成功且不立即报错", () => {
  const dir = makeTmpDir();
  try {
    const calls = [];
    const svc = createVaultWatcherService({
      vaultPath: dir,
      gitLedger: makeTestLedger(calls),
    });
    assert.ok(typeof svc.start === "function");
    assert.ok(typeof svc.stop === "function");
    assert.ok(typeof svc.isReady === "function");
  } finally {
    cleanup(dir);
  }
});

// ── 2. vault 路径不存在时 start 不崩溃（warn 但不抛）──
test("createVaultWatcherService.start 路径不存在时不抛错", () => {
  const svc = createVaultWatcherService({
    vaultPath: "/nonexistent-vault-" + Date.now(),
    gitLedger: makeTestLedger([]),
    logger: { info() {}, warn() {}, error() {} },
  });
  assert.doesNotThrow(() => svc.start());
  svc.stop();
});

// ── 3. ignore 白名单（模式面）：.git 等路径被忽略 ──
test("isIgnored: .git 路径被忽略", () => {
  // 通过白名单正则（内部行为）验证；归属判定由测试 6/6b/6c 在服务行为面覆盖（WP-J 后口径）
  const patterns = [
    /[/\\]\.git([/\\]|$)/,
    /[/\\]知识库[/\\]raw[/\\]boards([/\\]|$)/,
    /\.swp$/,
    /~$/,
    /conflict copy/i,
    /[/\\]\.trash([/\\]|$)/,
    /\.canvas\.bak$/,
    /\.vault-io-[\w.-]+\.tmp$/,
  ];
  const ignored = (p) => patterns.some((re) => re.test(p));

  // .git 目录
  assert.ok(ignored("/vault/.git/COMMIT_EDITMSG"));
  assert.ok(ignored("/vault/.git/config"));
  // boards 缓存
  assert.ok(ignored("/vault/知识库/raw/boards/something.json"));
  // vim 临时文件
  assert.ok(ignored("/vault/file.md.swp"));
  assert.ok(ignored("/vault/file.md~"));
  // Obsidian 冲突副本
  assert.ok(ignored("/vault/article (John's conflict copy 2026).md"));
  // .trash
  assert.ok(ignored("/vault/知识库/.trash/deleted.md"));
  // canvas 备份
  assert.ok(ignored("/vault/diagram.canvas.bak"));
  // vault-io 原子写瞬态 tmp
  assert.ok(ignored("/vault/知识库/x.yaml.vault-io-12345-a1b2.tmp"));

  // 正常文件不被忽略
  assert.ok(!ignored("/vault/知识库/wiki/entities/可观测性.md"));
  assert.ok(!ignored("/vault/知识库/TheSchema/enums.yaml"));
});

// ── 4. isReady() 初始为 false ──
test("isReady() 未 start 时为 false", () => {
  const svc = createVaultWatcherService({
    vaultPath: "/tmp",
    gitLedger: makeTestLedger([]),
  });
  assert.strictEqual(svc.isReady(), false);
});

// ── 5. stop 可安全多次调用 ──
test("stop() 多次调用不崩溃", () => {
  const svc = createVaultWatcherService({
    vaultPath: "/tmp",
    gitLedger: makeTestLedger([]),
    logger: { info() {}, warn() {}, error() {} },
  });
  assert.doesNotThrow(() => {
    svc.stop();
    svc.stop();
  });
});

// ── 6. WP-J attribution forensics: channel write log hit (same path + same hash) → internal write ──
test("WP-J channel write log hit (same path + same content hash)——no external: account recorded, no onExternalWrite bridge", () => {
  const dir = makeTmpDir();
  try {
    const calls = [];
    const bridged = [];
    const entityDir = path.join(dir, "知识库", "wiki", "entities");
    fs.mkdirSync(entityDir, { recursive: true });
    const article = path.join(entityDir, "内部写.md");
    const content = "---\narticle_id: X-1\n---\n正文\n";
    fs.writeFileSync(article, content, "utf8");
    seedChannelLog(dir, [{ path: "知识库/wiki/entities/内部写.md", contentHash: sha256Of(content) }]);
    const svc = createVaultWatcherService({
      vaultPath: dir,
      gitLedger: makeTestLedger(calls),
      logger: { info() {}, warn() {}, error() {} },
      onExternalWrite: (paths) => bridged.push(...paths),
    });
    svc.handleEventNow(article);
    assert.strictEqual(calls.filter((c) => c.type === "schedule" && c.domain === "external").length, 0,
      "forensics hit for this process's write——no external: double recording (under TTL semantics this was covered by the in-flight window)");
    assert.strictEqual(bridged.length, 0, "internal writes must not bridge onExternalWrite (the bridge is an external write delta source)");
  } finally {
    cleanup(dir);
  }
});

// ── 6b. WP-J: same path + different hash (content externally overwritten after channel write) → external write ──
test("WP-J channel write log miss (same path + different hash)——record external: account + bridge", () => {
  const dir = makeTmpDir();
  try {
    const calls = [];
    const bridged = [];
    const entityDir = path.join(dir, "知识库", "wiki", "entities");
    fs.mkdirSync(entityDir, { recursive: true });
    const article = path.join(entityDir, "被覆写.md");
    fs.writeFileSync(article, "外部编辑后的新内容", "utf8");
    // The channel log has this path, but the hash is the content before the external overwrite——forensics must miss
    seedChannelLog(dir, [{ path: "知识库/wiki/entities/被覆写.md", contentHash: sha256Of("旧内容") }]);
    const svc = createVaultWatcherService({
      vaultPath: dir,
      gitLedger: makeTestLedger(calls),
      logger: { info() {}, warn() {}, error() {} },
      onExternalWrite: (paths) => bridged.push(...paths),
    });
    svc.handleEventNow(article);
    assert.strictEqual(calls.filter((c) => c.type === "schedule" && c.domain === "external").length, 1,
      "same path + different hash = content's last writer is not this process——record external:");
    assert.deepStrictEqual(bridged, [article], "external writes should be bridged as-is");
  } finally {
    cleanup(dir);
  }
});

// ── 6c. WP-J: ⑤-category system files statically registered → internal (their own writes are not in the channel log) ──
test("WP-J system file registration (state-journal/channel-write-log path)——no external: account recorded", () => {
  const dir = makeTmpDir();
  try {
    const calls = [];
    const registered = new Set([
      path.resolve(path.join(dir, ".ledger", "state-journal.jsonl")),
      path.resolve(path.join(dir, ".ledger", "channel-write-log.jsonl")),
    ]);
    const svc = createVaultWatcherService({
      vaultPath: dir,
      gitLedger: {
        markSystemFile: (paths) => { for (const p of paths) registered.add(path.resolve(p)); },
        isSystemFile: (p) => registered.has(path.resolve(p)),
        scheduleLedger: (domain, summary, files) => calls.push({ type: "schedule", domain, summary, files }),
      },
      logger: { info() {}, warn() {}, error() {} },
    });
    // No channel log seed——system file attribution relies solely on static registration (its own ledger has its own accounting)
    svc.handleEventNow(path.join(dir, ".ledger", "state-journal.jsonl"));
    svc.handleEventNow(path.join(dir, ".ledger", "channel-write-log.jsonl"));
    assert.strictEqual(calls.filter((c) => c.type === "schedule" && c.domain === "external").length, 0,
      "writes to ⑤-category system files (independent append surface, anti-recursion not logged) rely on static registration to prevent false external:");
  } finally {
    cleanup(dir);
  }
});

// ── 7. 保守面回归：无通道写日志文件时全部按外部（除系统文件）——宁可多记不漏记 ──
test("知识库内文件事件仍记 external: 账（无日志文件＝保守面全外部）", () => {
  const dir = makeTmpDir();
  try {
    const calls = [];
    const svc = createVaultWatcherService({
      vaultPath: dir,
      gitLedger: makeTestLedger(calls),
      logger: { info() {}, warn() {}, error() {} },
    });
    svc.handleEventNow(path.join(dir, "知识库", "wiki", "entities", "可观测性.md"));
    const externals = calls.filter((c) => c.type === "schedule" && c.domain === "external");
    assert.strictEqual(externals.length, 1, "无通道写日志时（未初始化/读取失败）按保守面记 external:——假账可事后归因，真外部写不可漏");
  } finally {
    cleanup(dir);
  }
});

// ── 8. PR-058 先红后绿：frontmatter 解析不再丢列表值 ──
test("PR-058 parseFrontmatter：列表值/多行值被解析，非法 YAML 返回 null", () => {
  const withList = "---\narticle_id: X-1\ntags:\n  - a\n  - b\ncategory-path: ops:network:ovip-failover\n---\n正文";
  const fm = parseFrontmatter(withList);
  assert.ok(fm, "应解析出 frontmatter 对象");
  assert.strictEqual(fm.article_id, "X-1");
  assert.deepStrictEqual(fm.tags, ["a", "b"], "列表值不得静默丢失（PR-058 修复前正则实现下此断言红——tags 无命中）");
  assert.strictEqual(fm["category-path"], "ops:network:ovip-failover");

  // 多行标量（| 语法）
  const multiline = "---\nnote: |\n  第一行\n  第二行\n---\n正文";
  const fm2 = parseFrontmatter(multiline);
  assert.ok(fm2 && typeof fm2.note === "string" && fm2.note.includes("第一行"), "多行标量应被解析");

  // 非法 YAML → null（不触发校验）
  assert.strictEqual(parseFrontmatter("---\n: : :\n\tbad: [\n---\n正文"), null);
  assert.strictEqual(parseFrontmatter("无 frontmatter"), null);
});

// ── 8b. WP-116 批1 行为钉：切分改经文档装载宿主（loadDocument）后，边界输入产出与旧实现逐字一致 ──
// （迁移前基线探针实测：无 frontmatter/空文件/未闭合块/BOM/数组产物/标量产物 → null；
//   空块 `---\n---` → null；多 `---` 只取第一块；CRLF 与旧实现同为可解析——键值形态一致。）
test("WP-116 parseFrontmatter 边界钉：宿主切分与旧切分同产出", () => {
  // 空 frontmatter（`---\n---`）：旧实现 YAML.parse("")→null；宿主产物空映射 → null（同产出）
  assert.strictEqual(parseFrontmatter("---\n---\n正文"), null);
  // 空文件
  assert.strictEqual(parseFrontmatter(""), null);
  // 未闭合块（`---` 起头无闭合）：不触发校验
  assert.strictEqual(parseFrontmatter("---\narticle_id: X-1\n"), null);
  // BOM 打头：旧实现 startsWith("---") 为假 → null；宿主同（不触发校验）
  assert.strictEqual(parseFrontmatter("﻿---\narticle_id: X-1\n---\n正文"), null);
  // YAML 产物为数组/标量（非映射）：不触发校验
  assert.strictEqual(parseFrontmatter("---\n- a\n- b\n---\n正文"), null);
  assert.strictEqual(parseFrontmatter("---\n只是个裸标量\n---\n正文"), null);
  // 多 `---`：只取第一块
  const multi = parseFrontmatter("---\narticle_id: A-1\n---\n正文\n---\narticle_id: B-2\n---\n");
  assert.ok(multi && multi.article_id === "A-1", "多 --- 只取第一块");
  // CRLF：旧实现（indexOf("\n---")＋yaml 库）可解析；宿主同——键值形态逐字一致
  const crlf = parseFrontmatter("---\r\narticle_id: X-1\r\nmodule: 可观测性\r\ntags:\r\n  - x\r\n  - y\r\n---\r\n正文");
  assert.ok(crlf, "CRLF 可解析");
  assert.strictEqual(crlf.article_id, "X-1");
  assert.strictEqual(crlf.module, "可观测性");
  assert.deepStrictEqual(crlf.tags, ["x", "y"]);
});

// ── 9. PR-055：frontmatter 违规的健康写经 vault-io 通道（domain=health），禁止裸写 ──
test("SPEC-012 WP-B frontmatter 违规 → 痕迹落 telemetry 库且 vault 无 health 文件", () => {
  const dir = makeTmpDir();
  try {
    const articleDir = path.join(dir, "知识库", "raw", "drafts");
    fs.mkdirSync(articleDir, { recursive: true });
    const article = path.join(articleDir, "脏文章.md");
    fs.writeFileSync(article, "---\narticle_id: X-1\ntags:\n  - a\ncategory-path: 非法格式\n---\n正文\n", "utf8");

    const svc = createVaultWatcherService({
      vaultPath: dir,
      gitLedger: makeTestLedger([]),
      logger: { info() {}, warn() {}, error() {} },
      ruleSet: { domains: { ops: {} }, subdomains: { ops: ["network"] } },
    });
    svc.handleEventNow(article);
    const { getTelemetryStore, TRACE_KINDS } = require("../../../shared/persistence/telemetry-store.cjs");
    const latest = getTelemetryStore(dir).latestTrace(TRACE_KINDS.FRONTMATTER_CHECK);
    assert.ok(latest, "违规应落 telemetry 库一笔 frontmatter-check 痕迹");
    assert.strictEqual(latest.payload.file, path.relative(dir, article).split(path.sep).join("/"));
    assert.ok(latest.payload.violations.some((v) => v.field === "category-path"), "违规明细应含 category-path");
    assert.strictEqual(fs.existsSync(path.join(dir, ".ledger", "health")), false, "vault 内不得出现 health 目录");
  } finally {
    cleanup(dir);
  }
});

// ── SPEC-012 WP-C：外部写事件桥接（onExternalWrite 回调）──
test("外部写事件经 onExternalWrite 桥接给②类同步器（listener 失败不阻断）", () => {
  const dir = makeTmpDir();
  try {
    const bridged = [];
    fs.mkdirSync(path.join(dir, "知识库", "wiki", "entities"), { recursive: true });
    const svc = createVaultWatcherService({
      vaultPath: dir,
      gitLedger: makeTestLedger([]),
      logger: { info() {}, warn() {}, error() {} },
      onExternalWrite: (paths) => bridged.push(...paths),
    });
    const article = path.join(dir, "知识库", "wiki", "entities", "桥接.md");
    fs.writeFileSync(article, "正文");
    svc.handleEventNow(article);
    assert.deepEqual(bridged, [article], "外部写路径应原样桥接");

    // listener 抛错：监听主链路不受影响（后续事件仍记账）
    let boomCount = 0;
    const svc2 = createVaultWatcherService({
      vaultPath: dir,
      gitLedger: makeTestLedger([]),
      logger: { info() {}, warn() {}, error() {} },
      onExternalWrite: () => { boomCount += 1; throw new Error("boom"); },
    });
    const other = path.join(dir, "知识库", "wiki", "entities", "桥接2.md");
    fs.writeFileSync(other, "正文");
    assert.doesNotThrow(() => svc2.handleEventNow(other));
    assert.equal(boomCount, 1, "listener 被调用过一次");
  } finally {
    cleanup(dir);
  }
});

// ── WP-156 必修修复（红队⑤）：真实装配形态——ruleSet 函数提供者＋词表热更＋契约治理规则生效 ──
test("ruleSet 函数提供者（真实装配形态）：每次校验现取词表——治理规则违规落遥测＋词表热更即新值", () => {
  const dir = makeTmpDir();
  try {
    const kb = path.join(dir, "知识库");
    fs.mkdirSync(kb, { recursive: true });
    // 真实词表文件（provider 每次现读——词表热更实证的载体）
    const enumsPath = path.join(dir, "enums.yaml");
    fs.writeFileSync(enumsPath, "tags:\n  分类法:\n    - 图谱\nlifecycle:\n  status:\n    - 在线\n  review_cycle:\n    - 30d\n", "utf8");
    // provider＝与 main.cjs 真实装配同构：每次调用现读词表文件并过 buildRuleSet
    // （loadRuleSetForVault 同款——ENUM_SURFACE 消费的是 buildRuleSet 产物面 formalTags/statuses/reviewCycles，
    //  传 raw enums 会半失效：红队⑤修复期的形态教训，测试按真实产物形态钉）
    const yaml = require("js-yaml");
    const { buildRuleSet } = require("../../../shared/enums-loader.cjs");
    const provider = () => buildRuleSet(yaml.load(fs.readFileSync(enumsPath, "utf8")));

    const svc = createVaultWatcherService({
      vaultPath: dir,
      gitLedger: makeTestLedger([]),
      logger: { info() {}, warn() {}, error() {} },
      ruleSet: provider,
    });
    const article = path.join(kb, "脏文章.md");
    fs.writeFileSync(article, "---\ntitle: 脏\nstatus: 乱状态\ntags:\n  - 乱写\n---\n正文\n", "utf8");
    svc.handleEventNow(article);

    const { getTelemetryStore, TRACE_KINDS } = require("../../../shared/persistence/telemetry-store.cjs");
    let latest = getTelemetryStore(dir).latestTrace(TRACE_KINDS.FRONTMATTER_CHECK);
    assert.ok(latest, "违规应落 telemetry");
    const ruleIds = latest.payload.violations.map((v) => v.ruleId);
    for (const id of ["A09", "A10"]) {
      assert.ok(ruleIds.includes(id), `治理规则 ${id} 经真实装配形态在实时面生效（契约 13 条全量校验）`);
    }
    assert.ok(latest.payload.violations.some((v) => v.error === "tag 非法：'乱写'（不在分类法白名单中）"), "A09 文案与退役 Python 侧逐字一致");

    // 词表热更：乱写 tag 上词表→同文件再触发→A09 消失（provider 每次现取＝新值生效）
    fs.writeFileSync(enumsPath, "tags:\n  分类法:\n    - 图谱\n    - 乱写\nlifecycle:\n  status:\n    - 在线\n  review_cycle:\n    - 30d\n", "utf8");
    fs.writeFileSync(article, "---\ntitle: 脏\nstatus: 乱状态\ntags:\n  - 乱写\n---\n正文\n", "utf8");
    svc.handleEventNow(article);
    latest = getTelemetryStore(dir).latestTrace(TRACE_KINDS.FRONTMATTER_CHECK);
    assert.ok(!latest.payload.violations.some((v) => v.ruleId === "A09"), "词表热更后 A09 消失（provider 现取实证）");
    assert.ok(latest.payload.violations.some((v) => v.ruleId === "A10"), "A10 不受词表热更影响（status 仍乱）");
  } finally {
    cleanup(dir);
  }
});
