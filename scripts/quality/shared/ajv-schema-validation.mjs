/**
 * ajv-schema-validation.mjs
 *
 * S120（ADR037）：Ajv draft-2020-12 schema 校验唯一入口。
 * 替换此前散落在 check-phase-acceptance / rule-admission-validation /
 * constraint-inventory-validation 三处的手写关键字子集校验器（规则 8 单源）。
 *
 * 契约：
 *   validateWithAjv(instance, schema, rootLabel) → [{ location, message, keyword, data }]
 *   - location 为点号路径（如 registry.gates[0].id），与迁移前手写校验器风格一致
 *   - message 为 legacy 风格人类可读描述，关键字段名（additional/missing property）入文
 *   - keyword 透出 Ajv 原始关键字，供调用方做错误 kind 映射（如 enum → unknown_execution_status）
 *
 * strict:false：schema 中的未知关键字/格式不阻断（与迁移前手写子集的宽容面一致）；
 * allErrors:true：一次报全，与迁移前行为一致；
 * verbose:true：错误对象携带 data，供 enum 违规消息回显实际值。
 */
import Ajv2020 from "ajv/dist/2020.js";

/**
 * 将 Ajv instancePath（JSON Pointer）转换为点号路径。
 * "/gates/0/id" → "registry.gates[0].id"；"" → rootLabel。
 */
export function toDotLocation(instancePath, rootLabel = "registry") {
  if (!instancePath) return rootLabel;
  let out = rootLabel;
  for (const rawSeg of instancePath.split("/").filter((s) => s !== "")) {
    const seg = rawSeg.replace(/~1/g, "/").replace(/~0/g, "~");
    out += /^\d+$/.test(seg) ? `[${seg}]` : `.${seg}`;
  }
  return out;
}

/**
 * 将单条 Ajv 错误映射为 { location, message, keyword, data }。
 * message 保持迁移前手写校验器的表述风格，确保既有测试与报告消费面不破。
 */
export function mapAjvError(error, rootLabel = "registry") {
  const location = toDotLocation(error.instancePath, rootLabel);
  const data = error.data;
  let message;
  switch (error.keyword) {
    case "additionalProperties": {
      const prop = error.params?.additionalProperty;
      message = `${location}.${prop} is not allowed`;
      return { location: `${location}.${prop}`, message, keyword: error.keyword, data };
    }
    case "required": {
      const prop = error.params?.missingProperty;
      // 文案含 "missing" 子串，保持 check-phase-acceptance 既有测试断言面不破
      message = `${location}.${prop} is a missing required field ("${prop}")`;
      return { location: `${location}.${prop}`, message, keyword: error.keyword, data };
    }
    case "enum": {
      const shown = typeof data === "string" ? data : JSON.stringify(data);
      message = `${location} has unsupported value "${shown}"`;
      break;
    }
    case "pattern":
      message = `${location} does not match pattern ${error.params?.pattern}`;
      break;
    case "type":
      message = `${location} must be ${error.params?.type}`;
      break;
    case "uniqueItems":
      message = `${location} must contain unique items`;
      break;
    default:
      message = `${location} ${error.message}`;
  }
  return { location, message, keyword: error.keyword, data };
}

/**
 * 模块级单例 Ajv 实例（draft-2020-12）：进程内只创建一次。
 * 选项与迁移前逐次 new 的语义完全一致——allErrors 一次报全 / strict:false 宽容未知关键字 / verbose:true 错误携带 data。
 */
const ajvInstance = new Ajv2020({ allErrors: true, strict: false, verbose: true });

/**
 * schema 对象引用 → 编译后校验函数 的 Map 缓存（Ajv 官方推荐的 compile 缓存模式）。
 * 键为 schema 对象引用，不序列化：同一 schema 对象只 compile 一次，之后直接 validate(instance)。
 */
const schemaValidateCache = new Map();

/**
 * 用 Ajv（draft-2020-12）校验 instance 对 schema 的符合性。
 * schema 编译失败（schema 本身非法）时 fail-closed 返回单条 schema-compile 错误。
 *
 * @param {*} instance - 待校验数据
 * @param {Object} schema - 已解析的 JSON Schema 对象
 * @param {string} [rootLabel] - 错误 location 的根标签（默认 "registry"）
 * @returns {Array<{ location: string, message: string, keyword: string, data: * }>}
 */
export function validateWithAjv(instance, schema, rootLabel = "registry") {
  let validate = schemaValidateCache.get(schema);
  if (!validate) {
    try {
      // 共享单例实例以 $id 为 schema 身份：同 $id 已注册时直接复用其编译后校验函数。
      // 消费方对同一 schema 文件每次读取都会得到新对象（如 readFileSync+JSON.parse），
      // 旧实现每次 new 独立实例注册表互不冲突；单例下按 $id 复用与逐次编译行为等价。
      const id = schema && (schema.$id || schema.id);
      validate = id ? ajvInstance.getSchema(id) : undefined;
      if (!validate) validate = ajvInstance.compile(schema);
    } catch (err) {
      // schema 编译失败（schema 本身非法/引用缺失/重复 $id 无法复用）fail-closed 返回单条 schema-compile 错误
      return [{
        location: rootLabel,
        message: `${rootLabel} schema failed to compile: ${err.message}`,
        keyword: "schema-compile",
        data: undefined,
      }];
    }
    schemaValidateCache.set(schema, validate);
  }
  if (validate(instance)) return [];
  return (validate.errors || []).map((e) => mapAjvError(e, rootLabel));
}
