// Component: Vault-Watcher-Service
// @responsible: 监听 vault 文件系统事件，将外部写入（Obsidian/CLI）记为 external: 账（SPEC-011 WP3）
// @inputs: vaultGitLedger（isSystemFile 静态登记查询 + scheduleLedger）；vaultPath；通道写日志
//   （vault .ledger/channel-write-log.jsonl——vault-io 每次写后追加的取证面，SPEC-012 F1 修订）
// @outputs: 外部写事件 → external: 提交＋onExternalWrite 桥接；frontmatter 键值变更 → 校验结果落 telemetry
// @context: Vault
//
// 外部写归属判定（SPEC-012 WP-J：TTL 时间窗退役，改「查通道写日志按 path＋内容哈希取证」）：
//   ① 事件文件当前内容算 sha256；
//   ② 查通道写日志尾部最近 N=200 行——path 匹配且 contentHash 相等 → 本进程写
//     （跳过 external: 记账；内部写不桥接 onExternalWrite——桥是外部写增量源）；
//   ③ 两个⑤类系统文件（channel-write-log.jsonl＋state-journal.jsonl）自身写不在通道日志里
//     （防递归/独立追加面）——写者写前经 ledger.markSystemFile 静态登记，此处查 isSystemFile 判内部；
//   ④ 未命中＝外部写 → external: 记账＋桥接＋frontmatter 校验。
//   保守面：通道日志文件不存在/读取失败时退化为「除已登记系统文件外全部按外部」——宁可多记一笔
//   external:（假账可事后归因）不可漏记真外部写；与迁移前 TTL 语义不同代，属有意取舍。
//
// ignore 白名单（与门禁面⑥白名单语义对齐，两处同步维护——修改须同步 check-schema-writers.mjs）：
//   .git/ + 知识库/raw/boards/ + *.swp + *~ + *conflict copy* + .trash/ + *.canvas.bak
//   + vault-io 原子写 tmp（.vault-io-*.tmp——rename 前后瞬态，非稳定内容无从取证）

"use strict";

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// SPEC-012 WP-B：frontmatter 痕迹迁 telemetry.db
const { getTelemetryStore, TRACE_KINDS } = require("../../shared/persistence/telemetry-store.cjs");
// 通道写日志取址（SPEC-012 F1 修订——归属取证面，vault-io 同源常量）
const { channelLogPathFor } = require("../../shared/vault-io.cjs");
// SPEC-012 结构收口批：监听忽略形态单源派生（原与门禁⑥双处维护的清单退役）
const { ignoredFormsFor } = require("../../shared/vault-write-destinations.cjs");
// frontmatter 键值即时校验（A08 类规则）
const { validateFrontmatter } = require("../../shared/frontmatter-rule-engine.cjs");
// WP-116 批1（SPEC-083 §二.1）：`---` 边界切分收进文档装载宿主——本模块不再自持切分实现；
// parseFrontmatter 的 null/对象契约与键值形态（null 键剔除、标量回字符串）为监听校验面
// （validateFrontmatter）既有口径，保持不变。
// 合并态收口（WP-116 合入后欠账）：updateContentHash（WP-112 侧合入）的闭合界切分同样收口——
// 经批 2 纯转发的 frontmatterBounds（宿主同源；无 frontmatter/缺界 throw，catch 后沿用原静默 return）。
// 同时恢复 const YAML = require("yaml")：合并解按批 1 侧摘掉了 yaml 装载，而 WP-112 侧
// updateContentHash 仍引用 YAML——缺此行则该函数在 YAML.parse 处 ReferenceError 常败
// （content_hash 自动重算静默失效）。切分等价性探针：18 例基线 17 同，唯一分歧＝
// BOM+序列 frontmatter 退化形（旧静默跳过，新沿既有退化写路径——非映射 frontmatter 旧码本就如此）。
const { frontmatterBounds, loadDocument } = require("../../shared/document-load-port.cjs");
const YAML = require("yaml");
const { patchFrontmatter } = require("../../shared/document-load-port.cjs");
const { writeVault, contentRevision } = require("../../shared/vault-io.cjs");
const { resolveMutability, READ_ONLY_EVIDENCE } = require("../../shared/article-lifecycle-paths.cjs");

