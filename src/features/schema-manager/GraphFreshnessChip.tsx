// GraphFreshnessChip — 图新鲜度状态提示（WP-027/PR-142）
// 消费 GET /api/pipeline/graph-freshness（对账现算＋调度状态）：
//   最新（绿）／待更新·将自动刷新（黄，含预计触发时刻）／待更新（黄）／未知（灰——从未增量抽取）。
// 轮询 30s＋外部 tick（保存成功后即刷）；请求失败静默灰（fail-open，不打断页面）。
import { useEffect, useState } from "react";
import { CheckCircle2, HelpCircle, RefreshCw } from "lucide-react";
import { apiFetchJson } from "@/lib/api";
import { TERM } from "@/constants/term-const";
import { FRESHNESS_COPY } from "./schema-manager-copy";

interface GraphFreshnessResponse {
  success?: boolean;
  data?: {
    upToDate: boolean | null;
    changed?: string[];
    checkedAt?: string;
    manifestGeneratedAt?: string | null;
    scheduler?: {
      pending: boolean;
      pendingSince: string | null;
      firesAt: string | null;
      pendingCategory: string | null;
      lastTriggeredAt: string | null;
      lastSkipReason: string | null;
      quietMs: number;
    } | null;
  };
}

type ChipState =
  | { kind: "loading" }
  | { kind: "unknown" }
  | { kind: "fresh" }
  | { kind: "stale"; firesAt: string | null };

function firesAtLabel(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return null;
  }
}

export function GraphFreshnessChip({ refreshTick = 0 }: { refreshTick?: number }) {
  const [state, setState] = useState<ChipState>({ kind: "loading" });

  useEffect(() => {
    let alive = true;
    const load = () => {
      apiFetchJson<GraphFreshnessResponse>("/api/pipeline/graph-freshness")
        .then((res) => {
          if (!alive) return;
          const data = res?.data;
          if (!data || data.upToDate === null) return setState({ kind: "unknown" });
          if (data.upToDate === true) return setState({ kind: "fresh" });
          setState({ kind: "stale", firesAt: data.scheduler?.firesAt ?? null });
        })
        .catch(() => { if (alive) setState({ kind: "unknown" }); });
    };
    load();
    const timer = setInterval(load, 30_000);
    return () => { alive = false; clearInterval(timer); };
  }, [refreshTick]);

  if (state.kind === "loading") {
    return <span className="text-xs text-text-placeholder" data-testid="graph-freshness-chip" data-state="loading">…</span>;
  }
  if (state.kind === "fresh") {
    return (
      <span className="flex items-center gap-1 text-xs text-status-fact" data-testid="graph-freshness-chip" data-state="fresh" title={FRESHNESS_COPY.FRESH_TITLE}>
        <CheckCircle2 className="h-3 w-3" />{TERM.GRAPH_UP_TO_DATE}
      </span>
    );
  }
  if (state.kind === "unknown") {
    return (
      <span className="flex items-center gap-1 text-xs text-text-hint" data-testid="graph-freshness-chip" data-state="unknown" title={FRESHNESS_COPY.UNKNOWN_TITLE}>
        <HelpCircle className="h-3 w-3" />{TERM.GRAPH_STATE_UNKNOWN}
      </span>
    );
  }
  const at = firesAtLabel(state.firesAt);
  return (
    <span
      className="flex items-center gap-1 text-xs text-status-warn"
      data-testid="graph-freshness-chip"
      data-state="stale"
      title={FRESHNESS_COPY.STALE_TITLE}
    >
      <RefreshCw className="h-3 w-3" />{TERM.GRAPH_STALE}{at ? ` · ${at}${FRESHNESS_COPY.STALE_REFRESH_SUFFIX}` : ""}
    </span>
  );
}
