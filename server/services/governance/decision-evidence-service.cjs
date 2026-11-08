// @responsible: 向治理域重导出共享的无状态决策证据构建器。
// Governance re-export of the stateless decision-evidence builder.
// The builder itself is a pure construct contract living in ../shared/decision-lineage.cjs;
// governance retains write ownership of persisted decision facts elsewhere. Same-context
// governance consumers keep importing this path; analysis consumes the shared contract directly.
const { createDecisionEvidenceService } = require("../../shared/decision-lineage.cjs");

module.exports = { createDecisionEvidenceService };
