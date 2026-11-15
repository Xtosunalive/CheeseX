"use strict";

const { resolveClassInheritance } = require("../ontology-inheritance-resolver.cjs");

/**
 * 轻量本体派生编译器（纯函数）
 * 输入：解析后的本体、字段表、目标类ID
 * 输出：可直接消费的API路由、存储投影、UI配置
 * 同输入永远同输出，无副作用，不碰文件不连库
 */
function compileClassDerivation(ontology, fields, classId, options = {}) {
  const resolvedClass = resolveClassInheritance(ontology, classId, fields);
  const revision = options.revision || "1.0.0";
  const compiledAt = options.deterministic ? "deterministic" : Date.now();

  // 1. 派生API路由：直接取类绑定的动作，不重复定义
  const apiRoutes = resolvedClass.action_types.map((boundAction) => {
    const [method, ...pathParts] = boundAction.definition.http_route.split(" ");
    return {
      actionId: boundAction.id,
      method,
      pathTemplate: pathParts.join(" "),
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
    statusConsumptionRule: "直接消费状态接口allowed字段，页面不手写权限判断",
  };

  return {
    version: revision,
    compiledAt,
    classId,
    apiRoutes,
    storageFields,
    uiConfig,
  };
}

/**
 * 编译全量类（仅编译approved状态）
 */
function compileAllClasses(ontology, fields, options = {}) {
  const classIds = Object.keys(ontology.classes || {}).filter((id) => {
    const cls = ontology.classes[id];
    return (cls.lifecycle_status || "approved") === "approved";
  });
  return Object.fromEntries(
    classIds.map((id) => [id, compileClassDerivation(ontology, fields, id, options)])
  );
}

function registerDerivedRoutes(registerRoute, executeAction, logger = console) {
  return function (compiled) {
    let registered = 0;
    let skipped = 0;
    for (const route of compiled.apiRoutes) {
      try {
        registerRoute(route.method, route.pathTemplate, function (req, res) {
          return executeAction({
            actionId: route.actionId,
            request: req,
            reply: res,
          });
        });
        registered += 1;
      } catch (e) {
        if (e.message.includes("already declared")) {
          skipped += 1;
        } else {
          throw e;
        }
      }
    }
    logger.warn?.({ event: "derivation-route-skip-duplicate", registered, skipped });
  };
}

module.exports = {
  compileClassDerivation,
  compileAllClasses,
  registerDerivedRoutes,
};
