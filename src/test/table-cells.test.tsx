// ── P3 单元格件测试：Tag/StatusDot/Statistic/formatDateTime/Avatar/RowActions ──
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Tag } from "@/components/ui/tag";
import { StatusDot } from "@/components/status-dot/StatusDot";
import { Statistic } from "@/components/statistic/Statistic";
import { formatDateTime } from "@/lib/format";
import { Avatar } from "@/components/ui/avatar";
import { RowActions } from "@/components/row-actions/RowActions";
import { Trash2 } from "lucide-react";

describe("ui/tag（D6·antd 规格）", () => {
  it("五语义 tone＋规格类（px-7/行高20/圆角4px字面/字号xs）", () => {
    const { rerender } = render(<Tag tone="fact">事实</Tag>);
    const el = screen.getByTestId("ui-tag");
    expect(el.className).toContain("px-[7px]");
    expect(el.className).toContain("leading-5");
    // 收官存量清零批：--radius-xs 单消费者退役，圆角改 4px 字面（值不变）
    expect(el.className).toContain("rounded-[4px]");
    expect(el.className).toContain("bg-status-fact-2");
    rerender(<Tag tone="warn">警示</Tag>);
    expect(screen.getByTestId("ui-tag").className).toContain("text-status-warn");
    rerender(<Tag>普通</Tag>);
    expect(screen.getByTestId("ui-tag").className).toContain("ring-border-thin");
  });

  it("分类色 step 档经 className 拼接（动态类名不进 cva；WP-147 连名换装后 step 封闭类）", () => {
    render(
      <Tag className="bg-jade-12/20 text-jade-12 ring-jade-12/30">分类</Tag>,
    );
    expect(screen.getByTestId("ui-tag").className).toContain("text-jade-12");
  });
});

describe("StatusDot（D7）", () => {
  it("tone 类＋可访问名（禁令 4：不单独承载语义）", () => {
    render(<StatusDot tone="loading" label="处理中" />);
    const dot = screen.getByTestId("status-dot");
    expect(dot.getAttribute("aria-label")).toBe("处理中");
    expect(dot.className).toContain("bg-status-loading");
  });
});

describe("Statistic（D8·两旧件 API 并集）", () => {
  it("label/value/sub/tone/hint 全渲染", () => {
    render(<Statistic label="待处理" value={12} sub="较昨日 +2" tone="text-status-warn" hint="汇总口径" testId="stat-a" />);
    const card = screen.getByTestId("stat-a");
    expect(card.textContent).toContain("12");
    expect(card.textContent).toContain("待处理");
    expect(card.textContent).toContain("较昨日 +2");
    expect(card.getAttribute("title")).toBe("汇总口径");
    expect(card.querySelector(".text-status-warn")).toBeTruthy();
  });
});

describe("formatDateTime（D9·MM-DD HH:mm）", () => {
  it("补零与格式", () => {
    expect(formatDateTime(new Date(2026, 0, 5, 9, 7))).toBe("01-05 09:07");
    expect(formatDateTime("2026-10-15T18:30:00")).toMatch(/^\d{2}-\d{2} \d{2}:\d{2}$/);
  });
  it("无效输入原样返回", () => {
    expect(formatDateTime("not-a-date")).toBe("not-a-date");
  });
});

describe("Avatar（D10·收编 OwnerAvatar）", () => {
  it("首字符＋token 色＋尺寸档；空值占位", () => {
    const { rerender } = render(<Avatar name="架构组" />);
    const av = screen.getByTestId("ui-avatar");
    expect(av.textContent).toBe("架");
    expect(av.className).toContain("bg-accent-bg");
    expect(av.className).toContain("h-5 w-5");
    rerender(<Avatar name="x" size="md" />);
    expect(screen.getByTestId("ui-avatar").className).toContain("h-6 w-6");
    rerender(<Avatar name={null} />);
    expect(screen.queryByTestId("ui-avatar")).toBeNull();
    expect(screen.getByTitle("未分配").textContent).toBe("—");
  });
});

describe("RowActions（B2·配置化两型）", () => {
  it("文字钮＋图标钮渲染、右对齐容器、点击带行上下文", () => {
    const onView = vi.fn();
    const onDelete = vi.fn();
    const row = { id: "r1" };
    render(
      <RowActions
        row={row}
        actions={[
          { key: "view", label: "查看", onRun: onView },
          { key: "del", label: "删除", onRun: onDelete, icon: Trash2, danger: true },
        ]}
      />,
    );
    const group = screen.getByTestId("row-actions");
    expect(group.className).toContain("justify-end");
    expect(group.className).toContain("gap-2");
    fireEvent.click(screen.getByRole("button", { name: "查看" }));
    expect(onView).toHaveBeenCalledWith(row);
    fireEvent.click(screen.getByRole("button", { name: "删除" }));
    expect(onDelete).toHaveBeenCalledWith(row);
    expect(screen.getByRole("button", { name: "删除" }).className).toContain("text-status-error");
  });

  it("disabled 函数式按行动态禁用", () => {
    render(
      <RowActions
        row={{ id: "r2", locked: true }}
        actions={[{ key: "a", label: "动作", onRun: () => {}, disabled: (r) => r.locked }]}
      />,
    );
    expect(screen.getByRole("button", { name: "动作" })).toBeDisabled();
  });
});
