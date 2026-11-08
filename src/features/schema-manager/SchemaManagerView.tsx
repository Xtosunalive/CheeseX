// SchemaManagerView — 图谱规则配置主视图
import { apiFetchJson } from "@/lib/api";
import { Fragment, useEffect, useState, useCallback, useMemo } from "react";
import { TERM } from "@/constants/term-const";
import { Save, CheckCircle2, Loader2, Settings } from "lucide-react";
import { FeaturePageHeader } from "@/components/page-header";
import { Panel } from "@/components/panel";
import { useNavLocation } from "@/hooks/use-nav-location";
import { schemaTopology, TAB_SECTIONS } from "@/lib/schema-shape";
import { changeOf } from "@/lib/schema-edit";
import { UsageBadgesStrip } from "./UsageBadgesStrip";
import { useSchemaManagerStore } from "./schema-manager-store";
import { TAB_LABELS, type TabId } from "./schema-manager-types";
import { SchemaIntentNav } from "./SchemaIntentNav";
import { SchemaDanglingNotice } from "./SchemaDanglingNotice";
import { SchemaPartitionOverview } from "./SchemaPartitionOverview";
import { SkeletonSidebar } from "./SkeletonSidebar";
import type { ClassificationSelection } from "./skeleton-sidebar-types";
import { DomainSubdomainEditor } from "./DomainSubdomainEditor";
import { LayerEditor } from "./LayerEditor";
import { TagEditor } from "./TagEditor";
import { SchemaDiscoveryTab } from "./SchemaDiscoveryTab";
import { SchemaHistoryEditor } from "./SchemaHistoryEditor";
import { FieldsEditor } from "./FieldsEditor";
import { FieldGraphPanel } from "./FieldGraphPanel";
import { ConceptVocabularyTab } from "./ConceptVocabularyTab";
import { TagGovernanceEditor } from "./TagGovernanceEditor";
import { OntologyEditor } from "./OntologyEditor";
import { DependencyRulesEditor } from "./DependencyRulesEditor";
import { RelationsEditor } from "./RelationsEditor"; // EDGE-RELATION-GOV-001 阶段4：relations 页签面板（实例账＋出链/反链查询）
import { VIEW_COPY } from "./schema-manager-copy";
import { VersionRegistryEditor } from "./VersionRegistryEditor";
import { DocumentTaxonomyEditor } from "./DocumentTaxonomyEditor";
import { ModuleRegistryEditor } from "./components/ModuleRegistryEditor";
import { SubdomainChangePreviewDialog } from "./components";
import { GraphFreshnessChip } from "./GraphFreshnessChip"; // WP-027（PR-142）：图谱跟随状态提示
import { previewEnumsChanges } from "./schema-manager-api";
import { computeEnumsDirtyDiffs } from "./schema-manager-enums";
import type { EnumsChangePreviewData } from "./schema-manager-types";

