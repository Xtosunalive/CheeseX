// @tests: RelationsEditor——关系实例账编辑器（批13 后纯账面；出链/反链查询已迁 data-dashboard LocalGraph）。
// 层级：纯单元（fetch stub，验证对象＝组件与 edge-api 契约的对接行为，非后端本身——后端由
//   relations-routes/edge-routes 测试覆盖）。术语纪律：TERM 消费、无自造词。
import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { RelationsEditor } from "@/features/schema-manager/RelationsEditor";
import { TERM } from "@/constants/term-const";

const BUNDLE = {
  relations: [
    { source: "知识本体", target: "关系类型", type: "containment", note: "D3", asserted_by: "human", asserted_at: "2026-10-24" },
  ],
  revision: "sha256:abc",
  objectOptions: ["知识本体", "关系类型", "字段字典"],
  typeOptions: ["containment", "reference"],
};

function stubFetch(handler: (input: string, init?: RequestInit) => unknown) {
  const calls: Array<{ input: string; init?: RequestInit }> = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ input: url, init });
    const payload = handler(url, init);
    return new Response(JSON.stringify(payload), { status: 200, headers: { "Content-Type": "application/json" } });
  });
  vi.stubGlobal("fetch", fn);
  return { fn, calls };
}

beforeEach(() => { vi.unstubAllGlobals(); });

describe("RelationsEditor（阶段4 前端面板）", () => {
  it("实例账加载渲染：选项集单源下拉＋行可见＋身份说明", async () => {
    stubFetch((url) => url.includes("/api/schema/relations") ? { success: true, data: BUNDLE } : { success: true, data: { edges: [], count: 0, freshness: null } });
    render(<RelationsEditor />);
    await waitFor(() => expect(screen.getByLabelText("治理关系实例表")).toBeTruthy());
    expect(screen.getByText("知识本体")).toBeTruthy();
    expect(screen.getByText("containment")).toBeTruthy();
    expect(screen.getByText(/共 1 条/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /删除这条治理关系/ })).toBeTruthy();
  });

  it("新增行进入草稿、保存走 PUT 全量＋revision 乐观锁", async () => {
    const { calls } = stubFetch((url, init) => {
      if (url.includes("/api/schema/relations") && init?.method === "PUT") {
        return { success: true, data: { success: true, relations: [], revision: "sha256:new", objectOptions: BUNDLE.objectOptions, typeOptions: BUNDLE.typeOptions } };
      }
      return { success: true, data: BUNDLE };
    });
    render(<RelationsEditor />);
    await waitFor(() => expect(screen.getByLabelText("治理关系实例表")).toBeTruthy());
    await fireEvent.click(screen.getByRole("button", { name: new RegExp(TERM.ADD_ACTION) }));
    await waitFor(() => expect(screen.getByRole("button", { name: /保存全部/ })).toBeTruthy());
    await fireEvent.click(screen.getByRole("button", { name: /保存全部/ }));
    const put = await waitFor(() => calls.find((c) => c.input.includes("/api/schema/relations") && c.init?.method === "PUT"));
    expect(put).toBeTruthy();
    const body = JSON.parse(String(put?.init?.body));
    expect(body.revision).toBe("sha256:abc");
    expect(body.relations).toHaveLength(2);
    expect(body.relations[1]).toMatchObject({ source: "知识本体", asserted_by: "human" });
  });

});

