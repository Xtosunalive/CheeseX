import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { InferenceConflictPanel } from "@/features/review/components/InferenceConflictPanel";
import { useInferenceConflictStore } from "@/features/review/inference-conflict-store";
import * as api from "@/features/review/inference-conflict-api";

vi.mock("@/features/review/inference-conflict-api", () => ({
  fetchConflicts: vi.fn(),
}));

const unresolvedConflict = {
  conflictId: "conf-1",
  code: "RULES_CONFLICT" as const,
  subjectNodeId: "service:api-gateway",
  conclusionKey: "architecture-change-disposition",
  ruleIds: ["R01", "R02"],
  sourceRevision: "sha256:source",
  conclusions: [
    { ruleId: "R01", subjectNodeId: "service:api-gateway", conclusionKey: "architecture-change-disposition", effect: "ASSERT" as const, priority: 80, evidence: ["version:AnyShare:7.0.6.8"], scope: { product: "AnyShare", version: "7.0.6.8" } },
    { ruleId: "R02", subjectNodeId: "service:api-gateway", conclusionKey: "architecture-change-disposition", effect: "BLOCK" as const, priority: 100, evidence: ["article:ART-1:sha256:source"], scope: { product: "AnyShare", version: "7.0.6.8" } },
  ],
  status: "unresolved" as const,
};

describe("InferenceConflictPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useInferenceConflictStore.setState({
      conflicts: [],
      total: 0,
      statusFilter: "all",
      status: "idle",
      error: null,
      expandedIds: new Set<string>(),
    });
    vi.mocked(api.fetchConflicts).mockResolvedValue({ conflicts: [unresolvedConflict], total: 1 });
  });

  it("renders unresolved conflicts as read-only blocked evidence without write actions", async () => {
    render(<InferenceConflictPanel />);

    expect(await screen.findByText("AnyShare 7.0.6.8")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "筛选冲突状态" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "搜索规则冲突" })).toBeInTheDocument();
    ["适用范围", "处理事项", "候选结论", "状态", "采用结论"].forEach((label) => {
      expect(screen.getByRole("button", { name: `${label}排序` })).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: "刷新" })).not.toBeInTheDocument();
    expect(screen.getByText("待解决")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "展开AnyShare 7.0.6.8裁决" }));
    expect(screen.getByText("当前无权威来源可承载裁决，写入保持阻断")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "确认采用此结论" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重新打开裁决" })).not.toBeInTheDocument();
  });

  it("labels legacy resolved decisions as audit history rather than active facts", async () => {
    vi.mocked(api.fetchConflicts).mockResolvedValue({
      conflicts: [{ ...unresolvedConflict, status: "resolved", decision: { decision: "select_effect", selectedEffect: "ASSERT", selectedRuleIds: ["R01"], reasonCode: "LEGACY", sourceRevision: "sha256:source" } }],
      total: 1,
    });
    render(<InferenceConflictPanel />);
    expect(await screen.findByText("历史审计")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开AnyShare 7.0.6.8裁决" }));
    expect(screen.getByText("历史审计记录，不作为当前写入放行依据")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "重新打开裁决" })).not.toBeInTheDocument();
  });

  it("keeps filters and sortable headers visible for an empty result", async () => {
    vi.mocked(api.fetchConflicts).mockResolvedValue({ conflicts: [], total: 0 });
    render(<InferenceConflictPanel />);

    expect(await screen.findByText("暂无推理规则冲突")).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "筛选冲突状态" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "适用范围排序" })).toBeInTheDocument();
  });
});
