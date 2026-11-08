import { useCallback, useEffect, useRef, useState } from "react";
import { Check, CheckCircle2, GitBranch, Package, RefreshCw, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Panel } from "@/components/panel";
import { ApiError, formatApiErrorMessage } from "@/lib/api";
import { fetchApprovalCandidates, getApprovalStatus, transitionApproval, type ApprovalCandidate, type ApprovalOperation, type ApprovalStatus, type ApprovalStatusView } from "./approval-api";
import { standardizeArticle } from "@/features/article-workflow";
import { approvalStatusDisplay, standardizationStatusDisplay, type StatusDisplayTone } from "@/lib/domain/StatusDisplay";
import { TERM } from "@/constants/term-const";
import { APPROVAL_WORKBENCH_COPY, approvalCurrentRolesLine, approvalRequiredRolesLine } from "./approval-workbench-copy";

// 状态机步骤指示器（复用 anomaly workflowSteps/activeWorkflowStep 模式）
import { AnomalyGateNotice } from "@/features/anomaly-workbench";

const WORKFLOW_STEPS = APPROVAL_WORKBENCH_COPY.WORKFLOW_STEPS;

// 状态显示经 status-display 域单源（PR-130）：label/tone 现算，样式按 tone 四档映射
// （主题样式映射非状态第二份事实——状态键五条收敛为 tone 四条）。
const TONE_STYLE: Record<StatusDisplayTone, string> = {
  neutral: "bg-slate-2 text-text-sub ring-slate-6",
  warn: "bg-status-warn-2 text-status-warn ring-status-warn-6",
  fact: "bg-status-fact-2 text-status-fact ring-status-fact-6",
  error: "bg-status-error-2 text-status-error ring-status-error-6",
};

function activeWorkflowStep(status: ApprovalStatus): number {
  if (status === "draft") return 0;
  if (status === "pending") return 1;
  if (status === "approved") return 2;
  if (status === "rejected") return 1;
  return 3; // snapshot
}

function roleList(value: unknown): string[] | null {
  if (!Array.isArray(value) || !value.every((role): role is string => typeof role === "string" && role.trim() !== "")) return null;
  return value.map((role) => role.trim());
}

function approvalErrorMessage(error: unknown, fallback: string): string {
  const message = error instanceof Error ? error.message : fallback;
  if (!(error instanceof ApiError) || error.errorCode !== "ROLE_DENIED") return message;
  // 角色要求只取本次服务端详情；不按按钮猜角色，也不另抄角色词表。
  const details = error.details;
  const required = details && typeof details === "object" && "required" in details ? roleList(details.required) : null;
  const have = details && typeof details === "object" && "have" in details ? roleList(details.have) : null;
  const lines = [message];
  if (required?.length) lines.push(approvalRequiredRolesLine(required));
  if (have) lines.push(approvalCurrentRolesLine(have));
  lines.push(APPROVAL_WORKBENCH_COPY.ROLE_DENIED_GUIDANCE);
  return formatApiErrorMessage(lines.join("\n"), error.traceId);
}

interface ApprovalWorkbenchProps {
  /** 指定文章 ID；不传时从真实候选（precleaned）列表加载并选择 */
  articleId?: string;
  title: string;
}

