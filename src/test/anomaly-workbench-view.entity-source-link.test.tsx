import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AnomalyActionPreview, AnomalyResolutionForm } from "@/features/anomaly-workbench/components";
import { anomalyOverviewTarget } from "@/features/anomaly-workbench/anomaly-workbench-copy";
import type { AnomalyIssue } from "@/features/anomaly-workbench/anomaly-workbench-types";

const issue: AnomalyIssue = {
  issueId: "entity-check-1",
  issueKind: "unrecognized_entity",
  handling: "fix",
  title: "3 个目标无法解析",
  status: "previewed",
  evidence: [{ kind: "entity-compliance", path: "知识库/wiki/entities/example.md", lineNumber: null, ruleId: "B02" }],
  expectedRevisions: { sourceRevision: "sha256:source", ruleRevision: "B02" },
  blockedActions: [],
  proposedAction: { type: "entity-repair", sourceKey: "知识库/wiki/entities/example.md", field: "arch_subdomain", currentValue: null, expected: "填写有效子域", hint: "从规则配置选择子域" },
  actionPreview: {
    accepted: true,
    adapter: "entity-repair",
    token: { previewId: "write-preview-1" },
    summary: {
      sourceKey: "知识库/wiki/entities/example.md",
      changedFields: ["arch_subdomain"],
      beforeValues: { arch_subdomain: null },
      afterValues: { arch_subdomain: "architecture" },
      preCheck: { blockerCount: 1, warningCount: 3 },
      postCheck: { blockerCount: 0, warningCount: 2 },
    },
  },
  previewId: "preview-1",
  executionReady: true,
};

describe("anomaly workbench entity source link", () => {
  it("links entity anomalies to the matching source document check", () => {
    render(<AnomalyActionPreview issue={issue} />);
    fireEvent.click(screen.getByRole("button", { name: "打开源文档检查" }));
    expect(window.location.hash).toContain("#/entity-compliance?sourceKey=");
    expect(window.location.hash).toContain("example.md");
  });

  it("keeps the missing-entity property check separate from the preview source link", () => {
    const missingEntityIssue = {
      ...issue,
      issueKind: "missing_entity",
      proposedAction: {
        type: "entity-repair",
        entityId: "doc-raw-mysql",
        sourceKey: "知识库/wiki/entities/MySQL.md",
        field: "module_entity",
        currentValue: "MySQL",
      },
    } as AnomalyIssue;
    // 2026-10-07 案3 连带：anomalyOverviewTarget 的 property/checks?entityId 形态退役
    // （无生产消费方+F 项核对断裂）——行为退化为 anomalyActionTarget 直通（一键补齐）。
    expect(anomalyOverviewTarget(missingEntityIssue)?.hash).toContain("#/entity-compliance");
    expect(anomalyOverviewTarget(missingEntityIssue)?.hash).not.toContain("property/checks");
    render(<AnomalyActionPreview issue={missingEntityIssue} />);
    fireEvent.click(screen.getByRole("button", { name: "打开一键补齐" }));
    expect(window.location.hash).toContain("#/entity-compliance?sourceKey=");
    expect(window.location.hash).toContain("MySQL.md");
    expect(window.location.hash).toContain("create=1");
    // 11:0x 收编：title 参数值源=payload currentValue（golden-hash 对账）
    expect(window.location.hash).toContain("title=");
  });

  it("starts a missing entity creation preview with the module title", () => {
    const onOperate = vi.fn();
    const missingEntity = {
      ...issue,
      status: "open",
      issueKind: "missing_entity",
      previewId: undefined,
      proposedAction: { type: "entity-repair", sourceKey: "知识库/wiki/entities/MySQL.md", field: "module_entity", expected: "MySQL" },
    } as AnomalyIssue;
    render(<AnomalyResolutionForm issue={missingEntity} onPreview={onOperate} />);
    // entity-repair 已统一到工具栏弹窗
    expect(screen.getByText(/勾选问题后，用右下角悬浮操作条的「补齐字段」/)).toBeInTheDocument();
  });
});
