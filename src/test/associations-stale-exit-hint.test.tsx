import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AssociationDecisionList } from "@/features/article-associations/components/AssociationDecisionList";

/** PR-318/WP-180：stale 行处置出口指引——出口=选中该行重走保存（设计决定见组件头注释，remove 不接线）。 */
describe("PR-318 stale 行处置出口指引", () => {
  it("stale 行在审计状态列渲染出口指引文案", () => {
    const data = {
      decisions: [
        { decisionId: "d1", articleId: "a1", action: "add", componentIds: ["c1"], versionIds: [], stale: true },
        { decisionId: "d2", articleId: "a2", action: "add", componentIds: ["c2"], versionIds: [], stale: false },
      ],
      articles: [
        { articleId: "a1", title: "文章甲" },
        { articleId: "a2", title: "文章乙" },
      ],
    };
    render(<AssociationDecisionList data={data as never} onSelect={() => {}} />);
    const hints = screen.getAllByText(/点击本行载入表单，重新指定后保存即刷新/);
    expect(hints.length).toBe(1);
    expect(screen.getAllByText(/来源内容已变化/).length).toBe(1);
  });
});
