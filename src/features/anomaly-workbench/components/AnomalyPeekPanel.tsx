import { useEffect, useState } from "react";
import { X, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AnomalyIssue } from "@/features/anomaly-workbench/anomaly-workbench-types";
import {
  HANDLING_LABELS,
  statusLabel,
  ANOMALY_PEEK_COPY,
  ANOMALY_OWNER_UNASSIGNED,
  peekPanelAriaLabel,
  peekDerivedRepairHint,
  peekBasisSummaryText,
  peekCandidateVersionLabel,
  peekEndpointResolvedText,
  peekSourceCoordinateText,
  peekCandidateRejectedText,
  peekContentHashLabel,
} from "@/features/anomaly-workbench/anomaly-workbench-copy";
import { ANOMALY_RELATION_REJECT_ACTION } from "@/features/anomaly-workbench/anomaly-workbench-api";
import { AnomalyResolutionForm } from "./AnomalyResolutionForm";
import { formatDateTime } from "@/lib/format";

/** 阻断动作中文名收编 copy 闭集（WP-150）；Record<string,string> 形态保留（未登记枚举回退原文） */
const BLOCKED_ACTION_LABELS: Record<string, string> = ANOMALY_PEEK_COPY.BLOCKED_ACTION_LABELS;
import { AnomalyEvidencePanel } from "./AnomalyEvidencePanel";
import { RelationCandidateRejectForm } from "./RelationCandidateRejectForm";

/**
 * Linear 风 peek 侧栏（task/anomaly-workbench-linear-shell WP3，Master 14:41 批三口径）。
 * 结构=步进器+说明卡+表单段（AnomalyResolutionForm 五形态直嵌复用）+预览确认门禁链
 * +证据卡+九维属性。RPF=持久三态 footer。
 * 动作归位（任务书）：peek 只放页内表单类（preview/confirm/reject 候选类/RPF close·reopen）；
 * 跳转类动作只在勾选操作条（AnomalyActionToolbar），本面板不重复。
 * PR-030：候选驳回归位 footer 动作区（与「确认这次处理」同级，≤1 次点击可达）；
 * 「采信依据」折叠卡只承载证据核对（三元组/哈希/已拒审计），不再内嵌驳回动作。
 */
type Props = {
  issue: AnomalyIssue | null;
  /** 同组候选版本（同 conflictGroupId 的全部候选 issue）——旧 View 平铺语义直迁：每版证据链都可见可切换（relation-candidate-contract 契约） */
  siblingCandidateIssues?: AnomalyIssue[];
  open: boolean;
  onClose: () => void;
  onOperate: (operation: "preview" | "confirm" | "reject" | "close" | "reopen", payload?: Record<string, unknown>) => void;
};

