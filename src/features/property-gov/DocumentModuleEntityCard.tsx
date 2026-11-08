import { AlertTriangle } from "lucide-react";
import { CHECK_LABELS, DOCUMENT_MODULE_ENTITY_COPY, documentModuleEntityFixHint } from "./property-gov-copy";

type DocumentModuleEntityCheck = {
  moduleName: string;
  moduleInEnums: boolean;
  hasEntity: boolean;
  matchedEntityId: string | null;
  docTitle: string;
  docFilePath: string;
  reason: string;
};

export function DocumentModuleEntityCard({ check }: { check: DocumentModuleEntityCheck }) {
  return (
    <div className="space-y-2 rounded bg-status-error-2 px-2.5 py-2 ring-1 ring-status-error-6">
      <div className="flex items-center gap-1.5">
        <AlertTriangle className="h-3 w-3 text-status-error" />
        <span className="font-mono text-kg-xs text-status-error">{CHECK_LABELS.document_module_entity}</span>
      </div>
      <p className="font-mono text-kg-xs text-text-hint">
        {DOCUMENT_MODULE_ENTITY_COPY.ARTICLE_QUOTE_OPEN}<span className="text-text-sub">{check.docTitle}</span>{DOCUMENT_MODULE_ENTITY_COPY.DECLARES_MODULE}{" "}
        <code className="rounded bg-surface-hover px-1 text-status-error">{check.moduleName}</code>
        {check.moduleInEnums
          ? DOCUMENT_MODULE_ENTITY_COPY.MODULE_IN_ENUMS_NO_ENTITY
          : DOCUMENT_MODULE_ENTITY_COPY.MODULE_NOT_IN_ENUMS}
      </p>
      <p className="font-mono text-kg-2xs text-text-hint">{DOCUMENT_MODULE_ENTITY_COPY.SOURCE_PREFIX}{check.docFilePath}</p>
      <p className="font-mono text-kg-2xs text-text-placeholder">{check.reason}</p>
      <p className="font-mono text-kg-2xs text-status-warn">
        {check.moduleInEnums
          ? documentModuleEntityFixHint(check.moduleName)
          : DOCUMENT_MODULE_ENTITY_COPY.REGISTER_MODULE_HINT}
      </p>
    </div>
  );
}
