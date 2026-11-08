// SchemaPartitionOverview —— 分区引用总览面板（SCHEMA-IA-001 批3：意图模式内容区首件）。
// 批1/批2 的徽标与警示条只是 schemaTopology 的计数摘要；本面板首次把六类引用边画成
// 页面可见的层级结构（谁挂靠谁、断在哪），"配置数据层级关系"不再只活在校验器 if 里。
// 纪律：零第二份事实——分区/归属经 schemaPartitions/partitionOfTab/partitionOfKind 单源取数，
// 悬空语义标签复用 SchemaDanglingNotice 的 KIND_LABELS；纯呈现不拦截（执法在写网关）。
// ledger/intake 无引用边（schema-shape 已定）：渲染明示行而非空白。
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  editabilityState,
  TAB_FORMS,
  type TabForm,
  partitionEdgeGroups,
  partitionIsBlind,
  partitionOfTab,
  schemaPartitions,
  type EditabilityState,
  type SchemaTopology,
  type TopologyEdgeKind,
} from "@/lib/schema-shape";
import { KIND_LABELS } from "./dangling-kind-labels";
import { PARTITION_COPY, PARTITION_KIND_TITLES } from "./schema-manager-copy";
import { tabSemantics } from "@/lib/schema-shape";
import { OBJECT_DICTIONARY } from "@/lib/object-dictionary";
import type { TabId } from "./schema-manager-types";

const KIND_TITLES = PARTITION_KIND_TITLES as Record<TopologyEdgeKind, string>;

const EDITABILITY_LABELS: Record<EditabilityState, string> = {
  editable: PARTITION_COPY.EDITABILITY_EDITABLE,
  "role-denied": PARTITION_COPY.EDITABILITY_ROLE_DENIED,
  "derived-readonly": PARTITION_COPY.EDITABILITY_DERIVED_READONLY,
};

const FORM_LABELS: Record<TabForm, string> = {
  table: PARTITION_COPY.FORM_TABLE,
  "master-detail": PARTITION_COPY.FORM_MASTER_DETAIL,
  chips: PARTITION_COPY.FORM_CHIPS,
  cards: PARTITION_COPY.FORM_CARDS,
};

/** 健康边超过阈值折叠（悬空边永不折叠——断线是可操作信息） */
const COLLAPSE_THRESHOLD = 6;
const PREVIEW_COUNT = 3;

