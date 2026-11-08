import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MentalPageTip } from "@/components/mental/MentalPageTip";
import { MentalToast } from "@/components/mental/MentalToast";
import { MentalWarningDialog } from "@/components/mental/MentalWarningDialog";

const { toastInfo, toastWarning } = vi.hoisted(() => ({
  toastInfo: vi.fn(),
  toastWarning: vi.fn(),
}));

vi.mock("@/components/ui/sonner", () => ({
  toast: { info: toastInfo, warning: toastWarning },
}));

describe("mental feedback components", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows toast copy supplied by the caller", () => {
    const onShown = vi.fn();
    const { rerender } = render(<MentalToast eventId={1} message="反馈一" onShown={onShown} />);
    expect(toastInfo).toHaveBeenCalledWith("反馈一", { description: undefined });
    expect(onShown).toHaveBeenCalledOnce();

    rerender(<MentalToast eventId={2} message="反馈二" tone="warning" />);
    expect(toastWarning).toHaveBeenCalledWith("反馈二", { description: undefined });
  });

  it("renders a lightweight page tip", () => {
    render(<MentalPageTip>只读提示</MentalPageTip>);
    expect(screen.getByTestId("mental-page-tip")).toHaveTextContent("只读提示");
  });

  it("requires confirmation before running a high-risk action", () => {
    const onConfirm = vi.fn();
    render(
      <MentalWarningDialog
        trigger={<button type="button">打开确认</button>}
        title="确认操作"
        description="操作说明"
        confirmLabel="继续"
        cancelLabel="取消"
        onConfirm={onConfirm}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "打开确认" }));
    expect(screen.getByRole("alertdialog")).toHaveTextContent("操作说明");
    fireEvent.click(screen.getByRole("button", { name: "继续" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
