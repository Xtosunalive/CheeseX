// Component: Draft-Drop-Automation
// @responsible: WP-041——vault 监听外部写 → 投稿草稿自动校验＋提升（Obsidian 投放与网页上传同一条自动链）。
//   触发判定：vault 相对路径命中 知识库/raw/drafts/ 下的 .md 且文件仍在盘（unlink 事件跳过）；
//   串行链：validateDraft（建头信息＋archive 溯源锚＋校验戳＋自动补默认字段）→ promoteDraft（拷入
//   precleaned＋删草稿）。防自激由监听器归属判定兜底（系统写早退于桥接）；本模块再加 in-flight
//   去重防同文件突发多事件重复跑链。
// @inputs: vaultWatcher onExternalWrite 桥（main.cjs 装配）＋articleWorkflowService 既有动作
// @outputs: raw/precleaned/ 候选＋任务账建态＋logger 事件 draft-drop-automation-*
// @context: SPEC-013 触发时序（Master 2026-10-29「接」——触发器两处：网页上传回调＋监听器外部写）

"use strict";

const fs = require("fs");
const path = require("path");
const articleLifecycle = require("../../shared/article-lifecycle-paths.cjs");

function createDraftDropAutomation({ vaultPath, articleWorkflowService, logger }) {
  const log = logger || { info() {}, warn() {}, error() {} };
  const inFlight = new Set();

  function toVaultRelative(absPath) {
    try { return path.relative(vaultPath, absPath).split(path.sep).join("/"); }
    catch (_error) { return null; }
  }

  /** 命中判定：drafts 根下 .md 且当前仍在盘（link 断/unlink 事件不算投放）。 */
  function isDroppedDraftMd(absPath) {
    if (typeof absPath !== "string" || !absPath.endsWith(".md")) return false;
    const rel = toVaultRelative(absPath);
    if (!rel || !articleLifecycle.isUnderDraft(rel)) return false;
    let stat;
    try { stat = fs.statSync(absPath); } catch (_error) { return false; }
    return stat.isFile();
  }

  async function runChain(absPath) {
    const rel = toVaultRelative(absPath);
    log.info({ event: "draft-drop-automation-started", path: rel });
    try {
      // 结构性失败（校验器不可用 fail-closed 等）由 validateDraft 抛出——文件保留，仅留痕
      await articleWorkflowService.validateDraft(rel);
      await articleWorkflowService.promoteDraft(rel, true);
      log.info({ event: "draft-drop-automation-done", path: rel });
    } catch (error) {
      // 不外抛不阻塞后续事件：投放件保留原位，失败可见（网页重传/手动链仍可重试）
      log.warn({ event: "draft-drop-automation-failed", path: rel, error: error && error.message });
    }
  }

  return {
    /** 监听桥消费者：批量路径逐个判定；同文件在链中则跳过（去抖由 in-flight 承担）。 */
    async onExternalWrite(paths) {
      for (const absPath of Array.isArray(paths) ? paths : [paths]) {
        if (!isDroppedDraftMd(absPath)) continue;
        if (inFlight.has(absPath)) continue;
        inFlight.add(absPath);
        try { await runChain(absPath); }
        finally { inFlight.delete(absPath); }
      }
    },
    isDroppedDraftMd,
  };
}

module.exports = { createDraftDropAutomation };
