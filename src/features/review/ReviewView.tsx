// ReviewView — 关系审核 Tab 页入口
import { useState, useEffect } from "react";
import { GitMerge, History, AlertTriangle } from "lucide-react";
import { InternalTabs, type InternalTabItem } from "@/components/internal-tabs";
import { InferenceConflictPanel } from "./components/InferenceConflictPanel";
import { EdgeReviewPanel } from "./EdgeReviewPanel";
import { AuditLogPanel } from "./AuditLogPanel";
import { useLoadTopology } from "@/lib/topology-store";
import type { ReviewTab } from "./review-types";
import { navigate, type NavLocation } from "@/lib/navigation";
import { useNavLocation } from "@/hooks/use-nav-location";
import { PageContainer } from "@/components/page-container";
import { TERM } from "@/constants/term-const";
import { Panel } from "@/components/panel";
import { REVIEW_VIEW_COPY } from "./review-copy";

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

  useEffect(() => { loadTopology(); }, [loadTopology]);

  useEffect(() => { setTab(tabFromLocation(navLocation)); }, [navLocation]);

  const selectTab = (next: ReviewTab) => {
    setTab(next);
    navigate("review", next === "edges" ? {} : { sub: next });
  };

  return (
    <PageContainer>

      <InternalTabs ariaLabel={REVIEW_VIEW_COPY.TABS_ARIA} items={TABS} value={tab} onValueChange={selectTab} />

      <Panel className="min-h-0 flex-1">
        {tab === "edges" && <EdgeReviewPanel />}
        {tab === "conflicts" && <InferenceConflictPanel />}
        {tab === "audit" && <AuditLogPanel />}
      </Panel>
    </PageContainer>
  );
}
