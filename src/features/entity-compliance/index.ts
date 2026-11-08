// entity-compliance feature 公共出口：供其他 feature 读取同一份源文档检查结果。
// 写入统一提交到 Git Proposal；feature 只拥有页面交互状态。
export { fetchEntityCompliance } from "./entity-compliance-api";
export type { ComplianceFinding, EntityComplianceResult } from "./entity-compliance-types";
