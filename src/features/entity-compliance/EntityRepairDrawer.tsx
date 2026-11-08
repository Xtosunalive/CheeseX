import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, FileText, Plus } from "lucide-react";
import { fieldLabel as resolveFieldLabel } from "@/lib/domain/entity-repair-api";
import { useEntityComplianceStore } from "./entity-compliance-store";
import { FrontmatterDiff } from "./FrontmatterDiff";
import type { EntityRepairChanges } from "./entity-compliance-types";
import { RelationRepairPanel } from "./RelationRepairPanel";
import { TERM } from "@/constants/term-const";
import { RepairFieldEditor, FieldBlockerReason, type RepairFieldKind } from "@/components/entity-repair";
import { isEnumStarvedField } from "@/components/entity-repair/entity-repair-field-model";
import { TAB_LABELS } from "@/features/schema-manager/schema-manager-types";
import { FIELD_LABELS } from "../../../shared/field-labels.mjs";
import { ENTITY_CREATE_FIELDS } from "@/components/entity-repair/entity-create-fields";
import { EDITABLE } from "./entity-editable-fields";
import { repairableFieldIssues } from "./repairable-fields";
import { PLACEHOLDERS, articleAwareFieldKind, JSON_FIELDS } from "./repair-field-config";
import { PoolShell, BooleanPoolRow, usePoolOccupancy } from "@/components/pool-panel";
import { ENTITY_COMPLIANCE_COPY, EC_REPAIR_DRAWER_COPY, ecEnumStarvedHint, ecPreviewValidity, ecRepairBlockerHeading, ecRepairFieldCount, ecRepairFieldRowAria } from "./entity-compliance-copy";

export { EDITABLE };

const SKELETON_DEFAULTS: Record<string, unknown> = {
  title: "",
  // WP-113 M2：architecture-node-id 不进骨架——新建身份由服务端铸造（唯一取号点），骨架若带空串
  // 即构成「提交自带身份」，被写门来源门 system-minted/400 整笔拒（后端写门测试 T1 同批语义）。
  // status/date/updated 照旧在骨架内：服务端对这三键在 preview 显式剥离（:339），空串无害。
  arch_component: false,
  arch_layer: "",
  arch_category: "",
  arch_subdomain: "",
  arch_version_overrides: [],
  module: [],
  status: "",
  date: "",
  updated: "",
  tags: [],
  arch_since: "",
  arch_until: "",
};
const SKELETON_FIELDS = Object.keys(SKELETON_DEFAULTS);

// seq209：中文名走 shared/field-labels.mjs 单源（经 entity-repair-api.fieldLabel 转出）
function fieldLabel(field: string | null | undefined) {
  return field ? resolveFieldLabel(field) : TERM.FIELD_LABEL_FALLBACK;
}

function isEmptyFieldValue(value: unknown) {
  return value === null || value === undefined || value === "" || (Array.isArray(value) && value.length === 0);
}

// #1396 文章意识（articleAwareFieldKind）已拆至 repair-field-config.ts（组件文件只留组件）

// 池行式当前值展示：空值「未填写」；数组顿号连接；JSON 已填写摘要（展开后是等宽多行编辑）
function displayValueFor(kind: RepairFieldKind, value: unknown): string {
  if (isEmptyFieldValue(value)) return EC_REPAIR_DRAWER_COPY.VALUE_EMPTY;
  if (kind === "json") return EC_REPAIR_DRAWER_COPY.VALUE_JSON_FILLED;
  if (Array.isArray(value)) return value.map((item) => String(item)).join("、");
  return String(value);
}

