import { FileText } from "lucide-react";
import { SidePanelSection } from "@/components/side-panel";
import { RepairFieldEditor, type RepairFieldKind } from "./RepairFieldEditor";

/**
 * 实体修复共享表单 —— 待处理问题补齐与实体合规修复两个入口复用同一套
 * 分组、卡片布局和控件路由。
 *
 * 卡片统一采用固定的「标题区 / 控件区 / 提示区」三段布局：
 * 普通字段高度一致（min-h-[72px]），高内容字段（json/textarea）自动扩展。
 */

export type RepairFieldCard = {
  field: string;
  label: string;
  required: boolean;
  kind: RepairFieldKind;
  value: unknown;
  allowedValues?: string[];
  placeholder?: string;
  hint?: string;
  message?: string;
  pattern?: string;
  booleanLabel?: string;
  suggestions?: string[];
  suggestion?: { reason: string; confidence: number };
  disabled?: boolean;
  /** 字段级校验错误（预览前 required 校验写入） */
  error?: string;
  /** 字段标签下方的补充标记，如「当前问题字段」 */
  tag?: string;
  /** PR-050：文章源上下文与产品注册表信息（受管字段分发单源控件所需） */
  isArticle?: boolean;
  productValue?: string;
  products?: { name: string; versions: string[] }[];
  onChange: (value: unknown) => void;
};

export type RepairFieldGroup = {
  id: string;
  label: string;
  fields: RepairFieldCard[];
};

const TALL_KINDS = new Set<RepairFieldKind>(["json"]);

function FieldCard({ card }: { card: RepairFieldCard }) {
  const tall = TALL_KINDS.has(card.kind);
  return (
    <div className={`flex flex-col rounded-md bg-surface-root p-3 ring-1 ring-border-thin ${tall ? "min-h-[140px] md:col-span-2" : "min-h-[72px]"}`}>
      {/* 标题区 */}
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-text-main" aria-required={card.required || undefined}>
          {card.label}
          {card.required && <span className="ml-0.5 text-status-error" aria-hidden="true">*</span>}
        </span>
        {card.tag && <span className="shrink-0 text-kg-xs text-accent-base">{card.tag}</span>}
      </div>
      {/* 控件区 */}
      <div className="mt-1.5 flex-1">
        <RepairFieldEditor
          field={card.field}
          label={card.label}
          message=""
          value={card.value}
          kind={card.kind}
          allowedValues={card.allowedValues}
          placeholder={card.placeholder}
          hint={card.hint}
          pattern={card.pattern}
          booleanLabel={card.booleanLabel}
          required={card.required}
          suggestions={card.suggestions}
          suggestion={card.suggestion}
          disabled={card.disabled}
          showLabel={false}
          onChange={card.onChange}
          isArticle={card.isArticle}
          productValue={card.productValue}
          products={card.products}
        />
      </div>
      {/* 提示区：错误优先；检查消息沿用「字段名 · 消息」的原有展示格式 */}
      {(card.error || card.message) && (
        <p className={`mt-1 text-xs ${card.error ? "text-status-error" : "text-text-hint"}`} role={card.error ? "alert" : undefined}>
          {card.error || `${card.label} · ${card.message}`}
        </p>
      )}
    </div>
  );
}

type EntityRepairFormProps = {
  groups: RepairFieldGroup[];
  /** 双列网格（待处理问题补齐）或单列（实体合规修复） */
  columns?: 1 | 2;
};

export function EntityRepairForm({ groups, columns = 2 }: EntityRepairFormProps) {
  return (
    <>
      {groups.map((group) => (
        <SidePanelSection key={group.id} title={group.label} icon={FileText}>
          <div className={columns === 2 ? "grid grid-cols-1 gap-3 md:grid-cols-2" : "space-y-3"}>
            {group.fields.map((card) => <FieldCard key={card.field} card={card} />)}
          </div>
        </SidePanelSection>
      ))}
    </>
  );
}
