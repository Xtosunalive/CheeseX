// Component: Field-Graph-Routes（SPEC-020 波 3）
// @responsible: GET /api/schema/field-graph——字段值域引用图谱只读投影（页面图谱面板数据源）。
//               每字段：值域来自哪（段地址）／怎么算（op 结构渲染的中文描述——不读 note，note 是纯人读注释会漂移）／
//               现在解析出几个合法值／别名归一表大小／缺省值／输入归一标记。
// @context: 数据单源＝fields.yaml 配方（结构）＋resolved-domains.json 解析物（值集）——零手写内容防漂移；
//           解析物缺失→503 明示（页面上「图谱暂不可用」），不降级成空表假象（fail-visible，不静默）。
const { sendJSON } = require("../shared/api-envelope.cjs");
const { logger } = require("../shared/json-logger.cjs");
const fs = require("fs");
const path = require("path");
const YAML = require("yaml");
const { resolveTheSchemaDir } = require("../shared/theschema-root.cjs");

// op → 人读描述（从结构渲染，封闭映射——op 集新增时同步这里，check 由等价性/门禁面守）
const OP_LABELS = {
  values: "列表段直取",
  keys: "对象段取键",
  ids: "词条表取 id 并集",
  tags_union: "各分组并集 − disabled_tags",
  matrix_union_fallback: "矩阵并集优先，空回落主表（ADR-006 派生视图）",
  product_closure: "A03 闭合集＝projection.product＋product_aliases＋保留产品",
  version_registry: "产品版本注册表（G1+G5）",
  free_slug: "自由小写 ASCII slug",
};

function describeRecipe(vd) {
  if (!vd || typeof vd !== "object") return "自由值（无配方）";
  if (Array.isArray(vd.composite)) {
    return vd.composite
      .map((part) => {
        if (part && part.resolve && part.resolve.op === "free_slug") return "自由段";
        const label = OP_LABELS[(part && part.resolve && part.resolve.op) || "values"] || "未知操作";
        return `${part.source || "?"}（${label}${part && part.scoped_by === "previous" ? "，随前段收窄" : ""}）`;
      })
      .join(" → ");
  }
  const op = vd.resolve && vd.resolve.op;
  const source = vd.segment || vd.source || "?";
  if (!op) return vd.source === "free" ? "自由值（无配方）" : `${source}`;
  let label = `${source}（${OP_LABELS[op] || "未知操作"}）`;
  if (op === "ids" && vd.resolve.filter === "entity_usable") label += "，仅实体可用层（entity_layer≠false）";
  if (vd.normalize && typeof vd.normalize.aliases === "string") label += `；别名经 ${vd.normalize.aliases} 归一`;
  if (vd.normalize && vd.normalize.wikilink_strip) label += "；[[X]]→X 剥离";
  if (vd.default && typeof vd.default.from === "string") label += `；缺省=${vd.default.from}（缺省回落首项）`;
  return label;
}

function register(registerRoute, deps) {
  const vaultPath = deps.vaultPath;
  const schemaDir = path.join(resolveTheSchemaDir(deps.vaultPath));
  registerRoute("GET", "/api/schema/field-graph", function (_req, res) {
    try {
      const artifactPath = path.join(schemaDir, "resolved-domains.json");
      // WP-053 V-A：在场判断改信封 present（词表 basename 从本段消失——503 语义保持）
      const { loadVocabBundle } = require("../shared/vocab-load-port.cjs");
      const fieldsState = loadVocabBundle(vaultPath, { files: ["fields"] }).files.fields.state;
      if (fieldsState !== "present") {
        return sendJSON(res, 503, { error_code: "FIELD_GRAPH_UNAVAILABLE", message: "fields 字典不存在——字段字典未落档" });
      }
      if (!fs.existsSync(artifactPath)) {
        return sendJSON(res, 503, { error_code: "FIELD_GRAPH_UNAVAILABLE", message: "resolved-domains.json 不存在——先跑 npm run project:resolved-domains" });
      }
      // WP-053 V-A：fields 经装载端口（raw＝旧裸 parse 同形；缺件 fail-closed 面——上方 existsSync 守卫已先拒）
      const { readVocabDoc } = require("../shared/vocab-load-port.cjs");
      const fieldsDoc = readVocabDoc(vaultPath, "fields", {});
      const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
      // WP-051 I-C：字段×域键经身份入口——name 含 |/, 与 scope join 交错不再撞（两侧同式构造）
      const { makeId } = require("../shared/identity-port.cjs");
      const fieldKey = (name, scope) => makeId("field-scope", [name, (Array.isArray(scope) ? scope : []).join(",")]);
      const resolvedByKey = new Map(
        (Array.isArray(artifact.byField) ? artifact.byField : []).map((row) => [fieldKey(row.name, row.scope || []), row]),
      );
      const byField = (fieldsDoc.fields || [])
        .filter((f) => f && typeof f.name === "string")
        .map((decl) => {
          const rec = resolvedByKey.get(fieldKey(decl.name, decl.scope)) || {};
          const vd = decl.value_domain;
          const hasRecipe = Boolean(vd && typeof vd === "object" && (vd.resolve || Array.isArray(vd.composite)));
          const isComposite = Boolean(vd && Array.isArray(vd.composite));
          const hasValues = Array.isArray(rec.values);
          // 红队高-2 修复：行级过期检测——配方与解析物单边存在即明示（防矛盾数据以正常表相上页）：
          // 有配方无解析行（联动漏跑）/ 无配方却粘滞旧值集（配方已删解析未重算）。
          const stale = (hasRecipe && !rec.name) || (!hasRecipe && hasValues && rec.values.length > 0);
          // 红队高-1 修复：domainKind 四态区分（此前 valueCount=null 把 真自由/复合/缺行 混译成「自由」）
          const domainKind = stale ? "stale" : isComposite ? "composite" : hasValues ? "closed" : "free";
          return {
            name: decl.name,
            label: typeof decl.label === "string" ? decl.label : decl.name,
            required: typeof decl.required === "string" ? decl.required : null,
            scope: Array.isArray(decl.scope) ? decl.scope : [],
            layer: typeof decl.layer === "string" ? decl.layer : null,
            recipe: describeRecipe(decl.value_domain),
            domainKind,
            valueCount: hasValues ? rec.values.length : null,
            aliasCount: rec.aliasMap && typeof rec.aliasMap === "object" ? Object.keys(rec.aliasMap).length : 0,
            default: rec.default !== undefined && rec.default !== null ? rec.default : null,
            composite: Array.isArray(rec.composite) ? rec.composite : null,
          };
        });
      return sendJSON(res, 200, { schema_version: 1, byField });
    } catch (e) {
      // 红队中-1 附带修复：500 不透传原始异常文本（防本地路径泄漏），细节进服务端日志
      logger.error({ event: "field-graph-get-failed", error: e.message });
      return sendJSON(res, 500, { error_code: "FIELD_GRAPH_UNAVAILABLE", message: "字段图谱读取失败（详见服务端日志）" });
    }
  });
}

module.exports = { register };
