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

module.exports = { compileClassDerivation, projectArticleFields };