export function SchemaPartitionOverview({ tab, topology, roles = null }: { tab: TabId; topology: SchemaTopology | null; roles?: readonly string[] | null }) {
  const partitionId = partitionOfTab(tab);
  const [expandedKinds, setExpandedKinds] = useState<Partial<Record<TopologyEdgeKind, boolean>>>({});

  const partition = schemaPartitions().find((p) => p.id === partitionId);
  // WP-134 波4：分组与「健康＝边 − 悬空」差集升进 schema-shape.partitionEdgeGroups——
  // 组件内曾有第二份过滤聚合（自拼 `${from}→${to}` 键），悬空口径一改就与徽标分叉。
  const groups = useMemo(() => (topology ? partitionEdgeGroups(tab, topology) : []), [topology, tab]);

  if (!partition || !topology) return null;

  const ontologyBlind = partitionIsBlind(partitionId, topology);

  return (
    <section
      aria-label={`${PARTITION_COPY.SECTION_ARIA_PREFIX}${partition.title}`}
      data-testid="schema-partition-overview"
      className="mb-4 rounded-md border border-border-thin bg-surface-root/40 p-4 text-xs leading-5"
    >
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h3 className="font-medium text-text-main">{PARTITION_COPY.HEADER_PREFIX}{partition.title}</h3>
        <span className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] text-text-sub" data-testid="schema-overview-form">
          {PARTITION_COPY.FORM_BADGE_PREFIX}{FORM_LABELS[TAB_FORMS[tab] ?? "table"]}
        </span>
        <span className="text-text-sub">{partition.note}</span>
        <span className="text-text-sub/70">
          {PARTITION_COPY.LIVE_STATS_NOTE}
        </span>
      </header>

      {ontologyBlind && (
        <p
          data-testid="schema-partition-overview-coverage"
          className="mt-2 rounded-md bg-status-warn-2 p-2 text-status-warn ring-1 ring-status-warn-6"
        >
          {PARTITION_COPY.ONTOLOGY_BLIND}
        </p>
      )}

      {tabSemantics(OBJECT_DICTIONARY, tab) && (
        <div className="mt-2" data-testid="schema-overview-objects">
          <p className="font-medium text-text-main">{PARTITION_COPY.OBJECTS_TITLE}</p>
          <ul className="mt-1 space-y-0.5 text-text-sub">
            {tabSemantics(OBJECT_DICTIONARY, tab)!.objects.map((o) => (
              <li key={`obj:${o.canonical_name}`}>
                <span className="font-medium text-text-main">{o.canonical_name}</span>
                <span
                  className={`ml-2 rounded px-1 py-0.5 text-[10px] ${
                    editabilityState(tab, o.editable, roles) === "role-denied"
                      ? "bg-status-warn-2 text-status-warn"
                      : "bg-surface-hover"
                  }`}
                  data-testid={`schema-overview-editability-${o.canonical_name}`}
                >
                  {EDITABILITY_LABELS[editabilityState(tab, o.editable, roles)]}
                </span>
                <span className="ml-2">{o.definition}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {groups.length === 0 ? (
        <p className="mt-2 text-text-sub" data-testid="schema-partition-overview-empty">
          {PARTITION_COPY.EMPTY_NO_EDGES}
        </p>
      ) : (
        <div className="mt-3 space-y-3">
          {groups.map((group) => {
            const total = group.healthy.length + group.dangling.length;
            const collapsed = !expandedKinds[group.kind] && group.healthy.length > COLLAPSE_THRESHOLD;
            const healthyShown = collapsed ? group.healthy.slice(0, PREVIEW_COUNT) : group.healthy;
            return (
              <div key={group.kind} data-testid={`schema-overview-kind-${group.kind}`}>
                <p className="font-medium text-text-main">
                  {KIND_TITLES[group.kind]}
                  <span className="ml-2 font-normal text-text-sub">
                    {total}{PARTITION_COPY.TOTAL_SUFFIX}
                    {group.dangling.length > 0 && (
                      <span className="ml-1 text-status-warn">{PARTITION_COPY.DANGLING_PREFIX}{group.dangling.length}</span>
                    )}
                  </span>
                </p>
                {group.dangling.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-status-warn">
                    {group.dangling.map((ref) => (
                      <li key={`dangling:${group.kind}:${ref.from}:${ref.to}`}>
                        ⚠ <code className="font-mono">{ref.from}</code> → <code className="font-mono">{ref.to}</code>
                        <span className="text-status-warn-11">（{KIND_LABELS[group.kind]}）</span>
                      </li>
                    ))}
                  </ul>
                )}
                <ul className="mt-1 space-y-0.5 text-text-sub">
                  {healthyShown.map((edge) => (
                    <li key={`edge:${group.kind}:${edge.from}:${edge.to}`}>
                      <code className="font-mono">{edge.from}</code> → <code className="font-mono">{edge.to}</code>
                    </li>
                  ))}
                </ul>
                {collapsed && (
                  <Button
                    type="button"
                    variant="ghost"
                    className="mt-1 h-auto px-2 py-1 text-xs font-normal"
                    aria-expanded={false}
                    onClick={() => setExpandedKinds((prev) => ({ ...prev, [group.kind]: true }))}
                  >
                    {PARTITION_COPY.EXPAND_ALL_PREFIX}{group.healthy.length}{PARTITION_COPY.EXPAND_ALL_SUFFIX}
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
