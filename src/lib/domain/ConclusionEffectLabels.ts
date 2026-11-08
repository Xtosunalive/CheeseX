// 推断冲突「采用结论」效果四词唯一声明处（WP-035/PR-150——手册 §5.7）。
// 此前 AnomalyResolutionForm 与 InferenceConflictPanel 逐字同串双份手抄（seq204 注释
// 自认「一致靠约定不靠 import」）——收编本文件，两页 import；Record 满配钉防值域漂移。
// WP-152 收官批：本文件入文案闭集（ADR-019 §三.4 仪式——eslint.config.js 尾部闭集豁免块＋
// copy-vocabulary-closed-set.test.ts CLOSED_SET_FILES 投影＋SPEC-091 §2.1），与 StatusDisplay 同为 lib/domain 标签单源。
export const EFFECT_LABELS: Record<string, string> = {
  ASSERT: "纳入正式变更处置",
  WAIVE: "豁免本次变更处置",
  BLOCK: "阻止继续并先修复来源",
  SUSPEND: "暂停并转人工复核",
};
