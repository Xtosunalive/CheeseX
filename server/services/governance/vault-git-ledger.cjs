// Component: Vault-Git-Ledger
// @responsible: vault 仓写后 git 落账（SPEC-010-W10 WP2）——写成功后异步 add+commit+push，
//   失败只告警不回滚（git 是版本史不是写前置）。
// @inputs: vaultPath、变更路径集（绝对或 vault 相对）、写者域标签、摘要
// @outputs: scheduleLedger(domain, summary, files)（异步，不阻塞调用方）；flush()（测试用）
// @context: Vault（cheese 仓，北极星"源=代码·Git 管版本"前提兑现）
//
// 设计决策（SPEC-010-W10 §二）：
// - 不阻塞用户请求：写请求的成功语义不变，落账在响应返回后异步执行；
// - 失败只告警：git 落账失败记 logger.warn，不回滚已成功的 vault 写、不向调用方抛错；
// - 合并窗口：同一写者域短时间内的多次写合并为一笔提交（防提交风暴），窗口 windowMs（默认 1s）；
// - 提交信息规范：`<写者域>: <一句话变更>`（SPEC-010 §二）；
// - push 尽力而为：本地提交成功后尝试 push，远端不可达只告警（远端=备份性质）；
// - 干净即跳过：目标路径无变更时不产空提交（幂等；变更已被外部提交/还原时静默跳过）；
// - git 身份显式制：构造即预检——缺显式身份（user.name/user.email 配置任意层级，或 GIT_AUTHOR_*＋
//   GIT_COMMITTER_* 四个环境变量）只告警一次并附补救命令；提交带 user.useConfigOnly=true 封死
//   按登录名＋主机名自动猜测的假署名。原则同 scripts/vault-init.mjs probeGitIdentity（init 路径
//   fail-closed；克隆路径绕过那道门，由本预检把缺口提前到 boot 即暴露，不等每笔落账失败才现形）；
// - 测试注入：options.gitRunner 可替换（单测不依赖真实 git）；VAULT_GIT_LEDGER_DISABLE=1 全局停用。

const { execFile } = require("node:child_process");
const path = require("node:path");

const DEFAULT_WINDOW_MS = 1000;

