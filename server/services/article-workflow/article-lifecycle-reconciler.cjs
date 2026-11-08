// Component: Article-Lifecycle-Reconciler
// @responsible: PR-065/SPEC-013 L2——文章物理副本稳态对账（读时）＋文章退役动作（显式）。
//   稳态断言（Master 2026-10-15 裁「一篇＝标准文章×1＋原文归档×1」）：
//   已发布文章（正式区有快照）→ precleaned 工作副本退场（发布前它就是标准那份，发布后让位）；
//   退役动作：沿 source_file 链事务性全清（归档/工作副本/正式版/清单行）——TALOS archive 命令同构
//   （只读预演＋前置校验＋失败回移不留半态）。
// @inputs: vaultPath；正式区快照扫描；清单 store（derived-index）
// @outputs: reconcileWorkingCopies（读时对账，幂等）/ retireArticle（dryRun 预演＋事务性执行）
// @context: article-workflow 读路径（清单查询后触发，fail-open 只告警）；routes 显式退役端点

"use strict";

const fs = require("fs");
const { moveAtomic } = require("../../shared/repo-file-io.cjs");
const path = require("path");
const lifecycle = require("../../shared/article-lifecycle-paths.cjs");
const crypto = require("node:crypto");
const { loadDocument, docField } = require("../../shared/document-load-port.cjs");
// WP-138 R5b：frontmatter 派生键名经文档键源单点（本文件零手抄字段名清单）
const DK = require("../../shared/document-keys.cjs");
const { safeArticleDirectory } = require("./article-workflow-store.cjs");
const { getDerivedIndexStore } = require("../../shared/persistence/derived-index-store.cjs");
const { writeVault, writeVaultExclusive, ABSENT_REVISION } = require("../../shared/vault-io.cjs");

