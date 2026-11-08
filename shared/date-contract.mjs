// seq208-date-ssot：date 形状全库唯一事实源（ESM 载体，三端共用）
// 后端 node≥22 require(esm) 直吃；前端 vite 原生 import；checker 零 npm 依赖。
// 逻辑搬运自 server/shared/version-contract.cjs（DATE_PATTERN + Date.parse 真假校验组合），零新语义。
// 例外豁免：本文件是 date 形状单源定义处（eslint date selector 的豁免锚）。
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// 形状+真假双重校验：形状过 DATE_PATTERN，再以 Date.parse 锚定真实日历日期
// （拒绝 2025-13-99 等月溢出；T00:00:00Z 后缀消除时区边界漂移）。
// 已知边界（seq208 如实登记）：Date.parse 对月内日期溢出（2025-02-30）滚动放行——
// 与 version-contract 既有行为一致（零行为红线，搬运非加强）；严格 round-trip 校验属后续语义切片。
export function isValidDateString(value) {
  return (
    typeof value === "string" &&
    DATE_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(value + "T00:00:00Z"))
  );
}
