import { SMALL_UI_COPY } from "../components-copy";
// ── ui/avatar（P3 · D10：头像基础件，收编 T11 手画 OwnerAvatar）──
// 形态：圆形＋首字符 fallback；sm＝20px（对齐 OwnerAvatar 现状），md＝24px。
// 颜色全 token（accent 淡底系）；无值时渲染占位「—」。

export type AvatarProps = {
  /** 显示者名字（取首字符）；空值渲染占位 */
  name?: string | null;
  size?: "sm" | "md";
  title?: string;
  className?: string;
};

const SIZE_CLASS = { sm: "h-5 w-5 text-[10px]", md: "h-6 w-6 text-xs" } as const;

export function Avatar({ name, size = "sm", title, className }: AvatarProps) {
  if (!name) {
    return (
      <span className={`text-kg-xs text-text-hint ${className ?? ""}`} title={title ?? SMALL_UI_COPY.AVATAR_UNASSIGNED}>
        —
      </span>
    );
  }
  return (
    <span
      data-testid="ui-avatar"
      title={title ?? name}
      aria-label={title ?? name}
      className={`grid place-items-center rounded-full bg-accent-bg font-medium text-accent-fg ring-1 ring-border-thin ${SIZE_CLASS[size]} ${className ?? ""}`}
    >
      {name.slice(0, 1)}
    </span>
  );
}
