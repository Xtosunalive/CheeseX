// Schema Manager Zustand store
import { create } from "zustand";
import { sliceWithRest } from "@/lib/format";
import type { AssertionPolicySelectorOptions, DependencyImpactPreviewData, DependencyRuleItem, DependencyRulesData, DiscoveryResponse, FormalAbsorbRequest, FullEnumsData, NormalizedEnumsData, ModuleRegistry, TabId, SaveStatus, OntologyData, NodeTypeDef, RelationTypeDef } from "./schema-manager-types";
import { normalizeEnumsData } from "./schema-manager-types";
import { fetchEnums } from "./schema-manager-api";
import { computeEnumsDirtyDiffs, deepEqual, renameModuleSubdomainReferences } from "./schema-manager-enums";
import { fetchDiscovery } from "./schema-discovery-api";
import { fetchOntology } from "./ontology-api";
import { fetchDependencyRules, previewDependencyRules, validateDependencyRules } from "./dependencies-api";
import { createVersionRegistrySlice, type VersionRegistrySlice } from "./schema-manager-version-slice";
import { absorbDiscovery, writeDependencies, writeEnums, writeOntology } from "./schema-write-api";
import { errorMessageOf, requestFailed, requestIdle, requestLoading, requestSettled, type RequestSlice, type RequestStatus } from "@/lib/request-status";
import { SM_REQUEST_COPY, smGrownEntityNotice, smMatrixConfirmNotice } from "./schema-manager-copy";

interface SchemaManagerState extends VersionRegistrySlice {
  activeTab: TabId;
  enums: NormalizedEnumsData | null;
  savedEnums: NormalizedEnumsData | null;
  /** 主请求＝enums 加载；各页签子资源各自一片 RequestSlice（interaction-state 域契约） */
  status: RequestStatus;
  error: string | null;
  saveStatus: SaveStatus;
  saveError: string | null;
  pipelineRunning: boolean;
  discovery: DiscoveryResponse | null;
  discoveryRequest: RequestSlice;
  /** 未收录值/实体生长等写操作的失败位（不污染 discoveryRequest 读态） */
  discoveryOperationError: string | null;
  grownNotice: string | null;
  absorbingValue: string | null;
  subdomainRenameImpact: { from: string; to: string; moduleNames: string[] } | null;

  // Ontology state
  ontology: OntologyData | null;
  ontologySaved: OntologyData | null;
  ontologyRequest: RequestSlice;
  ontologySaveStatus: SaveStatus;
  ontologySaveError: string | null;
  ontologyRevision: string | null;
  ontologySelectorOptions: AssertionPolicySelectorOptions;

  // Dependency rules state
  dependencies: DependencyRulesData | null;
  dependenciesSaved: DependencyRulesData | null;
  dependenciesRequest: RequestSlice;
  dependenciesSaveStatus: SaveStatus;
  dependenciesSaveError: string | null;
  dependencyPreview: DependencyImpactPreviewData | null;
  dependencyPreviewLoading: boolean;

  setActiveTab: (tab: TabId) => void;
  load: () => Promise<void>;
  setDomains: (domains: FullEnumsData["domains"]) => void;
  setSubdomains: (subdomains: NormalizedEnumsData["subdomains"]) => void;
  setSubdomainConstraints: (policies: FullEnumsData["subdomain_constraints"]) => void;
  renameSubdomainReferences: (from: string, to: string) => void;
  setLayers: (layers: FullEnumsData["layers"]) => void;
  setCategories: (categories: string[]) => void;
  setArticleTypes: (articleTypes: string[]) => void;
  setDocTypes: (docTypes: string[]) => void;
  setModules: (modules: ModuleRegistry) => void;
  setTags: (tags: FullEnumsData["tags"]) => void;
  setTagAliases: (aliases: FullEnumsData["tag_aliases"]) => void;
  setDisabledTags: (tags: string[]) => void;
  loadDiscovery: (verifiedThreshold?: number) => Promise<void>;
  /** 波2（SPEC-007 §3.3）：阈值旋钮重取——?verifiedThreshold=N */
  reloadDiscoveryWithThreshold: (threshold: number) => Promise<void>;
  /** 波3b（Master 02:57 令）：信号门槛旋钮重取——?minCount=N */
  reloadDiscoveryWithMinCount: (minCount: number) => Promise<void>;
  absorbFormal: (payload: FormalAbsorbRequest) => Promise<void>;
  // ADR-007 A2/A3：实体生长裁定通道（field=entity，SPEC-005 §3.2）
  growEntity: (patch: { field: "entity"; value: string; assignMode: "create" | "link-existing"; sources?: string[]; targetEntity?: string }) => Promise<void>;
  /** PR-088 接线二：组合裁定（field=policy）——把 子域×类别 写进 subdomain_constraints（ADR-006 立契动作进生长通道） */
  allowMatrixCandidate: (subdomain: string, category: string) => Promise<void>;

