// Component: Status-Event-Writer
// @responsible: 问题状态机事件 → 实体/文章 frontmatter status 迁移写回（2026-10-08 字段托管）。
// @inputs: sourceKey（Vault 相对路径）、事件（confirm-verified / reject / reopen / manualoffline / rejected）
// @outputs: 迁移后的 status（写回源文档 frontmatter，走 status-transition-guard 合法性校验）
// @context: anomaly-workbench-service 事件内部驱动（verified 印章/reject 落账/reopen 重开）——不新增审批界面与端点。
//
// 幂等与安全：
// - 读现值 → 归一（存量旧值域映射）→ 守卫校验（非法迁移 409 不落盘）→ patchFrontmatter 原子写回
// - 文件不存在/非受管路径/UNSAFE（注释行手改痕迹）→ 静默跳过（哨兵规则 F12/F13/F15 会在诊断侧报「疑被手改」）
const fs = require("fs");
const path = require("path");
// WP-116 批2（SPEC-083 §二.3）：装载/补丁经文档装载端口出口（loadDocument＝宿主 parseEntityDocument
// 同底座委托，null 原型不变；patchFrontmatter 纯转发）——消费面禁直 require 宿主。
const { loadDocument, patchFrontmatter } = require("../../shared/document-load-port.cjs");
const { assertTransition, EVENT_TARGETS } = require("../../shared/status-transition-guard.cjs");
const { writeVault, writeVaultExclusive, readVault } = require("../../shared/vault-io.cjs");
const articleLifecycle = require("../../shared/article-lifecycle-paths.cjs"); // PR-057：vault 唯一写通道（原子写＋归属取证日志；noLedger=记账归属维持现状）

function writeStatusByEvent(vaultPath, sourceKey, event) {
  if (!vaultPath || !sourceKey || !EVENT_TARGETS[event]) return null;
  const abs = path.resolve(vaultPath, sourceKey);
  // 受管边界：仅 entities / raw/precleaned / raw/drafts
  const normalized = sourceKey.split("/").join("/");
  if (!(normalized.startsWith("知识库/wiki/entities/") || articleLifecycle.isUnderWorking(normalized) || articleLifecycle.isUnderDraft(normalized))) return null;
  if (!fs.existsSync(abs)) return null;
  let raw;
  let baseRevision;
  try { ({ content: raw, sha256: baseRevision } = readVault(abs)); } catch (_e) { return null; }
  const doc = loadDocument(raw, abs);
  const current = doc.frontmatter || {};
  // WP-049 余量批：旧值映射单源＝TheSchema（status-domain／装载端口）
  const from = (typeof current.status === "string" ? require("../../shared/status-domain.cjs").normalizeStatus(current.status.trim(), vaultPath) : "");
  let next;
  try { next = assertTransition({ from: from || "", event }); }
  catch (_e) { return null; } // 非法迁移（如 已驳回→在线）静默不落盘——审计侧状态不迁移，人工复核
  if (!next || next === from) return from; // 幂等：无需写
  try {
    const nextRaw = patchFrontmatter(raw, { status: next, updated: new Date().toISOString().slice(0, 10) }, {});
    writeVault(abs, nextRaw, { expectedContentHash: baseRevision, domain: "anomaly", summary: "状态事件回写" }); // SPEC-012 WP-I＋PR-083 凭据（冲突并入静默跳过——外部对账兜底）
    return next;
  } catch (_e) { return null; }
}

module.exports = { writeStatusByEvent };
