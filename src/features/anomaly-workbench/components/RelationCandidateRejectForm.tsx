import { useState, type FormEvent } from "react";
import { XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { RelationCandidateRejectionInput } from "@/features/anomaly-workbench/anomaly-workbench-types";
import { ANOMALY_REJECT_FORM_COPY } from "@/features/anomaly-workbench/anomaly-workbench-copy";

/**
 * 驳回候选理由表单（PR-030：驳回入口归位 peek footer 动作区——按钮在动作区，表单随按钮展开）。
 * 理由必填；提交后收起由父级控制。原嵌于「采信依据」折叠卡内的同形表单迁此，折叠卡只留证据。
 */
export function RelationCandidateRejectForm({ onReject, rejecting = false }: {
  onReject: (input: RelationCandidateRejectionInput) => void;
  rejecting?: boolean;
}) {
  const [reason, setReason] = useState("");
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!reason.trim()) return;
    onReject({ reason: reason.trim() });
  };
  return (
    <form className="space-y-2 rounded-lg bg-surface-root p-3 ring-1 ring-border-thin" aria-label={ANOMALY_REJECT_FORM_COPY.ARIA} onSubmit={submit}>
      <p className="text-xs leading-5 text-text-hint">
        {ANOMALY_REJECT_FORM_COPY.NOTE}
      </p>
      <textarea
        aria-label={ANOMALY_REJECT_FORM_COPY.REASON_ARIA}
        value={reason}
        onChange={(event) => setReason(event.target.value)}
        placeholder={ANOMALY_REJECT_FORM_COPY.REASON_PLACEHOLDER}
        className="min-h-16 w-full rounded-md bg-surface-card px-3 py-2 text-xs text-text-main ring-1 ring-border-thin outline-none focus:ring-border-focus"
      />
      <Button type="submit" size="sm" variant="outline" disabled={rejecting || !reason.trim()}>
        <XCircle className="mr-1.5 h-4 w-4" />{rejecting ? ANOMALY_REJECT_FORM_COPY.SUBMITTING_ACTION : ANOMALY_REJECT_FORM_COPY.SUBMIT_ACTION}
      </Button>
    </form>
  );
}
