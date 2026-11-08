import { ArrowRight, Link2 } from "lucide-react";
import { FilterSelect } from "@/components/filter-select";
import { SidePanelSection } from "@/components/side-panel";
import { TERM } from "@/constants/term-const";
import { useEntityComplianceStore } from "./entity-compliance-store";
import { RELATION_TYPES } from "@/lib/generated/ontology-registry";
import { ENTITY_COMPLIANCE_COPY, EC_RELATION_REPAIR_COPY } from "./entity-compliance-copy";

const OPERATION_OPTIONS = [
  { value: "add", label: EC_RELATION_REPAIR_COPY.OP_ADD, group: EC_RELATION_REPAIR_COPY.OP_GROUP_HANDLE },
  { value: "replace", label: EC_RELATION_REPAIR_COPY.OP_REPLACE, group: EC_RELATION_REPAIR_COPY.OP_GROUP_HANDLE },
  { value: "remove", label: EC_RELATION_REPAIR_COPY.OP_REMOVE, group: EC_RELATION_REPAIR_COPY.OP_GROUP_RISK },
];

const DIRECTION_OPTIONS = [
  { value: "outgoing", label: EC_RELATION_REPAIR_COPY.DIR_OUTGOING, group: EC_RELATION_REPAIR_COPY.DIR_GROUP },
  { value: "incoming", label: EC_RELATION_REPAIR_COPY.DIR_INCOMING, group: EC_RELATION_REPAIR_COPY.DIR_GROUP },
];

// Registry-derived relation type options: only typed_wikilink relations that are writable
const WRITABLE_RELATION_OPTIONS = Object.entries(RELATION_TYPES)
  .filter(([, def]) => def.factEncoding === "typed_wikilink")
  .map(([type, def]) => ({
    value: def.label,
    label: def.label,
    type,
    versionable: def.versionable === true,
    group: EC_RELATION_REPAIR_COPY.RELATION_MEANING,
  }));

