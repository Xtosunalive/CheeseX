import { useEffect } from "react";
import { AlertTriangle } from "lucide-react";
import { AssociationDecisionList, AssociationDecisionPanel, AssociationPreview } from "./components";
import { useArticleAssociationsStore } from "./article-associations-store";
import { getNavQueryParam } from "@/lib/navigation";
import { PageContainer } from "@/components/page-container";
import { Panel } from "@/components/panel";
import { AA_VIEW_COPY } from "./article-associations-copy";

export function ArticleAssociationsView({ embedded = false }: { embedded?: boolean }) {
  const store = useArticleAssociationsStore();
  useEffect(() => {
    // 消费端（2026-10-06 action-routing ①A，Master 裁 A）：读 URL 的 articleId 自动选中
    // 跳转过来的文章——此前该参数被携带但无人读（门禁抓出的死参数）。store.load() 优先用
    // 已设的 articleId，故先注入再加载。与 ImpactAnalysisView(seed)/SchemaManagerView(tab) 同模式。
    const articleId = getNavQueryParam("articleId");
    if (articleId) store.setArticleId(articleId);
    void store.load();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  const error = store.error ?? store.operationError;

  const content = (
    <>
      {error && (
        <div className="flex items-center gap-2 rounded-lg bg-status-error-2 px-4 py-3 text-sm text-status-error ring-1 ring-status-error-6">
          <AlertTriangle className="h-4 w-4" />{error}
        </div>
      )}
      {store.status === "loading" && !store.data && (
        <p className="py-12 text-center text-sm text-text-hint">{AA_VIEW_COPY.LOADING}</p>
      )}
      {/* Master 2026-10-29：空态即结构——无数据时内容区自然留空（SPEC-029 发布前常态同），引导卡退役 */}
      {store.data && store.data.articles.length > 0 && (
        <AssociationDecisionPanel
          data={store.data}
          articleId={store.articleId}
          action={store.action}
          componentIds={store.componentIds}
          versionIds={store.versionIds}
          loading={store.status === "loading"}
          saving={store.saving}
          canSubmit={Boolean(store.preview)}
          onArticle={store.setArticleId}
          onAction={store.setAction}
          onComponents={store.setComponentIds}
          onVersions={store.setVersionIds}
          onPreview={() => void store.runPreview()}
          onSubmit={() => void store.save()}
        />
      )}
      {store.preview && store.data && (
        <AssociationPreview preview={store.preview} data={store.data} />
      )}
      {store.data && (
        <AssociationDecisionList data={store.data} onSelect={store.setArticleId} />
      )}
    </>
  );

  // 嵌入「属性治理 · 人工映射校正」页签时：外层 PageContainer/PageSection/Panel 由
  // PropertyGovView 提供，这里只给裸内容，避免页面标题与卡片重复嵌套。
  if (embedded) return content;

  return (
    <PageContainer>
      <Panel>
        {content}
      </Panel>
    </PageContainer>
  );
}