export function AnomalyPeekPanel({ issue, siblingCandidateIssues = [], open, onClose, onOperate }: Props) {
  // 驳回表单展开态（PR-030）：随问题切换收起——表单卸载即重置理由
  const [rejectFormOpen, setRejectFormOpen] = useState(false);
  const issueId = issue?.issueId;
  useEffect(() => { setRejectFormOpen(false); }, [issueId]);
  // 整改五轮：三态——open ?（issue ? 详情 : 空态引导）: 不渲染（手动收起给列表让宽度）
  if (!open) return null;
  if (!issue) {
    return (
      <aside className="hidden w-[380px] shrink-0 flex-col gap-3 overflow-y-auto border-t border-border-thin p-4 xl:border-t-0 xl:border-l xl:flex" aria-label={peekPanelAriaLabel()}>
        <PeekHeader title={ANOMALY_PEEK_COPY.HEADER_TITLE} onClose={onClose} />
        <div className="grid place-items-center gap-1.5 py-16 text-center">
          <p className="text-sm text-text-sub">{ANOMALY_PEEK_COPY.EMPTY_GUIDE_PRIMARY}</p>
          <p className="text-xs text-text-hint">{ANOMALY_PEEK_COPY.EMPTY_GUIDE_INTERACTION}</p>
        </div>
      </aside>
    );
  }

  const action = issue.proposedAction && typeof issue.proposedAction === "object" && !Array.isArray(issue.proposedAction)
    ? (issue.proposedAction as Record<string, unknown>)
    : {};
  const isRpf = issue.issueKind === "release_publication_failure";
  const isDerived = action.type === "derived-graph-repair";
  const manualTypedRelation = action.type === "entity-relation-repair" && Array.isArray(action.unresolvedTargets) && action.unresolvedTargets.length === 0;
  const canConfirm = issue.status === "previewed" && Boolean(issue.previewId) && issue.executionReady !== false;
  // C1/#1793 分野（契约直迁）：语义关系候选（relation-candidate-review）是架构师拒绝专用流
  // ——入图事实必须走正式链，页内/peek 不得出现批准按钮；文章关联候选（article-association*）
  // 走 A1 页内处理链（表单+确认合法）。
  const isReviewOnlyCandidate = issue.relationCandidate !== undefined && String(action.type || "").startsWith("relation-candidate-review");
  const showResolutionForm = !isReviewOnlyCandidate && issue.issueKind !== "stale_source" && ["open", "stale", "previewed", "blocked"].includes(issue.status) && (issue.executionReady !== false || manualTypedRelation);
  const candidate = issue.relationCandidate;

  return (
    <aside
      className="hidden w-[380px] shrink-0 flex-col gap-3 overflow-y-auto border-t border-border-thin p-4 xl:border-t-0 xl:border-l xl:flex"
      aria-label={peekPanelAriaLabel(issue.issueId)}
      onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}
    >
      {/* 整改5：头部显示 ANOM-N（账本序号）；无号回退短 issueId；title 悬浮内部完整键 */}
      <PeekHeader
        title={issue.displaySeq ? `ANOM-${issue.displaySeq}` : issue.issueId.length > 20 ? `${issue.issueId.slice(0, 8)}…${issue.issueId.slice(-8)}` : issue.issueId}
        fullTitle={issue.issueId}
        onClose={onClose}
        badge={`${HANDLING_LABELS[issue.handling]} · ${statusLabel(issue.status)}`}
      />

      <div className="text-sm font-medium text-text-main">{issue.title}</div>

      {/* 四步流程 chip 已删（Master 2026-10-16 裁定：步骤名属旧流程、不可点、信息被处理决定覆盖） */}

      {/* ── 主序（整改4轮·项2）：处理动作在前 ── */}
      {/* 1. 处理决定（五形态直嵌）+确认门禁链——首屏即可完成一次裁决 */}
      {!isRpf && !isDerived && showResolutionForm && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-text-main">{ANOMALY_PEEK_COPY.DECISION_TITLE}</p>
          <AnomalyResolutionForm issue={issue} onPreview={(payload) => onOperate("preview", payload)} />
          {issue.status === "previewed" && (
            <p className="text-kg-xs text-text-hint">{ANOMALY_PEEK_COPY.PREVIEW_FRESH_HINT}</p>
          )}
        </div>
      )}
      {isDerived && (
        <div className="rounded-lg bg-surface-root p-3 text-xs leading-5 text-text-sub ring-1 ring-border-thin">
          {peekDerivedRepairHint()}
        </div>
      )}

      {/* 2. 采信依据折叠卡（默认收起，PR-030 后只承载证据核对）——候选证据整块收纳 + 内部可读化分层：
          一级=候选三元组/端点状态/来源坐标等裁决关键事实；二级「校验信息」子折叠收五组
          哈希与内部键（防篡改对账用）。已拒绝候选的审计理由随证据展示。 */}
      {(() => {
        const versions = issue.relationCandidate ? siblingCandidateIssues.filter((s) => s.relationCandidate) : [];
        const list = versions.length > 0 ? versions : [issue];
        const candidate = issue.relationCandidate;
        if (!candidate) return null;
        return (
          <details className="rounded-lg bg-surface-root ring-1 ring-border-thin">
            <summary className="cursor-pointer select-none px-3 py-2 text-xs font-medium text-text-main">
              {peekBasisSummaryText(list.length)}<span className="ml-1 font-normal text-text-hint">{ANOMALY_PEEK_COPY.BASIS_COLLAPSED_HINT}</span>
            </summary>
            <div className="space-y-3 px-3 pb-3">
              {list.map((current, index) => {
                const c = current.relationCandidate!;
                return (
                  <div key={current.issueId} className="space-y-2 border-t border-border-thin pt-2 first:border-t-0 first:pt-0">
                    {list.length > 1 && <p className="text-kg-xs text-text-hint">{peekCandidateVersionLabel(index, list.length)}</p>}
                    {/* 一级：裁决关键事实（不用点二级） */}
                    <div className="space-y-1.5">
                      {c.triples.map((triple) => (
                        <div key={triple.tripleId} className="rounded-md bg-surface-card p-2 ring-1 ring-border-thin">
                          <p className="break-all text-xs font-medium text-text-main">{triple.sourceNodeId} · {triple.relationType} · {triple.targetNodeId}</p>
                          <p className="mt-1 text-kg-xs text-text-hint">
                            {triple.targetEndpointStatus === "unknown" ? ANOMALY_PEEK_COPY.TRIPLE_TARGET_UNKNOWN : peekEndpointResolvedText(triple.direction)}
                          </p>
                          {triple.evidence.slice(0, 1).map((evidence) => (
                            <p key={evidence.evidenceId} className="mt-0.5 break-all text-kg-xs text-text-hint" title={evidence.coordinate}>{peekSourceCoordinateText(evidence.coordinate)}</p>
                          ))}
                        </div>
                      ))}
                    </div>
                    {/* 已拒绝候选的审计注记（PR-030：驳回动作已归位 footer，卡内只留证据与已拒事实） */}
                    {c.candidateStatus === "rejected" && (
                      <p className="text-kg-xs text-text-hint">
                        {peekCandidateRejectedText(c.rejection?.reason)}
                      </p>
                    )}
                    {/* 二级：校验信息（哈希/内部键，防篡改对账，默认收起） */}
                    <details className="rounded-md bg-surface-card ring-1 ring-border-thin">
                      <summary className="cursor-pointer select-none px-2 py-1.5 text-kg-xs text-text-hint">{ANOMALY_PEEK_COPY.HASH_SECTION_TITLE}</summary>
                      <div className="space-y-1 px-2 pb-2">
                        <HashRow label={ANOMALY_PEEK_COPY.HASH_LABEL_GROUP} value={c.conflictGroupId} />
                        <HashRow label={ANOMALY_PEEK_COPY.HASH_LABEL_CANDIDATE_ID} value={c.candidateId} />
                        <HashRow label={ANOMALY_PEEK_COPY.HASH_LABEL_CANDIDATE_HASH} value={c.candidateHash} />
                        <HashRow label={ANOMALY_PEEK_COPY.HASH_LABEL_EVIDENCE_SET} value={c.evidenceSetHash} />
                        <HashRow label={ANOMALY_PEEK_COPY.HASH_LABEL_SOURCE_SET} value={c.sourceSetHash} />
                        {c.triples.map((triple) => triple.evidence.map((evidence) => (
                          <HashRow key={evidence.evidenceId} label={peekContentHashLabel(evidence.evidenceId.slice(0, 8))} value={evidence.contentHash} />
                        )))}
                      </div>
                    </details>
                  </div>
                );
              })}
            </div>
          </details>
        );
      })()}

      {/* 3. 普通类（非候选）：证据面板（含具体原因/审计详情/Obsidian 打开） */}
      {!issue.relationCandidate && !isRpf && (
        <AnomalyEvidencePanel issue={issue} />
      )}

      {/* 4. 驳回表单（PR-030：候选类高频动作——footer 按钮展开，动作区直出） */}
      {candidate && candidate.candidateStatus !== "rejected" && rejectFormOpen && (
        <RelationCandidateRejectForm
          onReject={(payload) => { setRejectFormOpen(false); onOperate("reject", payload); }}
          rejecting={false}
        />
      )}

      {/* 属性栅格（2026-10-16 信息有效性批瘦身）：处置模式/状态/类型＝头部胶囊已示、来源＝证据区全径已示，
          执行就绪/候选/内部 ID＝内部标志与调试标识不上面板；保留三字段并中文化/格式化
          （阻断原始枚举→中文动作名，检出 ISO 原文→统一时间格式） */}
      <div className="grid grid-cols-3 gap-x-3 gap-y-1.5 rounded-lg bg-surface-root p-3 ring-1 ring-border-thin">
        <Prop label={ANOMALY_PEEK_COPY.PROP_BLOCKED} value={issue.blockedActions.length ? issue.blockedActions.map((a) => BLOCKED_ACTION_LABELS[a] ?? a).join("、") : ANOMALY_PEEK_COPY.PROP_VALUE_NONE} />
        <Prop label={ANOMALY_PEEK_COPY.PROP_OWNER} value={issue.owner ?? ANOMALY_OWNER_UNASSIGNED} />
        <Prop label={ANOMALY_PEEK_COPY.PROP_DETECTED} value={issue.createdAt ? formatDateTime(issue.createdAt) : "—"} />
      </div>

      {/* footer：动作归位——表单类 only；候选类高频驳回动作同级直出（PR-030） */}
      <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border-thin pt-3">
        {isRpf ? (
          issue.status === "closed"
            ? <Button size="sm" onClick={() => onOperate("reopen", {})}>{ANOMALY_PEEK_COPY.REOPEN_ACTION}</Button>
            : <Button size="sm" variant="outline" onClick={() => onOperate("close", {})}>{ANOMALY_PEEK_COPY.CLOSE_EXPLICIT_ACTION}</Button>
        ) : (
          <>
            {!isDerived && showResolutionForm && (
              <Button
                size="sm"
                disabled={!canConfirm}
                onClick={() => onOperate("confirm", { previewId: issue.previewId })}
                title={canConfirm ? ANOMALY_PEEK_COPY.CONFIRM_READY_TITLE : ANOMALY_PEEK_COPY.CONFIRM_BLOCKED_TITLE}
              >
                {ANOMALY_PEEK_COPY.CONFIRM_ACTION}
              </Button>
            )}
            {candidate && candidate.candidateStatus !== "rejected" && (
              <Button
                size="sm"
                variant="outline"
                aria-expanded={rejectFormOpen}
                onClick={() => setRejectFormOpen((v) => !v)}
                data-action-id={ANOMALY_RELATION_REJECT_ACTION.id}
                data-risk={ANOMALY_RELATION_REJECT_ACTION.risk}
                data-channel={ANOMALY_RELATION_REJECT_ACTION.dataChannel}
              >
                <XCircle className="mr-1.5 h-4 w-4" />{ANOMALY_PEEK_COPY.REJECT_CANDIDATE_ACTION}
              </Button>
            )}
            {candidate && candidate.candidateStatus === "rejected" && (
              <span className="text-kg-xs text-text-hint">
                {peekCandidateRejectedText(candidate.rejection?.reason)}
              </span>
            )}
            <span className="text-kg-xs text-text-hint">{ANOMALY_PEEK_COPY.HANDOFF_HINT}</span>
          </>
        )}
      </div>
    </aside>
  );
}

function PeekHeader({ title, fullTitle, badge, onClose }: { title: string; fullTitle?: string; badge?: string; onClose: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="font-mono text-kg-xs text-text-hint" title={fullTitle ?? title}>{title}</span>
      {badge && <span className="rounded bg-surface-hover px-1.5 py-0.5 text-kg-xs text-text-sub">{badge}</span>}
      <span className="flex-1" />
      <button type="button" aria-label={ANOMALY_PEEK_COPY.CLOSE_HEADER_ARIA} onClick={onClose} className="rounded p-1 text-text-hint hover:bg-surface-hover hover:text-text-main">
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

function Prop({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-kg-xs text-text-hint">{label}</p>
      <p className="truncate text-kg-xs text-text-sub" title={value}>{value}</p>
    </div>
  );
}

/** 哈希/长 ID 截断行（整改4轮·项2：校验信息二级视图，title 悬浮全文） */
function HashRow({ label, value }: { label: string; value: string }) {
  const short = value && value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-8)}` : value || "—";
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2">
      <span className="shrink-0 text-kg-xs text-text-hint">{label}</span>
      <span className="min-w-0 truncate font-mono text-kg-xs text-text-sub" title={value}>{short}</span>
    </div>
  );
}