export function EntityRepairDrawer() {
  const entity = useEntityComplianceStore((s) => s.selectedEntity);
  const repairOpen = useEntityComplianceStore((s) => s.repairOpen);
  const changes = useEntityComplianceStore((s) => s.repairChanges);
  const relationPatch = useEntityComplianceStore((s) => s.relationPatch);
  const status = useEntityComplianceStore((s) => s.repairStatus);
  const creatingEntity = useEntityComplianceStore((s) => s.creatingEntity);
  const preview = useEntityComplianceStore((s) => s.preview);
  const error = useEntityComplianceStore((s) => s.repairError);
  const repairBlockers = useEntityComplianceStore((s) => s.repairBlockers);
  const close = useEntityComplianceStore((s) => s.closeRepair);
  const minimize = useEntityComplianceStore((s) => s.minimizeRepair);
  const setField = useEntityComplianceStore((s) => s.setRepairField);
  const clearChanges = useEntityComplianceStore((s) => s.clearRepairChanges);
  const loadPreview = useEntityComplianceStore((s) => s.loadPreview);
  const submitApply = useEntityComplianceStore((s) => s.submitApply);
  // 池行式：当前展开编辑的字段（点行展开，再点收起；同一时刻至多一行展开）
  const [expandedField, setExpandedField] = useState<string | null>(null);
  // 关系修复虚线引导卡：点击展开小表单（再点收起）
  const [relationOpen, setRelationOpen] = useState(false);
  // 目检②互斥：被其他池顶掉时最小化（repairOpen=false，草稿与任务本体保留在 store）
  const stillOwner = usePoolOccupancy("entity-repair", Boolean(entity && repairOpen));
  useEffect(() => { if (repairOpen && entity && !stillOwner) minimize(); }, [repairOpen, entity, stillOwner, minimize]);
  // sourceKey 是修复抽屉的身份锚（展示 + 现读现算都依赖）；契约可选但缺失时无法修复，无渲染
  if (!entity || !repairOpen || !entity.sourceKey) return null;
  const isArticle = entity.sourceType === "standard-article";
  // seq205 值语义分槽 + seq207/208 值所有权法则（契约 06）：编辑框现值唯一来源=sourceValues（源文档）；
  // 系统建议降级为显式「采用建议」操作。用户已改的 changes 优先。诊断对象不带值（ESLint 执法）。
  const repair = repairableFieldIssues(entity);
  // seq206：未通过的字段排前（JS sort 稳定，组内首次出现序保持）；已通过可编辑字段跟后，编辑面不缩水
  const findings = [...repair.issues]
    .sort((a, b) => Number(b.failed) - Number(a.failed))
    // locked 取 selector 的按字段合并值（任一检查可改即可改），与卡片徽章同一口径——
    // 复核 CONCERN-2：此前读 best.editable（该字段首条检查），混合夹具下徽章与抽屉分叉。
    .map((issue) => ({ failed: issue.failed, locked: issue.locked, ruleId: issue.checks[0]?.ruleId ?? issue.field, best: issue.best }));
  const allChecks = (entity.groups || []).flatMap((group) => group.checks || []);
  // seq207 诊断不拥有值：编辑框现值唯一来源=sourceValues（源文档 frontmatter 映射）；finding.value 仅旧数据回退
  const sourceValues = (entity.sourceValues || {}) as Record<string, unknown>;
  const currentValueFor = (field: string): unknown => changes[field as keyof EntityRepairChanges] ?? sourceValues[field];
  const selectedProduct = String(currentValueFor("product") ?? "");
  const missingSkeletonFields = SKELETON_FIELDS.filter((field) => {
    const finding = allChecks.find((item) => item.field === field);
    return finding && isEmptyFieldValue(currentValueFor(field));
  });
  const generateSkeleton = () => {
    missingSkeletonFields.forEach((field) => setField(field, SKELETON_DEFAULTS[field]));
  };
  const blockerByField = new Map<string, (typeof repairBlockers)[number]>(repairBlockers.filter((blocker) => blocker.field).map((blocker) => [blocker.field, blocker]));

  // 底部操作条：2×2 网格等宽，按钮统一高 32px（h-8）、圆角 --radius-md（PR-026 定案 1：9px 归档 8px 档）
  const footer = (
    <div className="grid grid-cols-2 gap-1.5">
      <button type="button" onClick={clearChanges} disabled={(!Object.keys(changes).length && !relationPatch) || status === "previewing" || status === "applying"} className="inline-flex h-8 items-center justify-center rounded-md bg-surface-card px-2 text-xs font-medium text-text-sub ring-1 ring-border-thin transition-colors hover:bg-surface-hover hover:text-text-main disabled:cursor-not-allowed disabled:opacity-40">{EC_REPAIR_DRAWER_COPY.CLEAR_ALL}</button>
      <button type="button" onClick={generateSkeleton} disabled={missingSkeletonFields.length === 0 || status === "previewing" || status === "applying"} className="inline-flex h-8 items-center justify-center rounded-md bg-accent-bg px-2 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-bg-strong disabled:cursor-not-allowed disabled:opacity-40">{EC_REPAIR_DRAWER_COPY.GENERATE_SKELETON}</button>
      <button type="button" onClick={loadPreview} disabled={(!Object.keys(changes).length && !relationPatch) || status === "previewing" || status === "applying"} className="inline-flex h-8 items-center justify-center rounded-md bg-surface-card px-2 text-xs font-medium text-text-sub ring-1 ring-border-thin transition-colors hover:bg-surface-hover hover:text-text-main disabled:cursor-not-allowed disabled:opacity-40">{status === "previewing" ? EC_REPAIR_DRAWER_COPY.PREVIEWING : EC_REPAIR_DRAWER_COPY.PREVIEW}</button>
      <button type="button" onClick={submitApply} disabled={status !== "preview_ready"} className="inline-flex h-8 items-center justify-center rounded-md bg-accent-base px-2 text-xs font-medium text-accent-contrast transition-colors hover:bg-accent-bg-strong hover:text-accent-contrast disabled:cursor-not-allowed disabled:opacity-40">{status === "applying" ? EC_REPAIR_DRAWER_COPY.APPLYING : EC_REPAIR_DRAWER_COPY.APPLY}</button>
    </div>
  );

  return (
    <PoolShell
      title={`${creatingEntity ? ENTITY_COMPLIANCE_COPY.CREATE_AND_COMPLETE : EC_REPAIR_DRAWER_COPY.REPAIR} ${entity.title || entity.fileName}`}
      sourceKey={entity.sourceKey}
      onMinimize={minimize}
      onClose={close}
      footer={footer}
    >
      {/* 字段区顶部仅一行小字（定稿：不再有「受管属性」标题与「发现缺失字段」横幅） */}
      <p className="text-xs text-text-hint">{ecRepairFieldCount(repair.count)}</p>

      {/* 池行式字段列表：行=字段名+当前值(右)+通过状态点+箭头；行间 1px 分隔线 */}
      <div className="mt-1.5 divide-y divide-border-thin">
        {findings.map((finding) => {
          const field = (finding.best.field ?? "") as keyof EntityRepairChanges;
          const suggestion = finding.best.suggestions?.[0]?.value;
          const current = changes[field] ?? sourceValues[field] ?? "";
          const productVersions = finding.best.allowedValuesByProduct?.[selectedProduct];
          const allowed = (field === "version" && productVersions ? productVersions : finding.best.allowedValues || []).map(String);
          const suggestionText = suggestion === undefined || suggestion === null || String(suggestion) === String(current) ? null : String(suggestion);
          // 裁决 2C：枚举表为空的枚举字段不降级为自由文本（写侧必拒），禁用 + 指明配置出口。
          // 文案修订（Master 2026-09-28）：不写文件路径/开发者语言——指名页面功能 tab（架构分层/知识域），补齐自动恢复
          const enumStarved = isEnumStarvedField(String(field), allowed);
          // 2026-10-08 字段托管：system 字段（date/updated/status）只读展示——行不展开、不可编辑（母版 control=readonly-system 单源派生）
          // WP-113 M2：architecture-node-id 加入托管家族——新建身份由服务端铸造，人不填（母版同 control 判据自动覆盖）。
          const systemManaged = ENTITY_CREATE_FIELDS.some((spec) => spec.field === field && spec.control === "readonly-system");
          // D-1（WP-108）服务端能力位：声明 immutable 的字段（实体 architecture-node-id／WP-110 起含文章 article_id）
          // 在已有非空值时报 editable=false，前端据此渲染只读——用户不再被允许输入必被 422 打回的值。
          // 可达性由 WP-110 修：repairable-fields.ts 此前把能力位当「不渲染」判据，锁定位整行消失，本分支不可达。
          const immutableLocked = finding.locked && !systemManaged && !isEmptyFieldValue(current);
          // 托管短路（2026-10-09 补）：enumStarved 降级分支也须盖住 system 字段——否则 enums 加载失败时
          // status 降级为可写文本框（旧 C3 僵尸断言意外揭示的字段托管缺口；修复=托管字段任何路径不出用户写入口）
          const kind = systemManaged || immutableLocked ? ("text" as RepairFieldKind) : enumStarved ? ("text" as RepairFieldKind) : articleAwareFieldKind(field, allowed, isArticle);
          const expanded = expandedField === finding.ruleId && !systemManaged && !immutableLocked;
          // 空态展示文案随母版 spec.placeholder 派生（WP-113 M2：新建身份行显「由系统生成，创建后不可修改」，
          // 不留第二份文案；母版无 placeholder 的托管字段（date/updated/status）仍显「未填写」，行为不变）
          const valueText = (systemManaged && isEmptyFieldValue(current) && PLACEHOLDERS[field]) || displayValueFor(kind, current);
          return (
            <div key={finding.ruleId} className="py-0.5">
              <button
                type="button"
                aria-expanded={expanded}
                aria-label={ecRepairFieldRowAria(fieldLabel(finding.best.field), valueText, systemManaged ? "system" : immutableLocked ? "immutable" : null)}
                onClick={() => { if (systemManaged || immutableLocked) return; setExpandedField(expanded ? null : finding.ruleId); }}
                className={`flex w-full items-center gap-1.5 rounded-sm px-0.5 py-1.5 text-left transition-colors ${systemManaged || immutableLocked ? "cursor-default" : "hover:bg-surface-hover"}`}
              >
                {expanded ? <ChevronDown className="h-4 w-4 shrink-0 text-text-hint" /> : <ChevronRight className="h-4 w-4 shrink-0 text-text-hint" />}
                {/* 通过状态点：通过=实心 status-fact；未通过=空心描边（禁令4：title 文字双通道） */}
                <span
                  aria-hidden
                  title={finding.failed === false ? ENTITY_COMPLIANCE_COPY.PASSED : EC_REPAIR_DRAWER_COPY.STATUS_FAILED}
                  className={`h-1.5 w-1.5 shrink-0 rounded-full ${finding.failed === false ? "bg-status-fact" : "ring-1 ring-inset ring-status-error"}`}
                />
                <span className="min-w-0 shrink-0 truncate text-xs text-text-main">{fieldLabel(finding.best.field)}</span>
                <span className={`ml-auto min-w-0 truncate text-xs ${isEmptyFieldValue(current) ? "text-text-placeholder" : "text-text-sub"}`}>{valueText}</span>
                {systemManaged && <span className="shrink-0 text-[10px] text-text-hint">{EC_REPAIR_DRAWER_COPY.SYSTEM_MANAGED}</span>}
                {immutableLocked && <span className="shrink-0 text-[10px] text-text-hint">{EC_REPAIR_DRAWER_COPY.IMMUTABLE_LOCKED}</span>}
              </button>
              {expanded && (
                <div className="space-y-1 pb-2 pl-1 pr-0.5 pt-1">
                  {kind === "boolean" ? (
                    // 布尔行走 BooleanPoolRow（不经 RepairFieldEditor），行内阻断原因在此补——
                    // 此前数组与布尔两类字段拿不到写门给的字段级原因（seq178 的「按字段回显」只覆盖了文本/下拉）
                    <>
                      <BooleanPoolRow label={`${TERM.ARCH_COMPONENT}`} value={current === true} disabled={enumStarved} onChange={(next) => setField(field, next)} />
                      {blockerByField.get(String(field)) && <FieldBlockerReason message={blockerByField.get(String(field))!.message} />}
                    </>
                  ) : (
                    <RepairFieldEditor
                      field={field}
                      label={fieldLabel(finding.best.field)}
                      message={finding.best.reason === "missing" ? undefined : finding.best.message}
                      value={current}
                      kind={kind}
                      allowedValues={allowed}
                      placeholder={enumStarved ? undefined : (JSON_FIELDS.has(field) ? '[{"version":"7.0.0.0","arch_layer":"service"}]' : PLACEHOLDERS[field])}
                      pattern={finding.best.pattern}
                      hint={enumStarved ? ecEnumStarvedHint(field === "status" ? TAB_LABELS.domains : FIELD_LABELS.entity.arch_layer) : finding.best.hint}
                      errorText={blockerByField.get(String(field))?.message}
                      disabled={enumStarved || immutableLocked}
                      showLabel={false}
                      onChange={(value) => setField(field, field === "module" && !isArticle && typeof value === "string" ? [value] : value)}
                      isArticle={isArticle}
                    />
                  )}
                  {suggestionText !== null && !enumStarved && !immutableLocked && (
                    <button type="button" data-testid="adopt-suggestion" onClick={() => setField(field, field === "module" && !isArticle ? [suggestionText] : suggestionText)} className="text-left text-xs text-accent-base underline-offset-2 hover:underline">{EC_REPAIR_DRAWER_COPY.ADOPT_SUGGESTION_PREFIX}{suggestionText}</button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* 修复文档关系（可选）：虚线引导卡，点击才展开关系小表单（表单字段与业务逻辑不动） */}
      <div className="mt-3 rounded-md border border-dashed border-border-thin p-2.5">
        <p className="text-xs leading-5 text-text-hint">{TERM.RELATION_REPAIR_HINT}</p>
        <button
          type="button"
          onClick={() => setRelationOpen((open) => !open)}
          aria-expanded={relationOpen}
          className="mt-2 inline-flex h-8 w-full items-center justify-center gap-1 rounded-md bg-accent-bg px-2 text-xs font-medium text-accent-fg transition-colors hover:bg-accent-bg-strong"
        >
          {relationOpen ? EC_REPAIR_DRAWER_COPY.RELATION_FORM_COLLAPSE : ENTITY_COMPLIANCE_COPY.RELATION_REPAIR_TITLE}
          <Plus className={`h-3 w-3 transition-transform ${relationOpen ? "rotate-45" : ""}`} />
        </button>
        {relationOpen && <div className="mt-2">{<RelationRepairPanel />}</div>}
      </div>

      {preview && (
        <div className="mt-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-text-main"><FileText className="h-4 w-4 text-text-sub" />{EC_REPAIR_DRAWER_COPY.PREVIEW_HEADING}</p>
          <FrontmatterDiff preview={preview} />
        </div>
      )}
      {/* 裁决 2C：preview 失败从一行小字升格为醒目区块（H3 可见性）——明确告知「预览未生成」及原因，
          与「修复预览」区块的缺失形成可区分的两种状态（区块在=预览成功；红区块在=预览被拒+原因）。 */}
      {error && (
        <div data-testid="repair-preview-error" role="alert" className="mt-3 space-y-1 rounded-md bg-surface-root p-3 ring-1 ring-status-error-7">
          <p className="text-xs font-medium text-status-error">{EC_REPAIR_DRAWER_COPY.PREVIEW_NOT_GENERATED}</p>
          <p className="text-xs leading-5 text-status-error">{error}</p>
          <p className="text-xs leading-5 text-text-hint">{EC_REPAIR_DRAWER_COPY.PREVIEW_ERROR_HINT}</p>
        </div>
      )}
      {/* seq178：写门拒绝的字段级规则明细（ruleId/field/message 后端已带回，#1415）——按字段回显 */}
      {repairBlockers.length > 0 && (
        <div data-testid="repair-blocker-details" className="mt-3 space-y-1.5 rounded-md bg-surface-root p-3 ring-1 ring-status-error-6">
          <p className="text-xs font-medium text-status-error">{ecRepairBlockerHeading(repairBlockers.length)}</p>
          {repairBlockers.map((blocker) => (
            <p key={`${blocker.ruleId}:${blocker.field}:${blocker.message}`} className="text-xs leading-5 text-status-error">
              <span className="font-medium">{fieldLabel(blocker.field) || TERM.FIELD_LABEL_FALLBACK}</span>
                              <span className="ml-2">{blocker.message}</span>
            </p>
          ))}
        </div>
      )}
      {preview && <p className="mt-2 text-xs text-text-hint">{ecPreviewValidity(new Date(preview.expiresAt).toLocaleTimeString("zh-CN"), preview.postCheck.blockerCount, preview.postCheck.warningCount)}</p>}
      {status === "applied" && <p className="mt-3 text-sm text-status-fact">{EC_REPAIR_DRAWER_COPY.APPLIED}</p>}
    </PoolShell>
  );
}
