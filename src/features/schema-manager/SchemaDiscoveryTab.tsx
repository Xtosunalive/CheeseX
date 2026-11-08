import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSchemaManagerStore } from "./schema-manager-store";
import type { DiscoveryField } from "./schema-manager-types";
import { FilterSelect } from "@/components/filter-select";
// ADR-007 A2/A3：实体生长候选卡（Steward Queue 实体类）+ A5 卫生信号
import { EntityGrowthCards } from "./EntityGrowthCards";
// 波2（SPEC-007 §3.3）：词表画像区（五维度计数+阶段徽章+死词+阈值旋钮——Steward Queue 词表类）
import { VocabularyProfileSection } from "./VocabularyProfileSection";
// 波3（SPEC-008 §3.3）：规则通道（候选信号+台账——Steward Queue 规则类）
import { RulesChannelSection } from "./RulesChannelSection";
import { DISCOVERY_COPY, smLabeledValueAria } from "./schema-manager-copy";
import { TERM } from "@/constants/term-const";

const GROUPS: Array<{ field: DiscoveryField; label: string }> = [
  { field: "layers", label: TERM.LAYER },
  { field: "categories", label: TERM.CATEGORY },
  { field: "subdomains", label: TERM.SUBDOMAIN },
  { field: "tags", label: DISCOVERY_COPY.GROUP_UNCOLLECTED_TAGS },
];