// YAML frontmatter 解析（PR-058 结构解：经仓内 yaml 库——列表值/多行值/嵌套引号不再静默丢失；
// WP-116 批1：切分经 loadDocument 宿主单点，无 frontmatter/非法 YAML/非映射产物 → null 不触发校验）
function parseFrontmatter(content) {
  const fmRaw = loadDocument(content).frontmatter;
  if (!fmRaw || typeof fmRaw !== "object" || Array.isArray(fmRaw) || Object.keys(fmRaw).length === 0) return null;
  const fm = {};
  for (const [key, value] of Object.entries(fmRaw)) {
    if (value === null) continue; // 「key:」无值——旧口径该键不存在
    fm[key] = typeof value === "object" ? value : String(value); // YAML 类型化标量统一回字符串（与旧正则口径一致）
  }
  return fm;
}

// 关键 frontmatter 键（外部写后触发校验的字段）
const FRONTMATTER_KEYS = ["article_id", "category-path", "module", "article_type", "doc-type", "product"];

/**
 * createVaultWatcherService — 创建 vault 文件监听服务
 *
 * @param {{ vaultPath: string, gitLedger: object, logger?: object, ruleSet?: object, onExternalWrite?: function, onSchemaInputWrite?: function }} options
 *   gitLedger 须实现 isSystemFile(absPath) 与 scheduleLedger(domain, summary, paths)
 *   ruleSet 可选，用于 frontmatter 键值校验（category-path 格式验证）
 *   onExternalWrite 可选（SPEC-012 WP-C）：外部写事件桥接——②类同步器的增量来源之一
 *   onSchemaInputWrite 可选（WP-027/PR-142）：图输入 schema 文件（知识库/TheSchema/四件）写事件桥——
 *     不分内外部写（API 保存是内部写、Obsidian/CLI 直改是外部写，图谱刷新调度器都要感知）
 */
