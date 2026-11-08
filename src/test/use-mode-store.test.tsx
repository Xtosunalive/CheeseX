// useMode 共享 store 回归（体检 F4 收账：Toaster 恒跟随系统明暗）
// 面覆盖：①初始挂载只落 DOM 不写存储（「用户没选过」语义保持）
// ②多消费方同源同步——A 消费方 setMode → B 消费方重渲染见新值（外部 store 升级的目的，
//   原每组件独立 useState 时 Toaster 拿不到侧栏的切换）
// ③Toaster 主题随应用模式：dark 档传 dark、light 档传 light（替代原 next-themes 恒 system）
// 层级标注：测试 1/2＝纯单元（hook 状态机）；测试 3＝Adapter 契约（sonner.tsx→sonner 组件边界 theme 透传）
import { act, fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MODE_STORAGE_KEY, useMode, type ModeKind } from "@/hooks/use-mode";

// 捕获传给 sonner 组件的 theme prop（组件边界契约——不进 sonner 内部实现）
const spy = vi.hoisted(() => ({ themes: [] as string[] }));
vi.mock("sonner", () => ({
  Toaster: (props: { theme: string }) => {
    spy.themes.push(props.theme);
    return <div data-testid="toaster-mock" data-theme={props.theme} />;
  },
  toast: () => {},
}));
import { Toaster } from "@/components/ui/sonner";

function ModeProbe({ id, target }: { id: string; target?: ModeKind }) {
  const { mode, resolved, setMode } = useMode();
  return (
    <div
      data-testid={id}
      data-mode={mode}
      data-resolved={resolved}
      onClick={() => target && setMode(target)}
    />
  );
}

describe("useMode 共享 store（体检 F4 回归）", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
    delete document.documentElement.dataset.mode;
  });

  it("初始挂载只落 DOM 不写存储（「用户没选过」不固化为显式选择）", () => {
    render(<ModeProbe id="p" />);
    // jsdom 无 matchMedia：auto 解析为 light
    expect(screen.getByTestId("p").dataset.resolved).toBe("light");
    expect(document.documentElement.dataset.mode).toBe("light");
    expect(localStorage.getItem(MODE_STORAGE_KEY)).toBeNull();
  });

  it("多消费方同源：A setMode('dark') → B 重渲染见 dark 且 DOM 落档＋持久化", () => {
    render(
      <>
        <ModeProbe id="a" target="dark" />
        <ModeProbe id="b" />
      </>,
    );
    expect(screen.getByTestId("b").dataset.mode).toBe("auto"); // 初始同源快照
    act(() => { fireEvent.click(screen.getByTestId("a")); });
    expect(screen.getByTestId("b").dataset.mode).toBe("dark"); // B 被通知重渲染
    expect(screen.getByTestId("b").dataset.resolved).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem(MODE_STORAGE_KEY)).toBe("dark");
  });

  it("Toaster 主题随应用模式（dark 档 dark；切 light 档 light——不再恒 system）", () => {
    render(
      <>
        <Toaster />
        <ModeProbe id="to-light" target="light" />
        <ModeProbe id="to-dark" target="dark" />
      </>,
    );
    const toaster = screen.getByTestId("toaster-mock");
    // 模块级 store 跨测试同文件共享：先归一化到 light（上一用例残留 dark）
    act(() => { fireEvent.click(screen.getByTestId("to-light")); });
    expect(toaster.dataset.theme).toBe("light");
    act(() => { fireEvent.click(screen.getByTestId("to-dark")); });
    expect(spy.themes[spy.themes.length - 1]).toBe("dark"); // 切 dark 档后传给 sonner 的主题
    expect(toaster.dataset.theme).toBe("dark");
  });
});
