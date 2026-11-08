// Component: readiness-required（entity-readiness-rules.json required 段的唯一计算与写入——WP-132/ADR-015）
// @responsible: 「字典必填↔补齐契约」原为两处手写平行账（fields.yaml 语义源 × rules.json 消费契约），
//   由 check-fields-registry 第五面对账压着。本件把它变成投影：required 集＝fields.yaml 的确定性
//   函数（谓词与 checkCompletionParity 逐字同源），apply 只写 article.required 一段、其余键原样保留
//   （control/optionsKey 等仍是手写 UI 元数据）。消费方：gen-readiness-required.mjs（pre-commit 重算）
//   与 check-fields-registry.mjs 第五面（新鲜度执法＝生成器重放同语义）。
// @inputs: fields.yaml 解析后的 fields 数组；entity-readiness-rules.json 解析对象
// @outputs: computeRequired→string[]；applyRequiredToRules→{ rules, changed }
// 身份策略键（单源——原硬编于 check-fields-registry:70）：promote 自动生成占位，非字典必填，
// 但写路径 required 必须含它。生成段＝字典必填 ∪ 身份豁免，规范序（字典重排不漂移）。
export const IDENTITY_EXEMPT = new Set(["article_id"]);

export function computeRequiredFromFields(fields) {
  return (fields || [])
    .filter((f) => f && typeof f.name === "string" && f.required === "是" && Array.isArray(f.scope) && f.scope.includes("article"))
    .map((f) => f.name);
}

/** 只写 article.required 一段；返回 { rules, changed }——其余内容逐字节保留（手写 UI 元数据不动）。 */
/** 生成段＝字典必填 ∪ 身份豁免，规范序（sort）。 */
export function computeRequiredSegment(fields) {
  const set = new Set([...computeRequiredFromFields(fields), ...IDENTITY_EXEMPT]);
  return [...set].sort();
}

export function applyRequiredToRules(rules, required) {
  const next = JSON.parse(JSON.stringify(rules));
  if (!next.article || typeof next.article !== "object") {
    next.article = { required };
    return { rules: next, changed: true };
  }
  const before = JSON.stringify(next.article.required ?? null);
  next.article.required = required;
  return { rules: next, changed: before !== JSON.stringify(required) };
}