export function SchemaDiscoveryTab() {
  const store = useSchemaManagerStore();
  const [domains, setDomains] = useState<Record<string, string>>({});
  // Master 2026-10-17 裁决「发现的时候就写好」：subdomain 裁定晋升必填 label（出生即带义）。
  const [labels, setLabels] = useState<Record<string, string>>({});
  // G1'：tags 晋升的两种人裁定——升为正式标签（选分组）或归为别名（选目标正式标签）
  const [tagGroups, setTagGroups] = useState<Record<string, string>>({});
  const [tagAliasTargets, setTagAliasTargets] = useState<Record<string, string>>({});

  useEffect(() => { void store.loadDiscovery(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (store.discoveryRequest.status === "loading" && !store.discovery) return <div className="flex justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-status-inferred" /></div>;
  if (store.discoveryRequest.error && !store.discovery) return <div className="rounded-lg ring-1 ring-red-9 p-4 text-sm text-status-error">{store.discoveryRequest.error}</div>;
  if (!store.discovery) return null;
  // ADR-007 MVP：实体生长信号独立呈现（候选/孤儿），与词表未收录值并列——
  // 空态判定只约束词表面（counts.total===0 不代表无实体候选）。
  // 波2：对旧形态响应/测试 mock 宽容（entityMentions 等字段缺省视为空集——增量不破坏原则）。
  const growth = store.discovery;
  const entityMentions = growth.entityMentions ?? [];
  const entityCandidates = growth.entityCandidates ?? [];
  const orphanEntities = growth.orphanEntities ?? [];
  const entityNames = entityMentions.map((m) => m.name);
  // PR-088 接线一：组合候选（子域×类别）——与词表/实体/规则候选并列进裁定通道；空态判定一并计入
  const matrixCandidates = growth.matrixCandidates?.candidates ?? [];
  if (store.discovery.counts.total === 0 && !entityCandidates.length && !orphanEntities.length && !matrixCandidates.length) {
    return <div className="rounded-lg ring-1 ring-border-thin p-6 text-center text-sm text-text-sub" data-testid="discovery-empty-state">{DISCOVERY_COPY.EMPTY_STATE}</div>;
  }

  const formalTagOptions = Object.entries(store.enums?.tags || {}).flatMap(([group, values]) =>
    (values as string[]).map((value) => ({ value, label: DISCOVERY_COPY.FORMAL_TAG_OPTION(value, group), group: DISCOVERY_COPY.GROUP_FORMAL_TAGS }))
  );

  return <div className="space-y-6">
    {(store.discoveryRequest.error ?? store.discoveryOperationError) && <p className="text-sm text-status-error">{(store.discoveryRequest.error ?? store.discoveryOperationError)}</p>}
    {store.grownNotice && <div className="flex items-start justify-between gap-3 rounded-lg ring-1 ring-grass-12/40 bg-surface-card/60 px-3 py-2 text-sm text-status-fact" data-testid="grown-notice">
      <span>{store.grownNotice}</span>
      <button type="button" aria-label={DISCOVERY_COPY.CLOSE_NOTICE_ARIA} onClick={() => useSchemaManagerStore.setState({ grownNotice: null })} className="shrink-0 rounded px-1 text-text-hint hover:bg-surface-hover hover:text-text-main">×</button>
    </div>}
    <div className="rounded-lg ring-1 ring-border-thin bg-surface-card/60 p-3 text-xs text-text-sub">
      {DISCOVERY_COPY.WILD_TAG_NOTICE}
    </div>
    <EntityGrowthCards
      candidates={entityCandidates}
      orphans={orphanEntities}
      entityNames={entityNames}
      absorbingValue={store.absorbingValue}
      onGrow={(patch) => store.growEntity(patch)}
    />
    {growth.vocabularyProfile && <VocabularyProfileSection
      profile={growth.vocabularyProfile}
      onThresholdChange={(threshold) => void store.reloadDiscoveryWithThreshold(threshold)}
    />}
    {/* 实体总目（guide⑥派生总目——Curriculum 同构：分组+清单+计数；纯派生可折叠） */}
    {growth.entityCatalog && growth.entityCatalog.length > 0 && <details className="rounded-lg ring-1 ring-border-thin bg-surface-card/40 p-3" data-testid="entity-catalog">
      <summary className="cursor-pointer text-xs font-semibold uppercase tracking-wider text-text-hint">{DISCOVERY_COPY.ENTITY_CATALOG_HEADER(growth.entityCatalog.reduce((n, g) => n + g.count, 0), growth.entityCatalog.length)}</summary>
      <div className="mt-2 space-y-2">
        {growth.entityCatalog.map((g) => <div key={g.group}>
          <p className="text-xs text-text-main font-medium">{g.group}（{g.count}）</p>
          <p className="text-xs text-text-sub leading-relaxed">{g.items.map((it) => `${it.name}${it.mentionCount ? ` · ${it.mentionCount}` : ""}${it.origin === "article-grown" ? "🌱" : ""}`).join("　")}</p>
        </div>)}
      </div>
    </details>}
    {/* 波2：vocabularyProfile 缺省（旧 mock/异常响应）时词表画像区静默跳过——增量不破坏 */}
    <RulesChannelSection
      candidates={growth.ruleCandidates}
      onMinCountChange={(minCount) => void store.reloadDiscoveryWithMinCount(minCount)}
    />
    {/* PR-088 接线一/二：分类矩阵组合候选——反复出现的 子域×类别 经裁定写入 subdomain_constraints（ADR-006 立契），门禁自动转执法 */}
    {matrixCandidates.length > 0 && <section className="space-y-2" data-testid="matrix-candidates">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-text-hint">{DISCOVERY_COPY.MATRIX_HEADER} ({matrixCandidates.length}) · {growth.matrixCandidates?.stage === "configured" ? DISCOVERY_COPY.MATRIX_STAGE_CONFIGURED : DISCOVERY_COPY.MATRIX_STAGE_OBSERVING}</h3>
      <p className="text-xs text-text-hint">{DISCOVERY_COPY.MATRIX_INTRO}</p>
      {matrixCandidates.map((c) => {
        const key = `${c.subdomain}×${c.category}`;
        return <div key={key} className="rounded-lg ring-1 ring-border-thin bg-surface-card/60 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <code className="text-sm text-text-main">{c.subdomain} × {c.category}</code>
            <span className="text-xs text-text-hint">{c.occurrences}{DISCOVERY_COPY.MATRIX_OCCURRENCES_UNIT}{c.rounds ?? 1}{DISCOVERY_COPY.MATRIX_ROUNDS_UNIT}{c.total ?? DISCOVERY_COPY.MATRIX_TOTAL_UNKNOWN}{DISCOVERY_COPY.MATRIX_TOTAL_UNIT}{c.firstSeen && c.firstSeen !== DISCOVERY_COPY.FIRST_SEEN_CURRENT ? `${DISCOVERY_COPY.MATRIX_FIRST_SEEN_PREFIX}${c.firstSeen.slice(0, 10)}` : ""}</span>
            <div className="ml-auto flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                disabled={store.absorbingValue === key}
                onClick={() => void store.allowMatrixCandidate(c.subdomain, c.category)}
                className="h-8 text-xs"
                title={DISCOVERY_COPY.MATRIX_CONFIRM_TITLE}
              >{store.absorbingValue === key ? DISCOVERY_COPY.SUBMITTING : DISCOVERY_COPY.MATRIX_CONFIRM_ACTION}</Button>
            </div>
          </div>
          {c.sampleFiles && c.sampleFiles.length > 0 && <details className="mt-2 text-xs text-text-hint"><summary className="cursor-pointer">{DISCOVERY_COPY.SAMPLE_FILES_SUMMARY}</summary><ul className="mt-1 space-y-1">{c.sampleFiles.map((file) => <li key={file}>{file}</li>)}</ul></details>}
        </div>;
      })}
    </section>}
    {GROUPS.map(({ field, label }) => {
      const items = store.discovery!.discovery[field];
      if (!items || !items.length) return null;
      return <section key={field} className="space-y-2">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-text-hint">{label} ({items.length})</h3>
        {/* B1=b 执法补漏（与 #61 categories 页签恒只读同批语义）：arch_categories 派生视图缺失期冻结——absorb 服务端已 403（DERIVED_SEGMENT_READ_ONLY），按钮同禁防必然报错；类别裁定走「分类矩阵候选」组合立契 */}
        {field === "categories" && <p className="text-xs text-text-hint">{DISCOVERY_COPY.CATEGORIES_READONLY_HINT}</p>}
        {items.map((item) => <div key={item.value} className="rounded-lg ring-1 ring-border-thin bg-surface-card/60 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <code className="text-sm text-text-main">{item.value}</code>
            <span className="text-xs text-text-hint">{item.count}{DISCOVERY_COPY.COUNT_DOCS_UNIT}{item.files.length}{DISCOVERY_COPY.COUNT_FILES_UNIT}</span>
            <div className="ml-auto flex items-center gap-2">
              {field === "subdomains" && <>
                <FilterSelect ariaLabel={smLabeledValueAria(item.value, DISCOVERY_COPY.ASSIGN_DOMAIN_ARIA_SUFFIX)} title={DISCOVERY_COPY.ASSIGN_DOMAIN_TITLE} searchPlaceholder={DISCOVERY_COPY.DOMAIN_FILTER_PLACEHOLDER} value={domains[item.value] || ""} onValueChange={(value) => setDomains({ ...domains, [item.value]: value as string })} className="w-48 rounded-lg text-xs" options={[{ value: "", label: DISCOVERY_COPY.DOMAIN_PICK_OPTION, group: DISCOVERY_COPY.GROUP_SCOPE }, ...Object.entries(store.enums?.domains || {}).map(([value, name]) => ({ value, label: name, group: TERM.DOMAIN }))]} />
                <input aria-label={smLabeledValueAria(item.value, DISCOVERY_COPY.LABEL_ARIA_SUFFIX)} title={DISCOVERY_COPY.LABEL_REQUIRED_TITLE} placeholder={DISCOVERY_COPY.LABEL_REQUIRED_PLACEHOLDER} value={labels[item.value] || ""} onChange={(e) => setLabels({ ...labels, [item.value]: e.target.value })} className="w-36 rounded-lg text-xs" />
              </>}
              {field === "tags" && <>
                <FilterSelect ariaLabel={smLabeledValueAria(item.value, DISCOVERY_COPY.PROMOTE_GROUP_ARIA_SUFFIX)} title={DISCOVERY_COPY.PROMOTE_GROUP_TITLE} searchPlaceholder={DISCOVERY_COPY.GROUP_FILTER_PLACEHOLDER} value={tagGroups[item.value] || ""} onValueChange={(value) => setTagGroups({ ...tagGroups, [item.value]: value as string })} className="w-44 rounded-lg text-xs" options={[{ value: "", label: DISCOVERY_COPY.PROMOTE_GROUP_OPTION, group: DISCOVERY_COPY.GROUP_ADJUDICATION }, ...Object.entries(store.enums?.tags || {}).map(([value, name]) => ({ value, label: String(name), group: DISCOVERY_COPY.GROUP_TAG_GROUPS }))]} />
                <FilterSelect ariaLabel={smLabeledValueAria(item.value, DISCOVERY_COPY.ALIAS_TARGET_ARIA_SUFFIX)} title={DISCOVERY_COPY.ALIAS_TARGET_TITLE} searchPlaceholder={DISCOVERY_COPY.ALIAS_TARGET_FILTER_PLACEHOLDER} value={tagAliasTargets[item.value] || ""} onValueChange={(value) => setTagAliasTargets({ ...tagAliasTargets, [item.value]: value as string })} className="w-44 rounded-lg text-xs" options={[{ value: "", label: DISCOVERY_COPY.ALIAS_TARGET_OPTION, group: DISCOVERY_COPY.GROUP_ADJUDICATION }, ...formalTagOptions]} />
              </>}
              <button
                disabled={store.absorbingValue === item.value
                  || field === "categories"
                  || (field === "subdomains" && !(domains[item.value] && labels[item.value]?.trim()))
                  || (field === "tags" && !(tagGroups[item.value] || tagAliasTargets[item.value]))}
                onClick={() => void store.absorbFormal(
                  field === "subdomains" ? { field, value: item.value, mode: "formal", domain: domains[item.value], label: labels[item.value]?.trim() }
                  : field === "tags" ? (tagAliasTargets[item.value]
                    ? { field, value: item.value, mode: "formal", assignMode: "alias", aliasTarget: tagAliasTargets[item.value] }
                    : { field, value: item.value, mode: "formal", assignMode: "formal", group: tagGroups[item.value] })
                  : { field, value: item.value, mode: "formal" })}
                className="rounded-lg bg-accent-base px-3 py-1.5 text-xs text-accent-contrast hover:bg-accent-base/90 disabled:opacity-40"
                title={DISCOVERY_COPY.SUBMIT_TITLE}
              >{store.absorbingValue === item.value ? DISCOVERY_COPY.SUBMITTING : DISCOVERY_COPY.SUBMIT_ACTION}</button>
            </div>
          </div>
          <details className="mt-2 text-xs text-text-hint"><summary className="cursor-pointer">{DISCOVERY_COPY.VIEW_FILES_SUMMARY}</summary><ul className="mt-1 space-y-1">{item.files.map((file) => <li key={file}>{file}</li>)}</ul></details>
        </div>)}
      </section>
    })}
  </div>;
}
