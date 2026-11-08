import { describe, expect, it } from "vitest";
import { articleAwareFieldKind as fieldKind } from "@/features/entity-compliance/repair-field-config";

// #1396 回归墙：实体合规页修复抽屉对文章源（standard-article）必须把 module 渲染为单选（字符串），
// 修复前 fieldKind 无条件 array → 多选吐数组 → 后端 400 "module 必须是非空字符串"（tr_b7ff011a 实录）。
describe("fieldKind 文章意识", () => {
  it("文章源：module → select（有可选值时），不再 array", () => {
    expect(fieldKind("module", ["可观测性", "认证服务"], true)).toBe("select");
  });
  it("文章源：module 无可选值 → text（兜底，仍非 array）", () => {
    expect(fieldKind("module", [], true)).toBe("text");
  });
  it("文章源：tags 保持 array（后端文章 tags 本就是 string[]）", () => {
    expect(fieldKind("tags", [], true)).toBe("array");
  });
  it("实体源：module 仍为 array（实体语义不变）", () => {
    expect(fieldKind("module", ["网关"], false)).toBe("array");
  });
  it("实体源：arch_component 仍为 boolean（回归护栏）", () => {
    expect(fieldKind("arch_component", [], false)).toBe("boolean");
  });
});
