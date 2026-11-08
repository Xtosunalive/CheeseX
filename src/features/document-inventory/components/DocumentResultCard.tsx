import { Box, ChevronDown, ChevronRight, FileText, GitBranch, GitFork } from "lucide-react";
import { DocumentLinkPopover } from "./DocumentLinkPopover";
import { useSetActiveEntityId } from "@/lib/topology-store";
import { useHubDrawerState } from "@/components/app-shell/entity-hub-drawer-store";
import type { DocumentInventoryDocument } from "@/features/document-inventory/document-inventory-types";

import { relationTypeLabel } from "@/lib/ontology";
import { ArticlePanorama } from "./ArticlePanorama";
import { navigate } from "@/lib/navigation";
import { DOCUMENT_RESULT_FIELD_LABELS } from "./document-result-field-labels";
import { TERM } from "@/constants/term-const";
import { DOCUMENT_KIND_LABELS, DOCUMENT_RESULT_CARD_COPY, DOCUMENT_SHARED_COPY } from "../document-inventory-copy";




export function DocumentResultCard({ document, expanded, onToggle }: { document: DocumentInventoryDocument; expanded: boolean; onToggle: () => void }) {
  const setActiveEntityId = useSetActiveEntityId();
  const setHubOpen = useHubDrawerState((state) => state.setOpen);
  const nodeId = document.graphNodeIds[0] || "";
  const isEntity = document.documentKind === "entity";

  return (
    <article className="rounded-lg bg-surface-root ring-1 ring-border-thin">
      <button className="flex w-full items-center gap-3 p-4 text-left" onClick={onToggle}>
        {expanded ? <ChevronDown className="h-4 w-4 text-text-hint shrink-0" /> : <ChevronRight className="h-4 w-4 text-text-hint shrink-0" />}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-medium text-text-main">{document.title}</h3>
          <p className="truncate text-xs text-text-hint">{document.readablePath}</p>
        </div>
        <span className="rounded-sm bg-surface-hover px-2.5 py-0.5 text-xs text-text-sub">{DOCUMENT_KIND_LABELS[document.documentKind]}</span>
        <span className={`text-xs ${document.graphStatus === "indexed" ? "text-status-fact" : "text-status-warn"}`}>{document.graphStatus === "indexed" ? DOCUMENT_SHARED_COPY.GRAPH_STATUS_INDEXED : DOCUMENT_SHARED_COPY.GRAPH_STATUS_PENDING}</span>
      </button>
      {expanded && (
        <div className="border-t border-border-thin px-4 py-3 space-y-1">
          <div className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-[var(--color-accent-base)] shrink-0" />
            <DocumentLinkPopover relativePath={document.readablePath || document.title} title={document.title} />
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 pt-2 text-xs text-text-hint">
            {document.product && <span>{DOCUMENT_RESULT_FIELD_LABELS.product}：{document.product}</span>}
            {document.version && <span>{DOCUMENT_RESULT_FIELD_LABELS.version}：{document.version}</span>}
            {document.module && <span>{DOCUMENT_RESULT_FIELD_LABELS.module}：{Array.isArray(document.module) ? document.module.join("、") : document.module}</span>}
            {document.articleType && <span>{DOCUMENT_RESULT_FIELD_LABELS.articleType}：{document.articleType}</span>}
            {document.docType && <span>{DOCUMENT_RESULT_FIELD_LABELS.docType}：{document.docType}</span>}
          </div>

          {document.documentKind === "standard-article" && <ArticlePanorama documentId={document.documentId} />}

          {/* ── Cross-tab quick-jump buttons ── */}
          {nodeId && isEntity && <div className="flex items-center gap-1.5 pt-2 mt-2 border-t border-border-thin">
            <span className="text-xs text-text-placeholder mr-1">{DOCUMENT_RESULT_CARD_COPY.QUICK_JUMP}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setActiveEntityId(nodeId);
                setHubOpen(true);
              }}
              className="inline-flex items-center gap-1 rounded-md bg-surface-hover px-2.5 py-1 text-xs text-text-sub hover:text-text-main hover:bg-accent-bg transition-colors"
              title={DOCUMENT_RESULT_CARD_COPY.OPEN_ENTITY_OVERVIEW_TITLE}
            >
              <Box className="h-3 w-3" />
              {TERM.ENTITY_OVERVIEW}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setActiveEntityId(nodeId);
                navigate("impact-analysis", { query: { seed: nodeId } });
              }}
              className="inline-flex items-center gap-1 rounded-md bg-surface-hover px-2.5 py-1 text-xs text-text-sub hover:text-text-main hover:bg-accent-bg transition-colors"
              title={DOCUMENT_RESULT_CARD_COPY.IMPACT_TITLE}
            >
              <GitFork className="h-3 w-3" />
              {DOCUMENT_RESULT_CARD_COPY.IMPACT_ACTION}
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setActiveEntityId(nodeId);
                navigate("dashboard", { query: { highlight: nodeId } });
              }}
              className="inline-flex items-center gap-1 rounded-md bg-surface-hover px-2.5 py-1 text-xs text-text-sub hover:text-text-main hover:bg-accent-bg transition-colors"
              title={DOCUMENT_RESULT_CARD_COPY.GRAPH_HIGHLIGHT_TITLE}
            >
              <GitBranch className="h-3 w-3" />
              {DOCUMENT_RESULT_CARD_COPY.GRAPH_ACTION}
            </button>
          </div>}

          {document.relations.length > 0 && <div className="mt-3 text-xs text-text-hint">{DOCUMENT_SHARED_COPY.RELATIONS_PREFIX}{document.relations.map((relation) => relationTypeLabel(relation.type)).join("、")}</div>}
        </div>
      )}
    </article>
  );
}
