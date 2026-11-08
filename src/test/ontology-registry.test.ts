import { describe, expect, it } from "vitest";
import {
  ACTIVE_RELATION_TYPES,
  ENTITY_TYPES,
  RELATION_TYPES,
  isKnownRelationType,
  normalizeRelationType,
  validateRelation,
} from "@/lib/ontology";

describe("generated ontology registry", () => {
  it("exposes entity and relation types generated from TheSchema", () => {
    expect(ENTITY_TYPES).toContain("服务");
    expect(RELATION_TYPES.RELATED.label).toBe("相关");
    expect(RELATION_TYPES.CONNECTS_TO.label).toBe("连接到");
    expect(RELATION_TYPES.ENCRYPTS.label).toBe("加密");
  });

  it("normalizes configured wikilink labels as relation aliases", () => {
    expect(normalizeRelationType("关联")).toBe("RELATED");
    expect(isKnownRelationType("关联")).toBe(true);
    expect(isKnownRelationType("UNDEFINED_RELATION")).toBe(false);
  });

  it("recognizes deleted legacy names without exposing them as active relations", () => {
    expect(ACTIVE_RELATION_TYPES.USES).toBeUndefined();
    expect(normalizeRelationType("uses")).toBe("USES");
    expect(isKnownRelationType("uses")).toBe(false);
  });

  it("accepts configured relations and rejects undefined relation types", () => {
    // WP-049 余量批：定义域为类名词表（ADR-014 §3.2）；分类名经 CATEGORY_CLASSES（node_types.category
    // 反转，生成物单源）翻译判定——编辑器传分类名恢复 exact 置信
    expect(validateRelation("RELATED", "System", "Entity")).toEqual({ valid: true, confidence: 1 });
    expect(validateRelation("RELATED", "服务", "文档")).toEqual({ valid: true, confidence: 1 });
    expect(validateRelation("UNDEFINED_RELATION", "System", "Entity").valid).toBe(false);
  });
});

// WP-049 余量批（P6 关系配色键组对账钉）：配色键集 ⊆ 生成本体现役面（在册且非 delete 策略）
import { RELATION_COLORS } from "../lib/topology-types";
describe("关系配色键集对账（topology-types ↔ 生成注册表）", () => {
  it("每个配色键都在册且活性（非 legacy_policy=delete）", () => {
    for (const key of Object.keys(RELATION_COLORS)) {
      const def = RELATION_TYPES[key];
      expect(def, `配色键 ${key} 须在 RELATION_TYPES 在册`).toBeDefined();
      expect(def!.legacyPolicy, `配色键 ${key} 不得为 delete 策略（退役关系回落默认色）`).not.toBe("delete");
    }
  });
});

// WP-049 余量批（P6 layers layout 组对账钉）：前端 VALID_LAYOUTS ≡ 契约 enums.schema.json
import { VALID_LAYOUTS } from "../features/schema-manager/schema-manager-types";
import schemaJson from "../../contracts/enums.schema.json";
describe("layers layout 值域对账（前端 ↔ 契约 schema）", () => {
  it("VALID_LAYOUTS ≡ contracts/enums.schema.json 的 layout enum", () => {
    const contractEnum = (schemaJson as { properties: { layers: { items: { properties: { layout: { enum: string[] } } } } } })
      .properties.layers.items.properties.layout.enum;
    expect([...VALID_LAYOUTS].sort()).toEqual([...contractEnum].sort());
  });
});
