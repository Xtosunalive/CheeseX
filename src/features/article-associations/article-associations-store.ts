import { create } from "zustand";
import { fetchArticleAssociations, previewArticleAssociation, saveArticleAssociation } from "./article-associations-api";
import type { ArticleAssociationData, ArticleAssociationPreviewData, AssociationAction } from "./article-associations-types";
import { errorMessageOf, requestFailed, requestLoading, requestSettled, type RequestStatus } from "@/lib/request-status";
import { AA_REQUEST_COPY } from "./article-associations-copy";

type State = {
  data: ArticleAssociationData | null; preview: ArticleAssociationPreviewData | null;
  /** 主请求＝关联数据加载与预览（同一条请求线） */
  status: RequestStatus; error: string | null;
  /** 写侧＝保存/移除失效决策：saving 旗＋独立错误位 */
  saving: boolean; operationError: string | null;
  articleId: string; action: AssociationAction; componentIds: string[]; versionIds: string[];
  load: () => Promise<void>; runPreview: () => Promise<void>; save: () => Promise<void>;
  setArticleId: (value: string) => void; setAction: (value: AssociationAction) => void; setComponentIds: (value: string[]) => void; setVersionIds: (value: string[]) => void;
};

function formFor(data: ArticleAssociationData, articleId: string) {
  const current = data.currentAssociations.filter((item) => item.articleId === articleId);
  const versionIds = current.flatMap((association) => {
    const option = data.versionOptions.find((item) => item.product === association.product && item.version === association.version_since);
    return option ? [option.id] : [];
  });
  return {
    articleId,
    action: "replace" as AssociationAction,
    componentIds: [...new Set(current.flatMap((item) => item.component_id ? [item.component_id] : []))],
    versionIds: [...new Set(versionIds)],
  };
}

export const useArticleAssociationsStore = create<State>((set, get) => ({
  data: null, preview: null, status: "idle", error: null, saving: false, operationError: null, articleId: "", action: "replace", componentIds: [], versionIds: [],
  load: async () => { set(requestLoading()); try { const data = await fetchArticleAssociations(); const articleId = get().articleId || data.articles[0]?.articleId || ""; set({ data, ...formFor(data, articleId), ...requestSettled(data.articles.length === 0) }); } catch (error) {
    if (error instanceof Error && error.message === "NO_CURRENT_RELEASE") {
      // 发布前常态（SPEC-029）：无正式版本 → 空态引导，不是错误
      set({ data: null, preview: null, status: "empty", error: null });
      return;
    }
    set(requestFailed(error, AA_REQUEST_COPY.LOAD_FAILED));
  } },
  runPreview: async () => { const state = get(); if (!state.data || !state.articleId) return; set(requestLoading()); try { const preview = await previewArticleAssociation({ revision: state.data.revision, articleId: state.articleId, action: state.action, componentIds: state.componentIds, versionIds: state.versionIds }); set({ preview, ...requestSettled() }); } catch (error) { set({ preview: null, ...requestFailed(error, AA_REQUEST_COPY.PREVIEW_FAILED) }); } },
  save: async () => { const state = get(); if (!state.data || !state.articleId || !state.preview) return; set({ saving: true, operationError: null }); try { await saveArticleAssociation({ revision: state.preview.fileRevision, articleId: state.articleId, action: state.action, componentIds: state.componentIds, versionIds: state.versionIds }); set({ preview: null, saving: false }); } catch (error) { set({ saving: false, operationError: errorMessageOf(error, AA_REQUEST_COPY.SAVE_FAILED) }); } },
  setArticleId: (articleId) => { const data = get().data; set(data ? { ...formFor(data, articleId), preview: null } : { articleId, preview: null }); },
  setAction: (action) => set({ action, preview: null }),
  setComponentIds: (componentIds) => set({ componentIds, preview: null }),
  setVersionIds: (versionIds) => set({ versionIds, preview: null }),
}));
