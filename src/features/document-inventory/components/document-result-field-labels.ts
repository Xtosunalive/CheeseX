// 文档清单展示卡字段中文名表（自 DocumentResultCard 拆出——组件文件只留组件）。
// seq209：字段中文名收口到 shared/field-labels.mjs（文档清单展示卡片，所属域=article）。
// 「版本」「模块」在补齐表单里就叫「产品版本」「产品模块」，主理人对同类短名已裁定用长的，
// 故此处从字典取长名，不再自行缩略。
import { FIELD_LABELS as SHARED_FIELD_LABELS } from "../../../../shared/field-labels.mjs";

export const DOCUMENT_RESULT_FIELD_LABELS = {
  product: SHARED_FIELD_LABELS.article.product,
  version: SHARED_FIELD_LABELS.article.version,
  module: SHARED_FIELD_LABELS.article.module,
  articleType: SHARED_FIELD_LABELS.article.article_type,
  docType: SHARED_FIELD_LABELS.article["doc-type"],
};
