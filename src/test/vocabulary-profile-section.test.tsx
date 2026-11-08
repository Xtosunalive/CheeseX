// Component: VocabularyProfileSection Tests（SPEC-007 §3.3 前端层）
// @responsible: 词表画像区呈现（计数/阶段徽章/死词标记）+ 阈值旋钮交互（变更触发重取）+ 空维度不渲染。
// @inputs: VocabularyProfileSection + vitest 内联 profile
// @outputs: vitest 断言
// @context: SPEC-007 §3.3；先例=entity-growth-cards.test.tsx
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { VocabularyProfileSection } from "@/features/schema-manager/VocabularyProfileSection";

function profileWith(threshold: number) {
  return {
    dimensions: {
      layer: { words: [{ word: "service", usageCount: 2, stage: "verified" as const }, { word: "gateway", usageCount: 0, stage: "seed" as const }], deadWords: ["gateway"], wildValues: [] },
      category: { words: [{ word: "终端", usageCount: 1, stage: threshold <= 1 ? ("verified" as const) : ("growing" as const) }], deadWords: [], wildValues: [] },
      subdomain: { words: [], deadWords: [], wildValues: [] },
      module: { words: [{ word: "可观测性", usageCount: 3, stage: "verified" as const }], deadWords: [], wildValues: [{ value: "野生模块", count: 2, files: ["a.md"] }] },
      tag: { words: [], deadWords: [], wildValues: [] },
    },
    summary: {
      verifiedThreshold: threshold,
      totalWords: 4,
      totalDead: 1,
      dimensions: {
        layer: { total: 2, seed: 1, growing: 0, verified: 1, dead: 1, wild: 0 },
        category: { total: 1, seed: 0, growing: threshold <= 1 ? 0 : 1, verified: threshold <= 1 ? 1 : 0, dead: 0, wild: 0 },
        subdomain: { total: 0, seed: 0, growing: 0, verified: 0, dead: 0, wild: 0 },
        module: { total: 1, seed: 0, growing: 0, verified: 1, dead: 0, wild: 1 },
        tag: { total: 0, seed: 0, growing: 0, verified: 0, dead: 0, wild: 0 },
      },
    },
  };
}

describe("VocabularyProfileSection（ADR-007 波2）", () => {
  it("画像区：词计数+阶段徽章+死词标记呈现（数据全来自 vocabularyProfile 响应）", () => {
    render(<VocabularyProfileSection profile={profileWith(1)} onThresholdChange={vi.fn()} />);
    expect(screen.getByText("service")).toBeTruthy();
    expect(screen.getAllByText("Verified").length).toBeGreaterThanOrEqual(1); // service+可观测性+终端（阈值1）多徽章
    expect(screen.getByText("Seed")).toBeTruthy();
    expect(screen.getByText("dead")).toBeTruthy(); // gateway 零使用死词标记
    expect(screen.getByTestId("vocabulary-dim-module")).toBeTruthy();
  });

  it("阈值旋钮：变更触发 onThresholdChange（页面配置项——22:06 Master 裁决）", () => {
    const onChange = vi.fn();
    render(<VocabularyProfileSection profile={profileWith(1)} onThresholdChange={onChange} />);
    const input = screen.getByTestId("verified-threshold-input") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "5" } });
    expect(onChange).toHaveBeenCalledWith(5);
  });

  it("非法阈值输入（0/越界）不触发重取——前端防线，服务端再兜底", () => {
    const onChange = vi.fn();
    render(<VocabularyProfileSection profile={profileWith(1)} onThresholdChange={onChange} />);
    const input = screen.getByTestId("verified-threshold-input");
    fireEvent.change(input, { target: { value: "0" } });
    fireEvent.change(input, { target: { value: "100" } });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("空维度不渲染（subdomain/tag 词表为空时无对应区块）", () => {
    const { container } = render(<VocabularyProfileSection profile={profileWith(1)} onThresholdChange={vi.fn()} />);
    expect(container.querySelector('[data-testid="vocabulary-dim-subdomain"]')).toBeNull();
    expect(container.querySelector('[data-testid="vocabulary-dim-tag"]')).toBeNull();
  });

  it("阈值反映在分区标题（Verified 阈值随阈值变化展示）", () => {
    render(<VocabularyProfileSection profile={profileWith(3)} onThresholdChange={vi.fn()} />);
    // 阈值 3 时「终端」计数 1 应为 Growing（徽章存在）且描述行含阈值读数
    expect(screen.getByText(/≥3 次为 Verified，零使用为 Seed，其余为 Growing/)).toBeTruthy();
  });
});
