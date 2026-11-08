// GapEngineView — 拓扑结构检查 (Module 3)
import { useEffect } from "react";
import { GovernanceTodoTab } from "./GovernanceTodoTab";
import { useLoadTopology, useUnresolvedGapCount } from "@/lib/topology-store";
import { PageContainer } from "@/components/page-container";
import { Statistic } from "@/components/statistic";
import { GAP_ENGINE_VIEW_COPY } from "./gap-engine-copy";

export function GapEngineView() {
  // 直达/刷新本页（书签/分享链接）时自行拉取拓扑数据——store.gaps 由 dashboard 系视图
  // 挂载时填充，本视图此前不触发 fetch，直达即假「暂无待处理数据质量问题」（#1773）。
  const loadTopology = useLoadTopology();
  const gapCount = useUnresolvedGapCount();
  useEffect(() => { void loadTopology(); }, [loadTopology]);
  return (
    <PageContainer>
      {/* WP-037 P7 锚点：未解决缺口数主视觉 */}
      <Statistic size="xl" label={GAP_ENGINE_VIEW_COPY.UNRESOLVED_STAT_LABEL} value={gapCount} tone={gapCount > 0 ? "text-orange-10" : "text-status-fact"} hint={GAP_ENGINE_VIEW_COPY.UNRESOLVED_STAT_HINT} />
      <GovernanceTodoTab />
    </PageContainer>
  );
}
