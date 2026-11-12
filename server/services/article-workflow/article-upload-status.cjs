// @responsible: 依据投稿源、候选状态（机②）与审批状态（机①）同步并汇总文章上传任务状态。
// @context: SPEC-030 派生①——任务状态是派生投影（不设自身转移，读时聚合；唯一持久特例 digested）。
//   聚合规则唯一事实源＝SPEC-030 §三派生①聚合表（含发布后退场勘误：工作副本退场后由
//   历史 articleIds 的审批态判定 published，勿在候选集上单算）。
const fs = require("node:fs");
const articleLifecycle = require("../../shared/article-lifecycle-paths.cjs");
const path = require("node:path");

// 任务态六值（SPEC-030 派①值域；processing/completed 死态已删，published 接管 completed 真实语义）
const TASK_STATUSES = ["awaiting_architect_processing", "awaiting_approval", "standardized", "published", "source_deleted", "digested"];

function syncUploadTasks(tasks, articles, sourceByArticleId, vaultPath, approvalStatusOf) {
  let changed = false;
  const articlesByDraftPath = new Map();
  articles.forEach(function (article) {
    const sourceDraftPath = sourceByArticleId.get(article.id);
    if (!sourceDraftPath) return;
    const matches = articlesByDraftPath.get(sourceDraftPath) || [];
    matches.push(article);
    articlesByDraftPath.set(sourceDraftPath, matches);
  });
  // WP-169 红队P1-1 实证补：本地草稿可落 drafts 根或任意子目录（含 本地草稿/），归档 lane 统一
  // 「本地草稿」无法还原原位——归一产物固定 drafts 根形态，任务键在子目录时直配失配。
  // 兜底＝非投稿任务按文件名在根/子目录两候选试探（lane 语义＝非投稿 drafts；同名跨子目录取首个，边界已注）。
  const localLaneMatches = function (task) {
    if (articleLifecycle.isSubmissionDraft(task.draftPath)) return [];
    const base = task.draftPath.split("/").pop();
    for (const key of [`${articleLifecycle.DRAFT_ROOT}/${base}`, `${articleLifecycle.LOCAL_DRAFT_PREFIX}${base}`]) {
      if (articlesByDraftPath.has(key)) return articlesByDraftPath.get(key);
    }
    return [];
  };
  tasks.forEach(function (task) {
    const matches = (articlesByDraftPath.get(task.draftPath) || localLaneMatches(task)).slice().sort((left, right) => left.sourcePath.localeCompare(right.sourcePath));
    const precleanedPaths = matches.map((article) => article.sourcePath);
    const articleIds = matches.map((article) => article.id);
    const next = {
      precleanedPath: precleanedPaths[0] || null,
      precleanedPaths,
      articleIds,
      candidateCount: matches.length,
      status: uploadTaskStatus(matches, task, vaultPath, approvalStatusOf),
    };
    if (task.precleanedPath !== next.precleanedPath
      || task.status !== next.status
      || task.candidateCount !== next.candidateCount
      || !sameStrings(task.precleanedPaths, next.precleanedPaths)
      || !sameStrings(task.articleIds, next.articleIds)) {
      Object.assign(task, next, { updatedAt: latestWorkflowTime(task.createdAt, matches) });
      changed = true;
    }
  });
  return { changed };
}

// 审批态探针（机①→派生①单向读）：缺省/异常一律 null＝按未发布处理（fail-safe——
// 探针不可用不虚报 published；digested 终态在探针之前短路，不受影响）
function probeApprovalStatus(approvalStatusOf, articleId) {
  if (typeof approvalStatusOf !== "function" || typeof articleId !== "string" || !articleId) return null;
  try {
    const status = approvalStatusOf(articleId);
    return typeof status === "string" && status ? status : null;
  } catch (_error) {
    return null;
  }
}

