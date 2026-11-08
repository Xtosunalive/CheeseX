// Component: Vault-IO
// @responsible: vault 数据文件的唯一写入通道（SPEC-011 WP0＋PR-083 凭据制修订）——写前冲突拒绝 + 原子写 + 记账 + boot 漂移扫 + SIGTERM 排水。
// @inputs: vaultGitLedger（装配时注入）；absPath/content/domain/summary/expectedContentHash
// @outputs: readVault〔签发凭据〕/ writeVault〔更新写·必带凭据〕/ replaceVault〔全权替换〕/ writeVaultExclusive〔排他/只读所有权〕/ appendVaultJsonl〔追加〕（实例 API 同族）
// @context: Vault（cheese 仓）
//
// 设计决策（SPEC-011 WP0；PR-083 2026-10-20 Master 批复「A」凭据制修订）：
// - 唯一写通道：所有 vault 数据写入经此模块；忘挂钩的死角从结构上消失；
// - 写前冲突拒绝（PR-083，TALOS system/runtime/policy.file 同形态）：更新写必带期望修订凭据
//   （expectedContentHash——readVault 读时签发的 sha256；'absent' 声明「文件应不存在」），缺省拒、
//   与磁盘不符拒（VAULT_REVISION_CONFLICT）——盲覆盖在签名上不成立，非可选参数、无 lint 后置防线；
//   检查与落盘同处一个同步段（单进程内无事件循环间隙），进程内外部写者的竞态归 watcher 事后归属域；
// - 写路径四分类：更新（writeVault·凭据）／全权替换（replaceVault·显式「我拥有此文件」）／
//   排他与只读所有权（writeVaultExclusive·wx flag 即 OS 级 absent 声明）／追加（appendVaultJsonl·无覆盖语义）；
// - 原子写：tmp(O_EXCL) → writeFileSync → renameSync，进程中断不留半截文件（参照 schema-write-service）；
// - 记账：写成功后调 vaultGitLedger.scheduleLedger（写者域落账）；
// - 归属取证（SPEC-012 WP-J）：每次写后追加通道写日志（路径＋内容哈希＋基线修订 baseRevision——
//   PR-083：更新写记凭据值，审计可回放「基于哪个基线改的」）——
//   watcher 外部写归属从 TTL 时间窗改为「查日志按 path＋contentHash 匹配」（§F1 修订）；
//   通道日志自身写不在日志里（防递归），写前经 markSystemFile 静态登记防 watcher 误记；
// - 合并窗口参数化：VAULT_GIT_LEDGER_WINDOW_MS，默认 1000ms（SPEC-010 §二 补充说明）；
// - boot 漂移修复扫：server 启动时调 recoverDrift()——扫 vault 工作区 vs git HEAD，
//   有变更补一笔 recovery: 提交；仅执行一次；VAULT_GIT_LEDGER_DISABLE=1 时跳过；失败只告警；
// - SIGTERM 有序退出：在 main.cjs 注册 process.once('SIGTERM'/'SIGINT') → flush()（见下方导出）；
// - 写禁令执法面：server/** 禁裸 fs.writeFile* 由 eslint no-restricted-syntax error 规则执法
//   （SPEC-012 WP-J 第 21 号棘轮门禁退役随件；合法写者=本模块＋persistence 层＋repo-file-io）。
// - 目的地执法（SPEC-012 F1）：每次写入先验 contracts/vault-write-destinations.json 声明——
//   ①⑤类终态落点＋②③④迁移白名单（已清零）；越界 throw（fail-closed）。
//   实例通道（createVaultIO）始终执法（构造即知 vault 根）；模块级缺省通道在 initVaultIO 后执法
//   （生产 boot 必经 main.cjs initVaultIO，未初始化态仅存于单测夹具——静态门禁为第二道面）。

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { execFile } = require("node:child_process");
const { createError } = require("./error-factory.cjs"); // EG-1b：错误构造单源（本地禁手写工厂）
const { assertVaultWriteDestination, canonicalize } = require("./vault-write-destinations.cjs");
const humanEditGuard = require("./human-edit-guard.cjs"); // WP-015/SPEC-077：实体·概念页族「机器回写不覆盖人手改」裁决门

