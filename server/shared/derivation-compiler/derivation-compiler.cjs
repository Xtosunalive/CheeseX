"use strict";

const { resolveClassInheritance } = require("../ontology-inheritance-resolver.cjs");
const { createHash } = require("node:crypto");
const { lookupRoute } = require("../contract-request-schema.cjs");
const { docField } = require("../document-load-port.cjs");

/**
 * 轻量本体派生编译器（纯函数）
 * 输入：解析后的本体、字段表、目标类ID
 * 输出：可直接消费的API路由、存储投影、UI配置
 * 同输入永远同输出，无副作用，不碰文件不连库
 */
function compileClassDerivation(ontology, fields, classId) {
  const resolvedClass = resolveClassInheritance(ontology, classId, fields);
  const version = "sha256:" + createHash("sha256")
    .update(JSON.stringify([classId, ontology, fields])).digest("hex");

  // 1. 派生API路由：直接取类绑定的动作，不重复定义
  const apiRoutes = resolvedClass.action_types.map((boundAction) => {
    const [method, template] = String(boundAction.definition.http_route ?? "").trim().split(/\s+/, 2);
    const contract = lookupRoute(method, template);
    if (!contract.inContract || !boundAction.definition.executor) {
      throw new Error(`动作 ${boundAction.id} 缺少公开 HTTP 契约或登记执行器`);
    }
    const pathTemplate = contract.path.replace(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g, ":$1");
    return {
      actionId: boundAction.id,
      method,
      pathTemplate,
      requestBody: contract.hasRequestBody,
      executor: boundAction.definition.executor,
      requiredRoles: boundAction.definition.required_roles || [],
      classId: boundAction.class_id,
    };
  });

  // 2. 派生存储投影字段：从继承来的属性取
  const storageFields = Object.entries(resolvedClass.data_properties).map(([fieldName, definition]) => ({
    fieldName,
    required: Boolean(definition.binding?.required),
    type: definition.type || "text",
    sourceClass: definition.source_class || classId,
  }));

  // 3. 派生UI配置：默认展示字段、动作消费规则
  const uiConfig = {
    classId,
    inheritanceChain: resolvedClass.inheritance_chain,
    displayFields: storageFields.map((f) => f.fieldName),
    actionIds: resolvedClass.action_types.map((a) => a.id),
  };

  return {
    version,
    classId,
    apiRoutes,
    storageFields,
    uiConfig,
  };
}

function projectArticleFields(compiled, document) {
  const values = Object.fromEntries(compiled.storageFields.flatMap(({ fieldName }) => {
    const field = docField(document, fieldName);
    return field.value === undefined ? [] : [[fieldName, field.value]];
  }));
  return { version: compiled.version, values };
}

/**
 * 生命周期转移 → 路由计划派生（Wave3 走查缺口①收口·阶段一）：
 * article-lifecycle.json 的 transitions 边（promote/publish/archive/retire）自动派生出
 * 路由计划（动作/起点态/目标态/守卫语义），替代"手动接线"。阶段一产物＝计划面（含
 * inContract 标记：契约未登记的端点显式可见，漂移不再沉默）；阶段二＝按计划安装绑定。
 * 纯函数：同输入同输出。
 */
function compileLifecycleRoutes(lifecycle) {
  const transitions = Array.isArray(lifecycle?.transitions) ? lifecycle.transitions : [];
  return transitions.map((transition) => {
    const action = String(transition.action || "");
    const canonical = `/api/articles/lifecycle/:articleId/${action}`;
    const contract = lookupRoute("POST", canonical);
    return {
      action,
      from: String(transition.from || ""),
      to: String(transition.to || ""),
      note: transition.note || null,
      routeTemplate: contract.inContract ? contract.path : canonical,
      inContract: contract.inContract === true,
      stateGuard: { from: String(transition.from || ""), to: String(transition.to || "") },
    };
  });
}

// WP-207（SPEC-100 批 1·多类推广）：全 approved 类遍历——路由计划面泛化到任意类。单类编译失败
// 降级为 error 计划（显式可见，不静默丢类）；无 data_properties／无绑定动作的类产出空计划（合法）。
function compileAllClassDerivations(ontology, fields) {
  const out = [];
  const nodeTypes = (ontology && ontology.node_types) || {};
  for (const [classId, def] of Object.entries(nodeTypes)) {
    const status = def && def.lifecycle_status === undefined ? "approved" : def.lifecycle_status;
    if (status !== "approved") continue;
    try {
      out.push(compileClassDerivation(ontology, fields || {}, classId));
    } catch (error) {
      out.push({ version: null, classId, apiRoutes: [], uiConfig: null, error: error.message });
    }
  }
  return out;
}

module.exports = { compileClassDerivation, compileAllClassDerivations, projectArticleFields, compileLifecycleRoutes };
