import { useEffect, useMemo, useRef, useState } from "react";
import { useEntityComplianceStore } from "./entity-compliance-store";
import { fetchEnums, normalizeEnumsData } from "@/features/schema-manager";
import { entityFieldCandidates } from "@/lib/schema-shape";
import { SummaryBar } from "./SummaryBar";
import { EntityComplianceToolbar } from "./EntityComplianceToolbar";
import { EntityComplianceCard } from "./EntityComplianceCard";
import { FileSearch, AlertTriangle } from "lucide-react";
import { ENTITY_CREATE_FIELDS } from "@/components/entity-repair/entity-create-fields";
import type { EntityComplianceResult } from "./entity-compliance-types";
import { readNavLocation } from "@/lib/navigation";
import { PageContainer } from "@/components/page-container";
import { TERM } from "@/constants/term-const";
import { useRefetchOnFocus } from "@/hooks/useRefetchOnFocus";
import { EC_VIEW_COPY } from "./entity-compliance-copy";

// 字段清单母版=ENTITY_CREATE_FIELDS（seq189 P3a 单源化）：此处仅派生，顺序统一到母版序，禁止回填字面量（对齐锁测试 src/test/entity-fields-ssot.test.ts 强制）
export const CREATE_FIELDS: string[] = ENTITY_CREATE_FIELDS.map((spec) => spec.field);

// 2026-10-08 修复：创建模板的合成检查带 enums 候选（allowedValues）——否则所有枚举字段
// 被判 enum-starved（allowed.length===0）永久禁用，「产品模块/架构分层」等无法填写。
// 批16：候选推导单源＝schema-shape entityFieldCandidates（与异常侧抽屉同源同实现）；本文件不再拍平 enums。
function pendingEntity(sourceKey: string, title: string, enumOptions: Record<string, string[]>): EntityComplianceResult {
  return {
    entityId: "",
    title,
    fileName: sourceKey.split("/").pop() || `${title}.md`,
    sourceKey,
    blockerCount: CREATE_FIELDS.length,
    warningCount: 0,
    infoCount: 0,
    score: 0,
    groups: [{
      id: "identity",
      label: EC_VIEW_COPY.MISSING_TEMPLATE_GROUP,
      checks: CREATE_FIELDS.map((field, index) => ({
        ruleId: `CREATE-${index + 1}`,
        field,
        label: field,
        severity: "error" as const,
        passed: false,
        value: null,
        message: EC_VIEW_COPY.NOT_FILLED_MESSAGE,
        // 与后端 CREATE 模板同语义：本地合成的缺失实体检查同样带结构化缺失原因，
        // 抽屉据此抑制「尚未填写」状态废话（不按 message 文案判等）
        reason: "missing" as const,
        editable: true,
        allowedValues: enumOptions[field] || [],
      })),
    }],
  };
}

export function EntityComplianceView() {
  const data = useEntityComplianceStore((s) => s.data);
  const loading = useEntityComplianceStore((s) => s.status === "loading");
  const error = useEntityComplianceStore((s) => s.error);
  const openRepair = useEntityComplianceStore((s) => s.openRepair);
  const openCreate = useEntityComplianceStore((s) => s.openCreate);
  const refreshAll = useEntityComplianceStore((s) => s.refreshAll);
  const refreshSummary = useEntityComplianceStore((s) => s.refreshSummary);
  const lastCheckedAt = useEntityComplianceStore((s) => s.lastCheckedAt);

  // WP-145：进页即拉＋可见性变化重拉收编共享 hook（语义同原 effect；窗口聚焦重拉为收编后的公共行为）
  useRefetchOnFocus(refreshAll, { immediate: true });
  const [enumsReady, setEnumsReady] = useState(false);
  // 批16：候选经 schema-shape 投影（模块级可变变量 → state，React 语义归位）
  const [createFlowEnumOptions, setCreateFlowEnumOptions] = useState<Record<string, string[]>>({});
  // 2026-10-08：创建流候选预载（pendingEntity 合成检查消费；失败静默降级为旧 starved 行为）
  useEffect(() => {
    let cancelled = false;
    void fetchEnums().then((raw) => {
      if (cancelled) return;
      setCreateFlowEnumOptions(entityFieldCandidates(normalizeEnumsData(raw)));
    }).then(() => { if (!cancelled) setEnumsReady(true); }).catch(() => { /* 静默：零候选 → 字段 starved 提示（旧行为） */ if (!cancelled) setEnumsReady(true); });
    return () => { cancelled = true; };
  }, []);
  const target = useMemo(() => {
    const params = readNavLocation().query;
    return { sourceKey: params.get("sourceKey"), create: params.get("create") === "1", title: params.get("title") || EC_VIEW_COPY.NEW_ENTITY_TITLE };
  }, []);
  const openedTarget = useRef(false);
  useEffect(() => {
    if (!target.sourceKey || !data || openedTarget.current) return;
    const entity = data.items.find((item) => item.sourceKey === target.sourceKey);
    if (entity && entity.sourceExists === false) openCreate(entity);
    else if (entity) openRepair(entity);
    else if (target.create) {
      // 创建流：等 enums 候选就绪再合成（否则枚举字段零候选被 starved 禁用——时序修复 2026-10-08）
      if (!enumsReady && !Object.keys(createFlowEnumOptions).length) return;
      openCreate(pendingEntity(target.sourceKey, target.title, createFlowEnumOptions));
    }
    openedTarget.current = true;
  }, [data, openCreate, openRepair, target, enumsReady, createFlowEnumOptions]);

  return (
    <PageContainer>
      {refreshSummary && (
        <p className="text-xs text-status-fact" aria-live="polite">{refreshSummary}{lastCheckedAt ? ` · ${new Date(lastCheckedAt).toLocaleTimeString("zh-CN", { hour12: false })}` : ""}</p>
      )}

      {error && (
        <div className="flex items-center gap-2 rounded-lg ring-1 ring-status-error-6 bg-status-error-2 px-4 py-3 text-sm text-status-error">
          <AlertTriangle className="h-4 w-4" /><span>{error}</span>
          <button onClick={() => void refreshAll({ announce: true })} className="ml-auto text-xs underline">{TERM.RETRY_ACTION}</button>
        </div>
      )}

      {/* Master 2026-10-29：资格横幅撤（数字与统计卡重复）；P5：受检 0 时不渲染零值统计堆 */}
      {(data?.summary?.totalEntities ?? 0) > 0 && data && <SummaryBar summary={data.summary} />}
      <EntityComplianceToolbar />

      {loading && !data && (
        // animate-pulse 为功能性保留（WP-145 R7 复核）：加载占位骨架，向用户指示数据加载中
        <div className="space-y-2">{Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-lg bg-surface-root ring-1 ring-border-thin" />
        ))}</div>
      )}

      {!loading && data && !data.items?.length && (
        <div className="flex flex-col items-center gap-2 py-16 text-text-placeholder">
          <FileSearch className="h-6 w-6" /><p className="text-sm">{EC_VIEW_COPY.EMPTY_NO_MATCH}</p>
        </div>
      )}

      {data?.items?.map((item) => (
        <EntityComplianceCard key={item.entityId || item.fileName} entity={item} />
      ))}
    </PageContainer>
  );
}