function createVaultWatcherService({ vaultPath, gitLedger, vaultIO, logger, ruleSet, onExternalWrite, onSchemaInputWrite }) {
  const log = logger || { info() {}, warn() {}, error() {} };
  const ledger = gitLedger || { markSystemFile() {}, scheduleLedger() {} };

  // WP-027：图输入 schema 文件匹配——五件（WP-049 余量批：清单从词表装载端口 VOCAB_FILE_NAMES
  // 派生，P6「输入集多份」末份收编——事件监听面与抽取/新鲜度面同源）
  const { VOCAB_FILE_NAMES } = require("../../shared/vocab-load-port.cjs");
  const SCHEMA_GRAPH_INPUT_BASENAMES = new Set(VOCAB_FILE_NAMES.map((name) => `${name}.yaml`));
  function isSchemaGraphInputPath(absPath) {
    if (!SCHEMA_GRAPH_INPUT_BASENAMES.has(path.basename(absPath))) return false;
    const normalized = absPath.split(path.sep).join("/");
    return /(^|\/)TheSchema\//.test(normalized);
  }

  // SPEC-012 结构收口批：监听忽略形态从 destinations 契约 ignoredForms 单源派生——
  // 原与门禁⑥白名单「两处同步维护」的清单退役（改一漏一这类问题构造性消灭）
  const IGNORE_PATTERNS = ignoredFormsFor("watcher");

  function isIgnored(filePath) {
    return IGNORE_PATTERNS.some((re) => re.test(filePath));
  }

  // ⑤类系统文件静态登记查询（channel-write-log/state-journal 及 boot 迁移登记路径——写者写前登记，
  // 登记即系统文件，进程同寿无过期；无接口时降级不判——可能产生一笔可归因的假 external:，不丢账）
  function isSystemFile(absPath) {
    if (typeof ledger.isSystemFile === "function") return ledger.isSystemFile(absPath);
    return false;
  }

  // 通道写日志取证匹配：path＋contentHash 相等 → 本进程写（尾部 N=200 行窗口）
  const CHANNEL_LOG_TAIL_LINES = 200;
  function isChannelWrite(absPath) {
    const rel = path.relative(vaultPath, absPath).split(path.sep).join("/");
    let content;
    try { content = fs.readFileSync(absPath, "utf8"); } catch { return false; } // 文件已删（unlink 事件）→ 无从取证
    const hash = "sha256:" + crypto.createHash("sha256").update(content, "utf8").digest("hex");
    let text;
    try { text = fs.readFileSync(channelLogPathFor(vaultPath), "utf8"); } catch { return false; } // 无日志/读失败 → 全外部（保守面，见头部注释）
    const tail = text.split("\n").filter((l) => l.trim()).slice(-CHANNEL_LOG_TAIL_LINES);
    for (const line of tail) {
      try {
        const entry = JSON.parse(line);
        if (entry && entry.path === rel && entry.contentHash === hash) return true;
      } catch { /* 半行容忍：跳过 */ }
    }
    return false;
  }

  // 归属判定：内部写＝系统文件（静态登记）或通道写（日志取证）
  function isInternalWrite(absPath) {
    return isSystemFile(absPath) || isChannelWrite(absPath);
  }

  // 防抖：文件路径 → timer
  const debounceMap = new Map();
  const DEBOUNCE_MS = 5000; // 5s 聚批

  // frontmatter 即时校验
  function checkFrontmatter(absPath) {
    try {
      if (!fs.existsSync(absPath)) return;
      const content = fs.readFileSync(absPath, "utf8");
      const fm = parseFrontmatter(content);
      if (!fm) return;

      // SPEC-012 结构收口批：受管字段校验经规则引擎单点——validation-rules.json 声明的全部
      // 规则一次校验（原仅手挂 A08 一条；新规则进契约自动生效，无需在此接线）
      // WP-156 必修修复（红队⑤）：ruleSet 支持函数形态（词表提供者）——真实装配由 main 注入
      // `() => loadRuleSetForVault(vaultPath)`（与查询面 health 读模型同源），每次校验现取词表
      // （词表热更即实时面新值）；旧对象形态向后兼容。无源空转形态保留为显式可选（单测替身用），
      // 真实启动装配有源——「新规则进契约自动生效」在真库成立。
      const resolvedRuleSet = typeof ruleSet === "function" ? ruleSet() : ruleSet;
      const violations = resolvedRuleSet ? validateFrontmatter(fm, resolvedRuleSet) : [];

      if (violations.length > 0) {
        const record = {
          checkedAt: new Date().toISOString(),
          file: path.relative(vaultPath, absPath),
          violations,
        };
        // SPEC-012 WP-B：④类痕迹迁 telemetry.db（观测自指构造性解——vault 不再有 health 落盘；
        // 尽力而为：写失败只告警不阻断监听）
        const written = getTelemetryStore(vaultPath).recordTrace(TRACE_KINDS.FRONTMATTER_CHECK, record);
        if (!written) log.warn({ event: "vault-watcher-telemetry-write-failed", file: record.file });
        log.warn({ event: "vault-watcher-frontmatter-violation", file: record.file, violations });
      }
    } catch (err) {
      log.warn({ event: "vault-watcher-frontmatter-check-failed", path: absPath, error: err.message });
    }
  }

  // 处理单个文件事件（防抖后调用）
  function handleFile(absPath) {
    // WP-027（PR-142）：图输入 schema 写事件桥——先于内外部写分流（内部写早退不桥接 onExternalWrite，
    // 但 API 保存的 schema 写恰是内部写，故本桥必须独立于归属判定；桥失败不阻断监听主链路）
    if (typeof onSchemaInputWrite === "function" && isSchemaGraphInputPath(absPath)) {
      try { onSchemaInputWrite([absPath]); } catch (err) { log.warn({ event: "vault-watcher-schema-input-bridge-failed", error: err.message }); }
    }
    if (isInternalWrite(absPath)) {
      // 本进程写（通道取证命中或系统文件登记）——等记账员收账，不双记、不桥接
      return;
    }
    // 外部写：以 external: 域调 scheduleLedger
    ledger.scheduleLedger("external", `外部写入: ${path.relative(vaultPath, absPath)}`, [absPath]);
    log.info({ event: "vault-watcher-external-write", path: path.relative(vaultPath, absPath) });
    // 先把外部字节的派生哈希稳定写回，再通知读者；只读证据档不得被监听器改写。
    if (absPath.endsWith(".md")) {
      updateContentHash(absPath);
      checkFrontmatter(absPath);
    }
    if (typeof onExternalWrite === "function") {
      try { onExternalWrite([absPath]); } catch (err) { log.warn({ event: "vault-watcher-external-bridge-failed", error: err.message }); }
    }
  }

  // 自动重算内容哈希，更新frontmatter，不改动用户正文
  function updateContentHash(absPath) {
    try {
      if (!fs.existsSync(absPath)) return;
      const relative = path.relative(vaultPath, absPath).split(path.sep).join("/");
      if (resolveMutability(relative) === READ_ONLY_EVIDENCE) return;
      const raw = fs.readFileSync(absPath, "utf8");
      let end;
      try { end = frontmatterBounds(raw).close; } catch { return; }
      const fmText = raw.slice(3, end);
      const body = raw.slice(end);
      let fm;
      try { fm = YAML.parse(fmText) || {}; } catch { return; }
      if (!fm || typeof fm !== "object" || Array.isArray(fm)) return;
      const previous = fm.content_hash;
      delete fm.content_hash;
      const hash = "sha256:" + crypto.createHash("sha256").update(JSON.stringify(fm) + body, "utf8").digest("hex");
      if (previous === hash) return;
      const next = patchFrontmatter(raw, { content_hash: hash });
      writeVault(absPath, next, { expectedContentHash: contentRevision(raw), domain: "workflow", summary: "外部编辑内容哈希更新" });
      log.info({ event: "vault-watcher-hash-updated", path: path.relative(vaultPath, absPath) });
    } catch (err) {
      log.warn({ event: "vault-watcher-hash-update-failed", path: absPath, error: err.message });
    }
  }

  let watcher = null;
  let watcherReady = false;

  function start() {
    let chokidar;
    try {
      chokidar = require("chokidar");
    } catch (err) {
      log.warn({ event: "vault-watcher-chokidar-unavailable", error: err.message });
      return;
    }

    const watchPaths = [
      path.join(vaultPath, "知识库"),
      path.join(vaultPath, ".ledger"),
    ].filter((p) => fs.existsSync(p));

    if (watchPaths.length === 0) {
      log.warn({ event: "vault-watcher-no-watch-paths", vaultPath });
      return;
    }

    try {
      watcher = chokidar.watch(watchPaths, {
        ignored: (p) => isIgnored(p),
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
      });

      watcher.on("add", onEvent);
      watcher.on("change", onEvent);
      watcher.on("unlink", onEvent);
      watcher.on("ready", () => {
        watcherReady = true;
        log.info({ event: "vault-watcher-ready", paths: watchPaths.map((p) => path.relative(vaultPath, p)) });
      });
      watcher.on("error", (err) => {
        log.warn({ event: "vault-watcher-error", error: err.message });
      });
    } catch (err) {
      log.warn({ event: "vault-watcher-start-failed", error: err.message });
    }
  }

  function onEvent(absPath) {
    if (isIgnored(absPath)) return;
    // 防抖：同一文件 5s 内只触发一次
    if (debounceMap.has(absPath)) clearTimeout(debounceMap.get(absPath));
    debounceMap.set(absPath, setTimeout(() => {
      debounceMap.delete(absPath);
      handleFile(absPath);
    }, DEBOUNCE_MS));
  }

  function stop() {
    if (watcher) {
      watcher.close().catch(() => {});
      watcher = null;
    }
    for (const timer of debounceMap.values()) clearTimeout(timer);
    debounceMap.clear();
  }

  function isReady() { return watcherReady; }

  // handleEventNow：测试专用钩子——跳过防抖，直接处理文件事件（用于单测同步触发）
  function handleEventNow(absPath) {
    if (isIgnored(absPath)) return;
    handleFile(absPath);
  }

  return { start, stop, isReady, handleEventNow };
}

module.exports = { createVaultWatcherService, parseFrontmatter };