  // Ontology actions
  loadOntology: () => Promise<void>;
  saveOntology: () => Promise<boolean>;
  setNodeTypes: (nodeTypes: Record<string, NodeTypeDef>) => void;
  setRelationTypes: (relationTypes: Record<string, RelationTypeDef>) => void;

  // Direct write save actions (E3'b2)
  saveEnums: () => Promise<boolean>;
  saveDependencies: () => Promise<boolean>;

  // Dependency rules actions
  loadDependencies: () => Promise<void>;
  setDependencyItems: (items: DependencyRuleItem[]) => void;
  validateDependencies: () => Promise<void>;
  previewDependencies: () => Promise<void>;
  clearDependencyPreview: () => void;
}

export const useSchemaManagerStore = create<SchemaManagerState>((set, get) => ({
  activeTab: "domains",
  enums: null,
  savedEnums: null,
  status: "idle",
  error: null,
  saveStatus: "clean",
  saveError: null,
  pipelineRunning: false,
  discovery: null,
  grownNotice: null,
  discoveryRequest: requestIdle(),
  discoveryOperationError: null,
  absorbingValue: null,
  subdomainRenameImpact: null,

  ontology: null,
  ontologySaved: null,
  ontologyRequest: requestIdle(),
  ontologySaveStatus: "clean",
  ontologySaveError: null,
  ontologyRevision: null,
  ontologySelectorOptions: { sourceKinds: [], producers: [], decisionModes: [], workingProjections: [] },

  dependencies: null,
  dependenciesSaved: null,
  dependenciesRequest: requestIdle(),
  dependenciesSaveStatus: "clean",
  dependenciesSaveError: null,
  dependencyPreview: null,
  dependencyPreviewLoading: false,

  ...createVersionRegistrySlice((partial) => set(partial), () => get()),

  setActiveTab: (tab) => set({ activeTab: tab }),

  loadDiscovery: async (verifiedThreshold) => {
    set({ discoveryRequest: requestLoading() });
    // 波2：阈值透传（undefined=服务端默认 1）——页面旋钮变更时带参重取
    try { set({ discovery: await fetchDiscovery(verifiedThreshold), discoveryRequest: requestSettled() }); }
    catch (e) { set({ discoveryRequest: requestFailed(e, SM_REQUEST_COPY.RULES_LOAD_FAILED) }); }
  },

  // 波2（SPEC-007 §3.3）：阈值旋钮——verifiedThreshold 变更触发 discovery 重取（R2 现算无状态代价）
  reloadDiscoveryWithThreshold: async (threshold) => {
    set({ discoveryRequest: requestLoading() });
    try { set({ discovery: await fetchDiscovery(threshold), discoveryRequest: requestSettled() }); }
    catch (e) { set({ discoveryRequest: requestFailed(e, SM_REQUEST_COPY.DISCOVERY_RELOAD_THRESHOLD_FAILED) }); }
  },

  // 波3b（Master 02:57 令）：规则信号门槛旋钮——minCount 变更触发 discovery 重取
  reloadDiscoveryWithMinCount: async (minCount) => {
    set({ discoveryRequest: requestLoading() });
    try { set({ discovery: await fetchDiscovery(undefined, minCount), discoveryRequest: requestSettled() }); }
    catch (e) { set({ discoveryRequest: requestFailed(e, SM_REQUEST_COPY.DISCOVERY_RELOAD_MINCOUNT_FAILED) }); }
  },

  // ADR-007 A2/A3：实体生长裁定（field=entity）——create 建实体 / link-existing 归并别名。
  // 成功后整体重载 discovery（生长改变候选/提及计数/孤儿三个面，局部更新不如整体现算——R2 派生物无状态代价）。
  growEntity: async (patch) => {
    set({ absorbingValue: patch.value, discoveryOperationError: null }); // grownNotice 不在启动清——双击/连点第二次启动会秒抹上一条提示（Master 13:20 报"秒没"根因）；仅在新成功时替换
    try {
      const state = get();
      if (!state.enums?.revision) throw new Error("graph rules are not loaded yet");
      const result = await absorbDiscovery(state.enums.revision, { field: "entity", value: patch.value, assignMode: patch.assignMode, ...(patch.sources ? { sources: patch.sources } : {}), ...(patch.targetEntity ? { targetEntity: patch.targetEntity } : {}) });
      // WP-B（借镜 dictionary「新词反查旧文」）：create 成功回带 backlinks——出生反查提示
      // （unwrapEnvelope 已解一层 data——backlinks 在 SchemaWriteResult 顶层）
      const backlinks = result.backlinks || [];
      // WP-134 波3：出生反查提示的可见列举与「等」标记一处算出（旧写法 slice(0,3) 与 length>3 各写一遍）
      const backlinkFold = sliceWithRest(backlinks, 3);
      set({ absorbingValue: null, grownNotice: backlinks.length
        ? smGrownEntityNotice(patch.value, backlinks.length, backlinkFold.visible.map((b) => b.file), backlinkFold.rest > 0)
        : null });
      await get().loadDiscovery();
    } catch (e) {
      set({ absorbingValue: null, discoveryOperationError: errorMessageOf(e, SM_REQUEST_COPY.ENTITY_GROW_FAILED) });
    }
  },

  absorbFormal: async (payload) => {
    set({ absorbingValue: payload.value, discoveryOperationError: null });
    try {
      const state = get();
      // seq201（前端纯净度规则①清存量）：本地状态机守卫改中性技术诊断（经 discoveryError 回显），不再自造业务话术
      if (!state.enums?.revision) throw new Error("graph rules are not loaded yet");
      await absorbDiscovery(state.enums.revision, { field: payload.field, value: payload.value, ...(payload.domain ? { domain: payload.domain } : {}), ...(payload.label ? { label: payload.label } : {}), ...(payload.assignMode ? { assignMode: payload.assignMode } : {}), ...(payload.aliasTarget ? { aliasTarget: payload.aliasTarget } : {}), ...(payload.group ? { group: payload.group } : {}) });
      const discovery = get().discovery;
      if (discovery) {
        const nextItems = discovery.discovery[payload.field].filter((item) => item.value !== payload.value);
        set({
          discovery: {
            ...discovery,
            discovery: { ...discovery.discovery, [payload.field]: nextItems },
            counts: {
              ...discovery.counts,
              [payload.field]: nextItems.length,
              total: Math.max(0, discovery.counts.total - 1),
            },
          },
        });
      }
    } catch (e) {
      set({ discoveryOperationError: errorMessageOf(e, SM_REQUEST_COPY.DISCOVERY_ABSORB_FAILED) });
    } finally { set({ absorbingValue: null }); }
  },

  // PR-088 接线二：组合裁定——成功后重载 enums（revision 变）与 discovery（候选退场、矩阵 stage 翻面）。
  allowMatrixCandidate: async (subdomain, category) => {
    const key = `${subdomain}×${category}`;
    set({ absorbingValue: key, discoveryOperationError: null });
    try {
      const state = get();
      if (!state.enums?.revision) throw new Error("graph rules are not loaded yet");
      await absorbDiscovery(state.enums.revision, { field: "policy", subdomain, category });
      set({ grownNotice: smMatrixConfirmNotice(key) });
      await get().load();
      await get().loadDiscovery();
    } catch (e) {
      set({ discoveryOperationError: errorMessageOf(e, SM_REQUEST_COPY.POLICY_SUBMIT_FAILED) });
    } finally { set({ absorbingValue: null }); }
  },

  load: async () => {
    set(requestLoading());
    try {
      const data = normalizeEnumsData(await fetchEnums());
      set({
        enums: data,
        savedEnums: JSON.parse(JSON.stringify(data)),
        ...requestSettled(),
        saveStatus: "clean",
        saveError: null,
        subdomainRenameImpact: null,
      });
    } catch (e) {
      set(requestFailed(e, SM_REQUEST_COPY.RULES_LOAD_FAILED));
    }
  },

  setDomains: (domains) => {
    const { enums, savedEnums } = get();
    if (!enums) return;
    const next = { ...enums, domains };
    set({
      enums: next,
      saveStatus: deepEqual(next, savedEnums) ? (get().saveStatus === "dirty" ? "clean" : get().saveStatus) : "dirty",
    });
  },

  setSubdomains: (subdomains) => {
    const { enums, savedEnums } = get();
    if (!enums) return;
    const next = { ...enums, subdomains };
    set({
      enums: next,
      saveStatus: deepEqual(next, savedEnums) ? (get().saveStatus === "dirty" ? "clean" : get().saveStatus) : "dirty",
    });
  },

  setSubdomainConstraints: (subdomain_constraints) => {
    const { enums, savedEnums } = get();
    if (!enums) return;
    const next = { ...enums, subdomain_constraints };
    set({ enums: next, saveStatus: deepEqual(next, savedEnums) ? "clean" : "dirty" });
  },

  renameSubdomainReferences: (from, to) => {
    const { enums, savedEnums } = get();
    if (!enums || !from || !to || from === to) return;
    const renamed = renameModuleSubdomainReferences(enums.modules, from, to);
    const next = { ...enums, modules: renamed.modules };
    set({
      enums: next,
      subdomainRenameImpact: { from, to, moduleNames: renamed.moduleNames },
      saveStatus: deepEqual(next, savedEnums) ? "clean" : "dirty",
    });
  },

  setLayers: (layers) => {
    const { enums, savedEnums } = get();
    if (!enums) return;
    const next = { ...enums, layers };
    set({
      enums: next,
      saveStatus: deepEqual(next, savedEnums) ? (get().saveStatus === "dirty" ? "clean" : get().saveStatus) : "dirty",
    });
  },

  setCategories: (categories) => {
    const { enums, savedEnums } = get();
    if (!enums) return;
    const next = { ...enums, categories };
    set({
      enums: next,
      saveStatus: deepEqual(next, savedEnums) ? (get().saveStatus === "dirty" ? "clean" : get().saveStatus) : "dirty",
    });
  },

  setArticleTypes: (articleTypes) => {
    const { enums, savedEnums } = get();
    if (!enums) return;
    const next = { ...enums, article_types: articleTypes };
    set({ enums: next, saveStatus: deepEqual(next, savedEnums) ? "clean" : "dirty" });
  },

  setDocTypes: (docTypes) => {
    const { enums, savedEnums } = get();
    if (!enums) return;
    const next = { ...enums, doc_types: docTypes };
    set({ enums: next, saveStatus: deepEqual(next, savedEnums) ? "clean" : "dirty" });
  },

  setModules: (modules) => {
    const { enums, savedEnums } = get();
    if (!enums) return;
    const next = { ...enums, modules };
    set({ enums: next, saveStatus: deepEqual(next, savedEnums) ? "clean" : "dirty" });
  },
  setTags: (tags) => { const { enums, savedEnums } = get(); if (!enums) return; const next = { ...enums, tags }; set({ enums: next, saveStatus: deepEqual(next, savedEnums) ? "clean" : "dirty" }); },
  setTagAliases: (tag_aliases) => { const { enums, savedEnums } = get(); if (!enums) return; const next = { ...enums, tag_aliases }; set({ enums: next, saveStatus: deepEqual(next, savedEnums) ? "clean" : "dirty" }); },
  setDisabledTags: (disabled_tags) => { const { enums, savedEnums } = get(); if (!enums) return; const next = { ...enums, disabled_tags }; set({ enums: next, saveStatus: deepEqual(next, savedEnums) ? "clean" : "dirty" }); },

  // ── Ontology actions ──

  loadOntology: async () => {
    set({ ontologyRequest: requestLoading() });
    try {
      const data = await fetchOntology();
      set({
        ontology: { node_types: data.node_types, relation_types: data.relation_types, inference_rules: data.inference_rules, constraints: data.constraints },
        ontologySaved: JSON.parse(JSON.stringify(data)),
        ontologyRevision: data.revision ?? null,
        ontologyRequest: requestSettled(),
        ontologySaveStatus: "clean",
        ontologySaveError: null,
      });
    } catch (e) {
      set({ ontologyRequest: requestFailed(e, SM_REQUEST_COPY.ONTOLOGY_LOAD_FAILED) });
    }
  },

  saveOntology: async () => {
    const { ontology, ontologyRevision } = get();
    if (!ontology || !ontologyRevision) return false;
    set({ ontologySaveStatus: "saving", ontologySaveError: null });
    try {
      await writeOntology(ontologyRevision, ontology as unknown as Record<string, unknown>);
      await get().loadOntology();
      set({ ontologySaveStatus: "saved" });
      return true;
    } catch (e) {
      set({ ontologySaveStatus: "error", ontologySaveError: e instanceof Error ? e.message : SM_REQUEST_COPY.ONTOLOGY_SAVE_FAILED });
      return false;
    }
  },

  saveEnums: async () => {
    const { enums, savedEnums } = get();
    if (!enums?.revision) return false;
    // PUT 契约只收节键差量——整对象回写会把 GET 投影的只读字段（lifecycle_status/sourceFile）
    // 一并塞进 patch，被写路径闸门以 Unknown section 拒绝（tr_70af34a6 实证）
    const diffs = computeEnumsDirtyDiffs(enums, savedEnums);
    if (Object.keys(diffs).length === 0) {
      set({ saveStatus: "saved" });
      return true;
    }
    set({ saveStatus: "saving", saveError: null });
    try {
      await writeEnums(enums.revision, diffs as unknown as Record<string, unknown>);
      await get().load();
      set({ saveStatus: "saved" });
      return true;
    } catch (e) {
      set({ saveStatus: "error", saveError: e instanceof Error ? e.message : SM_REQUEST_COPY.RULES_SAVE_FAILED });
      return false;
    }
  },

  saveDependencies: async () => {
    const { dependencies } = get();
    if (!dependencies?.revision) return false;
    set({ dependenciesSaveStatus: "saving", dependenciesSaveError: null });
    try {
      await writeDependencies(dependencies.revision, { dependencies: dependencies.items });
      await get().loadDependencies();
      set({ dependenciesSaveStatus: "saved" });
      return true;
    } catch (e) {
      set({ dependenciesSaveStatus: "error", dependenciesSaveError: e instanceof Error ? e.message : SM_REQUEST_COPY.DEPENDENCY_SAVE_FAILED });
      return false;
    }
  },

  setNodeTypes: (nodeTypes) => {
    const { ontology, ontologySaved } = get();
    if (!ontology) return;
    const next = { ...ontology, node_types: nodeTypes };
    set({
      ontology: next,
      ontologySaveStatus: deepEqual(next, ontologySaved) ? (get().ontologySaveStatus === "dirty" ? "clean" : get().ontologySaveStatus) : "dirty",
    });
  },

  setRelationTypes: (relationTypes) => {
    const { ontology, ontologySaved } = get();
    if (!ontology) return;
    const next = { ...ontology, relation_types: relationTypes };
    set({
      ontology: next,
      ontologySaveStatus: deepEqual(next, ontologySaved) ? (get().ontologySaveStatus === "dirty" ? "clean" : get().ontologySaveStatus) : "dirty",
    });
  },

  loadDependencies: async () => {
    set({ dependenciesRequest: requestLoading() });
    try {
      const data = await fetchDependencyRules();
      set({
        dependencies: data,
        dependenciesSaved: JSON.parse(JSON.stringify(data)),
        dependenciesRequest: requestSettled(data.items.length === 0),
        dependenciesSaveStatus: "clean",
        dependenciesSaveError: null,
        dependencyPreview: null,
      });
    } catch (e) {
      set({ dependenciesRequest: requestFailed(e, SM_REQUEST_COPY.DEPENDENCY_LOAD_FAILED) });
    }
  },

  setDependencyItems: (items) => {
    const { dependencies, dependenciesSaved } = get();
    if (!dependencies) return;
    const next = { ...dependencies, items };
    set({
      dependencies: next,
      dependencyPreview: null,
      dependenciesSaveStatus: deepEqual(items, dependenciesSaved?.items ?? []) ? (get().dependenciesSaveStatus === "dirty" ? "clean" : get().dependenciesSaveStatus) : "dirty",
    });
  },

  validateDependencies: async () => {
    const { dependencies } = get();
    if (!dependencies) return;
    set({ dependenciesSaveError: null });
    try {
      const data = await validateDependencyRules({
        revision: dependencies.revision,
        items: dependencies.items,
      });
      set({
        dependencies: { ...data, revision: dependencies.revision },
        dependenciesSaveError: null,
      });
    } catch (e) {
      set({ dependenciesSaveError: e instanceof Error ? e.message : SM_REQUEST_COPY.DEPENDENCY_VALIDATE_FAILED });
    }
  },

  previewDependencies: async () => {
    const { dependencies } = get();
    if (!dependencies) return;
    set({ dependencyPreviewLoading: true, dependenciesSaveError: null });
    try {
      const dependencyPreview = await previewDependencyRules({ revision: dependencies.revision, items: dependencies.items });
      set({ dependencyPreview, dependencyPreviewLoading: false });
    } catch (e) {
      set({ dependencyPreview: null, dependencyPreviewLoading: false, dependenciesSaveError: e instanceof Error ? e.message : SM_REQUEST_COPY.DEPENDENCY_PREVIEW_FAILED });
    }
  },
  clearDependencyPreview: () => set({ dependencyPreview: null }),

}));