export function ApprovalWorkbench({ articleId, title }: ApprovalWorkbenchProps) {
  const [candidates, setCandidates] = useState<ApprovalCandidate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(articleId ?? null);
  const [status, setStatus] = useState<ApprovalStatusView | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const loadVersion = useRef(0);
  const [error, setError] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState("");

  const activeArticleId = selectedId;

  const load = useCallback(async () => {
    const version = ++loadVersion.current;
    setLoading(true);
    try {
      // 候选与审批记录一起更新，避免用旧源哈希比较新审批绑定。
      const fresh = await fetchApprovalCandidates();
      const targetId = activeArticleId ?? fresh[0]?.id ?? null;
      const s = targetId ? await getApprovalStatus(targetId) : null;
      if (version !== loadVersion.current) return;
      setCandidates(fresh);
      setSelectedId(targetId);
      setStatus(s);
      setError(null);
    } catch (e) {
      if (version !== loadVersion.current) return;
      setStatus(null);
      setError(approvalErrorMessage(e, APPROVAL_WORKBENCH_COPY.LOAD_STATUS_FAILED));
    } finally {
      if (version === loadVersion.current) setLoading(false);
    }
  }, [activeArticleId]);

  useEffect(() => {
    void load();
    return () => { loadVersion.current += 1; };
  }, [load]);

  const operate = async (operation: ApprovalOperation, input: Record<string, unknown> = {}) => {
    if (!activeArticleId) return;
    setBusy(true); setError(null);
    try {
      // B2/D2：confirm/publish 证据必须绑定当前源字节——操作前刷新候选列表并取该文章最新
      // formalContentHash/sourcePath（一次性刷新，不建轮询；防陈旧参数触发 409 假警报）。
      let evidenceSource = selectedCandidate;
      if (operation === "confirm" || operation === "publish") {
        try {
          const fresh = await fetchApprovalCandidates();
          setCandidates(fresh);
          evidenceSource = fresh.find((c) => c.id === activeArticleId) ?? evidenceSource;
        } catch { /* 刷新失败保留现有候选（服务端仍会以源文件现算交叉校验兜底） */ }
      }
      // 决策证据绑定：confirm/reject/publish 携带文章 contentHash + sourcePath（服务端以源文件现算为准）
      const evidence: Record<string, unknown> = operation === "publish"
        ? { sourcePath: evidenceSource?.sourcePath, contentHash: evidenceSource?.formalContentHash ?? undefined, title: evidenceSource?.title }
        : (operation === "confirm" || operation === "reject")
          ? { contentHash: evidenceSource?.formalContentHash ?? undefined, sourcePath: evidenceSource?.sourcePath, ...input }
          : input;
      const result = await transitionApproval(activeArticleId, operation, evidence);
      setStatus({ status: result.status, revision: result.revision ?? status?.revision ?? null, updatedAt: result.updatedAt });
      if (operation === "reject") setRejectReason("");
    } catch (e) {
      setError(approvalErrorMessage(e, APPROVAL_WORKBENCH_COPY.OPERATE_FAILED));
    } finally { setBusy(false); }
  };


  // 前端触发真实标准化（article-workflow）+ 成功后状态机进入待审（源头校验通过才放行）
  const standardizeAndSubmit = async () => {
    if (!activeArticleId) return;
    setBusy(true); setError(null);
    try {
      const standardized = await standardizeArticle(activeArticleId);
      const hash = standardized?.formalContentHash || standardized?.currentStandardVersion?.contentHash || null;
      // seq201（前端纯净度规则①清存量）：契约异常形态守卫改中性技术诊断——成功态无后端 error 文案可回显，不再自造业务话术
      if (!hash) throw new Error("standardization response is missing formalContentHash");
      const result = await transitionApproval(activeArticleId, "standardize", { contentHash: hash, sourcePath: selectedCandidate?.sourcePath, title: selectedCandidate?.title });
      setCandidates((current) => current.map((candidate) => candidate.id === activeArticleId
        ? { ...candidate, standardizationStatus: standardized.standardizationStatus, formalContentHash: hash }
        : candidate));
      setStatus({ status: result.status, revision: result.revision ?? null, updatedAt: result.updatedAt });
    } catch (e) {
      setError(approvalErrorMessage(e, APPROVAL_WORKBENCH_COPY.STANDARDIZE_FAILED));
    } finally { setBusy(false); }
  };

  // B2/D3：修改重提必经重新标准化（feature:88）——复用 standardizeAndSubmit 的两步模式：
  // 先真实标准化取新 formalContentHash，再 transition(resubmit)（服务端 probe 校验 + 重快照 + revision 刷新）
  const resubmitWithStandardize = async () => {
    if (!activeArticleId) return;
    setBusy(true); setError(null);
    try {
      const standardized = await standardizeArticle(activeArticleId);
      const hash = standardized?.formalContentHash || standardized?.currentStandardVersion?.contentHash || null;
      // seq201（前端纯净度规则①清存量）：契约异常形态守卫改中性技术诊断——成功态无后端 error 文案可回显，不再自造业务话术
      if (!hash) throw new Error("standardization response is missing formalContentHash");
      const result = await transitionApproval(activeArticleId, "resubmit", { contentHash: hash, sourcePath: selectedCandidate?.sourcePath, title: selectedCandidate?.title });
      setCandidates((current) => current.map((candidate) => candidate.id === activeArticleId
        ? { ...candidate, standardizationStatus: standardized.standardizationStatus, formalContentHash: hash }
        : candidate));
      setStatus({ status: result.status, revision: result.revision ?? status?.revision ?? null, updatedAt: result.updatedAt });
    } catch (e) {
      setError(approvalErrorMessage(e, APPROVAL_WORKBENCH_COPY.RESUBMIT_FAILED));
    } finally { setBusy(false); }
  };

  const currentStatus = status?.status ?? "draft";
  const stepIndex = activeWorkflowStep(currentStatus);
  const selectedCandidate = candidates.find((c) => c.id === activeArticleId) ?? null;
  // PR-047：pending 态源文件变化检测——存储 revision（standardize 时绑定的哈希）与候选当前
  // formalContentHash 不一致 = 旧审批绑定失效，confirm 必被 assertSourceUnchanged 拦。
  // 此时展示「重新标准化」按钮（走 standardizeAndSubmit：文章准入页重标准化 + 状态机 standardize 重绑，仍回待审）。
  const revisionHash = status?.revision?.match(/^sha256:([a-f0-9]{64})$/)?.[1] ?? null;
  const bindingStale = (currentStatus === "pending" || currentStatus === "approved")
    && Boolean(revisionHash)
    && Boolean(selectedCandidate?.formalContentHash)
    && revisionHash !== selectedCandidate?.formalContentHash;
  const recoveryButton = (
    <Button size="sm" variant="outline" data-action-id="approval-restandardize" disabled={busy} title={APPROVAL_WORKBENCH_COPY.RESTANDARDIZE_TITLE} onClick={() => void standardizeAndSubmit()}>
      <RefreshCw className="mr-1.5 h-4 w-4" />{APPROVAL_WORKBENCH_COPY.RESTANDARDIZE_ACTION}
    </Button>
  );

  return (
    <Panel className="space-y-4" ariaLabel={APPROVAL_WORKBENCH_COPY.WORKSPACE_LABEL}>
      <div className="flex items-center gap-2">
        <p className="text-xs font-medium uppercase tracking-[0.08em] text-text-hint">{APPROVAL_WORKBENCH_COPY.WORKSPACE_LABEL}</p>
        {status && <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-kg-xs ring-1 ${TONE_STYLE[approvalStatusDisplay(currentStatus).tone]}`}>{APPROVAL_WORKBENCH_COPY.STATUS_BADGE_PREFIX}{approvalStatusDisplay(currentStatus).label}</span>}
      </div>

      {/* 真实候选文章选择（切片 3b2：替代硬编码 fixture-article-1）*/}
      {!articleId && (
        <label className="block">
          <span className="mb-1 block text-kg-xs text-text-hint">{APPROVAL_WORKBENCH_COPY.SELECT_ARTICLE_LABEL}</span>
          <select
            value={activeArticleId ?? ""}
            onChange={(event) => { setSelectedId(event.target.value || null); setStatus(null); }}
            disabled={busy}
            className="h-8 w-full max-w-md rounded bg-surface-root px-2 text-xs text-text-main ring-1 ring-border-thin outline-none focus:ring-border-focus"
            aria-label={APPROVAL_WORKBENCH_COPY.SELECT_ARTICLE_ARIA}
          >
            {candidates.length === 0 && <option value="">{loading ? APPROVAL_WORKBENCH_COPY.CANDIDATES_LOADING : TERM.EMPTY_WORK_DRAFT}</option>}
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>{candidate.title}（{standardizationStatusDisplay(candidate.standardizationStatus).label}）</option>
            ))}
          </select>
        </label>
      )}

      {/* 步骤指示器（复用 anomaly 面板模式）*/}
      {status && <ol className="grid grid-cols-4 gap-2" aria-label={APPROVAL_WORKBENCH_COPY.STEPS_ARIA}>
        {WORKFLOW_STEPS.map((step, index) => (
          <li key={step} className={`rounded-md px-2 py-2 text-center text-kg-xs ${
            index < stepIndex ? "bg-status-fact-2 text-status-fact" :
            index === stepIndex ? "bg-accent-bg text-text-main ring-1 ring-border-focus" :
            "bg-surface-hover text-text-hint"
          }`}>
            <span className="block text-kg-xs">{index + 1}</span>{step}
          </li>
        ))}
      </ol>}

      <div className="text-xs leading-5 text-text-hint">
        <p className="font-medium text-text-main">{title}</p>
        {selectedCandidate && <p className="mt-1">{APPROVAL_WORKBENCH_COPY.ARTICLE_PREFIX}{selectedCandidate.title}（{selectedCandidate.fileName}）</p>}
        {selectedCandidate && <p className="mt-1">{TERM.STANDARDIZATION_VALIDATION}：{standardizationStatusDisplay(selectedCandidate.standardizationStatus).label}</p>}
        {/* WP-145 W2-B（C1）：revision 哈希收纳——照 CheckResultsPanel 折叠范式（摘要行＋可展开全文，details/summary）。
            哈希仅供防篡改对账（绑定失效判定同源），非日常信息：默认收起、展开可达，不再常显主界面。 */}
        {status && (
          <details className="mt-1 rounded-lg bg-surface-root ring-1 ring-border-thin" data-testid="approval-revision-details">
            <summary className="cursor-pointer select-none px-3 py-2 text-kg-xs text-text-hint">
              {APPROVAL_WORKBENCH_COPY.STATUS_SUMMARY_PREFIX}{currentStatus === "draft" ? APPROVAL_WORKBENCH_COPY.NOT_SUBMITTED : approvalStatusDisplay(currentStatus).label}
            </summary>
            <p className="px-3 pb-2 text-kg-xs text-text-hint">revision {status.revision ? status.revision.slice(0, 12) : "-"}</p>
          </details>
        )}
        {loading && <p className="mt-1">{APPROVAL_WORKBENCH_COPY.LOADING_INFO}</p>}
      </div>

      {error && <p role="alert" className="whitespace-pre-line rounded-md bg-status-error-2 px-3 py-2 text-xs text-status-error ring-1 ring-status-error-6">{error}</p>}

      {/* 操作按钮：标准化（draft→pending）/ 确认（approved）/ 驳回（rejected）/ 发布（snapshot）*/}
      {status && !loading && currentStatus === "draft" && activeArticleId && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" data-action-id="approval-standardize" disabled={busy} onClick={() => void standardizeAndSubmit()}>
            <Check className="mr-1.5 h-4 w-4" />{APPROVAL_WORKBENCH_COPY.STANDARDIZE_ACTION}
          </Button>
        </div>
      )}

      {status && !loading && currentStatus === "pending" && (
        <div className="flex flex-wrap gap-2">
          {bindingStale && recoveryButton}
          <Button size="sm" data-action-id="approval-confirm" disabled={busy || bindingStale} title={bindingStale ? APPROVAL_WORKBENCH_COPY.CONFIRM_BLOCKED_TITLE : undefined} onClick={() => void operate("confirm")}>
            <CheckCircle2 className="mr-1.5 h-4 w-4" />{APPROVAL_WORKBENCH_COPY.CONFIRM_ACTION}
          </Button>
          <Button size="sm" variant="outline" data-action-id="approval-reject" disabled={busy || !rejectReason.trim()} onClick={() => void operate("reject")}>
            <XCircle className="mr-1.5 h-4 w-4" />{APPROVAL_WORKBENCH_COPY.REJECT_ACTION}
          </Button>
          <input value={rejectReason} onChange={(event) => setRejectReason(event.target.value)} placeholder={APPROVAL_WORKBENCH_COPY.REJECT_REASON_PLACEHOLDER} className="h-8 w-48 rounded bg-surface-root px-3 text-xs text-text-main ring-1 ring-border-thin outline-none" />
        </div>
      )}

      {status && !loading && currentStatus === "approved" && (
        <div className="flex flex-wrap gap-2">
          {bindingStale && recoveryButton}
          <Button size="sm" data-action-id="approval-publish" disabled={busy || bindingStale || !selectedCandidate?.sourcePath} title={bindingStale ? APPROVAL_WORKBENCH_COPY.PUBLISH_BLOCKED_TITLE : undefined} onClick={() => void operate("publish", { sourcePath: selectedCandidate?.sourcePath, contentHash: selectedCandidate?.formalContentHash ?? undefined, title: selectedCandidate?.title })}>
            <Package className="mr-1.5 h-4 w-4" />{APPROVAL_WORKBENCH_COPY.PUBLISH_ACTION}
          </Button>
          <AnomalyGateNotice action="publish_graph" sourcePath={selectedCandidate?.sourcePath ?? undefined} />
        </div>
      )}

      {status && !loading && currentStatus === "rejected" && (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" data-action-id="approval-resubmit" disabled={busy} onClick={() => void resubmitWithStandardize()}>
            <GitBranch className="mr-1.5 h-4 w-4" />{APPROVAL_WORKBENCH_COPY.RESUBMIT_ACTION}
          </Button>
        </div>
      )}

      {status && !loading && currentStatus === "snapshot" && (
        <p className="text-xs leading-5 text-sky-11">{APPROVAL_WORKBENCH_COPY.SNAPSHOT_DONE}</p>
      )}

      {!loading && !error && !activeArticleId && (
        <p className="text-xs leading-5 text-text-hint">{APPROVAL_WORKBENCH_COPY.SELECT_PROMPT}</p>
      )}

      <div className="flex justify-end">
        <Button size="sm" variant="ghost" onClick={() => void load()} disabled={busy || loading}>
          <RefreshCw className={`mr-1.5 h-4 w-4 ${busy ? "animate-spin" : ""}`} />{APPROVAL_WORKBENCH_COPY.REFRESH}
        </Button>
      </div>
    </Panel>
  );
}
