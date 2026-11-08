import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ARTICLE_FIELD_COMPLETION_ACTION } from "@/features/article-workflow/article-workflow-api";
import type { CandidateFieldCompletion, CandidateFieldOptions, PrecleanedArticleDetail } from "@/features/article-workflow/article-workflow-types";
// PR-050：字段→控件语义收敛到 managed-article-field 单源（与修复抽屉共享）；本表单只保留流程壳。
// PR-151 续·根治：字段清单不再前端手写——渲染面＝服务端 articleFields（契约表单形状派生，
// completable 过滤补齐策略），控件按 control 分派，选项按 optionsKey 取包；字典新增必填字段
// 经契约登记后本表单零代码自动出现。
import { TERM } from "@/constants/term-const";
import { ManagedArticleFieldControl } from "@/components/entity-repair/managed-article-field";
import { resolveVersionOptions } from "@/components/entity-repair/managed-article-field-helpers";
import { CANDIDATE_FIELD_FORM_COPY, candidateFieldSaveTitle } from "../article-workflow-copy";

type Props = {
  article: PrecleanedArticleDetail;
  options: CandidateFieldOptions | null;
  optionsLoading: boolean;
  saving: boolean;
  onSave: (id: string, fields: CandidateFieldCompletion) => void;
};

const ARRAY_SEPARATOR = ", ";

type FieldSpec = NonNullable<CandidateFieldOptions["articleFields"]>[number];

// 选项取包（PR-151 续）：products/version 两级联特例，其余按 optionsKey 直取选项包
function optionsForSpec(spec: FieldSpec, options: CandidateFieldOptions | null, products: NonNullable<CandidateFieldOptions["products"]>, productValue: string): string[] {
  if (spec.optionsKey === "products") return products.map((entry) => entry.name);
  if (spec.optionsKey === "versions") return resolveVersionOptions({ products, productValue });
  if (!spec.optionsKey) return [];
  const bag = (options as unknown as Record<string, unknown> | null)?.[spec.optionsKey];
  return Array.isArray(bag) ? bag.filter((entry): entry is string => typeof entry === "string") : [];
}

export function CandidateFieldForm({ article, options, optionsLoading, saving, onSave }: Props) {
  // 补齐字段清单＝服务端派生（契约 control ∧ 补齐白名单；completable 缺省视为可补——兼容历史 mock）
  const completableFields = useMemo(
    () => (options?.articleFields ?? []).filter((spec) => spec.completable !== false),
    [options],
  );
  const initial = useMemo(() => Object.fromEntries(completableFields.map((spec) => {
    const raw = article.metadata[spec.field];
    const value = spec.control === "array"
      ? (Array.isArray(raw) ? raw.join(ARRAY_SEPARATOR) : typeof raw === "string" ? raw : "")
      : typeof raw === "string" ? raw : "";
    return [spec.field, value.trim() ? value : ""];
  })) as Record<string, string>, [article, completableFields]);
  const [values, setValues] = useState<Record<string, string>>(initial);
  const products = options?.products ?? [];
  const changed = completableFields.filter((spec) => values[spec.field] !== initial[spec.field] && values[spec.field] !== "");
  const disabled = optionsLoading || saving || changed.length === 0;
  return (
    <section aria-label={CANDIDATE_FIELD_FORM_COPY.SECTION_ARIA} className="rounded-lg bg-surface-card px-3 py-2 ring-1 ring-border-thin" data-action-id={ARTICLE_FIELD_COMPLETION_ACTION.id} data-risk={ARTICLE_FIELD_COMPLETION_ACTION.risk} data-channel={ARTICLE_FIELD_COMPLETION_ACTION.dataChannel}>
      <div className="flex flex-wrap items-end gap-3">
        {completableFields.length === 0 && (
          <p className="text-xs text-text-hint">{optionsLoading ? CANDIDATE_FIELD_FORM_COPY.FIELDS_LOADING : TERM.EMPTY_COMPLETABLE_FIELD}</p>
        )}
        {completableFields.map((spec) => (
          <label key={spec.field} className="flex min-w-36 flex-col gap-1 text-xs text-text-hint">
            {spec.label}
            {spec.control === "text" || spec.control === "array" ? (
              <Input
                aria-label={spec.label}
                className="h-8"
                value={values[spec.field] ?? ""}
                disabled={optionsLoading}
                placeholder={spec.control === "array" ? CANDIDATE_FIELD_FORM_COPY.ARRAY_PLACEHOLDER : ""}
                onChange={(event) => setValues((prev) => ({ ...prev, [spec.field]: event.target.value }))}
              />
            ) : (
              <div className="flex flex-col gap-1">
              <ManagedArticleFieldControl
                field={spec.field}
                label={spec.label}
                value={values[spec.field] ?? ""}
                options={optionsForSpec(spec, options, products, values.product ?? "")}
                products={products}
                productValue={values.product ?? ""}
                disabled={optionsLoading}
                surface="root"
                onChange={(next) => setValues((prev) => ({ ...prev, [spec.field]: next, ...(spec.field === "product" && next !== prev.product ? { version: "" } : {}) }))}
              />
              {(() => {
                // WP-062 功能可用性：选项空态显式化——availability.empty 时渲染指引（缺什么/去哪配），
                // 不让用户对着死下拉猜；数据态（词表归档/产品未注册）照实上报，程序不代填。
                const opts = optionsForSpec(spec, options, products, values.product ?? "");
                if (opts.length > 0) return null;
                const state = options?.availability?.[spec.optionsKey ?? ""];
                if (!state?.empty || !state.hint) return null;
                return <span className="text-[11px] leading-4 text-text-sub" role="note">{state.hint}</span>;
              })()}
              </div>
            )}
          </label>
        ))}
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8"
          disabled={disabled}
          title={changed.length > 0 ? candidateFieldSaveTitle(changed.map((spec) => spec.label)) : CANDIDATE_FIELD_FORM_COPY.SAVE_DISABLED_TITLE}
          onClick={() => onSave(article.id, Object.fromEntries(changed.map((spec) => [
            spec.field,
            spec.control === "array" ? (values[spec.field] ?? "").split(ARRAY_SEPARATOR).map((item) => item.trim()).filter(Boolean) : values[spec.field],
          ])) as CandidateFieldCompletion)}
        >
          {saving ? CANDIDATE_FIELD_FORM_COPY.SAVING : CANDIDATE_FIELD_FORM_COPY.SAVE_ACTION}
        </Button>
      </div>
      <p className="mt-1 text-xs text-text-hint">{CANDIDATE_FIELD_FORM_COPY.HINT}</p>
    </section>
  );
}