// 投稿任务状态聚合（SPEC-030 §三派①聚合表）：
// ① digested＝退役消化终态，只由 retireArticle 显式置位，读时聚合不回改（append-only 台账语义）。
// ② 有候选匹配时跟候选＋审批走；候选集空的两种形态分治——
//    曾有产物（articleIds 非空）＝发布后退场（reconcileWorkingCopies 删工作副本后候选消失）或
//    产物被删：查历史 articleIds 的审批态，任一 snapshot → published（投稿的知识产出已发布），
//    否则 source_deleted；从未有候选＝看投稿源文件存在性。
function uploadTaskStatus(matches, task, vaultPath, approvalStatusOf) {
  if (task.status === "digested") return "digested";
  if (matches.length === 0) {
    const historicalIds = Array.isArray(task.articleIds) ? task.articleIds.filter((id) => typeof id === "string" && id) : [];
    if (historicalIds.length > 0) {
      const published = historicalIds.some((id) => probeApprovalStatus(approvalStatusOf, id) === "snapshot");
      return published ? "published" : "source_deleted";
    }
    const draftExists = draftSourceExists(task.draftPath, vaultPath);
    if (draftExists === false) return "source_deleted";
    return "awaiting_architect_processing";
  }
  if (matches.some((article) => article.standardizationStatus === "pending_standardization" || article.standardizationStatus === "blocked")) {
    return "awaiting_approval";
  }
  // 全部候选 standardized：全部关联审批达 snapshot 才算投稿整体发布（多候选一投稿语义）
  const allPublished = matches.every((article) => probeApprovalStatus(approvalStatusOf, article.id) === "snapshot");
  return allPublished ? "published" : "standardized";
}

// 投稿源文件存在性检查；未传 vaultPath（纯函数调用/旧签名）时不判定，视为存在。
function draftSourceExists(draftPath, vaultPath) {
  if (!vaultPath || typeof draftPath !== "string" || !draftPath.trim()) return true;
  const normalized = normalizeDraftSourcePath(draftPath);
  if (!normalized) return true;
  return fs.existsSync(path.join(vaultPath, ...normalized.split("/")));
}

function latestWorkflowTime(createdAt, articles) {
  return articles.flatMap((article) => [article.updatedAt, article.validatedAt, article.approvedAt, article.submittedAt, article.completedAt])
    .filter((value) => typeof value === "string" && Number.isFinite(Date.parse(value)))
    .reduce((latest, value) => Date.parse(value) > Date.parse(latest) ? value : latest, createdAt);
}

function normalizeDraftSourcePath(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim().replaceAll("\\", "/").replace(/^\.\//, "").replace(/^\//, "");
  const vaultRelative = normalized.startsWith("知识库/") ? normalized : normalized.startsWith("raw/") ? "知识库/" + normalized : null;
  if (vaultRelative && articleLifecycle.isUnderDraft(vaultRelative)) return vaultRelative;
  const archiveMatch = vaultRelative ? vaultRelative.match(new RegExp(`^${articleLifecycle.ARCHIVE_ROOT}/(投稿|本地草稿|通用)/(?:[0-9a-f]{64}-)+([^/]+)$`)) : null;
  if (archiveMatch) {
    return (archiveMatch[1] === "本地草稿" ? `${articleLifecycle.DRAFT_ROOT}/` : articleLifecycle.SUBMISSION_DRAFT_PREFIX) + archiveMatch[2];
  }
  return null;
}

function normalizeUploadStatus(value) {
  return TASK_STATUSES.includes(value) ? value : "awaiting_architect_processing";
}

function countUploadStatuses(tasks) {
  return tasks.reduce((counts, task) => {
    counts[task.status] += 1;
    return counts;
  }, Object.fromEntries(TASK_STATUSES.map((status) => [status, 0])));
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string" && item.trim()).map((item) => item.trim()) : [];
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

module.exports = { countUploadStatuses, normalizeDraftSourcePath, normalizeUploadStatus, stringArray, syncUploadTasks, uploadTaskStatus, TASK_STATUSES };
