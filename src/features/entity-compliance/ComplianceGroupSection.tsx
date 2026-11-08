import { useState } from "react";
import type { ComplianceFinding, ComplianceGroup } from "./entity-compliance-types";
import { PropertyCheckRow } from "./PropertyCheckRow";
import { ChevronDown, ChevronRight, CircleAlert, AlertTriangle } from "lucide-react";

// seq193：未过计数表键=契约枚举（ComplianceFinding.severity: error|warn|info），
// 消除无锚字面量比较（seq182 修法同款：查表键对齐契约值集）。
const FAILED_COUNTS: Record<NonNullable<ComplianceFinding["severity"]>, number> = { error: 0, warn: 0, info: 0 };

export function ComplianceGroupSection({ group, sourceValues }: { group: ComplianceGroup; sourceValues?: Record<string, unknown> | null }) {
  // B5a 对齐：后端产出 severity=error/warn/info（SEVERITY 唯一枚举，契约已同步），不再查 blocker/warning 幽灵值
  const failedCounts = { ...FAILED_COUNTS };
  for (const c of group.checks ?? []) {
    if (!c.passed && c.severity) failedCounts[c.severity] += 1;
  }
  const hasBlocker = failedCounts.error > 0;
  const hasWarning = failedCounts.warn > 0;
  const [open, setOpen] = useState(!!hasBlocker || !!hasWarning);

  return (
    <div>
      <button onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 py-1 text-xs text-text-hint hover:text-text-sub">
        {open ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        <span>{group.label}</span>
        {hasBlocker && <CircleAlert className="h-3 w-3 text-status-error" />}
        {!hasBlocker && hasWarning && <AlertTriangle className="h-3 w-3 text-status-warn" />}
        {!hasBlocker && !hasWarning && group.checks?.length ? (
          <span className="ml-auto text-text-placeholder">{group.checks.filter((c) => c.passed).length}/{group.checks.length}</span>
        ) : null}
      </button>
      {open && group.checks?.map((c) => <PropertyCheckRow key={c.ruleId} finding={c} sourceValues={sourceValues} />)}
    </div>
  );
}
