// gap-api.ts — governance gap resolve API client (Module 3)
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
  const res = await fetch("/api/governance/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ gapId, action, ...(note ? { note } : {}) }),
  });
  return res.json();
}
