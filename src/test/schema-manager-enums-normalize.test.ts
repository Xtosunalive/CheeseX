import { describe, expect, it } from "vitest";
import { normalizeEnumsData } from "@/features/schema-manager/schema-manager-types";

// 完整态（SchemaEnumsData，/api/schema/enums 全量读取）
// ADR-008 D1：subdomains 词条对象形态（{id,label?,description?}）——完整态经防御归一后 subdomains 为对象数组。
const full: import("@/features/schema-manager/schema-manager-types").FullEnumsData = {
  domains: { d1: "领域一" },
  subdomains: { d1: [{ id: "s1" }] },
  subdomain_constraints: { p1: { domain_id: "d1", allowed_categories: ["c1"] } },
  layers: [{ id: "L1", label: "接入层", color: "violet", layout: "central" }],
  categories: ["c1"],
  article_types: ["a1"],
  doc_types: ["doc1"],
  modules: { m1: { subdomain: "s1" } },
  tags: { t1: ["x"] },
  tag_aliases: { t1: ["y"] },
  disabled_tags: [],
  revision: "rev-1",
  sourceFile: "知识库/TheSchema/enums.yaml",
};

describe("normalizeEnumsData（ADR063 节态→完整态归一）", () => {
  it("完整态透传（subdomains 例外：词条防御归一为对象数组，ADR-008 D1）", () => {
    const out = normalizeEnumsData(full);
    expect(out).toEqual(full);
    expect(out.revision).toBe("rev-1");
    // 非 subdomains 节仍引用透传（零拷贝语义不变）
    expect(out.domains).toBe(full.domains);
    expect(out.layers).toBe(full.layers);
  });

  it("完整态含 legacy 标量词条 → 防御归一为对象数组（双形态兜底）", () => {
    const legacy = { ...full, subdomains: { d1: ["s1"] } };
    const out = normalizeEnumsData(legacy);
    expect(out.subdomains).toEqual({ d1: [{ id: "s1" }] });
  });

  it("节态（SchemaEnumsSectionData）缺失字段归一为空值", () => {
    const section = { domains: { d1: "领域一" } };
    const out = normalizeEnumsData(section);
    expect(out.domains).toEqual({ d1: "领域一" });
    expect(out.subdomains).toEqual({});
    expect(out.subdomain_constraints).toEqual({});
    expect(out.layers).toEqual([]);
    expect(out.categories).toEqual([]);
    expect(out.modules).toEqual({});
    expect(out.tags).toEqual({});
    expect(out.revision).toBe("");
    expect(out.sourceFile).toBe("");
  });

  it("节态带部分字段时保留已有、补齐缺失（subdomains 词条归一）", () => {
    const section = { domains: { d2: "领域二" }, subdomains: { d2: ["s2"] } };
    const out = normalizeEnumsData(section);
    expect(out.domains).toEqual({ d2: "领域二" });
    expect(out.subdomains).toEqual({ d2: [{ id: "s2" }] });
    expect(out.tags).toEqual({});
  });
});
