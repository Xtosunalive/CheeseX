// action-routing 豁免/待定理由声明串单源（WP-150 散写销账增量）——闭集文件（ADR-019 §三.4 仪式入册）。
// 独立于 anomaly-workbench-copy.ts 成文件的唯一原因：ACTION_ROUTING 在模块初始化期即读这些串，
// 若住 copy 模块会形成 copy↔action-routing 双向值依赖（vitest 以 copy 为入口时 TDZ 红，
// 2026-11-08 实测 29 个测试文件装载失败）；本文件是零 import 叶子，action-routing 单向取值。
// 机器审计面声明串，非用户可见文案；改值须与 scripts/quality/check-action-routing.mjs 对账口径两处同步。

export const ANOMALY_ROUTING_REASONS = {
  missing_lineage: "修复本体在关系审核页（approved 边 owner 来源写回），生效在发布链——DerivedGraphRepairPanel 四步流承载",
  stale_source: "历史审计状态，无可执行动作（registry 原注释）",
  standardization_warning: "非阻断提示（issueExplanation:133「不阻断文章成为标准文章或进入检索阅读」+ issueImpactText 返回 null）——无处理动作，按钮不应出现",
  release_publication_failure: "持久 Issue 专用面板（AnomalyDecisionPanel:22-46）：关闭/重开 + 故障消息 + 三态说明；系统保持上一合法 Release",
} as const;
