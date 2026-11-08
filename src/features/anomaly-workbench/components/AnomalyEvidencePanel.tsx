import type { AnomalyIssue } from "@/features/anomaly-workbench/anomaly-workbench-types";
import { ObsidianLink } from "@/components/obsidian";
import { Panel } from "@/components/panel";
import { issueImpactText, evidencePath, evidencePathPresentation, issueExplanation, ANOMALY_EVIDENCE_COPY, evidenceStaleReasonText, evidenceExecutionErrorText, evidenceLineNumberText, evidenceCoordinateText } from "@/features/anomaly-workbench/anomaly-workbench-copy";

type Props = {
  issue: AnomalyIssue;
};

// PR-030：候选类（relationCandidate）证据由 AnomalyPeekPanel「采信依据」折叠卡直接承载，
// 驳回动作归位 peek footer 动作区（RelationCandidateRejectForm）——本面板只服务非候选类来源证据。
export function AnomalyEvidencePanel({ issue }: Props) {
  const path = evidencePath(issue);
  const pathPresentation = evidencePathPresentation(path);
  const impactText = issueImpactText(issue);
  return (
    <Panel className="space-y-4" ariaLabel={ANOMALY_EVIDENCE_COPY.PANEL_ARIA}>
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.08em] text-text-hint">{ANOMALY_EVIDENCE_COPY.TITLE}</p>
        {/* 2026-10-16 冗余清理批（Master）：「问题来源+类型 chip」行删除——类型在列表行与卡片标题已示 */}
        {pathPresentation.openableInObsidian ? (
          <ObsidianLink
            sourcePath={path}
            aria-label={`${ANOMALY_EVIDENCE_COPY.OBSIDIAN_OPEN_ARIA_PREFIX}${path}`}
            title={ANOMALY_EVIDENCE_COPY.OBSIDIAN_OPEN_TITLE}
            className="group mt-1 block w-full break-all text-left text-sm text-text-sub hover:text-text-main"
          >
            {pathPresentation.displayName}
          </ObsidianLink>
        ) : (
          <p className="mt-1 break-all text-sm text-text-main" title={pathPresentation.description}>{pathPresentation.displayName}</p>
        )}
        <p className="mt-2 text-xs leading-5 text-text-sub">{issueExplanation(issue.issueKind)}</p>
        {impactText && <p className="mt-2 text-xs text-text-hint">{impactText}</p>}
        {/* 处置方式段已删（Master 2026-10-16：处理入口已由悬浮操作条指引承载） */}
      </div>
      {/* 具体原因块已删（Master 2026-10-16：字段校验规则不需要展示——规则详情归服务端与登记簿） */}
      {(issue.staleReason || issue.executionError) && <div className="rounded-md bg-status-warn-2 px-3 py-2 text-xs text-status-warn ring-1 ring-status-warn-6" role="status">
        {issue.staleReason && <p>{evidenceStaleReasonText(issue.staleReason)}</p>}
        {issue.executionError && <p>{evidenceExecutionErrorText(issue.executionError)}</p>}
      </div>}
      {issue.evidence.some((evidence) => typeof evidence.lineNumber === "number" || typeof evidence.coordinate === "string") && <details className="text-xs text-text-sub"><summary className="cursor-pointer select-none text-text-hint">{ANOMALY_EVIDENCE_COPY.AUDIT_DETAILS_TITLE}</summary><div className="space-y-2 pt-2">
        {issue.evidence.map((evidence, index) => {
          const details = [
            typeof evidence.lineNumber === "number" ? evidenceLineNumberText(evidence.lineNumber) : null,
            typeof evidence.coordinate === "string" ? evidenceCoordinateText(evidence.coordinate) : null,
          ].filter(Boolean);
          return details.length ? <div key={`${evidencePath(issue)}-${index}`} className="flex flex-wrap gap-x-4 gap-y-1 border-t border-border-thin pt-2">{details.map((detail) => <span key={detail}>{detail}</span>)}</div> : null;
        })}
      </div></details>}
    </Panel>
  );
}
