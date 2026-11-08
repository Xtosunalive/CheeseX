// 节点显示名单一回落投影（WP-032/PR-147）。
// 此前图节点查表回落三种文案（「未命名实体」/「未命名架构组件」/裸 id）散布
// RelationsPanel/RelationLibraryTab/ImpactPathGraph/ImpactAnalysisPanel/LocalGraph/
// EntityDetailPanel——收编本函数，口径唯一「未命名实体」（裸 id 不上屏，S4 纪律）。
// 豁免面（WP-032 non_goals）：表单选项占位「未命名架构组件」（entity-compliance/
// article-associations 选择器——语义确指架构组件，非图节点查表族）不经本函数。

import { TERM } from "@/constants/term-const";

/** label 空白（undefined/null/空串/纯空白）或输入缺席 → 「未命名实体」（TERM.UNNAMED_ENTITY）；也接受裸字符串（Map.get 回落场景） */
export function nodeNameLabel(node?: { label?: string | null } | string | null | undefined): string {
  const raw = typeof node === "string" ? node : node?.label;
  const label = typeof raw === "string" ? raw.trim() : "";
  return label.length > 0 ? label : TERM.UNNAMED_ENTITY;
}