function createArticleLifecycleReconciler({ vaultPath, logger, removeDecisions, digestUploadTasks }) {
  const log = logger || { info() {}, warn() {}, error() {} };

  function invalidPath(message) {
    return Object.assign(new Error(message), { code: "VALIDATION_ERROR", status: 400 });
  }

  // 删除通道先核实角色归属，再逐层排除符号链接；不把受管路径字符串当成操作权限。
  // vault 根本身允许是部署别名，其下角色目录与目标不得借链接跳到其他位置。
  function assertManagedPath(target, root, file = false) {
    const absolute = path.resolve(target);
    const relative = path.relative(path.resolve(root), absolute);
    if ((file && !relative) || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
      throw invalidPath("退役目标不在指定文章角色目录内");
    }
    const vaultRelative = path.relative(path.resolve(vaultPath), absolute);
    if (vaultRelative === ".." || vaultRelative.startsWith(`..${path.sep}`) || path.isAbsolute(vaultRelative)) throw invalidPath("退役目标越出知识库");
    let current = path.resolve(vaultPath);
    const parts = vaultRelative.split(path.sep).filter(Boolean);
    for (let i = 0; i < parts.length; i += 1) {
      current = path.join(current, parts[i]);
      let stat;
      try { stat = fs.lstatSync(current); } catch (error) { if (error.code === "ENOENT") return; throw error; }
      if (stat.isSymbolicLink()) throw invalidPath("退役目标及其父目录不能是符号链接");
      if ((i < parts.length - 1 || !file) && !stat.isDirectory()) throw invalidPath("文章角色路径必须是目录");
      if (file && i === parts.length - 1 && !stat.isFile()) throw invalidPath("退役目标必须是文件");
    }
  }

  function documentText(raw, key) {
    const field = docField(loadDocument(raw), key);
    return field.state === "present" && typeof field.value === "string" ? field.value.trim() : "";
  }

  /** 正式快照单次扫描，供退场与显式退役共用同一身份匹配。 */
  function formalArticles() {
    const root = lifecycle.formalArticlesDir(vaultPath);
    assertManagedPath(root, root);
    const articles = [];
    let domainEntries;
    try { domainEntries = fs.readdirSync(root, { withFileTypes: true }); } catch (error) { if (error.code === "ENOENT") return articles; throw error; }
    for (const domainEntry of domainEntries) {
      if (!domainEntry.isDirectory()) continue;
      let entries;
      try { entries = fs.readdirSync(path.join(root, domainEntry.name), { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        let files;
        try { files = fs.readdirSync(path.join(root, domainEntry.name, entry.name), { withFileTypes: true }); } catch { continue; }
        for (const f of files) {
          if (!f.isFile() || !f.name.endsWith(".md")) continue;
          const absolute = path.join(root, domainEntry.name, entry.name, f.name);
          assertManagedPath(absolute, root, true);
          const raw = fs.readFileSync(absolute, "utf8");
          articles.push({ absolute, name: f.name, directoryId: entry.name, articleId: documentText(raw, DK.ARTICLE.articleId), hash: crypto.createHash("sha256").update(raw).digest("hex") });
        }
      }
    }
    return articles;
  }

  function matchingFormalArticles(basename, workingPath, articles) {
    const raw = workingPath ? fs.readFileSync(workingPath, "utf8") : null;
    const articleId = raw !== null ? documentText(raw, DK.ARTICLE.articleId) : "";
    const hash = raw !== null ? crypto.createHash("sha256").update(raw).digest("hex") : null;
    return articles.filter((article) => {
      // 正式字节保留源 article_id，目录可使用审批流自身 id；两者均是既有身份事实。
      if (articleId && (article.articleId ? article.articleId === articleId : article.directoryId === safeArticleDirectory(articleId))) return true;
      if (hash && article.hash === hash) return true;
      // source_file 仅标识原文来源，多篇拆分稿可同源，不能单凭它删除另一篇。
      // 兼容存量同名正式件；无工作件时支持用户直接按正式快照文件名退役。
      return article.name === basename && (!workingPath || (!articleId && !article.articleId && !/^[0-9a-f]{64}\.md$/.test(basename)));
    }).map((article) => article.absolute);
  }

  /**
   * 读时对账：已发布文章的 precleaned 工作副本退场（幂等；fail-open）。
   * 返回 { retired: [basename], skipped: n }。
   */
  function reconcileWorkingCopies() {
    const result = { retired: [], skipped: 0 };
    try {
      const published = formalArticles();
      const workingDir = lifecycle.workingDir(vaultPath);
      assertManagedPath(workingDir, workingDir);
      let files;
      try { files = fs.readdirSync(workingDir); } catch { return result; }
      for (const name of files) {
        if (!name.endsWith(".md")) continue;
        try {
          const workingAbs = path.join(workingDir, name);
          assertManagedPath(workingAbs, workingDir, true);
          if (matchingFormalArticles(name, workingAbs, published).length === 0) {
            result.skipped += 1;
            continue;
          }
          fs.rmSync(workingAbs);
          result.retired.push(name);
          log.info({ event: "lifecycle-working-copy-retired", name });
        } catch (error) {
          log.warn({ event: "lifecycle-working-copy-retire-failed", name, error: error.message });
          result.skipped += 1;
        }
      }
      if (result.retired.length > 0) {
        const store = getDerivedIndexStore(vaultPath);
        for (const name of result.retired) {
          try { store.articleManifests.delete(name.replace(/\.md$/, "")); } catch { /* 行级清单删除失败不阻断（孤儿对账另有兜底） */ }
        }
      }
    } catch (error) {
      log.warn({ event: "lifecycle-reconcile-failed", error: error.message });
    }
    return result;
  }

  /**
   * 文章退役（TALOS archive 命令同构）。
   * @param {{ basename: string, dryRun?: boolean }} input
   * @returns 预演返回清单；执行返回事务性结果（失败回移，不留半态）。
   */
  function retireArticle({ basename, dryRun = false }) {
    if (typeof basename !== "string" || !basename.endsWith(".md") || basename !== path.basename(basename) || /[\\/\0]/.test(basename)) {
      throw invalidPath("文章名须为不含路径的 .md 文件名");
    }
    const workingDir = lifecycle.workingDir(vaultPath);
    const workingPath = path.join(workingDir, basename);
    assertManagedPath(workingPath, workingDir, true);
    const hasWorking = fs.existsSync(workingPath);
    const formalPaths = matchingFormalArticles(basename, hasWorking ? workingPath : null, formalArticles());
    if (!hasWorking && formalPaths.length === 0) {
      throw Object.assign(new Error("文章不存在（工作区与正式区均无）"), { code: "ARTICLE_NOT_FOUND", status: 404 });
    }

    // 溯源锚：工作副本与正式版任一持有 source_file 即用（两级找锚——提升时锚先落草稿/
    // 工作副本，发布代次沿承；任一级缺都不阻断退役，缺锚只降级 warning）
    const anchorSource = readSourceFileAnchor(hasWorking ? workingPath : null) || readSourceFileAnchor(formalPaths[0] || null);
    if (anchorSource) {
      if (path.isAbsolute(anchorSource) || /[\\\0]/.test(anchorSource)) throw invalidPath("source_file 须为归档角色内的相对路径");
      assertManagedPath(path.join(vaultPath, anchorSource), lifecycle.archiveDir(vaultPath), true);
    }
    const plan = {
      basename,
      workingPath: hasWorking ? workingPath : null,
      formalPaths,
      archivePath: anchorSource,
      manifestKey: basename.replace(/\.md$/, ""),
      warnings: [],
    };
    if (!plan.archivePath) plan.warnings.push("未找到 source_file 溯源锚——归档副本不在本次清理范围（需人工确认）");
    if (plan.archivePath && !fs.existsSync(path.join(vaultPath, plan.archivePath))) plan.warnings.push("source_file 指向的归档件不存在（悬空）");

    if (dryRun) return { dryRun: true, plan };

    // 事务性执行：先全部「移入暂存」再提交删除；任一步失败 → 回移已暂存件，不留半态
    const staging = [];
    const undo = () => {
      for (const { from, to } of staging.reverse()) {
        try {
          // SPEC-028：read-only-evidence 落点（归档/正式代次）回滚禁更新写——原位已被搬空，
          // 以排他创建写原样重建（wx+0o444 由 vault-io 按档强制）；人可改档维持 PR-083 凭据制原路径
          const relFrom = path.relative(vaultPath, from).split(path.sep).join("/");
          if (lifecycle.resolveMutability(relFrom) === lifecycle.READ_ONLY_EVIDENCE) {
            if (fs.existsSync(to)) {
              const dir = path.dirname(from);
              try { if ((fs.statSync(dir).mode & 0o200) === 0) fs.chmodSync(dir, 0o755); } catch { /* 目录缺失由写报错 */ }
              writeVaultExclusive(from, fs.readFileSync(to), { domain: "workflow", summary: "退役回滚（只读档重建）" }); // 愈合不回封（P3 批口径）
            } else fs.rmSync(from, { recursive: true, force: true });
          } else if (fs.existsSync(to)) {
            // PR-083：原位文件已被移走，凭据声明 absent——若原位被并发占用则拒绝回滚（undo 失败留痕），不盲覆盖
            writeVault(from, fs.readFileSync(to), { expectedContentHash: ABSENT_REVISION, domain: "workflow", summary: "退役回滚" });
          } else fs.rmSync(from, { recursive: true, force: true });
        } catch (e) { log.error({ event: "lifecycle-retire-undo-failed", from, to, error: e.message }); }
      }
    };
    const stagingRootPath = path.join(vaultPath, ".ledger", ".retire-staging");
    const stageDir = path.join(stagingRootPath, crypto.randomUUID());
    assertManagedPath(stageDir, stagingRootPath);
    try {
      fs.mkdirSync(stageDir, { recursive: true });
      // 遗留不可写目录愈合（红队 P1 修订后现行口径＝目录不封）：目录属主无写位（缺陷批 0o555 等一切不可写态）时解锁搬移、不回封——退役即治愈遗留态（P3 批口径：原批回封属维持病灶）
      const moveTo = (abs, label) => {
        const dir = path.dirname(abs);
        try { if ((fs.statSync(dir).mode & 0o200) === 0) fs.chmodSync(dir, 0o755); } catch { /* 目录缺失由 rename 报错 */ }
        const dest = path.join(stageDir, label.replace(/[/\\]/g, "_"));
        moveAtomic(abs, dest);
        staging.push({ from: abs, to: dest });
      };
      if (plan.workingPath) moveTo(plan.workingPath, "working.md");
      for (let i = 0; i < plan.formalPaths.length; i += 1) moveTo(plan.formalPaths[i], `formal-${i}.md`);
      if (plan.archivePath && !plan.warnings.some((w) => w.includes("悬空"))) {
        moveTo(path.join(vaultPath, plan.archivePath), "archive.md");
      }
      // 提交：清单行删除（store 层原子）＋暂存目录整体清掉＋正式区空目录收尾
      const store = getDerivedIndexStore(vaultPath);
      store.articleManifests.delete(plan.manifestKey);
      fs.rmSync(stageDir, { recursive: true, force: true });
      // 父目录收尾：无并发退役时顺带清掉（有则留下，无害）
      const stagingRoot = path.dirname(stageDir);
      try { if (fs.existsSync(stagingRoot) && fs.readdirSync(stagingRoot).length === 0) fs.rmdirSync(stagingRoot); } catch { /* 无害 */ }
      for (const formalPath of plan.formalPaths) {
        // SPEC-030 派②两层收尾：articleId 目录删后，空域目录随之清（域下还有其他文章则保留）
        const dir = path.dirname(formalPath);
        try {
          if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
            fs.rmdirSync(dir);
            const domainDir = path.dirname(dir);
            if (fs.existsSync(domainDir) && fs.readdirSync(domainDir).length === 0) fs.rmdirSync(domainDir);
          }
        } catch { /* 空目录收尾失败无害 */ }
      }
      // 引用随源流转（2026-10-15 Master 批准）：沿链清关联决策行——源已退役，行成幽灵
      let associationsRemoved = 0;
      if (typeof removeDecisions === "function") {
        try { associationsRemoved = removeDecisions(basename); }
        catch (error) { log.warn({ event: "lifecycle-retire-associations-failed", basename, error: error.message }); }
      }
      // 方案 2：投稿任务消化（digested 终态）——退出追踪、保留台账
      let tasksDigested = 0;
      if (typeof digestUploadTasks === "function") {
        try { tasksDigested = digestUploadTasks(basename); }
        catch (error) { log.warn({ event: "lifecycle-retire-digest-failed", basename, error: error.message }); }
      }
      log.info({ event: "lifecycle-article-retired", basename, formal: plan.formalPaths.length, archive: Boolean(plan.archivePath), associationsRemoved, tasksDigested });
      return { retired: true, plan, associationsRemoved, tasksDigested };
    } catch (error) {
      undo();
      fs.rmSync(stageDir, { recursive: true, force: true });
      throw Object.assign(new Error(`退役失败已回滚：${error.message}`), { code: "RETIRE_FAILED", status: 500 });
    }
  }

  function readSourceFileAnchor(articlePath) {
    if (!articlePath) return null;
    return documentText(fs.readFileSync(articlePath, "utf8"), DK.ARTICLE.sourceFile) || null;
  }

  return { reconcileWorkingCopies, retireArticle };
}

module.exports = { createArticleLifecycleReconciler };
