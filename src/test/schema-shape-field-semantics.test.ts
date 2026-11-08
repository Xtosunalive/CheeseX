// schema-shape 字段级语义投影测试——复用域 schema-shape 守护测试（2026-10-27 批 B 档）
// 面覆盖：字段语义投影（登记对象往返/未登记空回退/单字段查找）＋直通钉子（DictionaryObject→Shape 输入面）
// 背景：字段正名/说明此前散在编辑器手写（「权威产品 ID」与契约「权威产品名」自相打架即症状）——
// 本批起字段语义单源自 object-dictionary fields 条目，编辑器经 fieldSemanticOf 取数禁自造。
import { describe, expect, it } from "vitest";
import { OBJECT_DICTIONARY, type DictionaryObject } from "@/lib/object-dictionary";
import { fieldSemanticOf, tabFieldSemantics, type ShapeDictionaryObject } from "@/lib/schema-shape";

// 编译期直通钉子：字典投影类型必须结构性可赋值 shape 输入面（fields 面含在内）
const _dictionaryAssignable: ShapeDictionaryObject = {} as DictionaryObject;
void _dictionaryAssignable;

describe("tabFieldSemantics/fieldSemanticOf（字段级语义投影）", () => {
  it("versions 对象首批 4 字段登记往返（canonical_product 正名=主产品名（身份锚点））", () => {
    const semantics = tabFieldSemantics(OBJECT_DICTIONARY, "versions");
    const fields = semantics.map((f) => f.field);
    expect(fields).toContain("canonical_product");
    expect(fields).toContain("product_aliases");
    expect(fields).toContain("products");
    expect(fields).toContain("reserved_products");
    const canonical = fieldSemanticOf(OBJECT_DICTIONARY, "versions", "canonical_product");
    expect(canonical?.label).toBe("主产品名（身份锚点）");
    expect(canonical?.description).toContain("仅允许从空态首次设定");
  });

  it("未登记 fields 的对象 → 空数组；未登记页签 → 空数组（total）", () => {
    expect(tabFieldSemantics([], "versions")).toEqual([]);
    expect(tabFieldSemantics(OBJECT_DICTIONARY, "history")).toEqual([]);
    const noFieldsObject = [{ canonical_name: "x", definition: "", edited_by_tab: "layers", editable: true, object_kind: "config" }];
    expect(tabFieldSemantics(noFieldsObject, "layers")).toEqual([]);
  });

  it("单字段查找未登记 → null（消费方自定回退文案）", () => {
    expect(fieldSemanticOf(OBJECT_DICTIONARY, "versions", "not_registered")).toBeNull();
    expect(fieldSemanticOf([], "versions", "canonical_product")).toBeNull();
  });
});
