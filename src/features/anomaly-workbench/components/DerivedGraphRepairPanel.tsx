import { ArrowRight, FileWarning, GitBranch, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AnomalyIssue } from "@/features/anomaly-workbench/anomaly-workbench-types";
import { anomalyActionTarget, statusLabel, ANOMALY_DERIVED_REPAIR_COPY, ANOMALY_DERIVED_REPAIR_STEPS, derivedGraphPublishActionLabel, derivedRepairStepsAriaLabel } from "@/features/anomaly-workbench/anomaly-workbench-copy";
import { TERM } from "@/constants/term-const";
import { safeNavigateHash } from "@/lib/navigation";

type Props = {
  issues: AnomalyIssue[];
};

function unapprovedArticleCount(issue: AnomalyIssue | undefined) {
  if (!issue) return 0;
  const articleEvidence = issue.evidence.filter((item) => {
    const value = item as Record<string, unknown>;
    return typeof value.articleId === "string" || String(value.coordinate || "").startsWith("node:");
  });
  return articleEvidence.length;
}

export function DerivedGraphRepairPanel({ issues }: Props) {
  // 2026-10-08 裁决 3：derived_graph_contamination 幽灵类型摘除（生产者零，B 案删除）。
  // 面板本体保留——服务 missing_lineage 真类型；representative 直接取 issues[0]。
  // 「误入派生图的文章节点」计数改从 missing_lineage 证据面统计（articleId/node: 坐标）。
  const representative = issues[0];
  if (!representative) return null;

  const relationCount = issues.filter((issue) => issue.issueKind === "missing_lineage").length;
  const articleCount = issues.reduce((sum, issue) => sum + unapprovedArticleCount(issue), 0);
  const target = anomalyActionTarget(representative);
  const handlePrimaryAction = () => { if (target) safeNavigateHash(target.hash); };

  return (
    <section className="overflow-hidden rounded-lg bg-surface-root ring-1 ring-status-warn-6" aria-label={TERM.DERIVED_GRAPH_REPAIR_BATCH}>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border-thin px-4 py-4">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 text-status-warn">
            <ShieldCheck className="h-4 w-4" />
            <h2 className="text-sm font-semibold text-text-main">{ANOMALY_DERIVED_REPAIR_COPY.TITLE}</h2>
            <span className="rounded bg-status-warn-2 px-2 py-0.5 text-kg-xs">{statusLabel(representative.status)}</span>
          </div>
          <p className="mt-2 text-xs leading-5 text-text-sub">
            {ANOMALY_DERIVED_REPAIR_COPY.NOTE}
          </p>
        </div>
        <Button size="sm" onClick={handlePrimaryAction} disabled={!target}>
          <ArrowRight className="mr-1.5 h-4 w-4" />
          {derivedGraphPublishActionLabel()}
        </Button>
      </div>

      <div className="grid border-b border-border-thin sm:grid-cols-3">
        <div className="flex items-center gap-3 px-4 py-3 sm:border-r sm:border-border-thin">
          <FileWarning className="h-4 w-4 text-status-error" />
          <div><p className="text-kg-xs text-text-hint">{ANOMALY_DERIVED_REPAIR_COPY.STAT_UNAPPROVED_ARTICLES}</p><p className="text-lg font-semibold tabular-nums text-text-main">{articleCount}</p></div>
        </div>
        <div className="flex items-center gap-3 border-t border-border-thin px-4 py-3 sm:border-r sm:border-t-0">
          <GitBranch className="h-4 w-4 text-status-warn" />
          <div><p className="text-kg-xs text-text-hint">{ANOMALY_DERIVED_REPAIR_COPY.STAT_MISSING_LINEAGE}</p><p className="text-lg font-semibold tabular-nums text-text-main">{relationCount}</p></div>
        </div>
        <div className="border-t border-border-thin px-4 py-3 sm:border-t-0">
          <p className="text-kg-xs text-text-hint">{ANOMALY_DERIVED_REPAIR_COPY.STAT_IMPACT}</p>
          <p className="mt-1 text-xs font-medium text-status-error">{ANOMALY_DERIVED_REPAIR_COPY.STAT_IMPACT_NOTE}</p>
        </div>
      </div>

      <div className="px-4 py-4">
        <p className="text-xs font-medium text-text-main">{ANOMALY_DERIVED_REPAIR_COPY.STEPS_TITLE}</p>
        <ol className="mt-3 grid gap-2 sm:grid-cols-4" aria-label={derivedRepairStepsAriaLabel()}>
          {ANOMALY_DERIVED_REPAIR_STEPS.map((step, index) => (
            <li key={index + 1} className="px-3 py-1">
              <p className="text-xs font-medium text-text-main"><span className="mr-1.5 text-text-hint">{index + 1}.</span>{step.title}</p>
              <p className="mt-1 text-kg-xs leading-4 text-text-hint">{step.description}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
