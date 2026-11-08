import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, FileText } from "lucide-react";
import { PoolShell, usePoolOccupancy } from "@/components/pool-panel";
import { EntityRepairForm, type RepairFieldGroup } from "@/components/entity-repair";
import { resolveFieldKind, isFieldEmpty, validateRequiredFields, fieldLabel, humanizeFieldTerms } from "@/components/entity-repair/entity-repair-field-model";
import { SidePanelAction, SidePanelSection } from "@/components/side-panel";
import { ENTITY_CREATE_FIELDS, ENTITY_CREATE_GROUPS, type EntityFieldSpec } from "@/components/entity-repair/entity-create-fields";
import { fetchEntityCompliance, type ComplianceFinding, type EntityComplianceResult } from "@/features/entity-compliance";
import { fetchEnums, fetchVersionRegistry, normalizeEnumsData } from "@/features/schema-manager";
import type { AnomalyIssue } from "@/features/anomaly-workbench/anomaly-workbench-types";
import { ANOMALY_REPAIR_DRAWER_COPY, ANOMALY_VALUE_PLACEHOLDER_COPY, repairDrawerTitle, repairDrawerEnumsErrorText, repairPostCheckSummaryText, repairBlockerLineText } from "../anomaly-workbench-copy";
import { fetchArticleRepairOptions } from "../anomaly-workbench-api";
import { previewEntityRepair, applyEntityRepair, extractRepairBlockers } from "@/lib/domain/entity-repair-api";
import { entityFieldCandidates } from "@/lib/schema-shape";

// 文章源路径前缀收编 copy 闭集（WP-150）——服务端源 key 分类比对键（非展示文案，改值须两处同步）
const ARTICLE_SOURCE_PREFIXES = ANOMALY_REPAIR_DRAWER_COPY.ARTICLE_SOURCE_PREFIXES;

type Props = {
  issue: AnomalyIssue;
  relatedIssues?: AnomalyIssue[];
  error: string | null;
  /** #1800：operate 的结构化 ApiError（ENTITY_COMPLIANCE_BLOCKED 时渲染阻断明细） */
  apiError?: unknown;
  onPreview: (payload: Record<string, unknown>) => void;
  onConfirm: (previewId: string) => void;
  /** B1 批量修复路径：多字段直连 /api/entity/repair/*，应用成功后由父层 reconcile 销账（N3） */
  onBatchApplied?: () => void;
  onClose: () => void;
};

type EnumOptions = Record<string, string[]>;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function emptyValue(spec: EntityFieldSpec): unknown {
  if (spec.control === "boolean") return false;
  if (spec.control === "array" || spec.control === "json") return [];
  return "";
}

function normalizeFieldValue(value: unknown, spec: EntityFieldSpec): unknown {
  if (value === null || value === undefined) return emptyValue(spec);
  if (spec.control === "array") return Array.isArray(value) ? value : typeof value === "string" && value.trim() ? [value] : [];
  if (spec.control === "boolean") return value === true;
  return value;
}

