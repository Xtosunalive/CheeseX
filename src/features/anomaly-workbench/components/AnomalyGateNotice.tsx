import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { fetchAnomalies } from "@/features/anomaly-workbench/anomaly-workbench-api";
import { gateNoticeText, ANOMALY_GATE_COPY } from "@/features/anomaly-workbench/anomaly-workbench-copy";
import { navigate } from "@/lib/navigation";

type Props = {
  action: "publish_graph" | "complete_global_diagnostic";
  /** 议题范围（#1413）：传入则只统计该来源文章自己的议题——闸点是「当前动作主体」的守门信息，不是全库总账；不传保持全量（全局诊断入口语义） */
  sourcePath?: string;
};

// 闸点呈现（#1398 切片4）：blockedActions 数据后端早已有（anomaly-workbench-service:45-46），
// 本组件把它接到动作使用点——诚实提示未处理议题数（不声称拦截），提供跳转入口（#1405）。
// 纯接线：不阻断按钮（后端仍守门），只让用户在按按钮之前就知道"谁在拦路、去哪解开"。
// 文案（动作名＋提示句）住 anomaly-workbench-copy 闭集（WP-145 B7 人话化同步迁集）。

function issueTouchesSource(item: { evidence?: Array<{ path?: unknown }> }, sourcePath: string): boolean {
  return (item.evidence || []).some((entry) => entry?.path === sourcePath);
}

export function AnomalyGateNotice({ action, sourcePath }: Props) {
  const [blockedCount, setBlockedCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void fetchAnomalies().then((data) => {
      if (cancelled) return;
      const items = Array.isArray(data.issues) ? data.issues : [];
      setBlockedCount(items.filter((item) => {
        if (!Array.isArray(item.blockedActions) || !item.blockedActions.includes(action)) return false;
        if (sourcePath !== undefined) return issueTouchesSource(item as { evidence?: Array<{ path?: unknown }> }, sourcePath);
        return true;
      }).length);
    }).catch(() => { if (!cancelled) setBlockedCount(null); });
    return () => { cancelled = true; };
  }, [action, sourcePath]);

  if (!blockedCount) return null;
  return (
    <span data-gate-notice className="inline-flex items-center gap-1.5 rounded-md bg-status-warn-2 px-2 py-1 text-kg-xs text-status-warn ring-1 ring-status-warn-6" role="status">
      <AlertTriangle className="h-4 w-4" aria-hidden />
      <span>{gateNoticeText(blockedCount, action)}</span>
      <button type="button" className="font-medium underline underline-offset-2" onClick={() => { navigate("anomalies"); }}>{ANOMALY_GATE_COPY.VIEW_ACTION}</button>
    </span>
  );
}
