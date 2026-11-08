import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ENTITY_CREATE_FIELDS } from "@/components/entity-repair/entity-create-fields";
import { CREATE_FIELDS } from "@/features/entity-compliance/EntityComplianceView";
import { EDITABLE } from "@/features/entity-compliance/EntityRepairDrawer";

// WP-138 R2（PR-250）：字段白名单单点化差分基线——迁移前三处白名单字面量的原样冻结抄录。
// 只作差分对照（谓词输出 ≡ 旧字面量逐字段），不是运行时源、不是第二事实源；消费方一律调谓词。
const LEGACY_COMPLIANCE_EDITABLE = [
  "title", "architecture-node-id", "arch_component", "arch_layer", "arch_category",
  "arch_subdomain", "arch_version_overrides", "module", "status", "date", "updated",
  "tags", "arch_since", "arch_until",
];
const LEGACY_REPAIR_ENTITY = [...LEGACY_COMPLIANCE_EDITABLE, "aliases"];
const LEGACY_REPAIR_ARTICLE = ["article_id", "title", "product", "version", "module", "article_type", "doc-type", "category-path", "tags", "arch_layer", "arch_category"];
const LEGACY_FRONT_EDITABLE = [...LEGACY_REPAIR_ENTITY, ...LEGACY_REPAIR_ARTICLE];

const require_ = createRequire(import.meta.url);
const fieldPolicy = require_("../../server/shared/field-policy.cjs") as {
  canEdit: (field: string, ctx?: { domain?: "entity" | "article" }) => boolean;
  canRepair: (field: string, ctx?: { domain?: "entity" | "article" }) => boolean;
  canRender: (field: string, ctx?: { domain?: "entity" | "article" }) => boolean;
  DIAGNOSIS_FIELDS: Set<string>;
  ENTITY_WRITE_FIELDS: Set<string>;
  ARTICLE_WRITE_FIELDS: Set<string>;
  RENDER_FIELDS: Set<string>;
};

function setEquals(actual: Set<string>, expected: string[]): boolean {
  const unique = new Set(expected); // 差分基线跨域合并时含重复项（并集语义），去重后比较
  return actual.size === unique.size && [...unique].every((field) => actual.has(field));
}

// seq189 P3a 等价锁：迁移前后「清单内容一字不差」由冻结字面量机器锁定；服务端权威三处保持原样，源码字面量同样锁死（漂移即红，fail-closed）。
// 2026-09-13 X3 裁决改写方向：required 单源从「锁前端字面量」改为「锁 前端 required 集 ≡ 后端 rules.json required 集」——
// 后端 rules.json 作唯一母版，前端 required 派生（原则 6）。原 MASTER_SNAPSHOT 逐字符冻结已退役（它会焊死前端母版 required 值）。

const MASTER_ORDER = [
  "title", "architecture-node-id", "arch_component", "module", "arch_layer", "arch_category", "arch_subdomain",
  "status", "date", "updated", "arch_since", "arch_until", "arch_version_overrides", "tags",
];

// 迁移前 EntityComplianceView:11 的原始字面量（旧序）；仅作内容等价对照，不再作为任何运行时源。
const LEGACY_VIEW_ORDER = [
  "title", "architecture-node-id", "arch_component", "arch_layer", "arch_category", "arch_subdomain",
  "arch_version_overrides", "module", "status", "date", "updated", "tags", "arch_since", "arch_until",
];

// 填写要求（hint）全文快照——contracts/entity-readiness-rules.json fields[*].hint 逐字段冻结。
// 升级自原「只锁非空」的弱断言：改任一字的文案都必须显式改本快照并留下变更记录（fail-closed，机器可见）。
// 快照取自契约母版，不是第二份事实源；契约改文本 → 本测试红 → 必须显式更新（即「文案漂移必须被看见」）。
const MASTER_HINTS: Record<string, string> = {
  title: "实体名称（title）是必填字段",
  "architecture-node-id": "组件身份由系统在创建时铸造，全库唯一，创建后不可修改", // WP-113 M2：身份收权——人不填，新建由唯一取号点铸造（取代 PR-229 批A 的「必填不能留空」口径）
  arch_component: "激活为架构组件必须显式设为 true",
  arch_layer: "建议填写架构分层（arch_layer）",
  arch_category: "建议填写实体类别（arch_category）",
  arch_subdomain: "建议填写子域（arch_subdomain）",
  arch_since: "语义版本，例如 7.0.0.0",
  arch_until: "语义版本，例如 8.0.0.0；长期有效可留空",
  arch_version_overrides: 'JSON 数组，例如 [{"version":"7.0.0.0","arch_layer":"service"}]',
  module: "建议填写产品模块（module）",
  status: "生命周期状态——系统托管只读（审批状态机驱动迁移）", // 2026-10-08 字段托管：hint 快照显式更新
  date: "创建日期——系统托管只读（首次创建生成，永续保留）", // 2026-10-08 字段托管
  updated: "最后更新时间——系统托管只读（每次落盘服务端 UTC 时间戳）", // 2026-10-08 字段托管
  tags: "从受管标签中选择；多个标签使用列表保存",
};

