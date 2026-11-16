// WorkbenchView — 工作台（2026-11-17 第 2 批，目标 IA 第 2 批落地）
// 只回答"我现在该处理什么"：跨域待办量值带（5 卡）＋逐卡深链入口。
// 口径（目标 IA 下钻修正）：本视图只做信号聚合与导航分发——队列动作仍在各工作页
// （待审→关系审核、缺口→拓扑缺口检查、异常→待处理问题、映射→修复中心），不搬动作。
import { useEffect } from "react";
import { Link2, GitFork, AlertTriangle, FilePenLine } from "lucide-react";
import { navigate } from "@/lib/navigation";
import { PageContainer } from "@/components/page-container";
import { Statistic } from "@/components/statistic/Statistic";
import { BentoGrid } from "@/components/bento";
import { useReviewDataStore } from "@/lib/review-data-store";
import { useUnresolvedGapCount } from "@/lib/topology-store";
import { useWorkbenchStore } from "./workbench-store";
import { WORKBENCH_VIEW_COPY } from "./workbench-copy";

export function WorkbenchView() {
  const load = useWorkbenchStore((s) => s.load);
  const pendingReview = useReviewDataStore((s) => s.pendingCount);
  const topologyGaps = useUnresolvedGapCount();
  const anomalies = useWorkbenchStore((s) => s.anomalies);
  const manifestPending = useWorkbenchStore((s) => s.manifestPending);

  useEffect(() => { void load(); }, [load]);

  return (
    <PageContainer>
      <BentoGrid data-testid="workbench-signals">
        <Statistic
          size="lg"
          testId="wb-pending-review"
          label={WORKBENCH_VIEW_COPY.STAT_PENDING_REVIEW}
          value={pendingReview}
          tone={pendingReview ? "text-status-warn" : undefined}
          icon={<Link2 className="h-4 w-4 text-status-warn" />}
          onClick={() => navigate("review", { sub: "edges" })}
          hint={WORKBENCH_VIEW_COPY.STAT_PENDING_REVIEW_HINT}
        />
        <Statistic
          size="lg"
          testId="wb-gaps"
          label={WORKBENCH_VIEW_COPY.STAT_GAPS}
          value={topologyGaps}
          tone={topologyGaps ? "text-orange-10" : undefined}
          icon={<GitFork className={`h-4 w-4 ${topologyGaps ? "text-orange-10" : "text-status-fact"}`} />}
          onClick={() => navigate("gaps")}
        />
        <Statistic
          size="lg"
          testId="wb-anomalies"
          label={WORKBENCH_VIEW_COPY.STAT_ANOMALIES}
          value={anomalies}
          tone={anomalies ? "text-status-warn" : undefined}
          icon={<AlertTriangle className="h-4 w-4 text-status-warn" />}
          onClick={() => navigate("anomalies")}
          hint={WORKBENCH_VIEW_COPY.STAT_ANOMALIES_HINT}
        />
        <Statistic
          size="lg"
          testId="wb-manifest"
          label={WORKBENCH_VIEW_COPY.STAT_MANIFEST}
          value={manifestPending}
          tone={manifestPending ? "text-status-warn" : undefined}
          icon={<FilePenLine className="h-4 w-4 text-status-warn" />}
          onClick={() => navigate("property", { sub: "mapping" })}
          hint={WORKBENCH_VIEW_COPY.STAT_MANIFEST_HINT}
        />
      </BentoGrid>
    </PageContainer>
  );
}
