import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FIELD_LABELS, fieldLabel } from "../../shared/field-labels.mjs";
import { FIELD_LABELS as GENERATED_FIELD_LABELS, fieldLabel as generatedFieldLabel } from "@/lib/generated/field-view";
import { ENTITY_CREATE_FIELDS } from "@/components/entity-repair/entity-create-fields";
import { REPAIR_FIELD_DEFS } from "@/components/entity-repair/entity-repair-field-model";
import { VERSION_DIFF_FIELD_LABELS } from "@/features/architecture-version/components/version-diff-field-labels";
import { DOCUMENT_RESULT_FIELD_LABELS } from "@/features/document-inventory/components/document-result-field-labels";
import { ARTICLE_PANORAMA_LABELS } from "@/features/document-inventory/components/article-panorama-labels";

// seq209 字段中文名单源锁（前后端收敛到一份：shared/field-labels.mjs）。
// 五条锁：
// L1 配置侧（contracts/entity-readiness-rules.json fields[*]）**不得再出现中文名**——
//    字段中文名的唯一来源是 shared/field-labels.mjs 的实体域字典（seq210：契约侧已去 label，只留 hint）。
//    故锁的极性从「两边断言相等」翻转为「契约侧出现 label 即红」（防回潮，fail-closed）。
// L1b 主理人裁定：文章域中文名**不**落在 contracts——article.fields 段只能有表单形状
//    （control/required/optionsKey）+ 键序，出现 label 即红。
// L2 消费方（B/C/D/E/F/G/H + 从 D 派生的两个展示组件）不得再出现任何字段中文字面量——防新增立法。
// L3 运行时取值：实体域 title/arch_component 与文章域 title 互不相同（域分段语义本身被锁住）。
// L4 前端派生结果 ≡ 单源。

