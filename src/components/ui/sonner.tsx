import { Toaster as Sonner, toast } from "sonner";

import { useMode } from "@/hooks/use-mode";

type ToasterProps = React.ComponentProps<typeof Sonner>;

const Toaster = ({ ...props }: ToasterProps) => {
  // F4（体检收账）：toast 主题改走应用显示模式（useMode 共享 store）——
  // 原实现经 next-themes 的 useTheme 取值，但应用从未包其 ThemeProvider，
  // toast 恒跟随系统明暗；现随应用内模式切换联动（dark 档 dark，light/warm 档 light）。
  const { resolved } = useMode();

  return (
    <Sonner
      theme={resolved === "dark" ? "dark" : "light"}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-overlay",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster, toast };
