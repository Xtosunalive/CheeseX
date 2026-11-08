// 共享小投影钉（WP-032/PR-147，SPEC-034 C1/C2/C3）。
// 层级：纯单元——验证对象：三个共享投影的回落口径唯一性与域满配。
// 改回落文案/删域键不动本钉即红（回落口径再分叉的第一道闸）。
import { describe, expect, it } from "vitest";
import { relationTypeLabel, RELATION_TYPES } from "@/lib/ontology";
import { nodeNameLabel } from "@/lib/domain";
import {
  RELATION_TYPE_PROVENANCE,
  RELATION_TYPE_PROVENANCE_DEFAULT,
  relationSourceMeta,
} from "@/lib/domain";

describe("relationTypeLabel——正名回落唯一口径", () => {
  it("已登记类型返回词表正名（等价红线：与词表逐键一致）", () => {
    for (const [type, def] of Object.entries(RELATION_TYPES)) {
      expect(relationTypeLabel(type)).toBe(def.label);
    }
  });

  it("未登记类型唯一回落「未登记关系」——裸枚举不上屏", () => {
    expect(relationTypeLabel("NOT_A_REAL_TYPE")).toBe("未登记关系");
    expect(relationTypeLabel("")).toBe("未登记关系");
  });
});

describe("nodeNameLabel——节点名回落唯一口径", () => {
  it("有名单纯空白归一「未命名实体」；裸 id 不上屏", () => {
    expect(nodeNameLabel({ label: "网关" })).toBe("网关");
    expect(nodeNameLabel({ label: "  " })).toBe("未命名实体");
    expect(nodeNameLabel({ label: "" })).toBe("未命名实体");
    expect(nodeNameLabel({ label: undefined })).toBe("未命名实体");
    expect(nodeNameLabel(undefined)).toBe("未命名实体");
    expect(nodeNameLabel(null)).toBe("未命名实体");
  });

  it("裸字符串入参（Map.get 回落场景）：空白归一、非空保留", () => {
    expect(nodeNameLabel("svc-a")).toBe("svc-a");
    expect(nodeNameLabel("   ")).toBe("未命名实体");
    expect(nodeNameLabel(undefined)).toBe("未命名实体");
  });
});

describe("PROVENANCE 域收编——满配钉与两页一致性", () => {
  it("关系类型轴 9 键满配（增删键不动本钉即红）", () => {
    expect(Object.keys(RELATION_TYPE_PROVENANCE).sort()).toEqual([
      "APPLIES_TO",
      "ASSOCIATED_WITH",
      "BELONGS_TO",
      "DEPENDS_ON",
      "DOCUMENTS",
      "HAS_SYMPTOM",
      "HAS_VERSION",
      "MENTIONS",
      "REFERENCES",
    ]);
    for (const meta of Object.values(RELATION_TYPE_PROVENANCE)) {
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.description.length).toBeGreaterThan(0);
      expect(meta.label).not.toMatch(/[A-Z_]{3,}/); // 裸枚举不上屏（S4）
    }
  });

  it("来源键轴分叉已归一：category-path 两页同文（域为准）", () => {
    expect(relationSourceMeta("category-path").label).toBe("结构关联");
    expect(relationSourceMeta("entity-wikilink").label).toBe("正文引用");
    expect(relationSourceMeta("document-body").label).toBe("正文推断");
  });

  it("默认回落文案在位", () => {
    expect(RELATION_TYPE_PROVENANCE_DEFAULT.label).toBe("结构生成");
  });
});
