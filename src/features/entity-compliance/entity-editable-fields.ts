// PR-250（WP-138 R2）：字段白名单字面量表退役——渲染门槛改为从前后端共用字段字典派生
// （seq209 单源 shared/field-labels.mjs：实体域 15 键＝14 表单字段＋aliases 别名通道；文章域 11 写门键＋body）。
// 服务端唯一持有方＝server/shared/field-policy.cjs（诊断/写门/渲染三 view 谓词）；本集合＝渲染 view
// 的前端投影（两域写门并集，21 项），逐字段等价由 src/test/entity-fields-ssot.test.ts 差分锁死（漂移即红）。
// 语义口径（WP-110/D-1a 判据分离，消费点 repairable-fields.ts）：可见性＝字段 ∈ EDITABLE（受管字段一律
// 成行，含只读行）；可改性＝check.editable 能力位（服务端响应如实输出，不经本地集合）。
// 注：旧注释声称的 contracts/wordlist-projections.json + check:wordlist-projections 门禁本仓未搬运，不再作为依据。
// seq205：从 EntityRepairDrawer 迁出至共享模块——修复抽屉与计数 selector（repairable-fields.ts）共用同一渲染门槛，禁止两处各算。
import { FIELD_LABELS } from "../../../shared/field-labels.mjs";

export const EDITABLE = new Set(
  [...Object.keys(FIELD_LABELS.entity), ...Object.keys(FIELD_LABELS.article)].filter(
    (field) => field !== "body", // 正文不是 frontmatter 修复对象（服务端 field-policy ARTICLE_CONTENT_FIELDS 同语义）
  ),
);
