// PR-250（WP-138 R2）：字段白名单字面量表退役——渲染门槛改为从字段字典派生。
// WP-187：派生面上移——EDITABLE 改从构建期生成物 src/lib/generated/field-view.ts 的 RENDER_KEYS 派生
// （键域×标签在生成器单点装配：键域活算自 server/shared/field-policy.cjs，标签取 seq209 单源
// shared/field-labels.mjs；前端不再直连标签单源，eslint no-restricted-imports 执法）。
// 服务端唯一持有方＝server/shared/field-policy.cjs（诊断/写门/渲染三 view 谓词）；生成键集与谓词活算的
// 逐字段等价由 src/test/entity-fields-ssot.test.ts 差分锁死（漂移即红）。
// 语义口径（WP-110/D-1a 判据分离，消费点 repairable-fields.ts）：可见性＝字段 ∈ EDITABLE（受管字段一律
// 成行，含只读行）；可改性＝check.editable 能力位（服务端响应如实输出，不经本地集合）。
// 注：旧注释声称的 contracts/wordlist-projections.json + check:wordlist-projections 门禁本仓未搬运，不再作为依据。
// seq205：从 EntityRepairDrawer 迁出至共享模块——修复抽屉与计数 selector（repairable-fields.ts）共用同一渲染门槛，禁止两处各算。
import { RENDER_KEYS } from "@/lib/generated/field-view";

// RENDER_KEYS＝两域写门并集（21 项），正文 body 本就不在写门键域（服务端 ARTICLE_CONTENT_FIELDS
// 同语义）——原「并集后滤 body」的前端过滤随派生面上移退役，语义由生成器键域保证。
export const EDITABLE = new Set<string>(RENDER_KEYS);
