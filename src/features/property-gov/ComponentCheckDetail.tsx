// ComponentCheckDetail — Layer 3 expandable check detail for a single component
// Shows 6 property checks grouped by severity with repair actions
import { useState } from "react";
import { sliceWithRest } from "@/lib/format";
import {
  CHECK_LABELS,
  COMPONENT_CHECK_COPY,
  COMPONENT_CHECK_SEVERITY_LABELS,
  PROPERTY_GOV_SHARED_COPY,
  componentCheckGroupPassText,
  componentCheckMoreModulesText,
  mountMismatchExplanation,
  mountMismatchGuidance,
  type GovCheckKey,
} from "./property-gov-copy";
import {
  AlertTriangle, CheckCircle2, Info, RotateCw,
  Wrench, ChevronDown, ChevronRight,
} from "lucide-react";
import { TERM } from "@/constants/term-const";
import type { CheckResultItem, RepairAction, RepairPayload } from "./property-types";
import { usePropertyStore } from "./property-store";
import { FormatArtifactCard } from "./FormatArtifactCard";
import { FilterSelect } from "@/components/filter-select";
import { DocumentModuleEntityCard } from "./DocumentModuleEntityCard";

// WP-033：标签单源 property-gov-copy（此处私有映射退役——同物多名「module 属性未填写」随之归一）

type Severity = "blocker" | "warning" | "info";

const CHECK_SEVERITY: Record<string, Severity> = {
  missing_module: "blocker",
  invalid_module: "blocker",
  mount_mismatch: "blocker",
  stale_property: "warning",
  format_artifact: "warning",
  mount_diagnostic: "info",
  document_module_entity: "blocker",
};

const SEVERITY_ORDER: Severity[] = ["blocker", "warning", "info"];

const SEVERITY_STYLE: Record<Severity, { bg: string; border: string; text: string; dot: string }> = {
  blocker: { bg: "bg-status-error-2", border: "border-status-error-6", text: "text-status-error", dot: "bg-status-error" },
  warning: { bg: "bg-status-warn-2", border: "border-status-warn-6", text: "text-status-warn", dot: "bg-status-warn" },
  info: { bg: "bg-surface-card/50", border: "border-border-thin", text: "text-text-hint", dot: "bg-surface-hover" },
};

const SEVERITY_LABEL: Record<Severity, string> = COMPONENT_CHECK_SEVERITY_LABELS;

// ── Main component ──

