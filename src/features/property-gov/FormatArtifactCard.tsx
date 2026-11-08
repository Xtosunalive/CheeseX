import { AlertTriangle, Wrench } from "lucide-react";
import type { FormatArtifact, RepairAction, RepairPayload } from "./property-types";
import { CHECK_LABELS, FORMAT_ARTIFACT_COPY, PROPERTY_GOV_SHARED_COPY, formatArtifactRepairLabel } from "./property-gov-copy";

// seq203（审计族 W 收尾）：可一键提案修复的字段投影 = 后端 FIELDS_TO_SCAN − "label"
// （property-governance-service.cjs 模块级单源导出），投影关系由
// server/services/__tests__/property-gov-wordlist-projection.test.cjs 锁死，改词表必须双端同步。
export const PROPOSAL_FIELDS = new Set(["module", "arch_layer", "arch_category", "arch_status", "arch_subdomain"]);

export function FormatArtifactCard({
  artifacts,
  isRepairing,
  canPropose,
  onRepair,
}: {
  artifacts: FormatArtifact[];
  isRepairing: boolean;
  canPropose: boolean;
  onRepair: (action: RepairAction, payload?: RepairPayload) => Promise<boolean>;
}) {
  const proposalFields = PROPOSAL_FIELDS;
  return (
    <div className="space-y-2 rounded bg-status-warn-2 ring-1 ring-status-warn-6 px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <AlertTriangle className="h-3 w-3 text-status-warn" />
        <span className="font-mono text-kg-xs text-status-warn">{CHECK_LABELS.format_artifact}</span>
      </div>
      <div className="space-y-1">
        {artifacts.map((artifact, index) => (
          <div key={`${artifact.field}-${index}`} className="space-y-1 rounded bg-surface-card/50 ring-1 ring-border-thin px-2 py-1.5">
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-kg-2xs text-text-hint">{artifact.field}</span>
              <span className="font-mono text-kg-2xs text-status-error bg-status-error-2 px-1 rounded">
                {artifact.rawValue}
              </span>
              <span className="font-mono text-kg-2xs text-text-placeholder">→</span>
              <span className="font-mono text-kg-2xs text-grass-11 bg-grass-2 px-1 rounded">
                {artifact.normalizedValue}
              </span>
            </div>
            {proposalFields.has(artifact.field) && !artifact.requiresManualConfirm ? (
              <button
                type="button"
                disabled={isRepairing || !canPropose}
                onClick={() => onRepair("normalize_format", { field: artifact.field, value: artifact.normalizedValue, requiresManualConfirm: artifact.requiresManualConfirm })}
                className="rounded bg-status-warn-2 ring-1 ring-status-warn-6 px-1.5 py-0.5 font-mono text-kg-2xs text-status-warn hover:bg-amber-4 disabled:opacity-30"
              >
                <Wrench className="inline h-3 w-3 mr-0.5" />
                {isRepairing ? PROPERTY_GOV_SHARED_COPY.WRITING_BACK : formatArtifactRepairLabel(artifact.field)}
              </button>
            ) : (
              <span className="font-mono text-kg-2xs text-text-hint">{FORMAT_ARTIFACT_COPY.MANUAL_CONFIRM_REQUIRED}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
