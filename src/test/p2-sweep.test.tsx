// P2 清扫钉（WP-035/PR-150，SPEC-037 C3）。
// 层级：纯单元——验证对象：EFFECT 四词单源满配（值域漂移/双份手抄回潮即红）。
// 删除面零引用与同物多名归一由验收 grep 承载（validation_commands）。
import { describe, expect, it } from "vitest";
import { EFFECT_LABELS } from "@/lib/domain";
import { EFFECT_LABELS as PANEL_EFFECT_LABELS } from "@/features/review/components/InferenceConflictPanel";

describe("EFFECT 四词单源（WP-035）", () => {
  it("四值满配——值域漂移即红", () => {
    expect(Object.keys(EFFECT_LABELS).sort()).toEqual(["ASSERT", "BLOCK", "SUSPEND", "WAIVE"]);
  });

  it("两页同源——InferenceConflictPanel 的 EFFECT_LABELS 即共享单源（手抄回潮即红）", () => {
    expect(PANEL_EFFECT_LABELS).toBe(EFFECT_LABELS);
  });

  it("四词全人话非空", () => {
    for (const label of Object.values(EFFECT_LABELS)) {
      expect(label.length).toBeGreaterThan(2);
    }
  });
});

// 红队瑕疵3补钉：Form 侧行为面——渲染 AnomalyResolutionForm 断言四词与共享单源一致
// （任一侧改词即红；Form 若改抄不同文案亦红——词面漂移的双向闸）
import { render, screen } from "@testing-library/react";
import { AnomalyResolutionForm } from "@/features/anomaly-workbench/components/AnomalyResolutionForm";
import type { AnomalyIssue } from "@/features/anomaly-workbench/anomaly-workbench-types";

describe("EFFECT 四词行为面（Form 渲染与单源一致）", () => {
  it("AnomalyResolutionForm 渲染的四个采用结论 = EFFECT_LABELS 单源四词", () => {
    const issue = {
      issueId: "test-1", kind: "inference_conflict", severity: "warning", status: "confirmed",
      title: "测试冲突", summary: "", selectedKeys: [],
      proposedAction: { type: "inference-review", conclusions: [
        { effect: "ASSERT" }, { effect: "WAIVE" }, { effect: "BLOCK" }, { effect: "SUSPEND" },
      ] },
    } as unknown as AnomalyIssue;
    render(<AnomalyResolutionForm issue={issue} onPreview={async () => true} />);
    for (const label of Object.values(EFFECT_LABELS)) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });
});
