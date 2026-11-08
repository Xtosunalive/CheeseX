// SchemaIntentNav —— 意图分区导航（SCHEMA-IA-001 批2）：消费复用域 schema-shape 的真实装配面。
// 分区/叶子/徽标全部现算自投影（schemaPartitions/danglingBadgeForPartition），本组件零第二份事实；
// 徽标的 coverage 门控自 WP-134 波4 起也在投影出口内（旧写法此处自判 ontology 缺席，与概览面板各判一遍）。
// 叶名唯一来源仍是 TAB_LABELS（seq202 单源口径延续）。PD-1 裁后为唯一导航（目录镜像退役，Master 2026-10-26）
// ——两导航并存会产生重名按钮破坏 getByRole 断言面（设计稿 §0-事实4）。
import { Inbox, Layers, ScrollText, Tags, Waypoints, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { danglingBadgeForPartition, schemaPartitions, type PartitionId, type SchemaTopology } from "@/lib/schema-shape";
import { TAB_LABELS, type TabId } from "./schema-manager-types";
import { INTENT_NAV_COPY } from "./schema-manager-copy";
import { tabSemantics } from "@/lib/schema-shape";
import { OBJECT_DICTIONARY } from "@/lib/object-dictionary";

const PARTITION_ICONS: Record<PartitionId, LucideIcon> = {
  classification: Layers,
  vocabulary: Tags,
  "type-system": Waypoints,
  ledger: ScrollText,
  intake: Inbox,
};

export function SchemaIntentNav({
  activeTab,
  onSelect,
  topology,
}: {
  activeTab: TabId;
  onSelect: (tab: TabId) => void;
  /** 投影现算结果（含 coverage）；null＝数据未就绪——徽标整体不显示（宁缺勿假） */
  topology: SchemaTopology | null;
}) {
  return (
    <aside
      aria-label={INTENT_NAV_COPY.NAV_ARIA}
      data-testid="schema-intent-nav"
      className="w-[220px] shrink-0 flex flex-col bg-surface-root/40 border-r border-border-thin overflow-hidden"
    >
      <div className="flex-1 overflow-y-auto overflow-x-hidden pt-3 px-2 space-y-1.5">
        {schemaPartitions().map((partition) => {
          const Icon = PARTITION_ICONS[partition.id];
          // WP-134 波4：徽标读数与 coverage 门控单源＝danglingBadgeForPartition
          // （ontology 未载入时数据缺席≠零悬空 → null 隐藏；此前此处与概览面板各判一遍）
          const danglingCount = danglingBadgeForPartition(partition.id, topology);
          return (
            <div key={partition.id}>
              <div className="flex items-center gap-1.5 px-2 py-1" title={partition.note}>
                <Icon className="h-4 w-4 text-text-hint shrink-0" aria-hidden="true" />
                <span className="text-xs font-medium text-text-sub">{partition.title}</span>
                {danglingCount !== null && danglingCount > 0 && (
                  <span
                    data-testid={`intent-nav-badge-${partition.id}`}
                    title={INTENT_NAV_COPY.DANGLING_COUNT_TITLE}
                    className="ml-auto rounded-sm bg-status-warn-2 px-1.5 text-[10px] leading-4 text-status-warn"
                  >
                    {danglingCount}
                  </span>
                )}
              </div>
              <div className="mt-0.5 ml-3 space-y-0.5 border-l border-border-thin pl-2">
                {partition.tabs.map((tab) => (
                  <Button
                    key={tab}
                    type="button"
                    variant="ghost"
                    aria-label={TAB_LABELS[tab as TabId]}
                    title={tabSemantics(OBJECT_DICTIONARY, tab)?.objects.map((o) => o.definition).join("；") || undefined}
                    aria-current={tab === activeTab ? "true" : "false"}
                    onClick={() => onSelect(tab as TabId)}
                    className={`w-full justify-start rounded-r-lg px-2 py-1 h-auto text-xs font-normal ${
                      tab === activeTab
                        ? "bg-surface-hover text-text-main border-l border-l-accent-base"
                        : "text-text-sub hover:bg-surface-hover hover:text-text-main"
                    }`}
                  >
                    {TAB_LABELS[tab as TabId]}
                  </Button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
