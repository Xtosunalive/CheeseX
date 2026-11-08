// review 页泄漏清扫钉（WP-034/PR-149，SPEC-036 C2）。
// 层级：纯单元——验证对象：置信度来源人话映射满配（值域加值不登记即红＋未知值兜底）。
// 显示面泄漏复查由验收 grep 承载（validation_commands）。
import { describe, expect, it } from "vitest";
import { CONFIDENCE_SOURCE_LABEL, confidenceSourceLabel } from "@/features/review/EdgeReviewPanel";

describe("置信度来源人话映射（WP-034）", () => {
  it("四值满配（映射自身漂移即红；后端加值由运行时兜底降级——红队批注如实化）", () => {
    expect(Object.keys(CONFIDENCE_SOURCE_LABEL).sort()).toEqual(["band", "native", "none", "suggestion"]);
  });

  it("映射值全人话（无裸英文枚举）；未知值兜底「未标记」", () => {
    for (const label of Object.values(CONFIDENCE_SOURCE_LABEL)) {
      expect(label).not.toMatch(/^(band|native|suggestion|none)$/);
      expect(label.length).toBeGreaterThan(0);
    }
    expect(confidenceSourceLabel("future_value")).toBe("未标记");
    expect(confidenceSourceLabel(undefined)).toBe("未标记");
    expect(confidenceSourceLabel("band")).toBe("评分档");
  });
});
