// ReviewView — 关系审核 Tab 页入口
import { useState, useEffect } from "react";
import { GitMerge, History, AlertTriangle } from "lucide-react";
import { InternalTabs, type InternalTabItem } from "@/components/internal-tabs";
import { InferenceConflictPanel } from "./components/InferenceConflictPanel";
import { EdgeReviewPanel } from "./EdgeReviewPanel";
import { AuditLogPanel } from "./AuditLogPanel";
import { useLoadTopology } from "@/lib/topology-store";
import { useReviewPendingCount } from "@/lib/review-data-store";
import { Statistic } from "@/components/statistic";
import type { ReviewTab } from "./review-types";
import { navigate, type NavLocation } from "@/lib/navigation";
import { useNavLocation } from "@/hooks/use-nav-location";
import { PageContainer } from "@/components/page-container";
import { TERM } from "@/constants/term-const";
import { Panel } from "@/components/panel";
import { REVIEW_VIEW_COPY, reviewPendingStatHint, reviewPendingStatLabel } from "./review-copy";

const TABS: InternalTabItem<ReviewTab>[] = [
  { id: "edges", icon: GitMerge, label: TERM.PENDING_RELATIONS },
  { id: "conflicts", icon: AlertTriangle, label: TERM.RULE_CONFLICTS },
  { id: "audit", icon: History, label: TERM.REVIEW_RECORDS },
];

const TAB_BY_HASH: Record<string, ReviewTab> = {
  edges: "edges",
  conflicts: "conflicts",
  audit: "audit",
};

function tabFromLocation(location: NavLocation): ReviewTab {
  if (location.route === "review" && location.sub) {
    const first = location.sub.split("/")[0];
    if (TAB_BY_HASH[first]) return TAB_BY_HASH[first];
  }
  return "edges";
}

export function ReviewView() {
  const navLocation = useNavLocation();
  const [tab, setTab] = useState<ReviewTab>(() => tabFromLocation(navLocation));
  const loadTopology = useLoadTopology();
  const pendingCount = useReviewPendingCount();

  useEffect(() => { loadTopology(); }, [loadTopology]);

  useEffect(() => { setTab(tabFromLocation(navLocation)); }, [navLocation]);

  const selectTab = (next: ReviewTab) => {
    setTab(next);
    navigate("review", next === "edges" ? {} : { sub: next });
  };

  return (
    <PageContainer>

      {/* WP-037 P7 锚点：待审核关系数主视觉（xl）；P3 页签独立行。
          WP-134 波2 假零拆除：pendingCount 的 null 是 store 初值（review-data-store.ts:18）＝未加载，
          旧写法 `?? 0` 让「还没取到数」在标签为「全部待审核总数」的卡上显示成 0。 */}
      <Statistic size="xl" label={reviewPendingStatLabel()} value={pendingCount} tone={(pendingCount ?? 0) > 0 ? "text-status-warn" : "text-status-fact"} hint={reviewPendingStatHint()} />

      <InternalTabs ariaLabel={REVIEW_VIEW_COPY.TABS_ARIA} items={TABS} value={tab} onValueChange={selectTab} />

      <Panel className="min-h-0 flex-1">
        {tab === "edges" && <EdgeReviewPanel />}
        {tab === "conflicts" && <InferenceConflictPanel />}
        {tab === "audit" && <AuditLogPanel />}
      </Panel>
    </PageContainer>
  );
}
