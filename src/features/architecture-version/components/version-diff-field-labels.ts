// 版本对比字段中文名表（自 VersionComponentDiff 拆出——组件文件只留组件）。
// seq209：字段中文名收口到 shared/field-labels.mjs。
// change.field 的取值集合由 architecture-version-service.cjs:183 的组件四键（label/layer/category/role）
// 与 :185 的文章三键（articleId/title/sourcePath）决定，下面逐个登记：属于字段名的从字典派生，
// 不是字段名的保持字面量并写明理由（免得后人当成漏网之鱼又改回去）。
import { FIELD_LABELS as SHARED_FIELD_LABELS } from "../../../../shared/field-labels.mjs";

export const VERSION_DIFF_FIELD_LABELS: Record<string, string> = {
  // ── 是字段名 ──
  // 服务端 :24 为 raw.layer || raw.arch_layer（同一字段两种写法）→ 字典实体域 arch_layer
  layer: SHARED_FIELD_LABELS.entity.arch_layer,
  // 服务端 :25 为 raw.category || raw.arch_category → 字典实体域 arch_category
  category: SHARED_FIELD_LABELS.entity.arch_category,
  // 文章域 title，字典为「标题」（原写「文章标题」是手抄偏差）
  title: SHARED_FIELD_LABELS.article.title,
  // 文章域 article_id，字典为「文章标识」（原写「文章身份」是别处已修、此处的残留）
  articleId: SHARED_FIELD_LABELS.article.article_id,
  // ── 不是字段名：保持字面量 ──
  // 服务端 :23 为 raw.label || raw.name || raw.title 三选一合成，不是单一字段
  label: "名称",
  // 源头 arch_role 未在 Vault 的 schema / enums / ontology 登记，且实时投影下该列恒为空（疑似独立问题，本次不动）
  role: "架构职责",
  // 文件路径（document-source-scanner.cjs:105），不是字段名
  sourcePath: "来源文档",
};
