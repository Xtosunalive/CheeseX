import { ApiError } from "@/lib/api";
import { create } from "zustand";
import { fetchArticleUploads, fetchCandidateFieldOptions, fetchPrecleanedArticle, fetchPrecleanedArticles, patchCandidateFields, promoteDraftArticle, standardizeArticle, uploadArticle, validateDraftArticle } from "./article-workflow-api";
import type { ArticleUploadList, ArticleUploadRequest, ArticleWorkflowTask, CandidateFieldCompletion, CandidateFieldOptions, DraftSkillOutcome, PrecleanedArticleDetail, PrecleanedArticleItem } from "./article-workflow-types";
import { errorMessageOf, requestFailed, requestLoading, requestSettled, type RequestStatus } from "@/lib/request-status";
import { ARTICLE_REQUEST_COPY } from "./article-workflow-copy";

type WorkflowState = {
  items: PrecleanedArticleItem[];
  uploads: ArticleWorkflowTask[];
  uploadTotal: number;
  uploadStatusCounts: ArticleUploadList["statusCounts"];
  /** WP-022 多用户并发防护：最近一次服务端确认的 workflow 修订号（乐观锁锚——写操作携带；409 时置 null 解锁并重读） */
  workflowRevision: number | null;
  lastScannedAt: string | null;
  selected: PrecleanedArticleDetail | null;
  latestTask: ArticleWorkflowTask | null;
  /** 主请求＝清单/详情加载 */
  status: RequestStatus;
  error: string | null;
  /** 写侧（上传/保存字段/标准化/选项加载）各自 busy 旗，失败统一落 operationError */
  submitting: boolean;
  updatingIds: string[];
  skillRunningIds: string[];
  skillOutcomes: Record<string, DraftSkillOutcome>;
  fieldOptions: CandidateFieldOptions | null;
  fieldOptionsLoading: boolean;
  savingFields: boolean;
  operationError: string | null;
  initialize: (silent?: boolean) => Promise<void>;
  reload: (silent?: boolean) => Promise<void>;
  submitUpload: (payload: ArticleUploadRequest) => Promise<boolean>;
  openArticle: (id: string) => Promise<void>;
  closeArticle: () => void;
  standardize: (id: string) => Promise<void>;
  runStandardizationSkill: (task: ArticleWorkflowTask) => Promise<void>;
  /** 按草稿路径执行本地标准化（工作草稿行内动作 2026-10-15 Master 裁）：与 runStandardizationSkill 同链路
   *  （validate→promote→reload），供行内按钮消费——避免为行内场景伪造 task 对象。 */
  runStandardizationSkillByPath: (draftPath: string, key: string) => Promise<void>;
  loadFieldOptions: () => Promise<void>;
  saveCandidateFields: (id: string, fields: CandidateFieldCompletion) => Promise<boolean>;
};

function message(error: unknown): string {
  return errorMessageOf(error, ARTICLE_REQUEST_COPY.REQUEST_FAILED);
}

