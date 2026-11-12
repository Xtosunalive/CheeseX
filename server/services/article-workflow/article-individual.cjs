"use strict";

const { docField, parseEntityDocumentStrict } = require("../../shared/document-load-port.cjs");
const { ARTICLE } = require("../../shared/document-keys.cjs");
const { resolveClassInheritance, lifecycleOf } = require("../../shared/ontology-inheritance-resolver.cjs");
const { loadVocabBundle } = require("../../shared/vocab-load-port.cjs");

const ARTICLE_CLASS = "KnowledgeArticle";

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

// The caller selects the managed article. Identity and attributes come from its Markdown bytes.
function projectArticleIndividual(raw, ontology, fields) {
  const { doc, diagnostics } = parseEntityDocumentStrict(raw);
  const articleId = text(docField(doc, ARTICLE.articleId).value) || null;
  const individual = { articleId, classId: null, properties: {}, relations: [], errors: diagnostics };
  if (diagnostics.length || !articleId) return individual;

  const definition = ontology.node_types?.[ARTICLE_CLASS];
  if (!definition) return individual;
  // 红队P1-1：lifecycle_status 枚举外的无法解释值必须报告（lifecycleOf 抛 INVALID_LIFECYCLE_STATUS，
  // 经 assertIndividualValid 落 503 VALIDATOR_UNAVAILABLE）——不得静默视作无匹配绕过硬校验；
  // 枚举内非 approved（draft/retired 等）才按 SPEC-095 §3.0 未归类放行
  if (lifecycleOf(definition, "class", ARTICLE_CLASS) !== "approved") return individual;
  const resolved = resolveClassInheritance(ontology, ARTICLE_CLASS, fields);
  individual.classId = resolved.class_id;
  if (resolved.constraints.length) throw new Error("文章类含当前执行器未登记的约束");

  for (const [name, property] of Object.entries(resolved.data_properties)) {
    if (property.type !== "string" || Object.keys(property.binding).some((key) => key !== "required")) {
      throw new Error(`文章类字段 ${name} 含当前执行器未登记的字段类型或覆盖规则`);
    }
    const { value } = docField(doc, name);
    if ((property.binding.required && !text(value)) || (value != null && typeof value !== "string")) {
      individual.errors.push({ field: name, message: `${name} 必须是${property.binding.required ? "非空" : ""}文本` });
    } else if (value != null) {
      Object.defineProperty(individual.properties, name, { value, enumerable: true });
    }
  }

  const associations = docField(doc, "architecture_associations");
  if (associations.state === "key-absent") return individual;
  if (!Array.isArray(associations.value)) {
    individual.errors.push({ field: "architecture_associations", message: "文章关联必须是列表" });
    return individual;
  }

  const allowed = new Set(resolved.allows_relations.relation_ids);
  function addRelation(type, target) {
    if (!allowed.has(type)) {
      individual.errors.push({ field: "architecture_associations", message: `当前文章类不允许 ${type} 关系` });
      return;
    }
    individual.relations.push({ type, target });
  }

  for (const association of associations.value) {
    const componentId = text(association?.component_id);
    const product = text(association?.product);
    const version = text(association?.version_since);
    if ((!componentId && !version) || (version && !product)) {
      individual.errors.push({ field: "architecture_associations", message: "文章关联缺少组件或产品版本坐标" });
      continue;
    }
    if (componentId) addRelation("DOCUMENTS", { componentId });
    if (version) addRelation("APPLIES_TO", { product, version });
  }

  return individual;
}

function validateArticleIndividual(vaultPath, raw) {
  const { files } = loadVocabBundle(vaultPath, { files: ["ontology", "fields"] });
  for (const [name, file] of Object.entries(files)) {
    if (file.state !== "present" || !file.raw || file.degradedNodes.length) {
      throw new Error(`文章本体校验需要可用的 ${name}.yaml`);
    }
  }
  return projectArticleIndividual(raw, files.ontology.data, files.fields.data);
}

module.exports = { projectArticleIndividual, validateArticleIndividual };