function createVaultGitLedger(options) {
  const vaultPath = path.resolve(options.vaultPath);
  const logger = options.logger || { info() {}, warn() {}, error() {} };
  const gitRunner = options.gitRunner || function runGit(args, cb) {
    execFile("git", args, { cwd: vaultPath, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }, cb);
  };
  const windowMs = typeof options.windowMs === "number" ? options.windowMs : DEFAULT_WINDOW_MS;

  if (process.env.VAULT_GIT_LEDGER_DISABLE === "1") {
    return {
      scheduleLedger() {},
      flush() { return Promise.resolve(); },
      markSystemFile() {},
      isSystemFile() { return false; },
    };
  }

  // WP-J 系统文件静态登记（SPEC-012 退役批）：TTL in-flight 时间窗随 watcher 归属改通道写日志取证而失业；
  // 保留极简 systemFiles 集合承载两类防误记——⑤类系统文件（channel-write-log/state-journal 自身写
  // 不在通道日志，写者写前登记）与 boot 迁移改名/删除（非通道写，导入器登记）。
  // 语义从「时间窗」变「登记即系统文件」：这些路径生命周期与进程同寿，无过期需求。
  const systemFiles = new Set();

  function markSystemFile(paths) {
    for (const p of (Array.isArray(paths) ? paths : [paths])) {
      if (typeof p === "string" && p) {
        systemFiles.add(path.resolve(path.isAbsolute(p) ? p : path.join(vaultPath, p)));
      }
    }
  }

  function isSystemFile(absPath) {
    return typeof absPath === "string" && systemFiles.has(path.resolve(absPath));
  }

  // 合并窗口状态：batch = { files:Set, domain, summary, timer }；flush 独占取走并清空
  let batch = null;

  function runGit(args) {
    return new Promise((resolve, reject) => {
      gitRunner(args, (error, stdout, stderr) => {
        if (error) {
          error.stderr = stderr;
          reject(error);
        } else {
          resolve(stdout);
        }
      });
    });
  }

  // ── git 身份预检（2026-10-27 直修批）──
  // 克隆路径没有 vault:init 的 fail-closed 身份门；机器全局有意不配身份、vault 仓也未配时，
  // 自动落账全断且只以每笔 warn 的形态迟到暴露（本机 2026-10-23 起静默断账的实录）。
  // 只认显式来源（与 scripts/vault-init.mjs probeGitIdentity 同原则）；经 gitRunner 探测（测试可注入）。
  const IDENTITY_ENV_KEYS = ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"];
  (async function probeIdentity() {
    if (IDENTITY_ENV_KEYS.every((k) => process.env[k] && String(process.env[k]).trim())) return;
    const [name, email] = await Promise.all([
      runGit(["config", "--get", "user.name"]).catch(() => ""),
      runGit(["config", "--get", "user.email"]).catch(() => ""),
    ]);
    if ((name || "").trim() && (email || "").trim()) return;
    logger.warn({
      event: "vault-git-ledger-identity-missing",
      hint: "vault 自动落账将全部失败（git commit 拒绝提交）。补救：在 vault 仓内 git config user.name \"…\"＋git config user.email \"…\"（仓库级即可，不动全局），或设 GIT_AUTHOR_*＋GIT_COMMITTER_* 四个环境变量；同 scripts/vault-init.mjs 身份原则",
    });
  })().catch(() => { /* 预检自身失败不改变落账语义（仍由 commit 失败告警兜底） */ });

  async function flush() {
    const current = batch;
    batch = null;
    if (current) {
      if (current.timer) clearTimeout(current.timer);
      await commitBatch(current);
    }
    // 等待已在途的落账完成（测试退出前收尾用）
    while (batch) {
      const next = batch;
      batch = null;
      if (next.timer) clearTimeout(next.timer);
      await commitBatch(next);
    }
  }

  async function commitBatch(current) {
    const files = [...current.files];
    try {
      // 状态探针：变更已被外部提交/还原时不产空账
      const statusOut = await runGit(["status", "--porcelain", "--", ...files]);
      if (!statusOut.trim()) {
        logger.info({ event: "vault-git-ledger-skip-clean", domain: current.domain });
        return;
      }
      await runGit(["add", "--", ...files]);
      // user.useConfigOnly：宁失败不假署名——封死 git 按登录名＋主机名自动猜身份（vault-init 同款）；
      // 显式 config/env 身份不受影响，猜测身份从「静默进历史」变「提交失败告警」。
      await runGit(["-c", "user.useConfigOnly=true", "commit", "-m", `${current.domain}: ${current.summary}`]);
      try {
        await runGit(["push"]);
      } catch (pushError) {
        // 远端备份尽力而为：本地已提交即落账成立，push 失败只告警
        logger.warn({ event: "vault-git-ledger-push-failed", domain: current.domain, error: pushError.message });
      }
      logger.info({ event: "vault-git-ledger-committed", domain: current.domain, files: files.length, summary: current.summary });
    } catch (error) {
      logger.warn({ event: "vault-git-ledger-failed", domain: current.domain, files: files.length, error: error.message });
    }
  }

  function scheduleLedger(domain, summary, files) {
    const list = (Array.isArray(files) ? files : [files]).filter((f) => typeof f === "string" && f !== "");
    if (!list.length) return;
    const rel = list.map((f) => (path.isAbsolute(f) ? path.relative(vaultPath, f) : f));
    // 同域合流进当前窗口；异域先冲掉旧窗口（旧批立即落，新城开新窗）
    if (!batch || batch.domain !== domain) {
      if (batch) {
        const old = batch;
        batch = null;
        if (old.timer) clearTimeout(old.timer);
        commitBatch(old); // 异步落旧批，不等它
      }
      batch = { files: new Set(), domain, summary, timer: null };
    }
    for (const f of rel) batch.files.add(f);
    // 摘要取最新一次（窗口内最后一次写的语义）
    batch.summary = summary || batch.summary;
    if (batch.timer) clearTimeout(batch.timer);
    batch.timer = setTimeout(() => { flush().catch(() => {}); }, windowMs);
  }

  return { scheduleLedger, flush, markSystemFile, isSystemFile };
}

module.exports = { createVaultGitLedger };