function initialValueForField(issue: AnomalyIssue, spec: EntityFieldSpec): unknown {
  const action = record(issue.proposedAction);
  const summary = record(record(issue.actionPreview).summary);
  const afterValues = record(summary.afterValues);
  if (issue.status === "previewed" && Object.prototype.hasOwnProperty.call(afterValues, spec.field)) return afterValues[spec.field];
  if (action.field === spec.field) {
    if (!isFieldEmpty(action.currentValue)) return action.currentValue;
    if (spec.control === "boolean" && (action.expected === true || action.expected === "true")) return true;
    if (["text", "select"].includes(spec.control) && typeof action.expected === "string") return action.expected;
  }
  if (issue.issueKind === "missing_entity" && spec.field === "title") {
    if (typeof action.expected === "string" && action.expected.trim()) return action.expected;
    if (typeof action.currentValue === "string" && action.currentValue.trim()) return action.currentValue;
  }
  return emptyValue(spec);
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function findingsByField(entity: EntityComplianceResult | null, specs: EntityFieldSpec[]): Map<string, ComplianceFinding> {
  const index = new Map<string, ComplianceFinding>();
  for (const finding of (entity?.groups || []).flatMap((group) => group.checks || [])) {
    if (!finding.field || !specs.some((spec) => spec.field === finding.field)) continue;
    const current = index.get(finding.field);
    // seq208：索引只做标注查找（allowedValues/建议）；值选择启发式已随诊断值绑定退役
    if (!current) index.set(finding.field, finding);
  }
  return index;
}

export function AnomalyEntityRepairDrawer({ issue, relatedIssues, error, apiError, onPreview, onConfirm, onBatchApplied, onClose }: Props) {
  // 目检②互斥：本弹窗渲染即占用池；被其他池顶掉时经 onClose 收起（表单草稿随 issueScopeKey 效应缓存）
  const stillOwner = usePoolOccupancy("anomaly-repair", true);
  useEffect(() => { if (!stillOwner) onClose(); }, [stillOwner, onClose]);
  const action = record(issue.proposedAction);
  const sourceKey = typeof action.sourceKey === "string" ? action.sourceKey : "";
  const isMissingEntity = issue.issueKind === "missing_entity";
  // 切片3：文章源（候选/草稿）走服务端单源字段清单，修复通道对文章不再开空抽屉
  const isArticle = ARTICLE_SOURCE_PREFIXES.some((prefix) => sourceKey.startsWith(prefix));
  const [articleSpecs, setArticleSpecs] = useState<EntityFieldSpec[]>([]);
  const activeSpecs = isArticle ? articleSpecs : ENTITY_CREATE_FIELDS;
  const scopedIssues = useMemo(() => (relatedIssues || [issue]).filter((candidate) => {
    const candidateAction = record(candidate.proposedAction);
    return candidateAction.type === "entity-repair" && candidateAction.sourceKey === sourceKey;
  }), [issue, relatedIssues, sourceKey]);
  const issueByField = useMemo(() => new Map(scopedIssues.flatMap((candidate) => {
    const candidateAction = record(candidate.proposedAction);
    return typeof candidateAction.field === "string" ? [[candidateAction.field, candidate] as const] : [];
  })), [scopedIssues]);
  const pendingSpecs = useMemo(
    () => isMissingEntity ? ENTITY_CREATE_FIELDS : activeSpecs.filter((spec) => issueByField.has(spec.field)),
    [isMissingEntity, issueByField, activeSpecs],
  );
  const supplementalSpecs = useMemo(
    () => isMissingEntity ? [] : activeSpecs.filter((spec) => !issueByField.has(spec.field)),
    [isMissingEntity, issueByField, activeSpecs],
  );
  const title = repairDrawerTitle(isMissingEntity, pendingSpecs.length);

  const [complianceEntity, setComplianceEntity] = useState<EntityComplianceResult | null>(null);
  const [complianceState, setComplianceState] = useState<"loading" | "ready" | "error">("loading");
  const [enumOptions, setEnumOptions] = useState<EnumOptions>({});
  // PR-050：文章源受管字段单源控件所需的产品注册表（version 联动下拉）——切片3 options 一次取回
  const [enumProducts, setEnumProducts] = useState<{ name: string; versions: string[] }[]>([]);
  const [enumState, setEnumState] = useState<"loading" | "ready" | "error">("loading");
  const [enumError, setEnumError] = useState<string | null>(null);
  // #1798：枚举加载失败后可手动重试（键变化触发重拉），替代「只能关掉重开抽屉」
  const [enumReloadKey, setEnumReloadKey] = useState(0);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [baselineValues, setBaselineValues] = useState<Record<string, unknown>>({});
  const dirtyFieldsRef = useRef(new Set<string>());
  // B1 批量修复本地态：previewId 由 entity-repair 链（TTL 预览）签发，与单议题账本 previewId 不同域
  const [batchPreview, setBatchPreview] = useState<{ previewId: string; changedFields: string[]; postCheck: Record<string, unknown> } | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);
  // #1800：批量链（B1 分流）不经过 store.operate——写门拒绝的 ApiError 必须在本地保留结构化形态，
  // 才能喂给 extractRepairBlockers 渲染明细（operate 链走 apiError prop，批量链走这里）
  const [batchApiError, setBatchApiError] = useState<unknown>(null);
  // #1800：apply 422（ENTITY_COMPLIANCE_BLOCKED）的阻断明细——逐条中文说明+原始信息，替代「一句话+排查编号」（operate 链 + B1 批量链双源）
  const applyBlockers = extractRepairBlockers(apiError ?? batchApiError);
  const complianceFindings = useMemo(() => findingsByField(complianceEntity, activeSpecs), [complianceEntity, activeSpecs]);
  const issueScopeKey = scopedIssues.map((candidate) => candidate.issueId).sort().join("|") || issue.issueId;
  // B2：父层重渲染会让 issue/issueByField/activeSpecs 身份变化（如 store loading→error），
  // 表单重置只允许由「议题范围真实变化」（issueScopeKey）触发，其余经 ref 读最新值。
  const issueByFieldRef = useRef(issueByField);
  issueByFieldRef.current = issueByField;
  const activeSpecsRef = useRef(activeSpecs);
  activeSpecsRef.current = activeSpecs;
  const issueRef = useRef(issue);
  issueRef.current = issue;
  const valuesRef = useRef(values);
  valuesRef.current = values;

  useEffect(() => {
    const initial: Record<string, unknown> = {};
    for (const spec of activeSpecsRef.current) initial[spec.field] = initialValueForField(issueByFieldRef.current.get(spec.field) || issueRef.current, spec);
    dirtyFieldsRef.current = new Set();
    setValues(initial);
    setBaselineValues(initial);
    setFieldErrors({});
    setBatchPreview(null);
    setBatchError(null);
  }, [issueScopeKey]);

  useEffect(() => {
    let cancelled = false;
    setComplianceState("loading");
    setComplianceEntity(null);
    void fetchEntityCompliance({ q: sourceKey, limit: 10, offset: 0 }).then((data) => {
      if (cancelled) return;
      const entity = (Array.isArray(data.items) ? data.items : []).find((item) => item.sourceKey === sourceKey) || null;
      // seq201（前端纯净度规则①清存量）：空态防御降级为中性技术诊断——本 throw 被 .catch 吞掉仅作控制流信号，文案不回显；后端错误文案已在 fetchEntityCompliance 内回显
      if (!entity) throw new Error("compliance entity not found for current source");
      const nextBaseline: Record<string, unknown> = {};
      for (const spec of activeSpecs.length ? activeSpecs : ENTITY_CREATE_FIELDS) {
        // seq208 值所有权法则：基线现值唯一来源=sourceValues（源文档）；文件没值才落到提案初始值（可编辑，不冒充现值）
        const sourceValue = entity.sourceValues && spec.field in entity.sourceValues ? entity.sourceValues[spec.field] : undefined;
        nextBaseline[spec.field] = !isFieldEmpty(sourceValue)
          ? normalizeFieldValue(sourceValue, spec)
          : initialValueForField(issueByField.get(spec.field) || issue, spec);
      }
      setComplianceEntity(entity);
      setBaselineValues(nextBaseline);
      setValues((current) => Object.fromEntries((activeSpecs.length ? activeSpecs : ENTITY_CREATE_FIELDS).map((spec) => [
        spec.field,
        dirtyFieldsRef.current.has(spec.field) ? current[spec.field] : nextBaseline[spec.field],
      ])));
      setComplianceState("ready");
    }).catch(() => {
      // 文章源容错：合规查询失败不堵修复（用 issue 基线继续），实体源保持原硬错行为
      if (!cancelled) setComplianceState(isArticle ? "ready" : "error");
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- B2（#1412）：合规拉取只随议题范围/来源变化重跑；issue/issueByField/activeSpecs 身份随父层状态翻转变化，列入依赖会连带重置表单（已填值丢失，红灯 T5 守卫）
  }, [issueScopeKey, sourceKey, isArticle]);

  useEffect(() => {
    let cancelled = false;
    setEnumState("loading");
    setEnumError(null);
    if (isArticle) {
      // 切片3：文章枚举/字段清单一次取回（field-completion-options，服务端单源）
      void fetchArticleRepairOptions().then((data) => {
        if (cancelled) return;
        const fields = Array.isArray(data.articleFields) ? data.articleFields : [];
        setArticleSpecs(fields.map((entry) => ({
          field: String(entry.field), label: String(entry.label), group: "classification" as const,
          required: Boolean(entry.required),
          control: (entry.control === "select" || entry.control === "array" ? entry.control : "text") as EntityFieldSpec["control"],
        })));
        const productNames = (data.products || []).map((entry2) => entry2.name);
        const allVersions = [...new Set((data.products || []).flatMap((entry2) => entry2.versions || []))];
        setEnumProducts(data.products || []);
        // PR-151 续·根治：字段→选项映射不再逐字段手写——按服务端 articleFields 的 optionsKey 逐包取数
        // （products/version 级联特例；契约新增字段自动出现，与补齐表单同一选项面）。
        const bags = data as unknown as Record<string, unknown>;
        const optionMap: Record<string, string[]> = {};
        for (const entry of fields) {
          const key = String(entry.optionsKey || "");
          if (!key) continue;
          if (key === "products") optionMap[String(entry.field)] = productNames;
          else if (key === "versions") optionMap[String(entry.field)] = allVersions;
          else {
            const bag = bags[key];
            optionMap[String(entry.field)] = Array.isArray(bag) ? bag.filter((v): v is string => typeof v === "string") : [];
          }
        }
        setEnumOptions(optionMap);
        setEnumState("ready");
      }).catch((reason: unknown) => {
        if (!cancelled) { setEnumState("error"); setEnumError(reason instanceof Error ? reason.message : ANOMALY_REPAIR_DRAWER_COPY.ARTICLE_OPTIONS_LOAD_FAILED); }
      });
      return () => { cancelled = true; };
    }
    // #1800：版本注册表并行拉取——有效期起点/终点由手填升级为版本下拉（数据源唯一：/api/schema/versions）
    // 批16：候选推导单源＝schema-shape entityFieldCandidates（原 25 行拍平收编；layers/subdomains 双形态取 id 随迁域内）
    void Promise.all([fetchEnums(), fetchVersionRegistry().catch(() => null)]).then(([raw, registry]) => {
      if (cancelled) return;
      setEnumOptions(entityFieldCandidates(normalizeEnumsData(raw), registry));
      setEnumState("ready");
    }).catch((reason: unknown) => {
      if (cancelled) return;
      setEnumState("error");
      setEnumError(reason instanceof Error ? reason.message : ANOMALY_REPAIR_DRAWER_COPY.ENUMS_LOAD_FAILED);
    });
    return () => { cancelled = true; };

  }, [isArticle, enumReloadKey]);

  const setField = (field: string, value: unknown) => {
    setFieldErrors((previous) => { const next = { ...previous }; delete next[field]; return next; });
    const dirty = new Set(dirtyFieldsRef.current);
    if (sameValue(value, baselineValues[field])) dirty.delete(field);
    else dirty.add(field);
    dirtyFieldsRef.current = dirty;
    setValues((previous) => ({ ...previous, [field]: value }));
  };

  const getAllowedValues = (spec: EntityFieldSpec): string[] => {
    const issueAction = record(issueByField.get(spec.field)?.proposedAction);
    const issueValues = Array.isArray(issueAction.allowedValues) ? issueAction.allowedValues.filter((value): value is string => typeof value === "string") : [];
    const complianceValues = complianceFindings.get(spec.field)?.allowedValues?.filter((value): value is string => typeof value === "string") || [];
    return [...new Set([...issueValues, ...complianceValues, ...(enumOptions[spec.field] || [])])];
  };

  const preview = issue.actionPreview;
  const summary = record(preview?.summary);
  const hasPreview = preview?.accepted === true;
  const changedFields: string[] = Array.isArray(summary.changedFields) ? summary.changedFields : [];
  const serverBeforeValues = record(summary.beforeValues);
  const afterValues = record(summary.afterValues);
  const postCheck = record(summary.postCheck);
  const canConfirm = issue.status === "previewed" && Boolean(issue.previewId) && issue.executionReady !== false;

  const handlePreview = () => {
    if (isMissingEntity) {
      const requiredDefs = (isArticle ? activeSpecs : ENTITY_CREATE_FIELDS).filter((spec) => spec.required);
      const missing = validateRequiredFields(requiredDefs, values);
      if (missing.length > 0) {
        setFieldErrors(Object.fromEntries(requiredDefs.filter((spec) => isFieldEmpty(values[spec.field])).map((spec) => [spec.field, ANOMALY_REPAIR_DRAWER_COPY.FIELD_REQUIRED_EMPTY])));
        return;
      }
    }
    const changes = isMissingEntity
      ? Object.fromEntries((isArticle ? activeSpecs : ENTITY_CREATE_FIELDS).flatMap((spec) => isFieldEmpty(values[spec.field]) ? [] : [[spec.field, values[spec.field]]]))
      : Object.fromEntries([...dirtyFieldsRef.current].map((field) => [field, values[field]]));
    if (Object.keys(changes).length === 0) {
      const target = pendingSpecs[0] || supplementalSpecs[0];
      if (target) setFieldErrors({ [target.field]: target.required && isFieldEmpty(values[target.field]) ? ANOMALY_REPAIR_DRAWER_COPY.FIELD_REQUIRED_EMPTY : ANOMALY_REPAIR_DRAWER_COPY.NO_CHANGES_ERROR });
      return;
    }
    setFieldErrors({});
    // B1 分流：多字段（或改动字段不属于当前单议题动作）直连 entity-repair 批量链——
    // 单议题端点 /api/anomalies/:issueId/preview 有意只收单字段（adapter 闸门），批量在这里恒 400。
    const changedKeys = Object.keys(changes);
    const singleIssueField = typeof action.field === "string" ? action.field : null;
    const isBatch = changedKeys.length >= 2 || (singleIssueField !== null && changedKeys[0] !== singleIssueField);
    if (!isBatch) {
      onPreview({ changes });
      return;
    }
    void (async () => {
      setBatchBusy(true);
      setBatchError(null);
      try {
        const rawRevision = record(record(issueRef.current.expectedRevisions).sourceRevision);
        // 规则5 显式归一：expectedRevisions 的 sourceRevision 为 unknown 容器，按 EntitySourceRevision 契约三字段投影
        const sourceRevision = {
          mtimeMs: Number(rawRevision.mtimeMs ?? 0),
          size: Number(rawRevision.size ?? 0),
          contentHash: String(rawRevision.contentHash ?? ""),
        };
        const response = await previewEntityRepair({
          sourceKey,
          changes,
          createIfMissing: isMissingEntity,
          ...(isMissingEntity
            ? { initialTitle: String(valuesRef.current.title ?? record(issueRef.current.proposedAction).expected ?? "") }
            : Object.keys(sourceRevision).length > 0 ? { sourceRevision } : {}),
        });
        setBatchPreview({
          previewId: String(response.previewId),
          changedFields: Array.isArray(response.changedFields) ? response.changedFields.map(String) : changedKeys,
          postCheck: record(response.postCheck),
        });
        // #1803：重试成功必须同步清结构化错误——否则上一次失败（如 F09）的明细区在预览成功后仍滞留
        setBatchApiError(null);
      } catch (reason) {
        // B2：失败只报错，保留已填值与脏字段，用户改完可直接重试；#1800 结构化错误另存供明细渲染
        setBatchError(reason instanceof Error ? reason.message : ANOMALY_REPAIR_DRAWER_COPY.BATCH_PREVIEW_FAILED);
        setBatchApiError(reason);
      } finally {
        setBatchBusy(false);
      }
    })();
  };

  const handleBatchApply = () => {
    if (!batchPreview || batchBusy) return;
    void (async () => {
      setBatchBusy(true);
      setBatchError(null);
      setBatchApiError(null);
      try {
        await applyEntityRepair(batchPreview.previewId);
        onBatchApplied?.();
      } catch (reason) {
        // 409（过期/已消费）等：预览作废需重看修复结果，已填值保留；#1800 结构化错误另存供明细渲染
        setBatchError(reason instanceof Error ? reason.message : ANOMALY_REPAIR_DRAWER_COPY.BATCH_APPLY_FAILED);
        setBatchApiError(reason);
        setBatchPreview(null);
      } finally {
        setBatchBusy(false);
      }
    })();
  };

  const buildCards = (specs: EntityFieldSpec[], pending: boolean): RepairFieldGroup["fields"] => specs.map((spec) => {
    const allowed = getAllowedValues(spec);
    const finding = complianceFindings.get(spec.field);
    // C3（#1792）：select 无候选时经 resolveFieldKind 降级为可写 text（后端枚举校验仍 fail-closed 兜底），
    // 不再整字段禁用成死字段——「不可写」即用户报障的死锁形态。
    // 2026-10-09 托管短路（字段托管缺口补）：readonly-system 字段（date/updated/status）任何路径不出
    // 用户写入口——select 降级分支不得绕过（旧 C3 僵尸断言意外揭示；与 entity-compliance 版 Drawer 的
    // systemManaged 只读展示同语义：值由服务端写路径注入，状态迁移走审批状态机通道）。
    // 实现取 kind=text + disabled（不扩 RepairFieldKind 类型——最小改）。
    const systemManaged = spec.control === "readonly-system";
    const kind = spec.control === "select" && allowed.length === 0 ? "text" : spec.control === "select" ? "select" : resolveFieldKind(spec.control, allowed);
    const disabled = (!pending && complianceState !== "ready") || systemManaged;
    return {
      field: spec.field,
      label: spec.label,
      required: spec.required,
      kind,
      value: values[spec.field] ?? emptyValue(spec),
      allowedValues: allowed,
      placeholder: spec.placeholder,
      hint: systemManaged ? ANOMALY_REPAIR_DRAWER_COPY.SYSTEM_MANAGED_HINT : (finding?.hint || record(issueByField.get(spec.field)?.proposedAction).hint as string | undefined),
      suggestions: allowed,
      disabled,
      error: fieldErrors[spec.field],
      tag: pending ? ANOMALY_REPAIR_DRAWER_COPY.TAG_CURRENT_ISSUE : ENTITY_CREATE_GROUPS.find((group) => group.id === spec.group)?.label || ANOMALY_REPAIR_DRAWER_COPY.TAG_SUPPLEMENTAL,
      // PR-050：受管字段单源控件分发——文章源上下文 + version 产品联动所需注册表
      isArticle,
      productValue: typeof values.product === "string" ? values.product : undefined,
      products: isArticle ? enumProducts : undefined,
      onChange: (value: unknown) => setField(spec.field, value),
    };
  });

  const groups: RepairFieldGroup[] = [
    { id: "pending", label: isMissingEntity ? ANOMALY_REPAIR_DRAWER_COPY.GROUP_PENDING_ENTITY : ANOMALY_REPAIR_DRAWER_COPY.GROUP_PENDING_FIELDS, fields: buildCards(pendingSpecs, true) },
    ...(supplementalSpecs.length ? [{ id: "supplemental", label: ANOMALY_REPAIR_DRAWER_COPY.GROUP_SUPPLEMENTAL, fields: buildCards(supplementalSpecs, false) }] : []),
  ].filter((group) => group.fields.length > 0);

  const actions = <>
    <SidePanelAction onClick={handlePreview} disabled={batchBusy}>{batchBusy ? ANOMALY_REPAIR_DRAWER_COPY.PREVIEW_BUSY_ACTION : ANOMALY_REPAIR_DRAWER_COPY.PREVIEW_ACTION}</SidePanelAction>
    {batchPreview
      ? <SidePanelAction variant="primary" onClick={handleBatchApply} disabled={batchBusy}>{ANOMALY_REPAIR_DRAWER_COPY.APPLY_ACTION}</SidePanelAction>
      : <SidePanelAction variant="primary" onClick={() => onConfirm(String(issue.previewId))} disabled={!canConfirm}>{ANOMALY_REPAIR_DRAWER_COPY.APPLY_ACTION}</SidePanelAction>}
  </>;

  return (
    <PoolShell title={title} sourceKey={sourceKey || issue.title} onMinimize={onClose} onClose={onClose} footer={actions}>
      {complianceState === "loading" && !isMissingEntity && <p className="rounded-md bg-surface-root px-3 py-2 text-xs text-text-hint ring-1 ring-border-thin" role="status">{ANOMALY_REPAIR_DRAWER_COPY.COMPLIANCE_LOADING}</p>}
      {complianceState === "error" && !isMissingEntity && <p className="rounded-md bg-status-warn-2 px-3 py-2 text-xs text-status-warn ring-1 ring-status-warn-6" role="status">{ANOMALY_REPAIR_DRAWER_COPY.COMPLIANCE_ERROR}</p>}
      {enumState === "loading" && <p className="rounded-md bg-surface-root px-3 py-2 text-xs text-text-hint ring-1 ring-border-thin" role="status">{ANOMALY_REPAIR_DRAWER_COPY.ENUMS_LOADING}</p>}
      {enumState === "error" && (
        <div className="rounded-md bg-status-error-2 px-3 py-2 text-xs text-status-error ring-1 ring-status-error-6" role="alert">
          <p>{repairDrawerEnumsErrorText(enumError)}</p>
          <button type="button" className="mt-1.5 rounded-md bg-surface-card px-2 py-1 text-xs text-text-main ring-1 ring-border-thin hover:bg-surface-hover" onClick={() => setEnumReloadKey((key) => key + 1)}>{ANOMALY_REPAIR_DRAWER_COPY.ENUMS_RETRY_ACTION}</button>
        </div>
      )}
      {isArticle && <p className="mb-2 rounded-md bg-status-warn-2 px-3 py-2 text-xs text-status-warn ring-1 ring-status-warn-6">{ANOMALY_REPAIR_DRAWER_COPY.ARTICLE_TITLE_WARNING}</p>}
      <EntityRepairForm groups={groups} columns={2} />

      {(hasPreview && changedFields.length > 0) && (
        <SidePanelSection title={ANOMALY_REPAIR_DRAWER_COPY.PREVIEW_SECTION_TITLE} icon={FileText}>
          <div className="space-y-2 rounded-md bg-status-fact-2 p-3 ring-1 ring-status-fact-6">
            {changedFields.map((field) => (
              <div key={field} className="grid items-center gap-2 text-xs sm:grid-cols-[100px_minmax(0,1fr)_auto_minmax(0,1fr)]">
                <span className="text-text-hint">{activeSpecs.find((spec) => spec.field === field)?.label || ENTITY_CREATE_FIELDS.find((spec) => spec.field === field)?.label || field}</span>
                <span className="break-words rounded bg-surface-root px-2 py-1.5 text-text-sub">{formatValue(Object.prototype.hasOwnProperty.call(serverBeforeValues, field) ? serverBeforeValues[field] : baselineValues[field])}</span>
                <ArrowRight className="h-4 w-4 text-text-hint" />
                <span className="break-words rounded bg-status-fact-2 px-2 py-1.5 text-status-fact">{formatValue(afterValues[field])}</span>
              </div>
            ))}
          </div>
          {postCheck && <p className="mt-2 text-xs text-text-hint">{repairPostCheckSummaryText(Number(postCheck.blockerCount || 0), Number(postCheck.warningCount || 0))}</p>}
        </SidePanelSection>
      )}

      {batchPreview && (
        <SidePanelSection title={ANOMALY_REPAIR_DRAWER_COPY.PREVIEW_SECTION_TITLE} icon={FileText}>
          <div className="space-y-2 rounded-md bg-status-fact-2 p-3 ring-1 ring-status-fact-6">
            {batchPreview.changedFields.map((field) => (
              <div key={field} className="grid items-center gap-2 text-xs sm:grid-cols-[100px_minmax(0,1fr)_auto_minmax(0,1fr)]">
                <span className="text-text-hint">{activeSpecs.find((spec) => spec.field === field)?.label || field}</span>
                <span className="break-words rounded bg-surface-root px-2 py-1.5 text-text-sub">{formatValue(baselineValues[field])}</span>
                <ArrowRight className="h-4 w-4 text-text-hint" />
                <span className="break-words rounded bg-status-fact-2 px-2 py-1.5 text-status-fact">{formatValue(values[field])}</span>
              </div>
            ))}
          </div>
          {batchPreview.postCheck && Object.keys(batchPreview.postCheck).length > 0 && <p className="mt-2 text-xs text-text-hint">{repairPostCheckSummaryText(Number(batchPreview.postCheck.blockerCount || 0), Number(batchPreview.postCheck.warningCount || 0))}</p>}
        </SidePanelSection>
      )}

      {(error || batchError) && <p className="mt-3 text-sm text-status-error" role="alert">{batchError || error}</p>}
      {/* #1800：apply 写门拒绝（ENTITY_COMPLIANCE_BLOCKED）的阻断明细——逐条中文规则说明，替代「一句话+排查编号」 */}
      {applyBlockers.length > 0 && (
        <div className="mt-2 rounded-md bg-status-error-2 px-3 py-2 ring-1 ring-status-error-6" role="alert">
          <p className="text-xs font-medium text-status-error">{ANOMALY_REPAIR_DRAWER_COPY.BLOCKERS_TITLE}</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {applyBlockers.map((blocker, index) => (
              <li key={`${blocker.ruleId}-${index}`} className="text-xs text-text-main">
                <span className="font-medium text-status-error">{blocker.ruleId}</span>
                {/* 字段标注经 entity-repair fieldLabel（组合字段「arch_since/arch_until」拆段译名——
                    anomaly copy 的 sharedFieldLabel 不拆组合，T11f 实测回归后回退原实现） */}
                {repairBlockerLineText(blocker.field ? `（${fieldLabel(blocker.field)}）` : "", humanizeFieldTerms(blocker.message))}
              </li>
            ))}
          </ul>
        </div>
      )}
      {issue.status === "confirmed" && <p className="mt-3 text-sm text-status-fact">{isArticle ? ANOMALY_REPAIR_DRAWER_COPY.CONFIRMED_ARTICLE : ANOMALY_REPAIR_DRAWER_COPY.CONFIRMED_ENTITY}</p>}
    </PoolShell>
  );
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined || value === "") return ANOMALY_VALUE_PLACEHOLDER_COPY.EMPTY;
  if (Array.isArray(value)) return value.length ? value.map((item) => typeof item === "object" ? JSON.stringify(item) : String(item)).join(", ") : ANOMALY_VALUE_PLACEHOLDER_COPY.EMPTY_LIST;
  return String(value);
}
