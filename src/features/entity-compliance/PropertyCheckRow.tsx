import type { ComplianceFinding } from "./entity-compliance-types";
import { fieldLabel as resolveFieldLabel } from "@/lib/domain/entity-repair-api";
import { CircleAlert, AlertTriangle, Info, CheckCircle2 } from "lucide-react";
import { TERM } from "@/constants/term-const";
import { EC_CHECK_ROW_COPY } from "./entity-compliance-copy";

// #1510（seq184）tsc 严格 union：三表键类型从 Record<string,...> 收紧为契约枚举（error|warn|info），
// 键拼错编译期即红（seq182 只对齐了键值，当年 blocker 键溜进正是键类型不设防所致）
const SEV_COLOR: Record<NonNullable<ComplianceFinding["severity"]>, string> = {
  error: "text-status-error bg-status-error-2 border-status-error-6",
  warn: "text-status-warn bg-status-warn-2 border-status-warn-6",
  info: "text-sky-10 bg-sky-2 border-sky-6",
};
// seq182：表键对齐契约枚举（http-api.openapi.json ComplianceFinding: error|warn|info，
// 与 entity-compliance-severity.cjs 单源一致）；legacy blocker/warning 已被服务端归一化，不再产出。
const SEV_ICON: Record<NonNullable<ComplianceFinding["severity"]>, typeof CircleAlert> = { error: CircleAlert, warn: AlertTriangle, info: Info };
const SEV_LABEL: Record<NonNullable<ComplianceFinding["severity"]>, string> = { error: TERM.BLOCKER, warn: TERM.WARNING, info: TERM.INFO };

// seq208 值所有权法则：行内「现值」唯一来源=sourceValues（源文档）；finding.value 诊断回显退役（ESLint 执法）
export function PropertyCheckRow({ finding, sourceValues }: { finding: ComplianceFinding; sourceValues?: Record<string, unknown> | null }) {
  // seq209：中文名走 shared/field-labels.mjs 单源（经 entity-repair-api.fieldLabel 转出）
  const fieldLabel = finding.field ? resolveFieldLabel(finding.field) : finding.label || TERM.FIELD_LABEL_FALLBACK;
  const sourceValue = (finding.field && sourceValues && finding.field in sourceValues) ? sourceValues[finding.field] : undefined;
  if (finding.passed) {
    return (
      <div className="flex items-center gap-2 pl-5 py-0.5 text-xs text-text-placeholder">
        <CheckCircle2 className="h-3 w-3 text-status-fact-11 shrink-0" />
        <span className="w-[140px] shrink-0 text-text-hint">{fieldLabel}</span>
        <span className="text-text-placeholder">{sourceValue != null ? String(sourceValue) : "—"}</span>
      </div>
    );
  }

  const severity = finding.severity;
  const Icon = (severity && SEV_ICON[severity]) || CircleAlert;

  return (
    <div className="grid grid-cols-[20px_140px_minmax(0,1fr)_auto] gap-2 pl-5 py-1 text-xs items-start border-b border-border-thin/40 last:border-0">
      <Icon className="h-4 w-4 mt-px shrink-0 text-status-error" />
      <span className="text-text-sub shrink-0 truncate">{fieldLabel}</span>
      <div className="min-w-0">
        <div className="flex items-baseline gap-1.5 flex-wrap">
          {sourceValue != null && <span className="text-text-hint line-through">{String(sourceValue)}</span>}
          {finding.expected != null && <span className="text-text-placeholder">→ {String(finding.expected)}</span>}
        </div>
        <p className="text-text-hint mt-0.5">{finding.message}</p>
        {finding.hint && <p className="text-text-placeholder mt-0.5">{finding.hint}</p>}
      </div>
      <span className={`shrink-0 px-1.5 py-0.5 rounded text-kg-xs font-medium border ${(severity && SEV_COLOR[severity]) || ""}`}>{severity ? (SEV_LABEL[severity] ?? EC_CHECK_ROW_COPY.UNGRADED) : EC_CHECK_ROW_COPY.UNGRADED}</span>
    </div>
  );
}