export function RelationRepairPanel() {
  const entity = useEntityComplianceStore((state) => state.selectedEntity);
  const data = useEntityComplianceStore((state) => state.data);
  const relationPatch = useEntityComplianceStore((state) => state.relationPatch);
  const setRelationPatch = useEntityComplianceStore((state) => state.setRelationPatch);
  const entities = data?.items || [];
  const operation = relationPatch?.operation || "add";
  const relationType = relationPatch?.relationType || RELATION_TYPES.DEPENDS_ON.label; // 缺省＝依赖（registry 正名单源，不手写）
  const direction = relationPatch?.direction || "outgoing";
  const targetId = relationPatch?.targetId || "";
  const currentName = entity?.title || entity?.entityId || EC_RELATION_REPAIR_COPY.CURRENT_COMPONENT;
  const target = entities.find((item) => item.entityId === targetId);
  const targetName = target?.title || targetId || EC_RELATION_REPAIR_COPY.TARGET_COMPONENT;
  const targetOptions = entities
    .filter((item) => item.entityId && item.entityId !== entity?.entityId)
    .map((item) => ({ value: item.entityId || "", label: item.title || item.entityId || item.fileName || TERM.UNNAMED_ARCH_COMPONENT, group: TERM.ARCH_COMPONENT }));

  const selectedRelationDef = WRITABLE_RELATION_OPTIONS.find((opt) => opt.value === relationType);
  const isVersionable = selectedRelationDef?.versionable ?? false;
  const versionRange = relationPatch?.versionRange ?? { since: "", until: "" };

  function update(next: Partial<NonNullable<typeof relationPatch>>) {
    setRelationPatch({
      operation, relationType, direction, targetId,
      versionRange: relationPatch?.versionRange ?? { since: "", until: "" },
      ...next,
    });
  }

  function updateVersionRange(field: "since" | "until", value: string) {
    setRelationPatch({
      operation, relationType, direction, targetId,
      versionRange: {
        ...(relationPatch?.versionRange ?? { since: "", until: "" }),
        [field]: value,
      },
    });
  }

  return <SidePanelSection title={ENTITY_COMPLIANCE_COPY.RELATION_REPAIR_TITLE} icon={Link2} ariaLabel={EC_RELATION_REPAIR_COPY.SECTION_ARIA} className="space-y-3">
    <p className="text-xs leading-5 text-text-hint">{TERM.RELATION_REPAIR_HINT}</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1.5"><span className="text-xs text-text-hint">{EC_RELATION_REPAIR_COPY.LABEL_OPERATION}</span><FilterSelect ariaLabel={EC_RELATION_REPAIR_COPY.OPERATION_ARIA} title={EC_RELATION_REPAIR_COPY.OPERATION_TITLE} value={operation} onValueChange={(value) => update({ operation: value as typeof operation })} className="w-full" options={OPERATION_OPTIONS} /></label>
      <label className="space-y-1.5"><span className="text-xs text-text-hint">{EC_RELATION_REPAIR_COPY.RELATION_MEANING}</span><FilterSelect ariaLabel={EC_RELATION_REPAIR_COPY.RELATION_MEANING} title={EC_RELATION_REPAIR_COPY.RELATION_TITLE} value={relationType} onValueChange={(value) => update({ relationType: value as string })} className="w-full" options={WRITABLE_RELATION_OPTIONS} /></label>
      <label className="space-y-1.5"><span className="text-xs text-text-hint">{EC_RELATION_REPAIR_COPY.LABEL_DIRECTION}</span><FilterSelect ariaLabel={EC_RELATION_REPAIR_COPY.DIR_GROUP} title={EC_RELATION_REPAIR_COPY.DIRECTION_TITLE} value={direction} onValueChange={(value) => update({ direction: value as typeof direction })} className="w-full" options={DIRECTION_OPTIONS} /></label>
      <label className="space-y-1.5"><span className="text-xs text-text-hint">{EC_RELATION_REPAIR_COPY.TARGET_COMPONENT}</span><FilterSelect ariaLabel={EC_RELATION_REPAIR_COPY.TARGET_ARIA} title={EC_RELATION_REPAIR_COPY.TARGET_TITLE} searchPlaceholder={EC_RELATION_REPAIR_COPY.TARGET_SEARCH_PLACEHOLDER} value={targetId} onValueChange={(value) => update({ targetId: value as string })} placeholder={targetOptions.length ? EC_RELATION_REPAIR_COPY.TARGET_PLACEHOLDER : EC_RELATION_REPAIR_COPY.TARGET_EMPTY} disabled={targetOptions.length === 0} className="w-full" options={targetOptions} /></label>
    </div>
    {isVersionable && (
      <div className="space-y-2">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="space-y-1.5">
            <span className="text-xs text-text-hint">{EC_RELATION_REPAIR_COPY.SINCE_LABEL}</span>
            <input
              type="text"
              className="w-full rounded border border-border-thin bg-surface-root px-2 py-1.5 text-xs"
              placeholder={EC_RELATION_REPAIR_COPY.SINCE_PLACEHOLDER}
              value={versionRange.since ?? ""}
              onChange={(e) => updateVersionRange("since", e.target.value)}
            />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs text-text-hint">{EC_RELATION_REPAIR_COPY.UNTIL_LABEL}</span>
            <input
              type="text"
              className="w-full rounded border border-border-thin bg-surface-root px-2 py-1.5 text-xs"
              placeholder={EC_RELATION_REPAIR_COPY.UNTIL_PLACEHOLDER}
              value={versionRange.until ?? ""}
              onChange={(e) => updateVersionRange("until", e.target.value)}
            />
          </label>
        </div>
        {(versionRange.since || versionRange.until) && (
          <div className="rounded bg-surface-root px-2 py-1">
            <code className="text-xs text-cyan-11">
              @effective(since={versionRange.since || ""}, until={versionRange.until || ""})
            </code>
          </div>
        )}
      </div>
    )}
    <div className="flex min-h-9 items-center gap-2 rounded bg-surface-root px-3 text-xs text-text-sub ring-1 ring-border-thin">
      <span className="truncate">{direction === "outgoing" ? currentName : targetName}</span><ArrowRight className="h-4 w-4 shrink-0 text-text-hint" /><span className="shrink-0 text-cyan-11">{relationType}</span><ArrowRight className="h-4 w-4 shrink-0 text-text-hint" /><span className="truncate">{direction === "outgoing" ? targetName : currentName}</span>
      {(versionRange.since || versionRange.until) && (
        <span className="shrink-0 text-xs text-text-hint">@effective({versionRange.since || ""}..{versionRange.until || ""})</span>
      )}
    </div>
    <p className="text-xs text-text-hint">{EC_RELATION_REPAIR_COPY.FOOTER_HINT}</p>
  </SidePanelSection>;
}