function readRepo(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

const ALL_LABELS: string[] = [...new Set([...Object.values(FIELD_LABELS.entity), ...Object.values(FIELD_LABELS.article)])];

// L5 必须逐项覆盖的九个标签（主理人指定的收尾范围）。
const COVERED_LABELS = ["架构分层", "实体类别", "标题", "文章标识", "产品", "产品版本", "产品模块", "知识文章类型", "文档类型"];

// L2 的受管文件清单：已收口的消费方（B/C/D/E/F + G/H）+ 从 D 派生的两个展示组件。
// A（contracts/entity-readiness-rules.json）不在清单内——它是配置侧权威，由 L1/L1b 锁。
const GUARDED_FILES = [
  "src/components/entity-repair/entity-create-fields.ts",
  "src/components/entity-repair/entity-repair-field-model.ts",
  "src/features/anomaly-workbench/anomaly-workbench-copy.ts",
  "src/lib/domain/entity-repair-api.ts",
  "src/features/entity-compliance/PropertyCheckRow.tsx",
  "src/features/entity-compliance/EntityRepairDrawer.tsx",
  "src/components/entity-repair/managed-article-field-helpers.ts"  /* F5 拆分后 CandidateFieldForm 的 label 派生经此转出 */,
  "server/services/article-workflow/article-workflow-service.cjs",
  "server/services/article-workflow/article-compliance-service.cjs",
  // seq209 收尾批：考古确认确属字段名的最后三个页面
  "src/features/architecture-version/components/VersionComponentDiff.tsx",
  "src/features/document-inventory/components/DocumentResultCard.tsx",
  "src/features/document-inventory/components/ArticlePanorama.tsx",
];

// 文章域字典显式键集（不写条目数——条目数会随新增字段变动而误红，键集才表达「多了/少了谁」）。
const ARTICLE_KEY_SET = [
  "title", "article_id", "product", "version", "module", "article_type", "doc-type", "category-path", "arch_layer", "arch_category", "tags", "body",
];
// 契约 article.fields 中声明了 control 的 = Web 可补齐字段（渲染顺序 = 键序，勿重排；
// PR-151：arch_layer/arch_category 入列——字典必填两字段开 Web 补齐）。
const WEB_COMPLETABLE_FIELDS = ["title", "product", "version", "module", "article_type", "doc-type", "category-path", "arch_layer", "arch_category", "tags"];

describe("field labels SSOT locks (seq209)", () => {
  it("L1 契约侧不得再出现字段中文名（防回潮：fields[*] 只留填写要求 hint）", () => {
    const declared = JSON.parse(readRepo("contracts/entity-readiness-rules.json")).fields as Record<string, Record<string, unknown>>;
    const declaredKeys = Object.keys(declared);
    expect(declaredKeys.length).toBe(14);
    // 键集一致（展示名单不多不少，仍等于 shared 实体域去掉 aliases）
    expect([...declaredKeys].sort()).toEqual(Object.keys(FIELD_LABELS.entity).filter((key) => key !== "aliases").sort());
    for (const key of declaredKeys) {
      const meta = declared[key];
      // 防回潮：中文名唯一来源是 shared/field-labels.mjs 的实体域字典，契约里再出现 label 即第二源
      expect(Object.keys(meta), `fields.${key} 出现禁用键（label 不得在此）`).not.toContain("label");
      for (const shapeKey of Object.keys(meta)) {
        // 2026-10-08 字段托管：system/control/managedBy 为托管声明键（control=readonly-system 表单只读派生），合法成员
        expect(["hint", "system", "control", "managedBy"], `fields.${key} 出现非「填写要求/托管声明」键`).toContain(shapeKey);
      }
    }
  });

  it("L1b 文章域中文名不落 contracts：article.fields 只留表单形状，label 字段禁用", () => {
    const articleFields = JSON.parse(readRepo("contracts/entity-readiness-rules.json")).article.fields as Record<string, Record<string, unknown>>;
    const keys = Object.keys(articleFields).filter((key) => key !== "$comment");
    // 键集与键序（键序 = 补齐表单渲染顺序；PR-151：arch 两字段插分类簇尾、tags 前）
    expect(keys).toEqual(["title", "article_id", "product", "version", "module", "article_type", "doc-type", "category-path", "arch_layer", "arch_category", "tags", "body"]);
    for (const key of keys) {
      const meta = articleFields[key];
      // 裁定落点：中文名唯一来源是 shared/field-labels.mjs 的文章域字典，契约里再出现 label 即第二源
      expect(Object.keys(meta), `article.fields.${key} 出现禁用键（label 不得在此）`).not.toContain("label");
      for (const shapeKey of Object.keys(meta)) {
        expect(["control", "required", "optionsKey"], `article.fields.${key} 出现非表单形状键`).toContain(shapeKey);
      }
    }
    // 声明了 control 的十个才是 Web 可补齐字段（article_id/body 只占位登记；PR-151：arch 两字段入列）
    expect(keys.filter((key) => Boolean(articleFields[key].control))).toEqual(WEB_COMPLETABLE_FIELDS);
    // 文章域字典覆盖契约里登记的全部字段（含只占位的 article_id / body）
    expect(Object.keys(FIELD_LABELS.article).sort()).toEqual([...ARTICLE_KEY_SET].sort());
  });

  it("L2 消费方文件不再持有任何字段中文字面量（防新增立法）", () => {
    for (const file of GUARDED_FILES) {
      const source = readRepo(file);
      for (const label of ALL_LABELS) {
        expect(source.includes(`"${label}"`), `${file} 出现字段中文字面量「${label}」，须改从派生面 src/lib/generated/field-view 取`).toBe(false);
      }
    }
  });

  it("L2b 收口的消费方确实接上了取值链（防止「删了字面量但没接上」）", () => {
    // WP-187 消费面收口后链路分两段：前端 页面→派生面 src/lib/generated/field-view（生成器装配 seq209 单源）；
    // 服务端 直引 shared（服务端消费面不收口，本测试锁其直引锚不变）。
    // 前端八处：B entity-create-fields / E entity-repair-field-model / C anomaly-workbench-copy /
    // D entity-repair-api / F5 managed-article-field-helpers（CandidateFieldForm 的 label 派生经此转出）＋
    // seq209 收尾批三个 label 模块（页面→label 模块→派生面→生成器→shared 链不断）。
    for (const file of ["src/components/entity-repair/entity-create-fields.ts", "src/components/entity-repair/entity-repair-field-model.ts", "src/features/anomaly-workbench/anomaly-workbench-copy.ts", "src/lib/domain/entity-repair-api.ts", "src/components/entity-repair/managed-article-field-helpers.ts", "src/features/architecture-version/components/version-diff-field-labels.ts", "src/features/document-inventory/components/document-result-field-labels.ts", "src/features/document-inventory/components/article-panorama-labels.ts"]) {
      expect(readRepo(file), file).toContain("@/lib/generated/field-view");
    }
    // 服务端两处直引 shared（服务端是单源的合法消费面）
    for (const file of ["server/services/article-workflow/article-workflow-service.cjs", "server/services/article-workflow/article-compliance-service.cjs"]) {
      expect(readRepo(file), file).toContain("shared/field-labels.mjs");
    }
    expect(readRepo("src/features/entity-compliance/PropertyCheckRow.tsx")).toContain("entity-repair-api");
    expect(readRepo("src/features/entity-compliance/EntityRepairDrawer.tsx")).toContain("entity-repair-api");
    // F 的表单形状仍从契约派生（裁定：形状归契约、中文名归 shared，两者不混装）
    expect(readRepo("server/services/article-workflow/article-workflow-service.cjs")).toContain("contracts/entity-readiness-rules.json");
    // WP-187 边界执法在位：eslint 对 src/** 禁直连 shared/field-labels（规则被摘即红）
    expect(readRepo("eslint.config.js")).toContain("**/shared/field-labels.mjs");
    // 派生面链路源头在位：生成物头声明（生成器通道被旁路/手改即红）
    expect(readRepo("src/lib/generated/field-view.ts")).toContain("Generated by scripts/generate-field-view.mjs. Do not edit by hand.");
  });

  it("L3 域分段语义：实体域 title/arch_component 与文章域取值互不相同", () => {
    expect(FIELD_LABELS.entity.title).toBe("实体名称");
    expect(FIELD_LABELS.article.title).toBe("标题");
    expect(FIELD_LABELS.entity.arch_component).toBe("激活为架构组件");
    expect(FIELD_LABELS.article.article_id).toBe("文章标识");
    // 缺省域序：entity → article
    expect(fieldLabel("title")).toBe("实体名称");
    expect(fieldLabel("arch_component")).toBe("激活为架构组件");
    expect(fieldLabel("article_id")).toBe("文章标识");
    expect(fieldLabel("body")).toBe("正文");
    // 显式域
    expect(fieldLabel("title", "article")).toBe("标题");
    expect(fieldLabel("title", "entity")).toBe("实体名称");
    // 未登记字段回字段名本身（不吞信息）
    expect(fieldLabel("not_a_field")).toBe("not_a_field");
    expect(fieldLabel("")).toBe("");
  });

  it("L4 前端派生结果 ≡ 单源（ENTITY_CREATE_FIELDS / REPAIR_FIELD_DEFS 的 label 全部来自 shared）", () => {
    for (const spec of ENTITY_CREATE_FIELDS) {
      expect(spec.label, `ENTITY_CREATE_FIELDS.${spec.field}`).toBe(FIELD_LABELS.entity[spec.field]);
    }
    for (const def of REPAIR_FIELD_DEFS) {
      const expected = def.group === "article" ? FIELD_LABELS.article[def.field] : FIELD_LABELS.entity[def.field];
      expect(def.label, `REPAIR_FIELD_DEFS.${def.field}`).toBe(expected);
    }
  });

  // L5 派生值断言锁（补 L2 的 fail-open 缺口）：
  // L2 的判定是 source.includes(`"${label}"`)——只比对「字典值 + 英文双引号」；
  // 而这批收尾页面的中文写在 **JSX 文本节点里、不带英文双引号**，L2 抓不到它们（假绿、危险方向）。
  // 所以只把文件塞进 GUARDED_FILES 不够，必须逐项断言「页面取值 ≡ 字典派生值」。
  it("L5 收尾三页面的标签 ≡ 字典派生值（堵住 L2 抓不到 JSX 文本节点的 fail-open）", () => {
    // ① VersionComponentDiff：layer/category 是页面短写法，字典正式键名为 arch_layer / arch_category
    expect(VERSION_DIFF_FIELD_LABELS.layer, "VersionComponentDiff.layer").toBe(FIELD_LABELS.entity.arch_layer);
    expect(VERSION_DIFF_FIELD_LABELS.category, "VersionComponentDiff.category").toBe(FIELD_LABELS.entity.arch_category);
    expect(VERSION_DIFF_FIELD_LABELS.title, "VersionComponentDiff.title").toBe(FIELD_LABELS.article.title);
    expect(VERSION_DIFF_FIELD_LABELS.articleId, "VersionComponentDiff.articleId").toBe(FIELD_LABELS.article.article_id);
    // ② DocumentResultCard：五个全部来自文章域
    expect(DOCUMENT_RESULT_FIELD_LABELS.product, "DocumentResultCard.product").toBe(FIELD_LABELS.article.product);
    expect(DOCUMENT_RESULT_FIELD_LABELS.version, "DocumentResultCard.version").toBe(FIELD_LABELS.article.version);
    expect(DOCUMENT_RESULT_FIELD_LABELS.module, "DocumentResultCard.module").toBe(FIELD_LABELS.article.module);
    expect(DOCUMENT_RESULT_FIELD_LABELS.articleType, "DocumentResultCard.articleType").toBe(FIELD_LABELS.article.article_type);
    expect(DOCUMENT_RESULT_FIELD_LABELS.docType, "DocumentResultCard.docType").toBe(FIELD_LABELS.article["doc-type"]);
    // ③ ArticlePanorama：文章标识 + 产品/产品版本（合并格子的两半各自派生）
    expect(ARTICLE_PANORAMA_LABELS.articleId, "ArticlePanorama.articleId").toBe(FIELD_LABELS.article.article_id);
    expect(ARTICLE_PANORAMA_LABELS.product, "ArticlePanorama.product").toBe(FIELD_LABELS.article.product);
    expect(ARTICLE_PANORAMA_LABELS.version, "ArticlePanorama.version").toBe(FIELD_LABELS.article.version);
    // 覆盖范围自检：九个指定标签一个不落
    const covered = new Set<string>([
      VERSION_DIFF_FIELD_LABELS.layer, VERSION_DIFF_FIELD_LABELS.category,
      VERSION_DIFF_FIELD_LABELS.title, VERSION_DIFF_FIELD_LABELS.articleId,
      DOCUMENT_RESULT_FIELD_LABELS.product, DOCUMENT_RESULT_FIELD_LABELS.version,
      DOCUMENT_RESULT_FIELD_LABELS.module, DOCUMENT_RESULT_FIELD_LABELS.articleType,
      DOCUMENT_RESULT_FIELD_LABELS.docType,
    ]);
    for (const label of COVERED_LABELS) {
      expect(covered.has(label), `九个指定覆盖标签缺「${label}」`).toBe(true);
    }
  });

  // L6 非字段名登记：以下六项对应的东西压根不是「字段名」，本规则不适用它们，页面保持字面量。
  // 这里**不做值断言**——否则以后改一句普通页面文案都会被无端报错，把有用的立法变成噪音。
  // 只锁反向一条：它们都不在字典值集合内。一旦有人把某项改成字典里已登记的字段名，本锁即红，
  // 提示应转为从字典派生（fail-closed 方向）。
  it("L6 非字段名豁免项确实不是字段名（仅登记，不锁值）", () => {
    const NON_FIELD_LABELS: Record<string, string> = {
      // 组件名三选一合成（label || name || title），不是单一字段
      "VersionComponentDiff.label": VERSION_DIFF_FIELD_LABELS.label,
      // 源头 arch_role 未在 Vault 的 schema / enums / ontology 登记，且实时投影下该列恒为空（独立问题，本次不动）
      "VersionComponentDiff.role": VERSION_DIFF_FIELD_LABELS.role,
      // 文件路径，不是字段名
      "VersionComponentDiff.sourcePath": VERSION_DIFF_FIELD_LABELS.sourcePath,
      // 内容哈希值
      "ArticlePanorama.sourceHash": ARTICLE_PANORAMA_LABELS.sourceHash,
      // 图谱流水线状态（已入图/待抽取）
      "ArticlePanorama.graphStatus": ARTICLE_PANORAMA_LABELS.graphStatus,
      // 发布 ID 与 commit
      "ArticlePanorama.releaseVersion": ARTICLE_PANORAMA_LABELS.releaseVersion,
    };
    for (const [key, value] of Object.entries(NON_FIELD_LABELS)) {
      expect(ALL_LABELS.includes(value), `${key} =「${value}」已属于字段名，应改为从字典派生`).toBe(false);
    }
  });

  // L7 生成物 ≡ 单源（WP-187 派生面差分锁）：前端消费的 src/lib/generated/field-view.ts 必须与
  // shared/field-labels.mjs 逐键同值、fieldLabel 同语义。漂移（手改生成物／源变更未再生）即红——
  // gen:field-view --check（check-derivation-sync 注册表纳管）是构建期同款锁，本测试是测试期冗余备份。
  it("L7 派生面 ≡ 单源：生成物两域字典逐键同值、fieldLabel 同语义（WP-187）", () => {
    expect(Object.keys(GENERATED_FIELD_LABELS.entity).sort()).toEqual(Object.keys(FIELD_LABELS.entity).sort());
    expect(Object.keys(GENERATED_FIELD_LABELS.article).sort()).toEqual(Object.keys(FIELD_LABELS.article).sort());
    for (const [key, value] of Object.entries(FIELD_LABELS.entity)) {
      expect(GENERATED_FIELD_LABELS.entity[key], `entity.${key}`).toBe(value);
    }
    for (const [key, value] of Object.entries(FIELD_LABELS.article)) {
      expect(GENERATED_FIELD_LABELS.article[key], `article.${key}`).toBe(value);
    }
    // fieldLabel 语义同构：缺省域序 entity → article、显式域、未登记回字段名、空输入回 ""
    expect(generatedFieldLabel("title")).toBe(fieldLabel("title"));
    expect(generatedFieldLabel("arch_component")).toBe(fieldLabel("arch_component"));
    expect(generatedFieldLabel("article_id")).toBe(fieldLabel("article_id"));
    expect(generatedFieldLabel("body")).toBe(fieldLabel("body"));
    expect(generatedFieldLabel("title", "article")).toBe(fieldLabel("title", "article"));
    expect(generatedFieldLabel("title", "entity")).toBe(fieldLabel("title", "entity"));
    expect(generatedFieldLabel("not_a_field")).toBe(fieldLabel("not_a_field"));
    expect(generatedFieldLabel("")).toBe(fieldLabel(""));
  });
});