const LEGACY_EDITABLE = [...LEGACY_VIEW_ORDER, "aliases", "article_id", "product", "version", "article_type", "doc-type", "category-path"];

function readRepo(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

// 后端 required 集（唯一母版，X3 裁决；2026-10-27 降档随迁：F 族迁代码内声明——母版源随迁）
function readRulesRequiredFields(): string[] {
  const require_ = createRequire(import.meta.url);
  const { FIELD_RULES } = require_("../../server/shared/field-rule-declarations.cjs") as { FIELD_RULES: Array<{ required?: boolean; field: string }> };
  return FIELD_RULES.filter((rule) => rule.required === true).map((rule) => rule.field);
}

describe("entity fields SSOT locks (seq189 P3a)", () => {
  it("前端 required 集 ≡ 后端 rules.json required 集（X3：后端唯一母版）", () => {
    const frontendRequired = ENTITY_CREATE_FIELDS.filter((spec) => spec.required).map((spec) => spec.field);
    const backendRequired = readRulesRequiredFields();
    expect([...frontendRequired].sort()).toEqual([...backendRequired].sort());
  });

  it("CREATE_FIELDS derives from master in master order, content identical to legacy literal", () => {
    expect(CREATE_FIELDS).toEqual(MASTER_ORDER);
    expect([...CREATE_FIELDS].sort()).toEqual([...LEGACY_VIEW_ORDER].sort());
    expect(new Set(CREATE_FIELDS).size).toBe(14);
  });

  it("EDITABLE membership identical to legacy set (21; now derived from field dictionary, WP-138 R2)", () => {
    expect(EDITABLE.size).toBe(21);
    for (const field of LEGACY_EDITABLE) expect(EDITABLE.has(field)).toBe(true);
    for (const field of MASTER_ORDER) expect(EDITABLE.has(field)).toBe(true);
  });

  it("server authority whitelist literals retired — derived from field-policy (WP-138 R2 polarity flip)", () => {
    const routes = readRepo("server/routes/entity-compliance-routes.cjs");
    // 2026-09-17（#1897 缺失实体模板元数据治本）：CREATE_FIELDS 字面量退役——字段清单、中文名（label）、
    // 填写要求（hint）三者统一派生自 contracts/entity-readiness-rules.json 的 fields 段（经
    // entity-compliance-service.RULE_FIELDS 转出声明式引擎的同源读取）。锁的**强度不变、极性翻转**：
    // 原锁「必须含字面量」改为「严禁字面量、必须从声明派生」，漂移同样 fail-closed。
    expect(routes).not.toContain('var CREATE_FIELDS = ["title", "architecture-node-id"');
    expect(routes).toContain("var CREATE_FIELDS = Object.keys(svc.RULE_FIELDS || {});");
    // 等价锁：派生出的字段集必须与历史 14 项一字不差（防止声明改键名静默丢字段）
    const declaredFields = JSON.parse(readRepo("contracts/entity-readiness-rules.json")).fields as Record<string, { label?: string; hint?: string }>;
    expect(Object.keys(declaredFields).sort()).toEqual([...LEGACY_VIEW_ORDER].sort());
    // 填写要求锁：14 个字段全部声明 hint（旧实现只有 7 个有，另 7 个是纯空框）
    expect(Object.keys(declaredFields).length).toBe(14);
    // 内容锁（升级自原 toBeTruthy 非空锁）：逐字段断言 hint 全文，改文案即红、必须显式更新本快照
    expect(Object.keys(MASTER_HINTS).sort()).toEqual([...LEGACY_VIEW_ORDER].sort());
    for (const [field, hint] of Object.entries(MASTER_HINTS)) {
      expect(declaredFields[field].hint, `declared hint for ${field}`).toBe(hint);
    }
    // WP-138 R2（PR-250）：三处白名单字面量表退役，同一极性翻转——原锁「必须含字面量」改为
    // 「严禁字面量、必须从 field-policy 谓词派生」；差分等价由 field-policy predicate SSOT describe 锁死。
    const complianceService = readRepo("server/services/entity-compliance/entity-compliance-service.cjs");
    expect(complianceService).not.toContain('"architecture-node-id", "arch_component", "arch_layer"');
    expect(complianceService).toContain("fieldPolicy.DIAGNOSIS_FIELDS");
    const repairService = readRepo("server/services/entity-compliance/entity-repair-service.cjs");
    expect(repairService).toContain("fieldPolicy.ENTITY_WRITE_FIELDS");
    expect(repairService).toContain("fieldPolicy.ARTICLE_WRITE_FIELDS");
    expect(repairService).not.toContain('new Set(["article_id"');
  });

  it("hint 全文不得含引擎插值占位符（静态渲染，禁止照搬 rules.message 的 {actual} 等）", () => {
    // hint 是静态渲染的「填写要求」，不做引擎插值；rules[].message 才支持 {actual}/{expected}/{index}…
    // 历史事故：有人把 message 照搬进 hint，占位符原样透出给用户，只能靠人工截掉——此处把不变式钉死。
    // 判据：hint 里出现的每个 {...} 块都必须是可解析的 JSON 字面量（如 arch_version_overrides 的示例数组对象），
    // 凡是解析不成 JSON 的块（{actual} / {expected} / {count} …）一律判为插值占位符残留。
    const declaredFields = JSON.parse(readRepo("contracts/entity-readiness-rules.json")).fields as Record<string, { hint?: string }>;
    const offenders: string[] = [];
    for (const [field, meta] of Object.entries(declaredFields)) {
      for (const block of (meta.hint || "").match(/\{[^{}]*\}/g) || []) {
        let isJsonLiteral = false;
        try {
          const parsed = JSON.parse(block);
          isJsonLiteral = typeof parsed === "object" && parsed !== null;
        } catch (_error) { isJsonLiteral = false; }
        if (!isJsonLiteral) offenders.push(`${field} → ${block}`);
      }
    }
    expect(offenders, "hint 出现插值占位符（只允许 JSON 字面量示例块）").toEqual([]);
  });

  it("frontend copies no longer carry field-list literals (derive-only)", () => {
    const view = readRepo("src/features/entity-compliance/EntityComplianceView.tsx");
    expect(view).not.toContain('"architecture-node-id", "arch_component", "arch_layer"');
    expect(view).toContain("ENTITY_CREATE_FIELDS.map((spec) => spec.field)");
    const drawer = readRepo("src/features/entity-compliance/EntityRepairDrawer.tsx");
    expect(drawer).not.toContain('"arch_version_overrides", "module", "status", "date", "updated"');
    // seq205→WP-138 R2：EDITABLE 派生随白名单单点化再迁——从字段字典（seq209 单源 field-labels）派生，
    // 禁止字段名数组字面量回填（唯一允许的字段名字面量＝body 排除项，语义对应服务端 ARTICLE_CONTENT_FIELDS）
    const editableFields = readRepo("src/features/entity-compliance/entity-editable-fields.ts");
    expect(editableFields).toContain("Object.keys(FIELD_LABELS.entity)");
    expect(editableFields).toContain("Object.keys(FIELD_LABELS.article)");
    expect(drawer).toContain('export { EDITABLE }');
  });
});

// ── WP-138 R2（PR-250）：三消费方谓词同源断言 ──
// 升级自「锁键集」（EDITABLE.size=21＋成员枚举）：白名单字面量表退役，唯一持有方＝server/shared/field-policy.cjs
// 谓词；本锁钉两件事：
// ① 差分等价（硬验收）：谓词输出矩阵 ≡ 迁移前三处字面量逐字段（防迁移语义漂移）；
// ② 同源接线：三消费方持有的集合与谓词派生集是同一引用（消费方不得另抄一份）。
describe("field-policy predicate SSOT (WP-138 R2)", () => {
  it("差分：诊断 view ≡ 旧 compliance EDITABLE_FIELDS（14 项逐字段）", () => {
    expect(setEquals(fieldPolicy.DIAGNOSIS_FIELDS, LEGACY_COMPLIANCE_EDITABLE)).toBe(true);
    expect(fieldPolicy.DIAGNOSIS_FIELDS.size).toBe(14);
  });

  it("差分：写门·实体域 ≡ 旧 repair EDITABLE_FIELDS（15 项逐字段）", () => {
    expect(setEquals(fieldPolicy.ENTITY_WRITE_FIELDS, LEGACY_REPAIR_ENTITY)).toBe(true);
    expect(fieldPolicy.ENTITY_WRITE_FIELDS.size).toBe(15);
  });

  it("差分：写门·文章域 ≡ 旧 repair ARTICLE_EDITABLE_FIELDS（11 项逐字段）", () => {
    expect(setEquals(fieldPolicy.ARTICLE_WRITE_FIELDS, LEGACY_REPAIR_ARTICLE)).toBe(true);
    expect(fieldPolicy.ARTICLE_WRITE_FIELDS.size).toBe(11);
  });

  it("差分：渲染 view ≡ 旧前端 EDITABLE（21 项逐字段＝两域写门并集）", () => {
    expect(setEquals(fieldPolicy.RENDER_FIELDS, LEGACY_FRONT_EDITABLE)).toBe(true);
    expect(fieldPolicy.RENDER_FIELDS.size).toBe(21);
  });

  it("三 view 语义差原样保留（PR-250 错位面逐条钉死）", () => {
    // 别名：写门接受（实体域）、诊断侧不含——写门与诊断是不同 view，禁止"补齐"
    expect(fieldPolicy.canEdit("aliases")).toBe(false);
    expect(fieldPolicy.canRepair("aliases", { domain: "entity" })).toBe(true);
    expect(fieldPolicy.canRender("aliases")).toBe(true);
    // 文章域字段：诊断 view 不含（实体域诊断），文章写门接受；渲染 view 跨域可见
    expect(fieldPolicy.canEdit("article_id")).toBe(false);
    expect(fieldPolicy.canRepair("article_id", { domain: "article" })).toBe(true);
    expect(fieldPolicy.canRender("article_id")).toBe(true);
    // 正文：不是 frontmatter 修复对象——契约 article.fields 有登记但写门不收、渲染不成行
    expect(fieldPolicy.canRepair("body", { domain: "article" })).toBe(false);
    expect(fieldPolicy.canRender("body")).toBe(false);
    // 跨域不串门：文章专属键不进实体写门，实体托管键进两域写门
    expect(fieldPolicy.canRepair("doc-type", { domain: "entity" })).toBe(false);
    expect(fieldPolicy.canRepair("title")).toBe(true);
    expect(fieldPolicy.canRepair("title", { domain: "article" })).toBe(true);
    // 缺省域：canRepair 缺省实体域、canRender 缺省跨域并集（与历史前端门槛逐字段等价）
    expect(fieldPolicy.canRepair("aliases")).toBe(true);
    expect(fieldPolicy.canRender("aliases")).toBe(true);
    // 白名单外字段三 view 全拒（防御面）
    expect(fieldPolicy.canEdit("unknown-field-x")).toBe(false);
    expect(fieldPolicy.canRepair("unknown-field-x", { domain: "article" })).toBe(false);
    expect(fieldPolicy.canRender("unknown-field-x")).toBe(false);
  });

  it("派生不抄写：诊断 view ≡ 契约 fields 段键集（与路由 CREATE 分支同一段）", () => {
    const declaredFields = JSON.parse(readRepo("contracts/entity-readiness-rules.json")).fields as Record<string, unknown>;
    const contractKeys = Object.keys(declaredFields).filter((key) => !key.startsWith("$"));
    expect(setEquals(fieldPolicy.DIAGNOSIS_FIELDS, contractKeys)).toBe(true);
  });

  it("同源接线：三消费方持有的集合与谓词派生集同一引用（禁止另抄一份）", () => {
    const compliance = require_("../../server/services/entity-compliance/entity-compliance-service.cjs") as { EDITABLE_FIELDS: Set<string> };
    const repair = require_("../../server/services/entity-compliance/entity-repair-service.cjs") as { EDITABLE_FIELDS: Set<string>; ARTICLE_EDITABLE_FIELDS: Set<string> };
    expect(Object.is(compliance.EDITABLE_FIELDS, fieldPolicy.DIAGNOSIS_FIELDS)).toBe(true);
    expect(Object.is(repair.EDITABLE_FIELDS, fieldPolicy.ENTITY_WRITE_FIELDS)).toBe(true);
    expect(Object.is(repair.ARTICLE_EDITABLE_FIELDS, fieldPolicy.ARTICLE_WRITE_FIELDS)).toBe(true);
    // 前端渲染门槛与谓词渲染 view 逐字段同源（前端经字段字典派生，差分锁死漂移）
    expect(setEquals(EDITABLE, [...fieldPolicy.RENDER_FIELDS])).toBe(true);
  });
});
