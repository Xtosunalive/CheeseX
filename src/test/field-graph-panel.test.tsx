// FieldGraphPanel 组件测试（SPEC-020 波 3）：
// ①默认折叠不取数 ②展开渲染图谱行（源→操作→值数）③接口失败明示不降级空表。
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { FieldGraphPanel } from "@/features/schema-manager/FieldGraphPanel";
import { apiFetchEnvelope } from "@/lib/api";

vi.mock("@/lib/api", () => ({
  apiFetchEnvelope: vi.fn(),
  unwrapEnvelope: vi.fn(async (request: Promise<{ ok: boolean; data?: unknown; error?: string }>, fallback: string) => {
    const envelope = await request;
    if (!envelope.ok || !envelope.data) throw new Error(envelope.error || fallback);
    return envelope.data;
  }),
}));
const mocked = vi.mocked(apiFetchEnvelope);

describe("FieldGraphPanel", () => {
  beforeEach(() => vi.clearAllMocks());

  it("默认折叠且不发起请求", () => {
    render(<FieldGraphPanel />);
    expect(mocked).not.toHaveBeenCalled();
    expect(screen.queryByTestId("field-graph-panel")).toBeInTheDocument();
  });

  it("展开后渲染图谱行：字段／配方描述／值数", async () => {
    mocked.mockResolvedValue({
      ok: true,
      data: {
      byField: [
        { name: "tags", label: "标签", required: "否", scope: ["entity", "article"], layer: "内容属性", recipe: "tags（各分组并集 − disabled_tags）；别名经 tag_aliases 归一", valueCount: 0, aliasCount: 0, default: null, composite: null },
        { name: "arch_layer", label: "架构分层", required: "是", scope: ["entity", "article"], layer: "业务属性", recipe: "layers（词条表取 id 并集，仅实体可用层）；别名经 architecture_projection.layer_aliases 归一", domainKind: "closed", valueCount: 9, aliasCount: 0, default: null, composite: null },
        { name: "category-path", label: "分类路径", required: "是", scope: ["entity", "article"], layer: "内容属性", recipe: "domains（对象段取键） → subdomains（词条表取 id 并集，随前段收窄） → 自由段", domainKind: "composite", valueCount: null, aliasCount: 0, default: null, composite: [{ source: "domains", values: ["ref"] }, { source: "subdomains", scoped: { ref: ["overview"] } }, { op: "free_slug" }] },
      ],
      },
    } as never);
    render(<FieldGraphPanel />);
    fireEvent.click(screen.getByRole("button", { name: /字段值域引用图谱/ }));
    await waitFor(() => expect(screen.getByText("tags")).toBeInTheDocument());
    expect(screen.getByText(/各分组并集 − disabled_tags/)).toBeInTheDocument();
    expect(screen.getByText("9 值")).toBeInTheDocument();
    expect(screen.getByText("0 值")).toBeInTheDocument();
    // 红队高-1：复合域渲染段结构（不再「自由」）
    expect(screen.getByText(/domains 1 值 → subdomains（随域收窄） → 自由段/)).toBeInTheDocument();
    expect(screen.queryByText(/^自由$/)).toBeNull(); // 复合行不显示孤立「自由」
    expect(mocked).toHaveBeenCalledWith("/api/schema/field-graph");
  });

  it("接口失败：明示暂不可用，不渲染空表", async () => {
    mocked.mockRejectedValue(new Error("resolved-domains.json 不存在"));
    render(<FieldGraphPanel />);
    fireEvent.click(screen.getByRole("button", { name: /字段值域引用图谱/ }));
    await waitFor(() => expect(screen.getByTestId("field-graph-error")).toBeInTheDocument());
    expect(screen.getByText(/图谱暂不可用/)).toBeInTheDocument();
    // 红队中-2：重试按钮清除错误态并重发
    mocked.mockResolvedValue({ ok: true, data: { byField: [] } } as never);
    fireEvent.click(screen.getByTestId("field-graph-retry"));
    await waitFor(() => expect(mocked).toHaveBeenCalledTimes(2));
    expect(screen.queryByTestId("field-graph-error")).toBeNull();
  });
});
