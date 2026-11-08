// @responsible: 将异常工作项映射到现有事实源预览、确认写回服务。
// @inputs: AnomalyIssue、人工选择、Entity/Article/Conflict 服务
// @outputs: 可确认的业务预览令牌与写回结果
// @context: Governance
// E2'b #3：ADR043 退役 graph-fact Proposal——execute 直接写回正式源
// （entityRepairService.apply 原子写回 + 乐观锁 + 备份；articleAssociationService.save 直接写回）。

const { bindErrorFactory } = require("../../shared/error-factory.cjs");
const adapterError = bindErrorFactory({ status: 400 });

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function requiredText(value, field) {
  if (typeof value !== "string" || !value.trim()) throw adapterError("ANOMALY_ACTION_INPUT_REQUIRED", `${field} 不能为空`, 400);
  return value.trim();
}

function sourceContentHash(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (value && typeof value === "object" && typeof value.contentHash === "string" && value.contentHash.trim()) return value.contentHash.trim();
  throw adapterError("ANOMALY_SOURCE_CHANGED", "来源 revision 缺少 contentHash，请刷新问题后重试", 409);
}

function createAnomalyActionAdapter(options = {}) {
  const entityRepairService = options.entityRepairService;
  const articleAssociationService = options.articleAssociationService;

  function actionFor(issue) {
    return record(issue && issue.proposedAction);
  }

  function supports(issue) {
    const action = actionFor(issue);
    if (action.type === "entity-repair") {
      return Boolean(entityRepairService?.preview && entityRepairService?.apply);
    }
    if (action.type === "entity-relation-repair") {
      return Boolean(
        entityRepairService
        && entityRepairService.preview
        && entityRepairService.apply
        && Array.isArray(action.unresolvedTargets)
        && action.unresolvedTargets.length > 0
      );
    }
    if (["article-association", "article-association-reload"].includes(action.type)) {
      return Boolean(articleAssociationService && articleAssociationService.list && articleAssociationService.preview && articleAssociationService.save);
    }
    if (action.type === "inference-review") return false;
    return false;
  }

  function previewEntity(issue, payload) {
    const action = actionFor(issue);
    const changes = record(payload && payload.changes);
    const changedFields = Object.keys(changes);
    if (changedFields.length !== 1 || (action.field && changedFields[0] !== action.field)) {
      throw adapterError("ANOMALY_ACTION_INPUT_REQUIRED", "必须且只能填写当前待处理字段", 400, { field: action.field || null });
    }
    const creatingEntity = issue.issueKind === "missing_entity";
    const repairChanges = creatingEntity
      ? { title: requiredText(changes[action.field], "实体标题") }
      : changes;
    const result = entityRepairService.preview({
      sourceKey: requiredText(action.sourceKey, "来源文件"),
      ...(creatingEntity
        ? { createIfMissing: true, initialTitle: requiredText(action.expected || action.currentValue, "实体标题") }
        : { sourceRevision: issue.expectedRevisions.sourceRevision }),
      changes: repairChanges,
    });
    return {
      accepted: true,
      adapter: "direct-apply",
      token: { previewId: result.previewId },
      summary: {
        sourceKey: result.sourceKey,
        changedFields: result.changedFields,
        beforeValues: creatingEntity
          ? { title: null }
          : { [action.field]: action.currentValue === undefined ? null : action.currentValue },
        afterValues: repairChanges,
        preCheck: result.preCheck,
        postCheck: result.postCheck,
      },
    };
  }

  function previewEntityRelation(issue, payload) {
    const action = actionFor(issue);
    const relationPatch = record(payload && payload.relationPatch);
    const operation = requiredText(relationPatch.operation, "链接处理方式");
    if (!["retarget", "remove-target"].includes(operation)) throw adapterError("ANOMALY_ACTION_INPUT_REQUIRED", "待处理问题只允许替换或移除当前旧链接", 400);
    const allowedTargets = Array.isArray(action.unresolvedTargets) ? action.unresolvedTargets : [];
    const requestedTargets = [requiredText(relationPatch.originalTarget, "无法解析的原目标")];
    if (requestedTargets.some((target) => !allowedTargets.includes(target))) throw adapterError("ANOMALY_ACTION_INPUT_REQUIRED", "待处理链接不属于当前来源检查结果", 409);
    // fail-closed：来源 contentHash 缺失/非法时阻断预览（写回前必须绑定来源 revision）
    sourceContentHash(issue.expectedRevisions.sourceRevision);
    const result = entityRepairService.preview({
      sourceKey: requiredText(action.sourceKey, "来源文件"),
      sourceRevision: issue.expectedRevisions.sourceRevision,
      relationPatch: operation === "retarget"
        ? { operation, originalTarget: requestedTargets[0], targetId: requiredText(relationPatch.targetId, "关系目标") }
        : { operation, originalTarget: requestedTargets[0] },
    });
    return {
      accepted: true,
      adapter: "direct-apply",
      token: { previewId: result.previewId },
      summary: { sourceKey: result.sourceKey, changedFields: result.changedFields, bodyPatch: result.bodyPatch, resolvedTarget: result.resolvedTarget, preCheck: result.preCheck, postCheck: result.postCheck },
    };
  }

  function previewArticle(issue, payload) {
    const action = actionFor(issue);
    const current = articleAssociationService.list();
    const expectedRevision = issue.expectedRevisions.factRevision;
    if (expectedRevision && expectedRevision !== current.revision) {
      throw adapterError("ANOMALY_SOURCE_CHANGED", "文章关联规则已变化，请刷新问题后重试", 409, { expectedRevision, currentRevision: current.revision });
    }
    const requested = action.type === "article-association-reload"
      ? { action: action.action, articleId: action.articleId, componentIds: action.componentIds, versionIds: action.versionIds }
      : { ...record(payload), articleId: action.articleId };
    const normalized = {
      action: requiredText(requested.action, "处理方式"),
      articleId: requiredText(requested.articleId, "文章"),
      componentIds: Array.isArray(requested.componentIds) ? requested.componentIds : [],
      versionIds: Array.isArray(requested.versionIds) ? requested.versionIds : [],
    };
    const result = articleAssociationService.preview(normalized);
    return {
      accepted: true,
      adapter: "direct-apply",
      token: { expectedRevision: result.fileRevision, change: normalized },
      summary: { articleTitle: result.article.title, action: result.action, added: result.added, removed: result.removed },
    };
  }

  function preview(issue, payload = {}) {
    if (actionFor(issue).type === "inference-review") {
      return { accepted: false, blocked: true, reason: "INFERENCE_DECISION_OWNER_SOURCE_REQUIRED" };
    }
    if (!supports(issue)) return { accepted: false, blocked: true, reason: "ANOMALY_ACTION_ADAPTER_NOT_CONFIGURED" };
    const action = actionFor(issue);
    if (action.type === "entity-repair") return previewEntity(issue, payload);
    if (action.type === "entity-relation-repair") return previewEntityRelation(issue, payload);
    if (["article-association", "article-association-reload"].includes(action.type)) return previewArticle(issue, payload);
    return { accepted: false, blocked: true, reason: "ANOMALY_ACTION_ADAPTER_NOT_CONFIGURED" };
  }

  function execute(issue) {
    if (actionFor(issue).type === "inference-review") {
      return { accepted: false, blocked: true, reason: "INFERENCE_DECISION_OWNER_SOURCE_REQUIRED" };
    }
    const actionPreview = record(issue && issue.actionPreview);
    if (actionPreview.accepted !== true || !actionPreview.token) return { accepted: false, blocked: true, reason: "ANOMALY_PREVIEW_TOKEN_MISSING" };
    if (actionPreview.adapter !== "direct-apply") return { accepted: false, blocked: true, reason: "ANOMALY_ACTION_ADAPTER_NOT_CONFIGURED" };
    const action = actionFor(issue);
    const token = actionPreview.token;
    if (["entity-repair", "entity-relation-repair"].includes(action.type)) {
      if (typeof entityRepairService?.apply !== "function") return { accepted: false, blocked: true, reason: "ANOMALY_ACTION_ADAPTER_NOT_CONFIGURED" };
      const applied = entityRepairService.apply({ previewId: token.previewId, confirmed: true });
      return { accepted: true, adapter: "direct-apply", result: applied };
    }
    if (["article-association", "article-association-reload"].includes(action.type)) {
      if (typeof articleAssociationService?.save !== "function") return { accepted: false, blocked: true, reason: "ANOMALY_ACTION_ADAPTER_NOT_CONFIGURED" };
      const saved = articleAssociationService.save(token.expectedRevision, token.change);
      return { accepted: true, adapter: "direct-apply", result: saved };
    }
    return { accepted: false, blocked: true, reason: "ANOMALY_ACTION_ADAPTER_NOT_CONFIGURED" };
  }

  return { supports, preview, execute };
}

module.exports = { createAnomalyActionAdapter };
