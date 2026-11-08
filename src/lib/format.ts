// ── formatDateTime（P3 · D9：时间格式化单一实现，替代 9 处多份 formatTime/displayTime）──
// 口径（决策卡 §十一裁定）：MM-DD HH:mm；无效输入原样返回（与各表现状一致）。
export function formatDateTime(input: string | number | Date): string {
  const d = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(d.getTime())) return String(input);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// ── sliceWithRest（WP-134 波0：折叠剩余数单一实现，替代散在六处的「items.length - 写死常数」）──
// 口径：limit＝本页可见上限（版式事实，留在各消费方）；rest＝被折叠条数，负值归零——
// 「其余 N／+N／等 N 项」这类文案只允许由 rest 出数，不允许再各自减一遍。
export function sliceWithRest<T>(
  items: readonly T[],
  limit: number,
): { visible: T[]; rest: number } {
  return { visible: items.slice(0, limit), rest: Math.max(0, items.length - limit) };
}
