// 文章全景字段中文名表（自 ArticlePanorama 拆出——组件文件只留组件）。
// seq209：字段中文名收口到 shared/field-labels.mjs（文章全景，所属域=article）。
// sourceHash / graphStatus / releaseVersion 三项不是字段名，保持字面量，见逐条理由。
import { FIELD_LABELS as SHARED_FIELD_LABELS } from "../../../../shared/field-labels.mjs";

export const ARTICLE_PANORAMA_LABELS = {
  // ── 是字段名 ──
  articleId: SHARED_FIELD_LABELS.article.article_id,
  product: SHARED_FIELD_LABELS.article.product,
  version: SHARED_FIELD_LABELS.article.version,
  // ── 不是字段名：保持字面量 ──
  // 内容哈希值，不是字段名
  sourceHash: "来源指纹",
  // 图谱流水线状态（已入图/待抽取），不是字段名
  graphStatus: "图谱状态",
  // 发布 ID 与 commit，不是字段名
  releaseVersion: "正式读取版本",
};
