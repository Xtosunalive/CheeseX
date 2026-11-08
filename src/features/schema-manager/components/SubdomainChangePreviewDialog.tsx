import { AlertTriangle, FileText, Loader2, Save } from "lucide-react";
import { SUBDOMAIN_PREVIEW_COPY } from ".././schema-manager-copy";
import { TERM } from "@/constants/term-const";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { EnumsChangePreviewData } from "@/features/schema-manager/schema-manager-types";

type Props = {
  preview: EnumsChangePreviewData | null;
  confirming: boolean;
  onCancel: () => void;
  onConfirm: () => void;
};

function changedValues(items: EnumsChangePreviewData["changes"]["removed"]) {
  return items.map((item) => item.value).join("、") || SUBDOMAIN_PREVIEW_COPY.EMPTY_VALUES;
}

export function SubdomainChangePreviewDialog({ preview, confirming, onCancel, onConfirm }: Props) {
  return (
    <Dialog open={Boolean(preview)} onOpenChange={(open) => { if (!open && !confirming) onCancel(); }}>
      <DialogContent className="max-h-[82vh] max-w-2xl overflow-y-auto border-border-thin bg-surface-card text-text-main">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <AlertTriangle className="h-4 w-4 text-status-warn" />{SUBDOMAIN_PREVIEW_COPY.DIALOG_TITLE}
          </DialogTitle>
          <DialogDescription className="text-text-hint">
            {SUBDOMAIN_PREVIEW_COPY.INTRO}
          </DialogDescription>
        </DialogHeader>

        {preview && <div className="space-y-4 text-sm">
          <section className="border-t border-border-thin pt-3">
            <p className="font-medium text-text-main">{SUBDOMAIN_PREVIEW_COPY.CHANGES_TITLE}</p>
            <div className="mt-2 grid grid-cols-2 gap-3 text-xs">
              <div><span className="text-text-hint">{SUBDOMAIN_PREVIEW_COPY.REMOVED_LABEL}</span><p className="mt-1 text-status-error">{changedValues(preview.changes.removed)}</p></div>
              <div><span className="text-text-hint">{TERM.ADD_ACTION}</span><p className="mt-1 text-status-fact">{changedValues(preview.changes.added)}</p></div>
            </div>
          </section>

          <section className="border-t border-border-thin pt-3">
            <p className="font-medium text-text-main">{`${SUBDOMAIN_PREVIEW_COPY.MODULES_TITLE}${preview.summary.modules}`}</p>
            {preview.affectedModules.length > 0
              ? <ul className="mt-2 space-y-1 text-xs text-text-sub">{preview.affectedModules.map((item) => <li key={item.name}>{item.name}：{item.before} → {item.after || SUBDOMAIN_PREVIEW_COPY.UNSET_VALUE}</li>)}</ul>
              : <p className="mt-2 text-xs text-text-hint">{SUBDOMAIN_PREVIEW_COPY.MODULES_EMPTY}</p>}
          </section>

          <section className="border-t border-border-thin pt-3">
            <p className="flex items-center gap-2 font-medium text-text-main"><FileText className="h-4 w-4" />{`${SUBDOMAIN_PREVIEW_COPY.DOCUMENTS_TITLE}${preview.summary.documents}`}</p>
            {preview.affectedDocuments.length > 0
              ? <ul className="mt-2 max-h-40 space-y-2 overflow-y-auto text-xs">{preview.affectedDocuments.map((item) => <li key={item.documentId}><p className="text-text-sub">{item.title}</p><p className="break-all text-text-hint">{item.sourcePath}{item.lineNumber ? `:${item.lineNumber}` : ""}{SUBDOMAIN_PREVIEW_COPY.CURRENT_VALUE_PREFIX}{item.currentValue}</p></li>)}</ul>
              : <p className="mt-2 text-xs text-text-hint">{SUBDOMAIN_PREVIEW_COPY.DOCUMENTS_EMPTY}</p>}
            <p className="mt-2 text-xs text-status-warn-11">{SUBDOMAIN_PREVIEW_COPY.PIPELINE_NOTE}</p>
          </section>

          <section className="border-t border-border-thin pt-3 text-xs text-text-hint">
            <p>{SUBDOMAIN_PREVIEW_COPY.SOURCE_LABEL}{preview.source.sourceFile}</p>
            <p className="mt-1 break-all">{SUBDOMAIN_PREVIEW_COPY.REVISION_LABEL}{preview.source.revision}</p>
            {preview.summary.invalidDocuments > 0 && <p className="mt-1 text-status-error">{`${SUBDOMAIN_PREVIEW_COPY.INVALID_DOCS_PREFIX}${preview.summary.invalidDocuments}${SUBDOMAIN_PREVIEW_COPY.INVALID_DOCS_SUFFIX}`}</p>}
          </section>
        </div>}

        <DialogFooter className="gap-2">
          <button type="button" onClick={onCancel} disabled={confirming} className="rounded-md px-3 py-2 text-sm text-text-sub ring-1 ring-border-thin hover:bg-surface-hover disabled:opacity-50">{TERM.CANCEL_ACTION}</button>
          <button type="button" onClick={onConfirm} disabled={confirming || Boolean(preview?.summary.invalidDocuments)} className="inline-flex items-center justify-center gap-2 rounded-md bg-status-warn-3 px-3 py-2 text-sm text-status-warn ring-1 ring-status-warn-6 hover:bg-amber-4 disabled:opacity-50">
            {confirming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            {confirming ? SUBDOMAIN_PREVIEW_COPY.CONFIRMING : SUBDOMAIN_PREVIEW_COPY.CONFIRM_ACTION}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
