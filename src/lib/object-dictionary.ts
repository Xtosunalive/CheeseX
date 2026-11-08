// object-dictionary —— 字典契约前端投影（SCHEMA-IA-001 批4 扩域：语义层装载器）
// 单源=contracts/object-dictionary.json（git 契约，家产清单钦定的业务对象字典——
// 正名/定义/裁决的权威住址）。本模块只做「取最小面」的结构化投影，语义解释归
// schema-shape 消费方（tabSemantics/canonicalTabLabels/fieldSemantics）；改字典即
// 全端跟随——此前正名裁决躺在字典里两年未执行的病根，就是缺这条投影链。
// 批（2026-10-27，Master「全都做」）：B 档治理粒度——对象条目可选 fields（字段级
// 正名/说明单源），编辑器字段标签与说明自此投影，禁自造。
import raw from "../../contracts/object-dictionary.json";

/** 字段级语义条目（可选面——首批「产品版本」对象 4 字段；未登记对象的字段投影为空） */
export interface DictionaryField {
  field: string;
  label: string;
  description: string;
}

export interface DictionaryObject {
  canonical_name: string;
  definition: string;
  edited_by_tab: string;
  editable: boolean;
  object_kind: string;
  fields?: readonly DictionaryField[];
}

function projectFields(entry: Record<string, unknown>): readonly DictionaryField[] | undefined {
  const list = entry.fields;
  if (!Array.isArray(list)) return undefined;
  return list.map((item) => {
    const f = (item ?? {}) as Record<string, unknown>;
    return {
      field: String(f.field ?? ""),
      label: String(f.label ?? ""),
      description: String(f.description ?? ""),
    };
  });
}

function project(entry: Record<string, unknown>): DictionaryObject {
  return {
    canonical_name: String(entry.canonical_name ?? ""),
    definition: String(entry.definition ?? ""),
    edited_by_tab: String(entry.edited_by_tab ?? ""),
    editable: entry.editable === true,
    object_kind: String(entry.object_kind ?? ""),
    fields: projectFields(entry),
  };
}

export const OBJECT_DICTIONARY: readonly DictionaryObject[] = (raw.core_objects as Record<string, unknown>[]).map(project);
