import { useEffect, useState } from "react";
import { AlertTriangle, FileText, Loader2, Wrench } from "lucide-react";
import { buildAnomalyHandoffHash } from "@/lib/domain/anomaly-handoff";
import { fetchDocument } from "@/features/document-inventory/document-inventory-api";
import type { DocumentDetailResponse } from "@/features/document-inventory/document-inventory-types";
import { getApprovalStatus, type ApprovalStatusView } from "@/features/approval-workbench/approval-api";

import { relationTypeLabel } from "@/lib/ontology";
import { safeNavigateHash } from "@/lib/navigation";
import { approvalStatusDisplay } from "@/lib/domain/StatusDisplay";
import { ARTICLE_PANORAMA_LABELS } from "./article-panorama-labels";
import { ARTICLE_PANORAMA_COPY, DOCUMENT_SHARED_COPY } from "../document-inventory-copy";



type State = { status: "loading" | "success" | "error"; data: DocumentDetailResponse | null; approval: ApprovalStatusView | null; approvalUnavailable: boolean; error: string | null };

export function ArticlePanorama({ documentId }: { documentId: string }) {
  const [state, setState] = useState<State>({ status: "loading", data: null, approval: null, approvalUnavailable: false, error: null });
  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading", data: null, approval: null, approvalUnavailable: false, error: null });
    fetchDocument(documentId).then((data) => {
      if (cancelled) return;
      if (data.document.documentId !== documentId || data.document.documentKind !== "standard-article") {
        setState({ status: "error", data: null, approval: null, approvalUnavailable: false, error: ARTICLE_PANORAMA_COPY.IDENTITY_MISMATCH });
        return;
      }
      const articleId = data.document.articleId;
      setState({ status: "success", data, approval: null, approvalUnavailable: !articleId, error: null });
      if (articleId) {
        getApprovalStatus(articleId).then((approval) => {
          if (!cancelled) setState((current) => ({ ...current, approval }));
        }).catch(() => {
          if (!cancelled) setState((current) => ({ ...current, approvalUnavailable: true }));
        });
      }
    }).catch((error) => {
      if (!cancelled) setState({ status: "error", data: null, approval: null, approvalUnavailable: false, error: error instanceof Error ? error.message : ARTICLE_PANORAMA_COPY.DETAIL_QUERY_FAILED });
    });
    return () => { cancelled = true; };
  }, [documentId]);

  if (state.status === "loading") return <div className="flex items-center gap-2 py-3 text-xs text-text-hint"><Loader2 className="h-4 w-4 animate-spin" />{ARTICLE_PANORAMA_COPY.DETAIL_LOADING}</div>;
  if (state.status === "error" || !state.data) return <div role="alert" className="flex items-center gap-2 py-3 text-xs text-status-error"><AlertTriangle className="h-4 w-4" />{state.error || ARTICLE_PANORAMA_COPY.DETAIL_UNAVAILABLE}</div>;

  const { document, releaseId, sourceCommit } = state.data;
  const handoff = buildAnomalyHandoffHash({ objectKind: "article", objectId: document.documentId, sourcePath: document.sourcePath, releaseId, sourceCommit });
  return <section aria-label={ARTICLE_PANORAMA_COPY.ARIA} className="space-y-3 py-2 text-xs">
    <p className="text-text-sub">{ARTICLE_PANORAMA_COPY.RELEASE_ONLY_NOTICE}</p>
    <div className="flex items-center gap-2"><FileText className="h-4 w-4 text-text-hint" /><span>{ARTICLE_PANORAMA_COPY.RELEASE_SOURCE_LABEL}</span><span className="break-all text-text-main">{document.sourcePath}</span></div>
    {state.approval && <p>{ARTICLE_PANORAMA_COPY.APPROVAL_STATUS_PREFIX}{approvalStatusDisplay(state.approval.status).label}{state.approval.status === "pending" ? ARTICLE_PANORAMA_COPY.PENDING_GUIDANCE : ""}</p>}
    {state.approvalUnavailable && <p role="status">{ARTICLE_PANORAMA_COPY.APPROVAL_UNAVAILABLE}</p>}
    <dl className="grid gap-x-5 gap-y-2 sm:grid-cols-2">
      <div><dt className="text-text-hint">{ARTICLE_PANORAMA_LABELS.articleId}</dt><dd className="mt-0.5 text-text-main">{document.articleId || document.documentId}</dd></div>
      <div><dt className="text-text-hint">{ARTICLE_PANORAMA_LABELS.sourceHash}</dt><dd className="mt-0.5 break-all font-mono text-text-main">{document.sourceHash}</dd></div>
      {/* 产品与版本沿用「合并成一格」的原始结构（未拆成一格一格）：两半各自从字典取 → 渲染为「产品 / 产品版本」 */}
      <div><dt className="text-text-hint">{`${ARTICLE_PANORAMA_LABELS.product} / ${ARTICLE_PANORAMA_LABELS.version}`}</dt><dd className="mt-0.5 text-text-main">{[document.product, document.version].filter(Boolean).join(" / ") || ARTICLE_PANORAMA_COPY.UNSCOPED}</dd></div>
      <div><dt className="text-text-hint">{ARTICLE_PANORAMA_LABELS.graphStatus}</dt><dd className="mt-0.5 text-text-main">{document.graphStatus === "indexed" ? DOCUMENT_SHARED_COPY.GRAPH_STATUS_INDEXED : DOCUMENT_SHARED_COPY.GRAPH_STATUS_PENDING}</dd></div>
      <div className="sm:col-span-2"><dt className="text-text-hint">{ARTICLE_PANORAMA_LABELS.releaseVersion}</dt><dd className="mt-0.5 break-all font-mono text-text-main">{releaseId}<br />{sourceCommit}</dd></div>
    </dl>
    {document.relations.length > 0 && <p className="text-text-hint">{DOCUMENT_SHARED_COPY.RELATIONS_PREFIX}{document.relations.map((relation) => relationTypeLabel(relation.type)).join("、")}</p>}
    <button type="button" className="inline-flex items-center gap-1 text-text-sub hover:text-text-main" onClick={() => { safeNavigateHash(handoff); }}><Wrench className="h-4 w-4" />{ARTICLE_PANORAMA_COPY.ANOMALY_HANDOFF_ACTION}</button>
  </section>;
}