export const useArticleWorkflowStore = create<WorkflowState>((set, get) => ({
  items: [],
  uploads: [],
  uploadTotal: 0,
  uploadStatusCounts: { awaiting_architect_processing: 0, awaiting_approval: 0, standardized: 0, published: 0, source_deleted: 0, digested: 0 },
  workflowRevision: null,
  lastScannedAt: null,
  selected: null,
  latestTask: null,
  status: "idle",
  error: null,
  submitting: false,
  updatingIds: [],
  skillRunningIds: [],
  skillOutcomes: {},
  fieldOptions: null,
  fieldOptionsLoading: false,
  savingFields: false,
  operationError: null,

  initialize: async (silent = false) => {
    // silent=静默重载：保留现有 status/error 直至结果落账（不闪断横幅，也不出现 status≠error 却清 error 的半态）
    if (!silent) set(requestLoading());
    try {
      const [list, history] = await Promise.all([fetchPrecleanedArticles(), fetchArticleUploads()]);
      set({ items: list.items, uploads: history.items, uploadTotal: history.total, uploadStatusCounts: history.statusCounts, lastScannedAt: list.generatedAt, ...requestSettled(list.items.length === 0) , workflowRevision: (history as { revision?: number }).revision ?? get().workflowRevision});
    } catch (error) { set(requestFailed(error, ARTICLE_REQUEST_COPY.REQUEST_FAILED)); }
  },
  reload: async (silent = false) => {
    return get().initialize(silent);
  },
  submitUpload: async (payload) => {
    set({ submitting: true, operationError: null, latestTask: null });
    try {
      const latestTask = await uploadArticle(payload, get().workflowRevision ?? undefined);
      set((state) => ({
        latestTask,
        submitting: false,
        uploads: [latestTask, ...state.uploads.filter((task) => task.taskId !== latestTask.taskId)].slice(0, 50),
        workflowRevision: (latestTask as unknown as { revision?: number }).revision ?? state.workflowRevision,
        uploadTotal: state.uploadTotal + 1,
        uploadStatusCounts: { ...state.uploadStatusCounts, awaiting_architect_processing: state.uploadStatusCounts.awaiting_architect_processing + 1 },
      }));
      // WP-038（Master 2026-10-29「校验和提升肯定自动跑」）：.md 投稿上传成功即自动链跑本地标准化
      // Skill——复用行内同款动作（validate→promote→reload＋skillOutcomes 结果卡）；非 .md 由动作内
      // guard 跳过（校验器物理只收 raw/drafts 下 .md，pdf 等维持等架构师摄取）。fire-and-forget：
      // 动作内部自捕错入结果卡，不阻塞投稿坞返回。
      void get().runStandardizationSkill(latestTask);
      return true;
    } catch (error) {
      // WP-022：409 修订冲突——解锁（下次写不带锁）＋立即重读拿新状态，操作不自动重试（人看新状态再决定）
      if (error instanceof ApiError && error.errorCode === "WORKFLOW_REVISION_CONFLICT") {
        set({ workflowRevision: null, submitting: false, operationError: ARTICLE_REQUEST_COPY.REVISION_CONFLICT });
        await get().reload(true);
        return false;
      }
      set({ operationError: message(error), submitting: false }); return false;
    }
  },
  openArticle: async (id) => {
    set(requestLoading());
    try { set({ selected: await fetchPrecleanedArticle(id), ...requestSettled() }); }
    catch (error) { set(requestFailed(error, ARTICLE_REQUEST_COPY.REQUEST_FAILED)); }
  },
  closeArticle: () => set({ selected: null }),
  // 字段补齐表单（腿B）：选项来自 Vault 权威枚举；打开候选时惰性加载一次。
  loadFieldOptions: async () => {
    if (get().fieldOptions || get().fieldOptionsLoading) return;
    set({ fieldOptionsLoading: true });
    try { set({ fieldOptions: await fetchCandidateFieldOptions(), fieldOptionsLoading: false }); }
    catch (error) { set({ operationError: message(error), fieldOptionsLoading: false }); }
  },
  saveCandidateFields: async (id, fields) => {
    set({ savingFields: true, operationError: null });
    try {
      const updated = await patchCandidateFields(id, fields);
      set((state) => ({
        selected: updated,
        items: state.items.map((item) => (item.id === updated.id ? { ...item, ...updated } : item)),
        savingFields: false,
      }));
      return true;
    } catch (error) { set({ operationError: message(error), savingFields: false }); return false; }
  },
  // 目标态主链：标准化校验通过后文章即可检索阅读；ERROR 阻断和 WARNING 计数由后端返回。
  standardize: async (id) => {
    set((state) => ({ updatingIds: [...new Set([...state.updatingIds, id])], operationError: null }));
    try {
      const updated = await standardizeArticle(id);
      set((state) => ({
        items: state.items.map((item) => (item.id === updated.id ? updated : item)),
        selected: state.selected && state.selected.id === updated.id ? { ...state.selected, ...updated } : state.selected,
        updatingIds: state.updatingIds.filter((candidate) => candidate !== id),
      }));
    } catch (error) {
      set((state) => ({ operationError: message(error), updatingIds: state.updatingIds.filter((candidate) => candidate !== id) }));
    }
  },
  // 本地标准化 Skill（验收 :20-21）：validateDraft（打标+收集问题）→ promoteDraft（结构门禁裁定）→ reload。
  // 字段缺失不拦截晋升（方案-promote不阻塞：字段问题随候选上报待处理问题补齐）；
  // 仅真结构问题（文件不存在/解析失败/source_file 缺失）由 promote 端点拒绝并展示错误。
  runStandardizationSkill: async (task) => {
    if (!task.draftPath || !/\.md$/i.test(task.draftPath)) return;
    await get().runStandardizationSkillByPath(task.draftPath, task.taskId);
  },
  runStandardizationSkillByPath: async (draftPath, key) => {
    if (!draftPath || !/\.md$/i.test(draftPath)) return;
    set((state) => ({ skillRunningIds: [...new Set([...state.skillRunningIds, key])], operationError: null }));
    try {
      // WP-022 红队#5：validate 段带锁（建任务态的并发面在它）；promote 段**不带锁**——validate 成功已推进
      // revision，第二段带旧锚必 409（单用户正常流首跑被误杀）。promote 的并发冲突由服务层文件操作幂等性
      // 与读时对账兜底（synchronizedState），并发写任务账的竞争面留 #7 收敛写带锁批
      const validate = await validateDraftArticle(draftPath, get().workflowRevision ?? undefined);
      const promote = await promoteDraftArticle(draftPath);
      set((state) => ({
        skillOutcomes: { ...state.skillOutcomes, [key]: { stage: "done", validate, promote, errorMessage: null } },
        skillRunningIds: state.skillRunningIds.filter((id) => id !== key),
      }));
      await get().reload(true);
    } catch (error) {
      set((state) => ({
        skillOutcomes: { ...state.skillOutcomes, [key]: { stage: "promote", validate: null, promote: null, errorMessage: message(error) } },
        skillRunningIds: state.skillRunningIds.filter((id) => id !== key),
      }));
    }
  },
}));
