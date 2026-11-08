// WP-138 R5c：主题执法面豁免配置唯一声明处——ADR-016 §三判语「色板豁免名单属执法面自身配置，
// 执法面配置亦须单源」。同型缺陷判据 P6 在册（docs/plans/同型缺陷判据与确认清单-2026-10-31.md §三）：
// 本名单原两处手抄（eslint.config.js 分类色板 override ↔ check-theme-tokens.mjs EXEMPT），已不等，
// 且靠「增删两处同笔改」人工义务维系（2026-10-27 教训：canvas 色板清账批只改一侧＝另一门禁假红）。
// 收口后：增删豁免只改本文件，各执法面经 import 派生，不再各持手抄。
//
// 两份事实（键＝仓库相对路径，POSIX 斜杠；判定在归一化 relPath 上做）：
//   PALETTE_SOURCE_FILES —— 分类色板唯一源文件（色值权威定义处）。消费面：
//     ① eslint.config.js「分类色板唯一源」override（no-hardcoded-colors/no-default-palette 关停）
//     ② check-theme-tokens.mjs 文件豁免面（themeFileExemptPatterns）
//   THEME_EXEMPT_ZONES —— 基础组件合法区＋测试断言区（theme-contract.md 禁令 3 白名单）。消费面：
//     check-theme-tokens.mjs 与 check-theme-vocab.mjs 的 EXEMPT（themeExemptZonePatterns）。
export const PALETTE_SOURCE_FILES = Object.freeze([
  "src/lib/topology-types.ts",
  "src/features/schema-manager/schema-manager-types.ts",
  "src/lib/dashboard-containers.ts",
  "src/index.css",
]);

export const THEME_EXEMPT_ZONES = Object.freeze([
  "src/components/ui/",
  "src/components/aria/",
  "src/test/",
]);

// 仓库相对路径 → relPath 正则。分隔符兼容 POSIX/Windows（与两门禁既有 [\\/] 形态一致）。
const pathLiteralToRegexSource = (p) =>
  p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\//g, "[\\\\/]");

/** 基础组件/测试豁免区（前缀形态——目录及其后代整体豁免，与既有 EXEMPT 语义一致） */
export function themeExemptZonePatterns() {
  return THEME_EXEMPT_ZONES.map((z) => new RegExp(pathLiteralToRegexSource(z)));
}

/** 门禁文件豁免面＝豁免区＋色板唯一源文件（文件条目整名锚定；index.css 不在 .ts/.tsx walk 面，
 *  其 @theme/裸区执法由 check-theme-tokens 检查④⑦独立承担，不受本豁免影响）。 */
export function themeFileExemptPatterns() {
  return [
    ...themeExemptZonePatterns(),
    ...PALETTE_SOURCE_FILES.map((f) => new RegExp(`^${pathLiteralToRegexSource(f)}$`)),
  ];
}