export function ComponentCheckDetail({ item }: { item: CheckResultItem }) {
  const repair = usePropertyStore((s) => s.repair);
  const refresh = usePropertyStore((s) => s.refresh);
  const repairingId = usePropertyStore((s) => s.repairingId);

  const [selectedModule, setSelectedModule] = useState("");
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    blocker: true,
    warning: true,
    info: false,
  });

  const isRepairing = repairingId === item.componentId;
  const c = item.checks ?? {} as CheckResultItem["checks"];

  const validModules =
    c.invalid_module?.validModules?.length > 0
      ? c.invalid_module.validModules
      : [];

  // Group checks by severity
  const groups: Record<Severity, Array<{ key: GovCheckKey; passed: boolean }>> = {
    blocker: [],
    warning: [],
    info: [],
  };

  const checkKeys = Object.keys(CHECK_LABELS) as GovCheckKey[];
  for (const key of checkKeys) {
    const checkData = c[key];
    if (!checkData) continue;
    const sev = CHECK_SEVERITY[key] || "info";
    groups[sev].push({ key, passed: checkData.passed !== false });
  }

  const hasAnyFailure =
    c.missing_module?.passed === false ||
    c.invalid_module?.passed === false ||
    c.mount_mismatch?.passed === false ||
    c.stale_property?.passed === false ||
    c.format_artifact?.passed === false;

  const toggleGroup = (sev: string) => {
    setExpandedGroups((prev) => ({ ...prev, [sev]: !prev[sev] }));
  };

  const handleRepair = async (action: RepairAction, payload?: RepairPayload) => {
    return repair(item, action, payload || {});
  };

  const handleRefresh = async () => {
    return refresh(item.componentId);
  };

  return (
    <div className="space-y-2 rounded-lg ring-1 ring-border-thin bg-surface-root p-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        {hasAnyFailure ? (
          <AlertTriangle className="h-4 w-4 text-status-warn" />
        ) : (
          <CheckCircle2 className="h-4 w-4 text-grass-11" />
        )}
        <span className="truncate font-mono text-kg-xs text-text-main">
          {item.label || item.componentId}
        </span>
        <span className="truncate font-mono text-kg-xs text-text-placeholder">
          {item.sourcePath}
        </span>
        {!item.sourcePathExists && (
          <span className="shrink-0 rounded bg-status-error-2 px-1.5 py-0.5 font-mono text-kg-2xs text-status-error">
            {COMPONENT_CHECK_COPY.SOURCE_FILE_MISSING}
          </span>
        )}
        {item.sourcePathExists && !item.sourceRevision && (
          <span className="shrink-0 rounded bg-status-warn-2 px-1.5 py-0.5 font-mono text-kg-2xs text-status-warn">
            {COMPONENT_CHECK_COPY.SOURCE_REVISION_MISSING}
          </span>
        )}
      </div>

      {/* Check groups by severity */}
      <div className="space-y-1.5">
        {SEVERITY_ORDER.map((sev) => {
          const groupItems = groups[sev];
          if (groupItems.length === 0) return null;

          const style = SEVERITY_STYLE[sev];
          const hasFailures = groupItems.some((g) => !g.passed);
          const isExpanded = expandedGroups[sev];

          return (
            <div key={sev} className={`rounded border ${style.border} ${style.bg}`}>
              <button
                type="button"
                onClick={() => toggleGroup(sev)}
                className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
              >
                {isExpanded ? (
                  <ChevronDown className="h-3 w-3 text-text-hint" />
                ) : (
                  <ChevronRight className="h-3 w-3 text-text-hint" />
                )}
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    hasFailures ? style.dot : "bg-grass-11"
                  }`}
                />
                <span className={`font-mono text-kg-xs ${style.text}`}>
                  {SEVERITY_LABEL[sev]}
                </span>
                <span className="font-mono text-kg-xs text-text-hint">
                  {componentCheckGroupPassText(groupItems.filter((g) => g.passed).length, groupItems.length)}
                </span>
              </button>

              {isExpanded && (
                <div className="space-y-1.5 px-2.5 pb-2">
                  {groupItems.map(({ key, passed }) => (
                    <CheckItemCard
                      key={key}
                      checkKey={key}
                      passed={passed}
                      sourceModule={item.module ?? null}
                      checks={item.checks}
                      validModules={validModules}
                      selectedModule={selectedModule}
                      onSelectModule={setSelectedModule}
                      isRepairing={isRepairing}
                      canPropose={Boolean(item.sourcePath && item.sourceRevision)}
                      onRepair={handleRepair}
                      onRefresh={handleRefresh}
                    />
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Individual check card router ──

function CheckItemCard({
  checkKey,
  passed,
  sourceModule,
  checks,
  validModules,
  selectedModule,
  onSelectModule,
  isRepairing,
  canPropose,
  onRepair,
  onRefresh,
}: {
  checkKey: GovCheckKey;
  passed: boolean;
  sourceModule: string | null;
  checks: CheckResultItem["checks"];
  validModules: string[];
  selectedModule: string;
  onSelectModule: (v: string) => void;
  isRepairing: boolean;
  canPropose: boolean;
  onRepair: (action: RepairAction, payload?: RepairPayload) => Promise<boolean>;
  onRefresh: () => Promise<boolean>;
}) {
  if (passed) {
    return (
      <div className="flex items-center gap-1.5 rounded bg-surface-card/50 px-2 py-1">
        <CheckCircle2 className="h-3 w-3 text-grass-11" />
        <span className="font-mono text-kg-xs text-text-hint">{CHECK_LABELS[checkKey]}</span>
        <span className="font-mono text-kg-2xs text-grass-11">{PROPERTY_GOV_SHARED_COPY.PASSED}</span>
      </div>
    );
  }

  switch (checkKey) {
    case "missing_module":
      return (
        <MissingModuleCard
          validModules={validModules}
          selectedModule={selectedModule}
          onSelectModule={onSelectModule}
          isRepairing={isRepairing}
          canPropose={canPropose}
          onRepair={onRepair}
        />
      );
    case "invalid_module":
      return (
        <InvalidModuleCard
          currentValue={sourceModule ?? ""}
          validModules={(checks.invalid_module?.validModules?.length ?? 0) > 0 ? checks.invalid_module!.validModules : validModules}
          selectedModule={selectedModule}
          onSelectModule={onSelectModule}
          isRepairing={isRepairing}
          canPropose={canPropose}
          onRepair={onRepair}
        />
      );
    case "stale_property":
      return (
        <StalePropertyCard
          articleMtime={checks.stale_property?.articleMtime ?? "N/A"}
          extractedAt={checks.stale_property?.propertyExtractedAt ?? "N/A"}
          isRepairing={isRepairing}
          onRefresh={onRefresh}
        />
      );
    case "mount_mismatch":
      return <MountMismatchCard />;
    case "mount_diagnostic":
      return (
        <MountDiagnosticCard
          entityCount={checks.mount_diagnostic?.entityCount ?? 0}
          edgeCount={checks.mount_diagnostic?.edgeCount ?? 0}
          missingIds={checks.mount_diagnostic?.missingEntityIds ?? []}
        />
      );
    case "format_artifact":
      return (
        <FormatArtifactCard
          artifacts={checks.format_artifact?.artifacts ?? []}
          isRepairing={isRepairing}
          canPropose={canPropose}
          onRepair={onRepair}
        />
      );
    case "document_module_entity":
      return (
        <DocumentModuleEntityCard
          check={checks.document_module_entity!}
        />
      );
    default:
      return null;
  }
}

// ── Check-specific cards ──

function MissingModuleCard({
  validModules,
  selectedModule,
  onSelectModule,
  isRepairing,
  canPropose,
  onRepair,
}: {
  validModules: string[];
  selectedModule: string;
  onSelectModule: (v: string) => void;
  isRepairing: boolean;
  canPropose: boolean;
  onRepair: (action: RepairAction, payload?: RepairPayload) => Promise<boolean>;
}) {
  return (
    <div className="space-y-2 rounded bg-status-error-2 ring-1 ring-status-error-6 px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <AlertTriangle className="h-3 w-3 text-status-error" />
        <span className="font-mono text-kg-xs text-status-error">{CHECK_LABELS.missing_module}</span>
      </div>
      <p className="font-mono text-kg-xs text-text-hint">
        {COMPONENT_CHECK_COPY.MISSING_MODULE_DESC}
      </p>
      <div className="rounded bg-surface-card/50 ring-1 ring-border-thin px-2 py-1.5">
        <p className="font-mono text-kg-2xs text-text-hint mb-1">
          {COMPONENT_CHECK_COPY.MISSING_MODULE_HINT}
        </p>
        <div className="flex items-center gap-1.5">
          <FilterSelect ariaLabel={COMPONENT_CHECK_COPY.MISSING_MODULE_ARIA} title={COMPONENT_CHECK_COPY.SELECT_MODULE} searchPlaceholder={COMPONENT_CHECK_COPY.FILTER_MODULE} value={selectedModule} onValueChange={(value) => onSelectModule(value as string)} placeholder={COMPONENT_CHECK_COPY.SELECT_MODULE} className="h-7 flex-1 rounded font-mono text-kg-xs" options={[{ value: "", label: COMPONENT_CHECK_COPY.SELECT_MODULE_OPTION, group: PROPERTY_GOV_SHARED_COPY.SCOPE_GROUP }, ...validModules.map((value) => ({ value, label: value, group: PROPERTY_GOV_SHARED_COPY.VALID_MODULES_GROUP }))]} />
          <button
            type="button"
            disabled={!selectedModule || isRepairing || !canPropose}
            onClick={() => onRepair("set_module", { module: selectedModule })}
            className="shrink-0 rounded bg-status-error-2 ring-1 ring-status-error-6 px-2 py-1 font-mono text-kg-xs text-status-error hover:bg-red-4 disabled:opacity-30"
          >
            <Wrench className="inline h-3 w-3 mr-0.5" />
            {isRepairing ? COMPONENT_CHECK_COPY.APPLYING : COMPONENT_CHECK_COPY.APPLY_REPAIR}
          </button>
        </div>
      </div>
    </div>
  );
}

function InvalidModuleCard({
  currentValue,
  validModules,
  selectedModule,
  onSelectModule,
  isRepairing,
  canPropose,
  onRepair,
}: {
  currentValue: string;
  validModules: string[];
  selectedModule: string;
  onSelectModule: (v: string) => void;
  isRepairing: boolean;
  canPropose: boolean;
  onRepair: (action: RepairAction, payload?: RepairPayload) => Promise<boolean>;
}) {
  // WP-134 波3：可见徽章与「等 N 项」剩余数一处算出（旧写法 slice(0,12) 与 length-12 各写一遍，上限改一处必漏另一处）
  const moduleFold = sliceWithRest(validModules, 12);
  return (
    <div className="space-y-2 rounded bg-status-error-2 ring-1 ring-status-error-6 px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <AlertTriangle className="h-3 w-3 text-status-error" />
        <span className="font-mono text-kg-xs text-status-error">{CHECK_LABELS.invalid_module}</span>
      </div>
      <p className="font-mono text-kg-xs text-text-hint">
        {COMPONENT_CHECK_COPY.CURRENT_VALUE_PREFIX}{" "}
        <code className="rounded bg-surface-hover px-1 text-status-error">
          {currentValue || COMPONENT_CHECK_COPY.EMPTY_VALUE}
        </code>{" "}
        {COMPONENT_CHECK_COPY.NOT_IN_VALID_MODULES}
      </p>
      <div className="flex flex-wrap gap-1">
        {moduleFold.visible.map((m) => (
          <span key={m} className="rounded bg-surface-hover px-1.5 py-0.5 font-mono text-kg-2xs text-text-hint">
            {m}
          </span>
        ))}
        {moduleFold.rest > 0 && (
          <span className="rounded bg-surface-hover px-1.5 py-0.5 font-mono text-kg-2xs text-text-placeholder">
            {componentCheckMoreModulesText(moduleFold.rest)}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <FilterSelect ariaLabel={COMPONENT_CHECK_COPY.SELECT_VALID_MODULE} title={COMPONENT_CHECK_COPY.SELECT_VALID_MODULE} searchPlaceholder={COMPONENT_CHECK_COPY.FILTER_VALID_MODULE} value={selectedModule} onValueChange={(value) => onSelectModule(value as string)} placeholder={COMPONENT_CHECK_COPY.SELECT_VALID_MODULE} className="h-7 flex-1 rounded font-mono text-kg-xs" options={[{ value: "", label: COMPONENT_CHECK_COPY.SELECT_VALID_MODULE_OPTION, group: PROPERTY_GOV_SHARED_COPY.SCOPE_GROUP }, ...validModules.map((value) => ({ value, label: value, group: PROPERTY_GOV_SHARED_COPY.VALID_MODULES_GROUP }))]} />
        <button
          type="button"
          disabled={!selectedModule || isRepairing || !canPropose}
          onClick={() => onRepair("overwrite_module", { module: selectedModule })}
          className="shrink-0 rounded bg-status-error-2 ring-1 ring-status-error-6 px-2 py-1 font-mono text-kg-xs text-status-error hover:bg-red-4 disabled:opacity-30"
        >
          <Wrench className="inline h-3 w-3 mr-0.5" />
          {isRepairing ? PROPERTY_GOV_SHARED_COPY.WRITING_BACK : COMPONENT_CHECK_COPY.WRITE_BACK_MODULE}
        </button>
      </div>
    </div>
  );
}

function StalePropertyCard({
  articleMtime,
  extractedAt,
  isRepairing,
  onRefresh,
}: {
  articleMtime: string;
  extractedAt: string;
  isRepairing: boolean;
  onRefresh: () => Promise<boolean>;
}) {
  const fmtMtime = articleMtime !== "N/A" ? new Date(articleMtime).toLocaleString("zh-CN") : "N/A";
  const fmtExtracted = extractedAt !== "N/A" ? new Date(extractedAt).toLocaleString("zh-CN") : "N/A";

  return (
    <div className="space-y-2 rounded bg-status-warn-2 ring-1 ring-status-warn-6 px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <AlertTriangle className="h-3 w-3 text-status-warn" />
        <span className="font-mono text-kg-xs text-status-warn">{CHECK_LABELS.stale_property}</span>
      </div>
      <div className="space-y-0.5 font-mono text-kg-xs text-text-hint">
        <div>{COMPONENT_CHECK_COPY.ARTICLE_MTIME_PREFIX}<span className="text-status-warn">{fmtMtime}</span></div>
        <div>{COMPONENT_CHECK_COPY.EXTRACTED_AT_PREFIX}<span className="text-text-hint">{fmtExtracted}</span></div>
      </div>
      <button
        type="button"
        disabled={isRepairing}
        onClick={onRefresh}
        className="rounded bg-status-warn-2 ring-1 ring-status-warn-6 px-2 py-1 font-mono text-kg-xs text-status-warn hover:bg-amber-4 disabled:opacity-30"
      >
        <RotateCw className={`inline h-3 w-3 mr-0.5 ${isRepairing ? "animate-spin" : ""}`} />
        {isRepairing ? COMPONENT_CHECK_COPY.QUEUED : COMPONENT_CHECK_COPY.REGENERATE}
      </button>
    </div>
  );
}

function MountMismatchCard() {
  return (
    <div className="space-y-2 rounded bg-status-error-2 ring-1 ring-status-error-6 px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <AlertTriangle className="h-3 w-3 text-status-error" />
        <span className="font-mono text-kg-xs text-status-error">{CHECK_LABELS.mount_mismatch}</span>
      </div>
      <p className="font-mono text-kg-xs text-text-hint">
        {mountMismatchExplanation()}
      </p>
      <p className="font-mono text-kg-2xs text-text-placeholder">
        {mountMismatchGuidance()}
      </p>
    </div>
  );
}

function MountDiagnosticCard({
  entityCount,
  edgeCount,
  missingIds,
}: {
  entityCount: number;
  edgeCount: number;
  missingIds: string[];
}) {
  return (
    <div className="space-y-1.5 rounded bg-surface-card/50 ring-1 ring-border-thin px-2.5 py-2">
      <div className="flex items-center gap-1.5">
        <Info className="h-3 w-3 text-text-hint" />
        <span className="font-mono text-kg-xs text-text-hint">{CHECK_LABELS.mount_diagnostic}</span>
      </div>
      <div className="flex gap-3 font-mono text-kg-xs">
        <span className="text-text-hint">{TERM.ENTITY}: <span className="text-text-sub">{entityCount}</span></span>
        <span className="text-text-hint">{TERM.EDGE}: <span className="text-text-sub">{edgeCount}</span></span>
      </div>
      {missingIds.length > 0 && (
        <div className="font-mono text-kg-2xs text-text-placeholder">
          {COMPONENT_CHECK_COPY.MISSING_ENTITIES_PREFIX}{missingIds.join(", ")}
        </div>
      )}
    </div>
  );
}
