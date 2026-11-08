// PropertyGovView — 文章图谱映射 + 架构组件属性
import { useState, useEffect, useRef } from "react";
import { FileText, Link2, ShieldCheck } from "lucide-react";
import { InternalTabs, type InternalTabItem } from "@/components/internal-tabs";
import { TERM } from "@/constants/term-const";
import { ManifestListPanel } from "./ManifestListPanel";
import { CheckResultsPanel } from "./CheckResultsPanel";
import { useSetActiveEntityId } from "@/lib/topology-store";
import { usePropertyStore } from "./property-store";
import { ArticleAssociationsView } from "@/features/article-associations";
import { navigate, getNavQueryParam, type NavLocation } from "@/lib/navigation";
import { useNavLocation } from "@/hooks/use-nav-location";
import { PageContainer } from "@/components/page-container";
import { Panel } from "@/components/panel";
import { PROPERTY_GOV_VIEW_COPY } from "./property-gov-copy";

type TabId = "manifest" | "checks" | "mapping";

const TABS: InternalTabItem<TabId>[] = [
  { id: "manifest", icon: FileText, label: TERM.ARTICLE_GRAPH_MAPPING },
  { id: "checks", icon: ShieldCheck, label: TERM.ARCH_COMPONENT_ATTRIBUTES },
  { id: "mapping", icon: Link2, label: PROPERTY_GOV_VIEW_COPY.TAB_MAPPING },
];

function tabFromLocation(location: NavLocation): TabId {
  if (location.route === "article-associations" || location.sub === "mapping") return "mapping";
  if (location.sub === "checks") return "checks";
  return "manifest";
}


export function PropertyGovView() {
  const navLocation = useNavLocation();
  const [tab, setTab] = useState<TabId>(() => tabFromLocation(navLocation));
  const setActiveEntityId = useSetActiveEntityId();
  const syncedHash = useRef(navLocation.hash);


  // Parse ?entityId=xxx from URL hash on mount (cross-tab quick-jump)
  useEffect(() => {
    const entityId = getNavQueryParam("entityId");
    if (entityId) {
      setActiveEntityId(entityId);
      // Auto-switch to check results tab + pre-fill search so the entity is actually visible
      setTab("checks");
      const propertyStore = usePropertyStore.getState();
      propertyStore.setQuery(entityId);
      // load() will be triggered by CheckResultsPanel's useEffect on mount
    }
  }, [setActiveEntityId]);

  // 只在地址真变化时跟随（挂载那次不跑，避免覆盖上面 entityId 跳转预设的 checks 页签）
  useEffect(() => {
    if (syncedHash.current === navLocation.hash) return;
    syncedHash.current = navLocation.hash;
    setTab(tabFromLocation(navLocation));
  }, [navLocation]);

  const selectTab = (next: TabId) => {
    setTab(next);
    navigate("property", next === "manifest" ? {} : { sub: next });
  };


  return (
    <PageContainer>

      {/* WP-037 P3：页签条独立行（标题区与内容面板之间）——不进面板体，间距由 PageContainer 节奏承担 */}
      <InternalTabs ariaLabel={PROPERTY_GOV_VIEW_COPY.TABS_ARIA} items={TABS} value={tab} onValueChange={selectTab} />

      <Panel className="min-h-0 flex-1">
        {tab === "manifest" && <ManifestListPanel />}
        {tab === "checks" && <CheckResultsPanel />}
        {tab === "mapping" && <ArticleAssociationsView embedded />}
      </Panel>
    </PageContainer>
  );
}
