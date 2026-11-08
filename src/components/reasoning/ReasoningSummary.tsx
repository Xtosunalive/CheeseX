import { AlertTriangle, CheckCircle2, CirclePause, ShieldX } from "lucide-react";
import type { components } from "@/lib/generated/api-types";
import { REASONING_STATUS_COPY, REASONING_SUMMARY_COPY, reasoningSummaryCounts } from "../components-copy";

type ReasoningEvaluation = components["schemas"]["ReasoningEvaluation"];

const PRESENTATION: Record<ReasoningEvaluation["status"], { label: string; detail: string; tone: string }> = {
  clear: { ...REASONING_STATUS_COPY.clear, tone: "text-status-fact bg-status-fact-2 ring-status-fact-6" },
  change_required: { ...REASONING_STATUS_COPY.change_required, tone: "text-cyan-11 bg-cyan-2 ring-cyan-6" },
  waived: { ...REASONING_STATUS_COPY.waived, tone: "text-status-fact bg-status-fact-2 ring-status-fact-6" },
  blocked: { ...REASONING_STATUS_COPY.blocked, tone: "text-status-error bg-status-error-2 ring-status-error-6" },
  review_required: { ...REASONING_STATUS_COPY.review_required, tone: "text-status-warn bg-status-warn-2 ring-status-warn-6" },
  conflicted: { ...REASONING_STATUS_COPY.conflicted, tone: "text-status-warn bg-status-warn-2 ring-status-warn-6" },
  stale: { ...REASONING_STATUS_COPY.stale, tone: "text-status-error bg-status-error-2 ring-status-error-6" },
};

export function ReasoningSummary({ data }: { data: ReasoningEvaluation }) {
  const presentation = PRESENTATION[data.status];
  const Icon = data.writeAllowed ? CheckCircle2 : data.status === "review_required" ? CirclePause : data.status === "blocked" || data.status === "stale" ? ShieldX : AlertTriangle;
  return (
    <section aria-label={REASONING_SUMMARY_COPY.SECTION_ARIA} className={`flex items-start gap-3 rounded-md p-3 text-xs ring-1 ${presentation.tone}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0">
        <div className="font-medium">{presentation.label}</div>
        <div className="mt-0.5 text-text-sub">{presentation.detail}</div>
        <div className="mt-1 text-text-hint">{reasoningSummaryCounts(data.candidates.length, data.conflicts.length)}</div>
      </div>
    </section>
  );
}