/**
 * 创建 vault-io 实例。
 * @param {{ vaultPath: string, gitLedger: object, logger?: object }} options
 *   gitLedger 须实现 scheduleLedger(domain, summary, paths)；
 *   缺省时为 no-op（保持旧装配不破）。
 */
// ── 原子写辅助（模块级——writeVaultFile 与模块级缺省通道共用）──
function atomicWrite(absPath, content) {
  const tmpPath = absPath + ".vault-io-" + process.pid + "-" + crypto.randomUUID() + ".tmp";
  try {
    // O_EXCL：独占创建，防并发写冲突
    fs.writeFileSync(tmpPath, content, { encoding: "utf8", flag: "wx" });
    fs.renameSync(tmpPath, absPath);
  } catch (err) {
    try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch { /* best-effort */ }
    throw err;
  }
}

// 追加写的取证哈希取写后全文：watcher 按事件文件「当前内容」匹配——追加行哈希与全文哈希恒不等，
// 记行哈希会让全部追加目标（如 .ledger/decisions.jsonl）被误判外部写（SPEC-012 WP-J）。
function readBackForHash(absPath, fallback) {
  try { return fs.readFileSync(absPath, "utf8"); } catch { return fallback; }
}

// ── 写前冲突拒绝（PR-083：凭据制——TALOS policy.file「file write requires expected file digest」同形态）──
const ABSENT_REVISION = "absent"; // 合法凭据值：写者声明「文件应不存在」——新建/恢复同样有冲突语义