export function SchemaManagerView() {
  const store = useSchemaManagerStore();
  const [classificationSelection, setClassificationSelection] = useState<ClassificationSelection>({ domainId: "ref" });
  const [changePreview, setChangePreview] = useState<EnumsChangePreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirmingChange, setConfirmingChange] = useState(false);
  // WP-027（PR-142）：保存成功后即刷图新鲜度提示（否则最长等 30s 轮询）
  const [freshnessTick, setFreshnessTick] = useState(0);
  // SCHEMA-IA-001：PD-1 已裁（2026-10-26「1A 只留意图分区」）——目录镜像退役，意图分区唯一导航（并存切换代码已随裁决移除）

  // 批5：当前主体角色（/api/auth/me 一次性；local 模式恒全角色——谓词自然全绿，oidc 非管理员时徽标转「需 admin」）
  const [principalRoles, setPrincipalRoles] = useState<string[] | null>(null);
  useEffect(() => {
    let alive = true;
    apiFetchJson<{ data?: { principal?: { roles?: string[] } | null } }>("/api/auth/me")
      .then((res) => { if (alive) setPrincipalRoles(res?.data?.principal?.roles ?? null); })
      .catch(() => { if (alive) setPrincipalRoles(null); });

  return () => { alive = false; };
  }, []);
  const { query: navQuery } = useNavLocation();

  // SCHEMA-IA-001 批2：配置引用拓扑现算（消费复用域 schema-shape；输入即 store 既有状态，零新请求）
  const topology = useMemo(() => schemaTopology(store.enums, store.ontology), [store.enums, store.ontology]);

  // R4（PR-277）：装配接线由 changeOf 单点构造——当前页签的懒加载动作／保存动作／状态与
  // 错误读取／编辑冻结全部声明驱动（元数据单源=src/lib/schema-edit TAB_EDIT_META，键=字典
  // 正名）；此前 15 处逐页签 if-else 分支链自此归零
  const wiring = changeOf(store.activeTab, { ...store, previewError });

  // 动作注册表（键=schema-edit 声明的动作名；扁平名字面注册，无页签分支——动作名到
  // store 动作的唯一接线位）
  const EDIT_ACTIONS: Record<string, () => Promise<unknown>> = {
    saveEnums: store.saveEnums,
    saveOntology: store.saveOntology,
    saveDependencies: store.saveDependencies,
    saveVersions: store.saveVersions,
    loadOntology: store.loadOntology,
    loadDiscovery: store.loadDiscovery,
    loadDependencies: store.loadDependencies,
    loadVersions: store.loadVersions,
  };
  const runEditAction = (name: string | null): Promise<unknown> | undefined => {
    const action = name ? EDIT_ACTIONS[name] : undefined;
    return action ? action() : undefined;
  };

  useEffect(() => {
    const requested = navQuery.get("tab");
    if (requested && requested in TAB_LABELS) store.setActiveTab(requested as TabId);
  }, [navQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { store.load(); }, []); // eslint-disable-line

  // R4：懒加载接线声明驱动单点——当前页签需补拉的子资源由 changeOf 依 TAB_EDIT_META 给出
  // （守卫：数据缺席且读请求非 loading）；此前为 ontology/discovery/dependencies/versions(+modules)
  // 四个 effect 五处页签 if
  useEffect(() => {
    if (wiring.lazyLoadAction) void runEditAction(wiring.lazyLoadAction);
  }, [store.activeTab]); // eslint-disable-line react-hooks/exhaustive-deps

// discoveryTotal 随旧分组侧栏退役（树导航无角标位；发现计数仍在未收录值页内）

  const handleSidebarSelect = useCallback((selection: ClassificationSelection) => {
    setClassificationSelection(selection);
    store.setActiveTab("domains");
  }, [store]);
  const handleAddDomain = useCallback((id: string, label: string) => {
    if (!store.enums || store.enums.domains[id]) return;
    store.setDomains({ ...store.enums.domains, [id]: label });
    store.setSubdomains({ ...store.enums.subdomains, [id]: [] });
    setClassificationSelection({ domainId: id });
  }, [store]);

  const handleSave = async () => {
    await doSave();
    // WP-027（PR-142）：保存成功即刷图新鲜度（写失败已由各 save 内部置 error 态，此处只管成功侧提示跟进）
    setFreshnessTick((t) => t + 1);
  };
  const doSave = async () => {
    if (store.subdomainRenameImpact && store.enums && store.savedEnums) {
      setPreviewLoading(true);
      setPreviewError(null);
      try {
        const diffs = computeEnumsDirtyDiffs(store.enums, store.savedEnums);
        // seq201（前端纯净度规则①清存量）：客户端流程守卫改中性技术诊断（经 previewError 行内回显），不再自造业务话术
        if (!diffs.subdomains) throw new Error("no subdomain changes detected to save");
        setChangePreview(await previewEnumsChanges({ ...diffs, revision: store.enums.revision, subdomains: diffs.subdomains }));
      } catch (error) {
        setPreviewError(error instanceof Error ? error.message : VIEW_COPY.PREVIEW_FAILED);
      } finally {
        setPreviewLoading(false);
      }
      return;
    }
    // R4：保存动作由 changeOf 单点构造——专用族数据缺席回落 enums 主面、ontology 乐观锁
    // revision 缺席门槛，均在其声明内；null=门槛未过不保存
    await runEditAction(wiring.saveAction);
  };
  const confirmClassificationChange = async () => {
    if (!changePreview) return;
    setConfirmingChange(true);
    await store.saveEnums();
    setChangePreview(null);
    setConfirmingChange(false);
    setFreshnessTick((t) => t + 1); // WP-027：确认保存同样是 enums 图输入写
  };
  const isEditingDisabled = previewLoading || store.pipelineRunning || wiring.editingLocked;
  const currentSaveStatus = wiring.saveStatus;
  const currentSaveError = wiring.saveError;

  if (store.status === "loading" && !store.enums) return <div className="flex h-full items-center justify-center"><Loader2 className="h-5 w-5 animate-spin text-status-inferred" /></div>;
  if (store.error && !store.enums) return <div className="flex h-full flex-col items-center justify-center gap-3"><p className="text-sm text-status-error">{store.error}</p><button onClick={() => store.load()} className="rounded-md bg-accent-bg text-[var(--color-accent-fg)] ring-1 ring-[var(--color-border-focus)] px-3 py-1.5 text-sm">{TERM.RETRY_ACTION}</button></div>;
  if (!store.enums) return null;

  const selectedDomainId = store.enums.domains[classificationSelection.domainId]
    ? classificationSelection.domainId
    : (Object.keys(store.enums.domains)[0] ?? "");
  const selectedSubdomain = classificationSelection.domainId === selectedDomainId
    && classificationSelection.subdomain
    && (store.enums.subdomains[selectedDomainId] ?? []).some((entry) => entry.id === classificationSelection.subdomain)
      ? classificationSelection.subdomain
      : undefined;
  const activeSelection = { domainId: selectedDomainId, subdomain: selectedSubdomain };

  // ── 批14：内容区 sections 声明驱动装配（TAB_SECTIONS 单源；未声明=无挂载点，
  // 缺渲染器 fail-visible：console.error 且不渲染，不静默回落）──
  const enums = store.enums; // 早退已保证非空（闭包内 TS 收窄不传递——局部化）
  const sectionRenderers: Record<string, () => React.ReactNode> = {
    "classification-workspace": () => (
      <div data-testid="classification-tab-layout" className="flex min-h-full">
        <SkeletonSidebar activeSelection={activeSelection} domains={enums.domains} subdomains={enums.subdomains} onSelect={handleSidebarSelect} onAddDomain={handleAddDomain} disabled={isEditingDisabled} />
        <div className="flex-1 min-w-0 p-5">
          <UsageBadgesStrip dimension="subdomain" label={VIEW_COPY.DIM_SUBDOMAIN} />
          <DomainSubdomainEditor domains={enums.domains} subdomains={enums.subdomains} categories={enums.categories} policies={enums.subdomain_constraints} onDomainsChange={store.setDomains} onSubdomainsChange={store.setSubdomains} onPoliciesChange={store.setSubdomainConstraints} onSubdomainRename={store.renameSubdomainReferences} selectedDomainId={selectedDomainId} selectedSubdomain={selectedSubdomain} onSelectedSubdomainChange={(subdomain) => setClassificationSelection({ domainId: selectedDomainId, subdomain })} showDomainList={false} onDomainCreated={(domainId) => setClassificationSelection({ domainId })} disabled={isEditingDisabled} />
          {store.subdomainRenameImpact && <div className="mt-4 rounded-md bg-status-warn-2 p-3 text-xs leading-5 text-status-warn ring-1 ring-status-warn-6"><p className="font-medium">{VIEW_COPY.RENAME_IMPACT_NOT_APPLIED}{store.subdomainRenameImpact.from} → {store.subdomainRenameImpact.to}</p><p className="mt-1 text-status-warn-11">{VIEW_COPY.RENAME_IMPACT_GUIDE_PREFIX}{store.subdomainRenameImpact.from}{VIEW_COPY.RENAME_IMPACT_GUIDE_MIDDLE}{store.subdomainRenameImpact.moduleNames.length}{VIEW_COPY.RENAME_IMPACT_GUIDE_SUFFIX}</p></div>}
        </div>
      </div>
    ),
    "layer-editor": () => (<div className="p-5"><UsageBadgesStrip dimension="layer" label={VIEW_COPY.DIM_LAYER} /><LayerEditor layers={enums.layers} domains={enums.domains} categories={enums.categories} onLayersChange={store.setLayers} disabled={isEditingDisabled} /></div>),
    "derived-categories-readonly": () => (
      <div className="p-5">
        {/* B1=b 执法（Master 2026-10-23 裁 b）：arch_categories 为派生视图（值＝subdomain_constraints 矩阵并集，ADR-006），派生源缺失期冻结只读——服务端 PUT 已同步拒收（DERIVED_SEGMENT_READ_ONLY），此处恒只读不依赖编辑态 */}
        <div className="mb-4 rounded-md border border-cyan-6 bg-cyan-2 px-4 py-3 text-sm text-text-hint">{VIEW_COPY.CATEGORIES_DERIVED_NOTE}</div>
        <TagEditor tags={enums.categories} onTagsChange={store.setCategories} placeholder={VIEW_COPY.CATEGORY_INPUT_PLACEHOLDER} />
      </div>
    ),
    "taxonomy-editor": () => (<div className="p-5"><DocumentTaxonomyEditor disabled={isEditingDisabled} /></div>),
    "module-registry": () => (<div className="p-5"><ModuleRegistryEditor modules={enums?.modules ?? {}} subdomainGroups={Object.entries(enums?.subdomains ?? {}).map(([domainId, entries]) => ({ domainId, domainLabel: enums?.domains?.[domainId] ?? domainId, entries: entries ?? [] }))} onGoDomains={isEditingDisabled ? undefined : () => store.setActiveTab("domains")} productNames={Object.keys(store.versions?.products ?? {})} onGoVersions={isEditingDisabled ? undefined : () => store.setActiveTab("versions")} versionsLoading={store.versionsRequest.status === "loading"} disabled={isEditingDisabled} onChange={(modules) => enums && store.setModules(modules)} /></div>),
    "tag-governance": () => (<div className="p-5"><TagGovernanceEditor disabled={isEditingDisabled} /></div>),
    "discovery-intake": () => (<div className="p-5"><SchemaDiscoveryTab /></div>),
    "concept-vocabulary": () => (<div className="p-5"><ConceptVocabularyTab disabled={isEditingDisabled} /></div>),
    "ontology-editor": () => (
      store.ontologyRequest.status === "loading" ? <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-status-inferred" /></div>
        : store.ontology ? <div className="p-5"><OntologyEditor nodeTypes={store.ontology.node_types} relationTypes={store.ontology.relation_types} inferenceRules={store.ontology.inference_rules} constraints={store.ontology.constraints} onNodeTypesChange={store.setNodeTypes} onRelationTypesChange={store.setRelationTypes} selectorOptions={store.ontologySelectorOptions} saveStatus={store.ontologySaveStatus} saveError={store.ontologySaveError} disabled={isEditingDisabled} /></div>
        : store.ontologyRequest.error ? <div className="flex flex-col items-center justify-center gap-3 py-12"><p className="text-sm text-status-error">{store.ontologyRequest.error}</p><button onClick={() => store.loadOntology()} className="rounded-md bg-accent-bg text-[var(--color-accent-fg)] ring-1 ring-[var(--color-border-focus)] px-3 py-1.5 text-sm">{TERM.RETRY_ACTION}</button></div>
        : null
    ),
    "dependency-rules": () => (<div className="p-5"><DependencyRulesEditor disabled={isEditingDisabled} /></div>),
    "version-registry": () => (<div className="p-5"><VersionRegistryEditor disabled={isEditingDisabled} /></div>),
    "version-snapshots": () => (<div className="p-5"><SchemaHistoryEditor disabled={isEditingDisabled} /></div>),
    "relation-ledger": () => (<div className="p-5"><RelationsEditor /></div>),
    "field-graph": () => (<div className="p-5"><FieldGraphPanel /></div>),
    "fields-editor": () => (<div className="p-5"><FieldsEditor disabled={isEditingDisabled} /></div>),
  };

  return (
    <Panel
      padding="none"
      testId="schema-manager-layout"
      ariaLabel={VIEW_COPY.PANEL_ARIA}
      className="flex flex-1 min-h-0 flex-col overflow-hidden"
      contentClassName="flex flex-1 min-h-0 flex-col"
    >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div className="flex items-center gap-3">
            <Settings className="h-5 w-5 text-status-inferred" />
            <FeaturePageHeader description={VIEW_COPY.PAGE_DESCRIPTION} />
            {currentSaveStatus === "saved" && <span className="text-xs text-status-fact flex items-center gap-1"><CheckCircle2 className="h-3 w-3" />{TERM.SAVED}</span>}
            {currentSaveStatus === "saving" && <span className="text-xs text-text-sub flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />{VIEW_COPY.SAVING}</span>}
            {(currentSaveStatus === "error" || previewError) && currentSaveError && <span className="text-xs text-status-error">{currentSaveError}</span>}
            {store.pipelineRunning && <span className="text-xs text-status-loading flex items-center gap-1"><Loader2 className="h-3 w-3 animate-spin" />{VIEW_COPY.PIPELINE_RUNNING}</span>}
            <GraphFreshnessChip refreshTick={freshnessTick} />
          </div>
          <button onClick={handleSave} disabled={isEditingDisabled || currentSaveStatus === "clean"} className="flex items-center gap-1.5 rounded-md bg-accent-bg text-[var(--color-accent-fg)] ring-1 ring-[var(--color-border-focus)] px-3 py-1.5 text-sm disabled:opacity-40 transition-colors">
            {currentSaveStatus === "saving" || previewLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{currentSaveStatus === "saving" ? VIEW_COPY.SAVING : previewLoading ? VIEW_COPY.CHECKING_IMPACT : VIEW_COPY.SAVE_RULES_ACTION}
          </button>
        </div>

        {/* E3'b2：Schema Proposal 生命周期已退役，编辑直接写回权威源（乐观锁 revision） */}

        {/* Sidebar + Content */}
        <div className="flex flex-1 min-h-0">
          {/* SCHEMA-IA-001 批2：两导航互斥挂载（并存会产生重名按钮破坏 getByRole 断言面）＋形态切换 */}
          <SchemaIntentNav activeTab={store.activeTab} onSelect={store.setActiveTab} topology={topology} />

          <div className="flex-1 min-h-0 overflow-auto">
            <SchemaDanglingNotice tab={store.activeTab} topology={topology} />
            <SchemaPartitionOverview tab={store.activeTab} topology={topology} roles={principalRoles} />
          {(TAB_SECTIONS[store.activeTab] ?? []).map((sectionId) => (
            <Fragment key={sectionId}>
              {sectionRenderers[sectionId] ? sectionRenderers[sectionId]() : (console.error(`${VIEW_COPY.SECTION_FALLBACK_PREFIX}${sectionId}`), null)}
            </Fragment>
          ))}
          </div>
        </div>

        <SubdomainChangePreviewDialog preview={changePreview} confirming={confirmingChange} onCancel={() => setChangePreview(null)} onConfirm={() => void confirmClassificationChange()} />

    </Panel>
  );
}
