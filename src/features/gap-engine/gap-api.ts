// gap-api.ts — governance gap resolve API client (Module 3)
import { apiFetchEnvelope } from "@/lib/api";
import { GOVERNANCE_TODO_COPY } from "./gap-engine-copy";
import type { GapResolveAction } from "./gap-types";

export interface ResolveResponse {
  success: boolean;
  total: number;
}

export async function resolveGap(
  gapId: string,
  action: GapResolveAction,
  note?: string,
): Promise<ResolveResponse> {
  const envelope = await apiFetchEnvelope<ResolveResponse>("/api/governance/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gapId, action, ...(note ? { note } : {}) }),
  });
  if (!envelope.ok || !envelope.data) throw new Error(envelope.error || GOVERNANCE_TODO_COPY.ACTIONS_FETCH_FAILED);
  return envelope.data;
}

// PR-317 反悔通道（Master 2026-11-17 裁）：撤销已处置缺口——追加 action=reopened 行（最新条目胜出），
// 缺口重新出现在待处理列表（后端 getResolvedGapIds 最新条目胜出语义）。
export interface GovernanceActionRow { gapId: string; action: string; note: string; resolvedAt: string }
export interface GovernanceActionsData { actions: GovernanceActionRow[]; resolvedGapIds: string[]; total: number }

export async function listGovernanceActions(): Promise<GovernanceActionsData> {
  const envelope = await apiFetchEnvelope<GovernanceActionsData>("/api/governance/actions");
  if (!envelope.ok || !envelope.data) throw new Error(envelope.error || GOVERNANCE_TODO_COPY.ACTIONS_FETCH_FAILED);
  return envelope.data;
}

export async function reopenGap(gapId: string, note?: string): Promise<ResolveResponse> {
  const envelope = await apiFetchEnvelope<ResolveResponse>("/api/governance/reopen", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gapId, confirmed: true, ...(note ? { note } : {}) }),
  });
  if (!envelope.ok || !envelope.data) throw new Error(envelope.error || GOVERNANCE_TODO_COPY.REOPEN_FAILED);
  return envelope.data;
}
