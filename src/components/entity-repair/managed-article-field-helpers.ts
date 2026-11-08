// 文章受管字段纯函数集（自 managed-article-field.tsx 拆出——组件文件只留组件，PR-050 单源语义不变）。
// 控件形态/联动/回退语义仍单源；此文件只承载无 JSX 的取数函数，补齐表单与修复抽屉两棵表单树共用。
import { FIELD_LABELS } from "../../../shared/field-labels.mjs";

export type ManagedArticleProduct = { name: string; versions: string[] };

export function managedArticleFieldLabel(field: string): string {
  return FIELD_LABELS.article[field] || field;
}

export function managedArticleOptionsFor(field: string, optionBag: {
  products?: ManagedArticleProduct[];
  articleTypes?: string[];
  modules?: string[];
  docTypes?: string[];
  categoryPaths?: string[];
  archLayers?: string[];
  archCategories?: string[];
}): string[] {
  switch (field) {
    case "product": return (optionBag.products || []).map((entry) => entry.name);
    case "article_type": return optionBag.articleTypes || [];
    case "module": return optionBag.modules || [];
    case "doc-type": return optionBag.docTypes || [];
    case "category-path": return optionBag.categoryPaths || [];
    // PR-151：字典必填两字段（选项面=field-completion-options 的 archLayers/archCategories，与 PATCH 执法同源）
    case "arch_layer": return optionBag.archLayers || [];
    case "arch_category": return optionBag.archCategories || [];
    default: return [];
  }
}

export function resolveVersionOptions(props: { products?: ManagedArticleProduct[]; productValue?: string; options?: string[] }): string[] {
  if (props.products && props.products.length > 0) {
    const product = props.products.find((entry) => entry.name === props.productValue);
    return product ? product.versions : [];
  }
  return props.options ?? [];
}