/** 内容修订指纹（与通道日志 contentHash 同口径）。 */
function contentRevision(content) {
  return "sha256:" + crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

/** 磁盘当前修订：文件缺失即 'absent'（与 TALOS file_hash 同构）。 */
function diskRevision(absPath) {
  try { return contentRevision(fs.readFileSync(absPath, "utf8")); }
  catch { return ABSENT_REVISION; }
}

/**
 * 更新写凭据校验：缺凭据即拒（签名级，非可选参数）；凭据与磁盘不符即拒（含 absent↔已存在双向）。
 * 检查与落盘同处一个同步段——单进程内检查后无事件循环间隙，竞态窗口对外部写者（编辑器）不设防，
 * 该面归 watcher 事后归属域（与 TALOS 分工一致）。
 * @returns 校验通过的实际修订值（供通道日志记 baseRevision）
 */
function assertUpdateCredential(absPath, expected) {
  if (typeof expected !== "string" || expected.length === 0) {
    throw createError(
      "VAULT_REVISION_CREDENTIAL_REQUIRED",
      `vault update write requires expectedContentHash (obtain via readVault; '${ABSENT_REVISION}' declares create): ${path.basename(absPath)}`,
      500,
    );
  }
  const actual = diskRevision(absPath);
  if (expected !== actual) {
    throw createError(
      "VAULT_REVISION_CONFLICT",
      `vault revision conflict on ${path.basename(absPath)}: expected ${expected}, disk ${actual}`,
      409,
      { expected, actual },
    );
  }
  return actual;
}

function createVaultIO(options) {
  const vaultPath = path.resolve(options.vaultPath);
  const logger = options.logger || { info() {}, warn() {}, error() {} };
  // gitLedger 接口：scheduleLedger(domain, summary, paths)——写者域落账。
  // 写归属取证走通道写日志（appendChannelLog），不再依赖 ledger 的进程内登记。
  const gitLedger = options.gitLedger || { scheduleLedger() {} };

  // ── 公开 API ──

  /**
   * 更新写（原子 + 凭据校验 + 记账）——PR-083 凭据制：必带 expectedContentHash。
   * @param {string} absPath 绝对路径
   * @param {string} content 文件内容
   * @param {{ expectedContentHash: string, domain?: string, summary?: string }} opts
   *   expectedContentHash：readVaultFile 签发的 sha256，或 'absent'（声明文件应不存在）
   */
  function writeVaultFile(absPath, content, opts) {
    assertVaultWriteDestination(vaultPath, absPath); // SPEC-012 F1
    assertNotReadOnlyEvidenceFor(vaultPath, absPath, "更新写 writeVaultFile（含凭据）"); // SPEC-028：只读证据档禁更新/覆盖
    // WP-015/SPEC-077：实体·概念页族写前裁决——人改面×写面相交即拒（机器回写不覆盖人手改）
    const guardVerdict = humanEditGuard.checkWrite({ vaultPath, absPath, nextRaw: content });
    if (!guardVerdict.allowed) throw guardVerdict.error;
    const { domain, summary } = opts || {};
    const baseRevision = assertUpdateCredential(absPath, opts && opts.expectedContentHash); // PR-083
    atomicWrite(absPath, content);
    const ledgerFiles = [absPath];
    if (humanEditGuard.record(vaultPath, absPath, content)) {
      // 侧账变化搭同笔账车（基线与页面同账，git 即账）；markSystemFile 防 watcher 判 external（H5，通道日志同款）
      const blPath = humanEditGuard.baselinePath(vaultPath);
      try { gitLedger.markSystemFile(blPath); } catch { /* 无 markSystemFile 的替身账车跳过 */ }
      ledgerFiles.push(blPath);
    }
    const channelLog = channelLogPathFor(vaultPath); // 日志搭账车（与默认通道同款）
    if (channelLog && path.resolve(channelLog) !== path.resolve(absPath)) ledgerFiles.push(channelLog);
    gitLedger.scheduleLedger(domain || "vault", summary || "write", ledgerFiles);
    appendChannelLog(vaultPath, absPath, content, domain, summary, baseRevision); // SPEC-012 F1 修订＋PR-083 基线
    emitVaultWrite({ absPath, domain, summary }); // SPEC-012 WP-C
  }

  /**
   * 全权替换写（原子 + 记账）——显式「我全权拥有此文件」（指针/清单/派生投影再生成类）。
   * 无凭据形态仅此与追加/排他三种，盲覆盖不在此列。
   */
  function replaceVaultFile(absPath, content, opts) {
    assertVaultWriteDestination(vaultPath, absPath); // SPEC-012 F1
    assertNotReadOnlyEvidenceFor(vaultPath, absPath, "全权替换 replaceVaultFile"); // SPEC-028：只读证据档禁更新/覆盖
    // WP-015/SPEC-077 立法：实体·概念页禁走全权替换——「我全权拥有此文件」声明与
    // 「机器回写不覆盖人手改」不相容（盲覆盖面即人改面），此类页面只许凭据制更新写（writeVaultFile 经裁决门）
    {
      const relForGuard = path.relative(vaultPath, absPath).split(path.sep).join("/");
      if (humanEditGuard.ENTITY_PAGE_RE.test("/" + relForGuard)) {
        throw createError("HUMAN_EDIT_CONFLICT", `实体·概念页禁走全权替换（${relForGuard}）——该类页面的机器写只许凭据制更新写经人改裁决门`, 409, { path: relForGuard });
      }
    }
    const { domain, summary } = opts || {};
    atomicWrite(absPath, content);
    const ledgerFiles = [absPath];
    const channelLog = channelLogPathFor(vaultPath);
    if (channelLog && path.resolve(channelLog) !== path.resolve(absPath)) ledgerFiles.push(channelLog);
    gitLedger.scheduleLedger(domain || "vault", summary || "replace", ledgerFiles);
    appendChannelLog(vaultPath, absPath, content, domain, summary, null);
    emitVaultWrite({ absPath, domain, summary });
  }

  /**
   * 读取 vault 文件并签发写凭据（PR-083：凭据从读签发——读与写后校验同口径）。
   * @returns {{ content: string, sha256: string }}
   */
  function readVaultFile(absPath) {
    const content = fs.readFileSync(absPath, "utf8");
    return { content, sha256: contentRevision(content) };
  }

  /**
   * 追加一行 JSON 到 JSONL 文件 + 记账。
   * PR-058：真追加——单行一次 O_APPEND 写（dev-log createSyncAppendStream 同款先例），
   * 不再「读全文件→拼接→原子写回」（O(全文) 且与并发追加者读改写竞态）；
   * 进程中断的半行风险由消费方按行解析兜底（readDevLog 同款跳过半行）。
   * @param {string} absPath 绝对路径
   * @param {object} record 待追加记录（将被 JSON.stringify）
   * @param {{ domain: string, summary: string }} opts
   */
  function appendJsonl(absPath, record, opts) {
    assertVaultWriteDestination(vaultPath, absPath); // SPEC-012 F1
    assertNotReadOnlyEvidenceFor(vaultPath, absPath, "追加 appendJsonl"); // SPEC-028：只读证据档非 append-only 账本
    const { domain, summary } = opts || {};
    const line = JSON.stringify(record) + "\n";
    fs.appendFileSync(absPath, line, { encoding: "utf8" });
    const ledgerFiles = [absPath];
    const channelLog = channelLogPathFor(vaultPath); // 日志搭账车（与默认通道同款）
    if (channelLog && path.resolve(channelLog) !== path.resolve(absPath)) ledgerFiles.push(channelLog);
    gitLedger.scheduleLedger(domain || "vault", summary || "append", ledgerFiles);
    // 归属取证记写后全文哈希（watcher 按当前内容匹配，见 readBackForHash 注释）
    appendChannelLog(vaultPath, absPath, readBackForHash(absPath, line), domain, summary); // SPEC-012 F1 修订
    emitVaultWrite({ absPath, domain, summary }); // SPEC-012 WP-C
  }

  return { writeVaultFile, replaceVaultFile, readVaultFile, appendJsonl };
}

// ── Boot 漂移修复扫（SPEC-011 WP0：crash window 兜底）──
// 在 main.cjs 的 vaultGitLedger 创建后调用一次，listen 前 await 完成（PR-056 顺序兑现）。
// 扫 vault 工作区 vs git HEAD；有变更则补 `recovery: boot-time drift` 提交。
// 仅执行一次（boot 阶段），不循环；失败只告警不阻断启动。
// PR-056：git 调用异步（execFile）——boot 期虽可容忍同步，但与运行时统一异步纪律。
async function recoverBootDrift(vaultPath, gitLedger, logger) {
  if (process.env.VAULT_GIT_LEDGER_DISABLE === "1") return;
  const log = logger || { info() {}, warn() {} };
  try {
    const out = await new Promise((resolve) => {
      execFile(
        "git", ["-c", "core.quotepath=false", "status", "--porcelain", "--untracked-files=all"],
        { cwd: vaultPath, encoding: "utf8", timeout: 15000 },
        (error, stdout) => resolve(error ? null : stdout),
      );
    });
    if (out === null) {
      log.warn({ event: "vault-io-boot-drift-failed", error: "git status 不可用" });
      return;
    }
    if (!out.trim()) {
      log.info({ event: "vault-io-boot-drift-clean" });
      return;
    }
    // 有变更：通过 ledger 落一笔 recovery: 提交
    log.warn({ event: "vault-io-boot-drift-detected", lines: out.split("\n").length });
    // 用整仓两目录兜底收账（与 SPEC-010 WP3 管线收尾同款策略）
    const dirs = [
      path.join(vaultPath, "知识库"),
      require("../vault-paths.cjs").getLedgerDir(vaultPath), // PR-243 批B：单源
    ];
    gitLedger.scheduleLedger("recovery", "boot-time drift", dirs);
    // flush 确保在 server 开始处理请求前 recovery 提交已落
    if (typeof gitLedger.flush === "function") {
      await gitLedger.flush();
    }
    log.info({ event: "vault-io-boot-drift-recovered" });
  } catch (err) {
    // 失败只告警，不阻断启动（git 不可用 / vault 非 git 仓 等场景）
    log.warn({ event: "vault-io-boot-drift-failed", error: err.message });
  }
}

// ── 模块级缺省通道（PR-057 迁移基建：函数式服务模块的取用形态）──
// 取用形态两种并存：
//   ① 装配注入实例：main.cjs 直建的服务（watcher/reconcile）持 vaultIO 引用（SPEC-011 WP0 原始形态）；
//   ② 模块级缺省通道：函数式服务模块（enums-write-service 等无构造器的模块）经 writeVault /
//      appendVaultJsonl / writeVaultExclusive 使用——main.cjs boot 期 initVaultIO 一次，
//      生产行为=记账＋归属取证日志全开；未初始化时（单测夹具）回退为「无记账原子写」，
//      行为等价旧裸写+原子性增益，测试无需装配 ledger。
// 设计取舍：模块级缺省通道是服务定位器形态——为覆盖大量「无构造器的函数式模块」而设，
// 与 SPEC WP0 的「装配注入」并存而非替代；执法面在 eslint 禁裸写规则（SPEC-012 WP-J 起常驻），
// 不在取用形态。
let defaultLedger = null;
let defaultVaultPath = null; // SPEC-012 F1：缺省通道目的地执法的 vault 根（initVaultIO 后激活）

function initVaultIO(options) {
  defaultLedger = (options && options.gitLedger) || null;
  defaultVaultPath = (options && options.vaultPath) ? path.resolve(options.vaultPath) : null;
  return createVaultIO(options);
}

/** 测试复位口：清模块级缺省根（生产单进程单 vault 不用——多夹具单测防进程单例污染，红队 P1 回归批引入） */
function resetVaultIO() {
  defaultLedger = null;
  defaultVaultPath = null;
}

function assertDefaultDestination(absPath) {
  if (defaultVaultPath) assertVaultWriteDestination(defaultVaultPath, absPath);
}

// ── SPEC-028 可变性档执法：read-only-evidence 落点（article-lifecycle 角色声明）──
// 更新写/全权替换/追加一律拒绝（fail-closed，不回落不假成功）；
// 排他写强制 { flag:"wx", mode:0o444 }（声明胜于调用方记忆）。
// 目录不封（红队 P1 修正 2026-10-25：lane/正式区是共享写工作区，封目录断后续写入——
// 只封文件 0o444；删除防护由 sha256 文件名校验＋reconcile 悬空告警承载，见 SPEC-028 §五）。
// 双写者族同执法：模块级缺省函数族＋createVaultIO 工厂族。
const lifecycleMutability = require("./article-lifecycle-paths.cjs");

function resolveMutabilityFor(vaultPath, absPath) {
  if (!vaultPath) return null; // 未装配 vault 根（单测直连形态）——档位执法随 F1 目的地执法同门激活
  // 红队 P2 修复：与 F1 目的地执法同源 canonicalize（vault-write-destinations 单源）——
  // macOS /tmp→/private/tmp、symlink 别名路径归一后再判定档位，两道防线口径一致，禁第二份归一实现
  const rel = path.relative(canonicalize(vaultPath), canonicalize(absPath)).split(path.sep).join("/");
  return rel.startsWith("..") ? null : lifecycleMutability.resolveMutability(rel);
}

function assertNotReadOnlyEvidenceFor(vaultPath, absPath, operation) {
  if (resolveMutabilityFor(vaultPath, absPath) !== lifecycleMutability.READ_ONLY_EVIDENCE) return;
  const rel = path.relative(path.resolve(vaultPath), path.resolve(absPath)).split(path.sep).join("/");
  throw Object.assign(
    new Error(`vault-io 拒写：${rel} 属只读证据档（article-lifecycle mutability=read-only-evidence）——${operation} 不适用，仅允许排他创建写 writeVaultExclusive（wx+0o444）；fail-closed`),
    { code: "VAULT_IMMUTABLE_PATH", status: 409 },
  );
}

function enforceExclusiveWriteOptionsFor(vaultPath, absPath, fsOptions) {
  if (resolveMutabilityFor(vaultPath, absPath) !== lifecycleMutability.READ_ONLY_EVIDENCE) return fsOptions;
  return { ...(fsOptions || {}), flag: "wx", mode: 0o444 };
}

function resolveVaultMutability(absPath) {
  return resolveMutabilityFor(defaultVaultPath, absPath);
}

function assertNotReadOnlyEvidence(absPath, operation) {
  assertNotReadOnlyEvidenceFor(defaultVaultPath, absPath, operation);
}

function markSystemFileSafe(absPath) {
  if (defaultLedger && typeof defaultLedger.markSystemFile === "function") defaultLedger.markSystemFile([absPath]);
}

// ── 通道写日志（SPEC-012 F1 修订：路径＋内容哈希——排除法归属的取证面）──
// 每次通道写后追加一行到 vault ⑤类 channel-write-log.jsonl；自身不记（防递归）；
// 失败只吞（尽力而为——日志不得阻断写路径）；日志自身经 markSystemFile 静态登记防 watcher 误记外部写
// （watcher 归属判定：优先查本日志 path＋contentHash，登记的⑤类系统文件直接判内部，其余外部）。
const CHANNEL_LOG_REL = ".ledger/channel-write-log.jsonl"; // PR-243 批B：实例名残留退役（对账键字面量，与 vault-paths.LEDGER_DIRNAME 同值——REL 形态供扫描对账）
function appendChannelLog(vaultRoot, absPath, content, domain, summary, baseRevision) {
  try { fs.mkdirSync(path.join(vaultRoot, ".ledger"), { recursive: true }); } catch { /* 已存在——追加自会失败降级 */ }
  if (!vaultRoot) return;
  const logPath = path.join(vaultRoot, CHANNEL_LOG_REL);
  if (path.resolve(absPath) === path.resolve(logPath)) return;
  try {
    const hash = "sha256:" + crypto.createHash("sha256").update(content, "utf8").digest("hex");
    // 符号链接归一（macOS /tmp→/private/tmp——e2e 实证不归一会逃逸出 vault 根，watcher 按串匹配即错判）
    const rel = path.relative(canonicalize(vaultRoot), canonicalize(absPath)).split(path.sep).join("/");
    markSystemFileSafe(logPath);
    // baseRevision（PR-083）：更新写记凭据值（写者认定的基线），替换/追加/排他为 null
    fs.appendFileSync(logPath, JSON.stringify({ ts: new Date().toISOString(), path: rel, contentHash: hash, baseRevision: baseRevision || null, domain: domain || null, summary: summary || null }) + "\n", "utf8");
  } catch { /* 取证日志失败不回卷写路径 */ }
}
function channelLogPathFor(vaultRoot) {
  return vaultRoot ? path.join(vaultRoot, CHANNEL_LOG_REL) : null;
}

// ── 通道挂钩事件源（SPEC-012 WP-C：②类同步器的增量来源之一）──
// 写入成功后同步派发 { absPath, domain, summary }；listener 抛错只吞不阻断写路径（fail-open 对派生链路）。
const writeListeners = new Set();

/** 订阅通道写事件；返回退订函数。 */
function onVaultWrite(listener) {
  writeListeners.add(listener);
  return () => writeListeners.delete(listener);
}

function emitVaultWrite(record) {
  for (const listener of writeListeners) {
    try { listener(record); } catch { /* 派生链路失败不回卷写路径 */ }
  }
}

function scheduleLedgerSafe(domain, summary, absPath, noLedger) {
  if (noLedger) return; // 迁移批语义：只换写路径不改记账归属（归属取证日志仍记）
  if (defaultLedger && typeof defaultLedger.scheduleLedger === "function") {
    const files = [absPath];
    if (defaultVaultPath && humanEditGuard.consumeBaselineLedgerFlag(defaultVaultPath)) {
      files.push(humanEditGuard.baselinePath(defaultVaultPath)); // WP-015：侧账与页面同账
    }
    const logPath = channelLogPathFor(defaultVaultPath); // 日志搭账车：与所记写同批入库（SPEC-012 F1 修订）
    if (logPath && path.resolve(logPath) !== path.resolve(absPath)) files.push(logPath);
    defaultLedger.scheduleLedger(domain || "vault", summary || "write", files);
  }
}

/** 更新写（tmp+rename 原子＋凭据校验＋记账＋取证日志）——PR-083 凭据制：必带 opts.expectedContentHash。 */
function writeVault(absPath, content, opts) {
  assertDefaultDestination(absPath); // SPEC-012 F1
  assertNotReadOnlyEvidence(absPath, "更新写 writeVault（含凭据）"); // SPEC-028：只读证据档禁更新写
  // WP-015/SPEC-077：实体·概念页族写前裁决（与实例通道同判据；defaultVaultPath 未初始化时跳过＝单测夹具态）
  if (defaultVaultPath) {
    const guardVerdict = humanEditGuard.checkWrite({ vaultPath: defaultVaultPath, absPath, nextRaw: content });
    if (!guardVerdict.allowed) throw guardVerdict.error;
  }
  const expected = opts && opts.expectedContentHash;
  const baseRevision = assertUpdateCredential(absPath, expected); // PR-083：缺省拒＋不符拒
  atomicWrite(absPath, content);
  if (defaultVaultPath && humanEditGuard.record(defaultVaultPath, absPath, content)) {
    if (opts && opts.noLedger) humanEditGuard.consumeBaselineLedgerFlag(defaultVaultPath); // H10③：noLedger 不搭账车，旗标当场清防滞留污染下笔
    else humanEditGuard.markBaselineForLedger(defaultVaultPath); // 侧账搭同笔账车（见 scheduleLedgerSafe 下发）
  }
  scheduleLedgerSafe(opts && opts.domain, opts && opts.summary, absPath, opts && opts.noLedger);
  appendChannelLog(defaultVaultPath, absPath, content, opts && opts.domain, opts && opts.summary, baseRevision); // SPEC-012 F1 修订＋PR-083 基线
  emitVaultWrite({ absPath, domain: opts && opts.domain, summary: opts && opts.summary }); // SPEC-012 WP-C
}

/** 全权替换写——显式「我全权拥有此文件」（指针/清单/派生投影再生成类）；凭据制的唯一无凭据覆盖形态。 */
function replaceVault(absPath, content, opts) {
  assertDefaultDestination(absPath); // SPEC-012 F1
  assertNotReadOnlyEvidence(absPath, "全权替换 replaceVault"); // SPEC-028：只读证据档禁覆盖
  // WP-015/SPEC-077 立法：实体·概念页禁走全权替换（与实例通道同款）
  if (defaultVaultPath) {
    const relForGuard = path.relative(defaultVaultPath, absPath).split(path.sep).join("/");
    if (humanEditGuard.ENTITY_PAGE_RE.test("/" + relForGuard)) {
      throw createError("HUMAN_EDIT_CONFLICT", `实体·概念页禁走全权替换（${relForGuard}）——该类页面的机器写只许凭据制更新写经人改裁决门`, 409, { path: relForGuard });
    }
  }
  atomicWrite(absPath, content);
  scheduleLedgerSafe(opts && opts.domain, opts && opts.summary, absPath, opts && opts.noLedger);
  appendChannelLog(defaultVaultPath, absPath, content, opts && opts.domain, opts && opts.summary, null);
  emitVaultWrite({ absPath, domain: opts && opts.domain, summary: opts && opts.summary });
}

/**
 * 读取 vault 文件并签发写凭据（PR-083：凭据从读签发）。
 * @returns {{ content: string, sha256: string }}
 */
function readVault(absPath) {
  const content = fs.readFileSync(absPath, "utf8");
  return { content, sha256: contentRevision(content) };
}

/** 单行真追加 + 记账 + 取证日志——替换服务层 fs.appendFileSync（JSONL 台账）。 */
function appendVaultJsonl(absPath, record, opts) {
  assertDefaultDestination(absPath); // SPEC-012 F1
  assertNotReadOnlyEvidence(absPath, "追加 appendVaultJsonl"); // SPEC-028：只读证据档非 append-only 账本
  const line = typeof record === "string" ? record : JSON.stringify(record);
  fs.appendFileSync(absPath, line, (opts && opts.fsOptions) || { encoding: "utf8" });
  scheduleLedgerSafe(opts && opts.domain, opts && opts.summary, absPath, opts && opts.noLedger);
  // 归属取证记写后全文哈希（watcher 按事件文件当前内容匹配，见 readBackForHash 注释）
  appendChannelLog(defaultVaultPath, absPath, readBackForHash(absPath, line), opts && opts.domain, opts && opts.summary); // SPEC-012 F1 修订
  emitVaultWrite({ absPath, domain: opts && opts.domain, summary: opts && opts.summary }); // SPEC-012 WP-C
}

/**
 * 排他/带 flag 写 + 记账——保留调用方 flag/mode 语义（wx 排他创建、0o444 只读快照等）。
 * 注意：此路径非原子（与迁移前的裸写一致）；排他性由 flag 语义保证。
 * PR-083 归类：显式所有权家族——wx 即操作系统级 absent 声明（已存在即失败），无盲覆盖形态。
 * SPEC-028：read-only-evidence 落点强制 { flag:"wx", mode:0o444 }（声明胜于调用方记忆）；目录不封（红队 P1 修正）。
 */
function writeVaultExclusive(absPath, content, opts, fsOptions) {
  assertDefaultDestination(absPath); // SPEC-012 F1
  const effectiveOptions = enforceExclusiveWriteOptionsFor(defaultVaultPath, absPath, fsOptions);
  fs.writeFileSync(absPath, content, effectiveOptions || { flag: "wx" });
  scheduleLedgerSafe(opts && opts.domain, opts && opts.summary, absPath, opts && opts.noLedger);
  appendChannelLog(defaultVaultPath, absPath, content, opts && opts.domain, opts && opts.summary); // SPEC-012 F1 修订
  emitVaultWrite({ absPath, domain: opts && opts.domain, summary: opts && opts.summary }); // SPEC-012 WP-C
}

// ── SIGTERM/SIGINT 有序退出工厂 ──
// 在 main.cjs 调用：registerShutdownHandlers(vaultGitLedger, logger)
// handler 调 flush() 等待在途批次落账后再 exit(0)。
function registerShutdownHandlers(gitLedger, logger) {
  const log = logger || { info() {}, warn() {} };
  async function handler(signal) {    log.info({ event: "vault-io-shutdown-start", signal });
    try {
      if (typeof gitLedger.flush === "function") {
        await gitLedger.flush();
      }
    } catch (err) {
      log.warn({ event: "vault-io-shutdown-flush-failed", error: err.message });
    }
    log.info({ event: "vault-io-shutdown-done", signal });
    process.exit(0);
  }
  process.once("SIGTERM", () => handler("SIGTERM").catch(() => process.exit(0)));
  process.once("SIGINT",  () => handler("SIGINT").catch(() => process.exit(0)));
}

// ── 迁移完成记录（SPEC-011 WP0 → SPEC-012 WP-J 终态）──
// 25 个裸写点已全部经通道收口：contracts/vault-write-baseline.json 棘轮基线与第 21 号门禁
// （check:vault-write-channel）随 WP-J 退役，写禁令常驻 eslint.config.js server 块
// no-restricted-syntax error 规则（禁 fs.writeFile* 裸写，合法写者文件级豁免）。

module.exports = {
  createVaultIO, initVaultIO, recoverBootDrift, registerShutdownHandlers,
  writeVault, replaceVault, readVault, writeVaultExclusive, appendVaultJsonl, onVaultWrite,
  contentRevision, ABSENT_REVISION,
  appendChannelLog, channelLogPathFor, CHANNEL_LOG_REL,
  resetVaultIO,
};
