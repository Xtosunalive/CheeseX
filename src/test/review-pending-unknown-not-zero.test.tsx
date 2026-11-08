// WP-134 波2 假零拆除的视图级钉（合同 coverage 最后一条待补项）：`useReviewPendingCount()` 的 null
// 是 store 初值（src/lib/review-data-store.ts:18）＝还没取到数，旧写法 `?? 0` 会让「未知」在标签为
// 「全部待审核关系总数」的主视觉卡上显示成 0——真零与未知同形，运营者无从分辨。
// 本钉两态：未加载→「—」；真零→「0」（负断言配正对照，防「一律隐藏」把真零也吃掉）。
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const { holder } = vi.hoisted(() => ({ holder: { pendingCount: null as number | null } }));

vi.mock("@/lib/review-data-store", () => ({
  useReviewPendingCount: () => holder.pendingCount,
  useReviewStore: (selector: (state: { load: () => void; pendingCount: number | null }) => unknown) =>
    selector({ load: () => {}, pendingCount: holder.pendingCount }),
}));
vi.mock("@/lib/topology-store", () => ({ useLoadTopology: () => vi.fn() }));
vi.mock("@/features/review/EdgeReviewPanel", () => ({ EdgeReviewPanel: () => <div data-testid="panel-edges" /> }));
vi.mock("@/features/review/components/InferenceConflictPanel", () => ({
  InferenceConflictPanel: () => <div data-testid="panel-conflicts" />,
}));
vi.mock("@/features/review/AuditLogPanel", () => ({ AuditLogPanel: () => <div data-testid="panel-audit" /> }));

import { ReviewView } from "@/features/review/ReviewView";

function pendingCard(): HTMLElement {
  const card = screen.getAllByTestId("statistic").find((el) => el.textContent?.includes("待审核关系"));
  if (!card) expect.fail("「待审核关系」主视觉卡未渲染");
  return card;
}

describe("ReviewView 待审核关系数（未知≠真零）", () => {
  it("未加载（store 初值 null）＝「—」，不显示 0", () => {
    holder.pendingCount = null;
    render(<ReviewView />);
    expect(pendingCard().textContent).toContain("—");
    expect(pendingCard().textContent).not.toContain("0");
  });

  it("后端真报 0＝显示 0，不隐藏也不显示「—」", () => {
    holder.pendingCount = 0;
    render(<ReviewView />);
    expect(pendingCard().textContent).toContain("0");
    expect(pendingCard().textContent).not.toContain("—");
  });
});
