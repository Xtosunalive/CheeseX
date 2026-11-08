// Component: EntityGrowthCards（ADR-007 A2/A3：实体生长候选卡——Steward Queue 实体类卡片）
// @responsible: 呈现文章提及产出的实体候选（次数/样例），承载裁定动作：
//               [建实体]（origin=article-grown 出生）/ [挂到已有实体]（aliases 归并）。
//               A5 卫生信号（零提及实体）只读展示，无操作按钮（MVP 边界）。
// @inputs: discovery 响应 entityCandidates/orphanEntities + absorb 通道（field=entity）
// @outputs: 候选卡区块组件
// @context: SPEC-005 §3.2；样式与裁定交互沿用 SchemaDiscoveryTab 卡片先例（不另起设计）
import { useState } from "react";
import { GROWTH_CARDS_COPY, smLabeledValueAria } from "./schema-manager-copy";
import { FilterSelect } from "@/components/filter-select";
import type { DiscoveryResponse } from "./schema-manager-types";

type Candidate = DiscoveryResponse["entityCandidates"][number];
type Orphan = DiscoveryResponse["orphanEntities"][number];

interface Props {
  candidates: Candidate[];
  orphans: Orphan[];
  entityNames: string[];
  absorbingValue: string | null;
  onGrow: (patch: { field: "entity"; value: string; assignMode: "create" | "link-existing"; sources?: string[]; targetEntity?: string }) => Promise<void>;
}

export function EntityGrowthCards({ candidates, orphans, entityNames, absorbingValue, onGrow }: Props) {
  // link-existing 的目标选择（候选名 → 已有实体名）
  const [linkTargets, setLinkTargets] = useState<Record<string, string>>({});
  if (!candidates.length && !orphans.length) return null;

  return <div className="space-y-4">
    {candidates.length > 0 && <section className="space-y-2" data-testid="entity-growth-candidates">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-hint">{GROWTH_CARDS_COPY.CANDIDATES_HEADER} ({candidates.length})</h3>
      <p className="text-xs text-text-hint">{GROWTH_CARDS_COPY.CANDIDATES_INTRO}</p>
      {candidates.map((c) => <div key={c.name} className="rounded-lg ring-1 ring-border-thin bg-surface-card/60 p-3">
        <div className="flex flex-wrap items-center gap-3">
          <code className="text-sm text-text-main">{c.name}</code>
          <span className="text-xs text-text-hint">{c.mentionCount}{GROWTH_CARDS_COPY.MENTION_SUFFIX}</span>
          <div className="ml-auto flex items-center gap-2">
            {entityNames.length > 0 && <FilterSelect
              ariaLabel={smLabeledValueAria(c.name, GROWTH_CARDS_COPY.LINK_TARGET_ARIA_SUFFIX)}
              title={GROWTH_CARDS_COPY.LINK_TARGET_TITLE}
              searchPlaceholder={GROWTH_CARDS_COPY.ENTITY_FILTER_PLACEHOLDER}
              value={linkTargets[c.name] || ""}
              onValueChange={(value) => setLinkTargets({ ...linkTargets, [c.name]: value as string })}
              className="w-44 rounded-lg text-xs"
              options={[{ value: "", label: GROWTH_CARDS_COPY.LINK_EXISTING_OPTION, group: GROWTH_CARDS_COPY.GROUP_ADJUDICATION }, ...entityNames.map((n) => ({ value: n, label: n, group: GROWTH_CARDS_COPY.GROUP_EXISTING_ENTITIES }))]}
            />}
            <button
              disabled={absorbingValue === c.name}
              onClick={() => void onGrow(linkTargets[c.name]
                ? { field: "entity", value: c.name, assignMode: "link-existing", targetEntity: linkTargets[c.name] }
                : { field: "entity", value: c.name, assignMode: "create", sources: c.samples.map((s) => `${s.file} ${s.coordinate}`) })}
              className="rounded-md bg-accent-base px-3 py-1.5 text-xs text-accent-contrast hover:bg-accent-base/90 disabled:opacity-40"
              title={linkTargets[c.name] ? `${GROWTH_CARDS_COPY.MERGE_TITLE_PREFIX}${linkTargets[c.name]}${GROWTH_CARDS_COPY.MERGE_TITLE_SUFFIX}` : GROWTH_CARDS_COPY.CREATE_NEW_TITLE}
            >{absorbingValue === c.name ? GROWTH_CARDS_COPY.SUBMITTING : linkTargets[c.name] ? GROWTH_CARDS_COPY.LINK_EXISTING_ACTION : GROWTH_CARDS_COPY.CREATE_ACTION}</button>
          </div>
        </div>
        <details className="mt-2 text-xs text-text-hint"><summary className="cursor-pointer">{GROWTH_CARDS_COPY.SOURCES_SUMMARY}</summary>
          <ul className="mt-1 space-y-1">{c.samples.map((s, i) => <li key={i}>{s.file} · {s.coordinate}{s.snippet ? ` · “${s.snippet}”` : ""}</li>)}</ul>
        </details>
      </div>)}
    </section>}
    {orphans.length > 0 && <section className="space-y-2" data-testid="entity-growth-orphans">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-hint">{GROWTH_CARDS_COPY.ORPHANS_HEADER} ({orphans.length})</h3>
      <p className="text-xs text-text-hint">{GROWTH_CARDS_COPY.ORPHANS_INTRO}</p>
      <div className="rounded-lg ring-1 ring-border-thin bg-surface-card/40 p-3 text-xs text-text-sub">
        {orphans.map((o) => <code key={o.name} className="mr-3">{o.name}</code>)}
      </div>
    </section>}
  </div>;
}
