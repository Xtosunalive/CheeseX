// ArticleDrawer — 源文档与准入详情抽屉
// Slide-out panel controlled by admission-store drawer state.

import { useEffect } from "react";
import { X, FileCode } from "lucide-react";
import { PoolShell, usePoolOccupancy } from "@/components/pool-panel";
import { SidePanelAction, SidePanelHeader, SidePanelSection } from "@/components/side-panel";
import { useDrawerOpen, useDrawerEntityId, useCloseDrawer, useRegistryItems } from "./admission-store";
import { type EntityRegistryItem } from "./admission-types";
import { admissionStatusDisplay } from "@/lib/domain/StatusDisplay";
import { TERM } from "@/constants/term-const";
import { ObsidianLink } from "@/components/obsidian";
import { SHARED_UI_COPY } from "@/components/components-copy";
import { ADMISSION_COPY, ARTICLE_DRAWER_COPY } from "./admission-copy";

function ObsidianOpenButton({ articlePath }: { articlePath: string }) {
  return (
    <ObsidianLink sourcePath={articlePath} className="inline-flex items-center gap-1 rounded-md bg-surface-hover px-2 py-1 text-xs text-text-main transition-colors hover:bg-surface-root disabled:cursor-not-allowed disabled:opacity-50">
      <span className="h-3 w-3 rounded-full bg-accent-base" />
      {SHARED_UI_COPY.OPEN_OBSIDIAN}
    </ObsidianLink>
  );
}

export function ArticleDrawer() {
  const open = useDrawerOpen();
  const entityId = useDrawerEntityId();
  const onClose = useCloseDrawer();
  // 目检②互斥：被其他池顶掉时收起
  const stillOwner = usePoolOccupancy("article-detail", open);
  useEffect(() => { if (open && !stillOwner) onClose(); }, [open, stillOwner, onClose]);
  const items = useRegistryItems();
  const item: EntityRegistryItem | undefined = entityId
    ? items.find((i) => i.entityId === entityId)
    : undefined;

  if (!open) return null;
  return (
    <PoolShell title={ARTICLE_DRAWER_COPY.TITLE} onClose={onClose} closeLabel={ARTICLE_DRAWER_COPY.CLOSE_ARIA}>
      {item ? <DrawerContent item={item} onClose={onClose} /> : <DrawerEmpty onClose={onClose} />}
    </PoolShell>
  );
}

function DrawerContent({
  item,
  onClose,
}: {
  item: EntityRegistryItem;
  onClose: () => void;
}) {
  const hasFrontmatter = item.frontmatter && Object.keys(item.frontmatter).length > 0;

  return (
    <>
      <SidePanelHeader title={ARTICLE_DRAWER_COPY.TITLE} dialogTitle />

      <div className="space-y-4">
        <div className="flex justify-end">
          <ObsidianOpenButton articlePath={item.articlePath ?? ""} />
        </div>

        <SidePanelSection title={ARTICLE_DRAWER_COPY.PATH_SECTION} icon={FileCode}>
          <div className="font-mono bg-surface-root p-2.5 rounded ring-1 ring-border-thin break-all text-text-sub select-all text-xs">
            {item.articlePath?.trim() || "—"}
          </div>
        </SidePanelSection>

        <SidePanelSection title={ARTICLE_DRAWER_COPY.FRONTMATTER_SECTION} icon={FileCode}>
          {hasFrontmatter ? (
            <pre className="bg-surface-root text-text-sub p-4 rounded-lg font-mono text-xs overflow-x-auto leading-relaxed ring-1 ring-border-thin">
              {"---\n" +
                Object.entries(item.frontmatter!)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join("\n") +
                "\n---"}
            </pre>
          ) : (
            <p className="text-sm text-text-placeholder">{ARTICLE_DRAWER_COPY.NO_SOURCE_DOC}</p>
          )}
        </SidePanelSection>

        <SidePanelSection title={ARTICLE_DRAWER_COPY.ADMISSION_SECTION} icon={FileCode}>
          <dl className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <dt className="text-xs text-text-placeholder">{ADMISSION_COPY.ADMISSION_STATUS}</dt>
              <dd className="text-text-main font-medium truncate">{admissionStatusDisplay(item.admissionStatus).label}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-placeholder">{TERM.LAYER}</dt>
              <dd className="text-text-sub">{item.layer}</dd>
            </div>
            <div>
              <dt className="text-xs text-text-placeholder">{TERM.CATEGORY}</dt>
              <dd className="text-text-sub">{item.category}</dd>
            </div>
          </dl>
        </SidePanelSection>
      </div>

      <div className="mt-4 flex justify-end">
        <SidePanelAction
          variant="primary"
          onClick={onClose}
        >
          {ARTICLE_DRAWER_COPY.CLOSE_SIDEBAR}
        </SidePanelAction>
      </div>
    </>
  );
}

function DrawerEmpty({ onClose }: { onClose: () => void }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-5 py-4 border-b border-border-thin">
        <h3 className="font-display text-base font-bold text-text-main">{ADMISSION_COPY.SOURCE_DOC_DETAIL}</h3>
        <button
          onClick={onClose}
          className="text-text-hint hover:text-text-sub p-1.5 rounded-md hover:bg-surface-hover transition"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 flex items-center justify-center text-text-placeholder text-sm">
        {ARTICLE_DRAWER_COPY.NO_SELECTION}
      </div>
    </div>
  );
}
