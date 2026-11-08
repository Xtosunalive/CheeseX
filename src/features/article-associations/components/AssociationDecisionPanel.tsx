import { versionStatusDisplay } from "@/lib/domain/StatusDisplay";
import { Eye, GitBranch, Loader2, Minus, Plus, RefreshCw } from "lucide-react";
import { FilterSelect } from "@/components/filter-select";
import type { ArticleAssociationData, AssociationAction } from "@/features/article-associations/article-associations-types";
import { TERM } from "@/constants/term-const";
import { AA_PANEL_COPY, ARTICLE_ASSOCIATION_COPY, ASSOCIATION_ACTION_LABELS } from "@/features/article-associations/article-associations-copy";

const ACTIONS = [
  { id: "add", label: ASSOCIATION_ACTION_LABELS.add, icon: Plus },
  { id: "remove", label: ASSOCIATION_ACTION_LABELS.remove, icon: Minus },
  { id: "replace", label: ASSOCIATION_ACTION_LABELS.replace, icon: RefreshCw },
] as const;

export function AssociationDecisionPanel({ data, articleId, action, componentIds, versionIds, loading, saving, canSubmit, onArticle, onAction, onComponents, onVersions, onPreview, onSubmit }: {
  data: ArticleAssociationData; articleId: string; action: AssociationAction; componentIds: string[]; versionIds: string[]; loading: boolean; saving: boolean; canSubmit: boolean;
  onArticle: (value: string) => void; onAction: (value: AssociationAction) => void; onComponents: (value: string[]) => void; onVersions: (value: string[]) => void; onPreview: () => void; onSubmit: () => void;
}) {
  const article = data.articles.find((item) => item.articleId === articleId);
  return <section aria-label={AA_PANEL_COPY.SECTION_ARIA} className="space-y-4 border-y border-border-thin py-4">
    <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_minmax(320px,1.4fr)]">
      <div><div className="mb-1.5 text-xs text-text-hint">{TERM.STANDARD_ARTICLE_CANDIDATE}</div><FilterSelect ariaLabel={AA_PANEL_COPY.ARTICLE_PICK_ARIA} title={AA_PANEL_COPY.ARTICLE_PICK_ARIA} searchPlaceholder={AA_PANEL_COPY.ARTICLE_SEARCH_PLACEHOLDER} value={articleId} onValueChange={(value) => onArticle(value as string)} options={data.articles.map((item) => ({ value: item.articleId, label: item.title || ARTICLE_ASSOCIATION_COPY.UNNAMED_ARTICLE, group: item.product || AA_PANEL_COPY.UNLABELED_PRODUCT }))} className="h-9 w-full" /></div>
      {article && <div className="grid min-w-0 grid-cols-2 gap-x-4 gap-y-1 border-l border-border-thin pl-4 text-xs"><span className="text-text-hint">{ARTICLE_ASSOCIATION_COPY.ARTICLE_PRODUCT}</span><span className="truncate text-text-main">{article.product || AA_PANEL_COPY.UNLABELED}</span><span className="text-text-hint">{AA_PANEL_COPY.APPLICABLE_VERSION}</span><span className="truncate text-text-main">{article.version || AA_PANEL_COPY.UNLABELED}</span><span className="text-text-hint">{AA_PANEL_COPY.SOURCE}</span><span className="truncate text-text-sub" title={article.sourcePath}>{article.sourcePath}</span></div>}
    </div>
    <div><div className="mb-1.5 text-xs text-text-hint">{AA_PANEL_COPY.ACTION_MODE}</div><div className="inline-flex overflow-hidden rounded-md ring-1 ring-border-thin">{ACTIONS.map((item) => { const Icon = item.icon; return <button key={item.id} type="button" onClick={() => onAction(item.id)} className={`flex h-8 items-center gap-1.5 px-3 text-xs ${action === item.id ? "bg-accent-bg text-[var(--color-accent-fg)]" : "bg-surface-root text-text-hint hover:text-text-main"}`}><Icon className="h-4 w-4" />{item.label}</button>; })}</div></div>
    <div className="grid gap-3 md:grid-cols-2">
      <div><div className="mb-1.5 text-xs text-text-hint">{AA_PANEL_COPY.COMPONENTS_LABEL}</div><FilterSelect ariaLabel={AA_PANEL_COPY.COMPONENTS_PICK_ARIA} title={AA_PANEL_COPY.COMPONENTS_PICK_ARIA} searchPlaceholder={AA_PANEL_COPY.COMPONENTS_SEARCH_PLACEHOLDER} multiple value={componentIds} onValueChange={(value) => onComponents(value as string[])} placeholder={TERM.ARCH_COMPONENT} emptyLabel={AA_PANEL_COPY.COMPONENTS_EMPTY} options={data.componentOptions.map((item) => ({ value: item.id, label: item.label || TERM.UNNAMED_ARCH_COMPONENT, group: TERM.ARCH_COMPONENT }))} className="h-9 w-full" /></div>
      <div><div className="mb-1.5 text-xs text-text-hint">{AA_PANEL_COPY.VERSIONS_LABEL}</div><FilterSelect ariaLabel={AA_PANEL_COPY.VERSIONS_PICK_ARIA} title={AA_PANEL_COPY.VERSIONS_PICK_ARIA} searchPlaceholder={AA_PANEL_COPY.VERSIONS_SEARCH_PLACEHOLDER} multiple value={versionIds} onValueChange={(value) => onVersions(value as string[])} placeholder={ARTICLE_ASSOCIATION_COPY.ARTICLE_VERSION} emptyLabel={AA_PANEL_COPY.VERSIONS_EMPTY} options={data.versionOptions.map((item) => ({ value: item.id, label: item.label, group: `${item.product} · ${versionStatusDisplay(item.status).label}` }))} className="h-9 w-full" /></div>
    </div>
    <div className="flex justify-end gap-2"><button type="button" onClick={onPreview} disabled={loading || !articleId} className="inline-flex h-9 items-center gap-2 rounded-md bg-surface-hover px-4 text-sm text-text-main disabled:opacity-40">{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Eye className="h-4 w-4" />}{ARTICLE_ASSOCIATION_COPY.PREVIEW_RESULT}</button><button type="button" onClick={onSubmit} disabled={saving || !canSubmit} className="inline-flex h-9 items-center gap-2 rounded-md bg-accent-bg px-4 text-sm text-[var(--color-accent-fg)] ring-1 ring-[var(--color-border-focus)] disabled:opacity-40">{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <GitBranch className="h-4 w-4" />}{AA_PANEL_COPY.SAVE}</button></div>
  </section>;
}
