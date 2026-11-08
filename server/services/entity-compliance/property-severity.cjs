// Component: Property-Severity
// @responsible: property-gov 组件分级单源（seq193 刀1：summary 计数与 filter 分派共用同一判定）
// @inputs: component checks 对象（六类 check 的 passed 布尔）
// @outputs: "blocker" | "warning" | "clean"
// @context: 从 property-governance-service.cjs 拆出（file-size 棘轮；分叉收敛史见 #1569）
// 收敛前分叉实证（红灯 SEQ193_SEV_CLASSIFY_DIVERGED）：buildSummary.hasBlocker 4 项含
// document_module_entity、filterResults case "blocker" 3 项漏之——同一组件（仅
// document_module_entity 失败）summary 计入 blocker 而 filter(blocker) 不显示。
// 以更全的 4 项判定为单源基准（计数/过滤一致化），行为变化=filter 补齐漏项，属修复目标。

function classifyComponentSeverity(c) {
  if (!c.missing_module.passed || !c.invalid_module.passed || !c.mount_mismatch.passed
    || (c.document_module_entity && !c.document_module_entity.passed)) return "blocker";
  if (!c.stale_property.passed || !c.format_artifact.passed) return "warning";
  return "clean";
}

module.exports = { classifyComponentSeverity };
