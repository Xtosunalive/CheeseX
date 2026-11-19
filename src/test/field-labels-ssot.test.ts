import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { FIELD_LABELS, fieldLabel } from "../../shared/field-labels.mjs";
import { FIELD_LABELS as GENERATED_FIELD_LABELS, fieldLabel as generatedFieldLabel } from "@/lib/generated/field-view";
import { ENTITY_CREATE_FIELDS } from "@/components/entity-repair/entity-create-fields";
import { REPAIR_FIELD_DEFS } from "@/components/entity-repair/entity-repair-field-model";
import { VERSION_DIFF_FIELD_LABELS } from "@/features/architecture-version/components/version-diff-field-labels";
import { DOCUMENT_RESULT_FIELD_LABELS } from "@/features/document-inventory/components/document-result-field-labels";
import { ARTICLE_PANORAMA_LABELS } from "@/features/document-inventory/components/article-panorama-labels";

// 字段中文绑定名单源锁。WP-195：seq209 载体（shared/field-labels.mjs 手写字典）已退役为生成物——
// 单源＝data/theschema/fields.yaml v2 的 classes.*.properties display（类属主立法面）；
// shared/field-labels.mjs（服务端面）与 src/lib/generated/field-view.ts（前端面）均为
// gen:field-view 再生物（禁手改，漂移经 L7 与 gen:field-view --check 双面锁）。
// 各条锁：
// L1 配置侧（contracts/entity-readiness-rules.json fields[*]）**不得再出现中文名**——
//    绑定名的唯一来源是 fields.yaml v2 display（seq210：契约侧已去 label 只留 hint；WP-195 后基准上移到立法面）。
//    契约侧出现 label/display 即红（防回潮，fail-closed）；键集关系锁为：
//    契约 fields ⊆ v2 entity 类属性集，v2 entity.properties ≡ 生成物字典 entity 域。
// L1b 主理人裁定：文章域绑定名**不**落在 contracts——article.fields 段只能有表单形状
//    （control/required/optionsKey）+ 键序，出现 label/display 即红；契约段 ⊆ v2 article 类属性集，
//    v2 article.properties ≡ 生成物字典 article 域。
// L2 消费方（B/C/D/E/F/G/H + 从 D 派生的两个展示组件）不得再出现任何字段中文字面量——防新增立法。
// L3 运行时取值：实体域 title/arch_component/status 与文章域取值按 v2 display 钉死（域分段语义本身被锁住）。
// L4 前端派生结果 ≡ 生成物字典（链路经派生面，消费方不直连单源）。

function readRepo(relativePath: string): string {
  return readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

// WP-195 立法面：绑定名期望表从 fields.yaml v2 的 classes.*.properties display 构建（比对基准）。
const FIELDS_YAML = parseYaml(readRepo("data/theschema/fields.yaml")) as {
  classes: Record<"entity" | "article", { properties: Array<{ name: string; display: string }> }>;
};
const V2_ENTITY_LABELS: Record<string, string> = Object.fromEntries(
  FIELDS_YAML.classes.entity.properties.map((p) => [p.name, p.display]),
);
const V2_ARTICLE_LABELS: Record<string, string> = Object.fromEntries(
  FIELDS_YAML.classes.article.properties.map((p) => [p.name, p.display]),
);
const V2_ENTITY_KEYS = Object.keys(V2_ENTITY_LABELS);
const V2_ARTICLE_KEYS = Object.keys(V2_ARTICLE_LABELS);

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

// 契约 article.fields 中声明了 control 的 = Web 可补齐字段（渲染顺序 = 键序，勿重排；
// PR-151：arch_layer/arch_category 入列——字典必填两字段开 Web 补齐）。
const WEB_COMPLETABLE_FIELDS = ["title", "product", "version", "module", "article_type", "doc-type", "category-path", "arch_layer", "arch_category", "tags"];

describe("field labels SSOT locks (seq209)", () => {
  it("L1 契约侧不得再出现字段中文名（防回潮：fields[*] 只留填写要求 hint）", () => {
    const declared = JSON.parse(readRepo("contracts/entity-readiness-rules.json")).fields as Record<string, Record<string, unknown>>;
    const declaredKeys = Object.keys(declared).filter((key) => key !== "$comment");
    expect(declaredKeys.length).toBe(14);
    // ① 契约 fields 键集 ⊆ v2 entity 类属性集（契约段只是实体类属性里参与合规表单的子集）
    for (const key of declaredKeys) {
      expect(V2_ENTITY_KEYS.includes(key), `fields.${key} 未在 fields.yaml v2 entity 类属性集登记`).toBe(true);
    }
    // ② v2 entity.properties 键集 ≡ 生成物字典 entity 域键集（生成物跟随立法面，多了/少了谁都红）
    expect([...V2_ENTITY_KEYS].sort()).toEqual(Object.keys(FIELD_LABELS.entity).sort());
    for (const key of declaredKeys) {
      const meta = declared[key];
      // ③ 防回潮：绑定名唯一来源是 fields.yaml v2 display，契约里再出现 label/display 即第二源
      expect(Object.keys(meta), `fields.${key} 出现禁用键（label 不得在此）`).not.toContain("label");
      expect(Object.keys(meta), `fields.${key} 出现禁用键（display 不得在此）`).not.toContain("display");
      for (const shapeKey of Object.keys(meta)) {
        // 2026-10-08 字段托管：system/control/managedBy 为托管声明键（control=readonly-system 表单只读派生），合法成员
        expect(["hint", "system", "control", "managedBy"], `fields.${key} 出现非「填写要求/托管声明」键`).toContain(shapeKey);
      }
    }
  });

  it("L1b 文章域绑定名不落 contracts：article.fields 只留表单形状，label/display 字段禁用", () => {
    const articleFields = JSON.parse(readRepo("contracts/entity-readiness-rules.json")).article.fields as Record<string, Record<string, unknown>>;
    const keys = Object.keys(articleFields).filter((key) => key !== "$comment");
    // 键集与键序（键序 = 补齐表单渲染顺序；PR-151：arch 两字段插分类簇尾、tags 前）
    // L1b 锁的是契约段本身，不是 v2 全集——v2 article.properties 也含 body，两处 body 各自独立锁定
    expect(keys).toEqual(["title", "article_id", "product", "version", "module", "article_type", "doc-type", "category-path", "arch_layer", "arch_category", "tags", "body"]);
    for (const key of keys) {
      const meta = articleFields[key];
      // 裁定落点：绑定名唯一来源是 fields.yaml v2 display，契约里再出现 label/display 即第二源
      expect(Object.keys(meta), `article.fields.${key} 出现禁用键（label 不得在此）`).not.toContain("label");
      expect(Object.keys(meta), `article.fields.${key} 出现禁用键（display 不得在此）`).not.toContain("display");
      for (const shapeKey of Object.keys(meta)) {
        expect(["control", "required", "optionsKey"], `article.fields.${key} 出现非表单形状键`).toContain(shapeKey);
      }
    }
    // 声明了 control 的十个才是 Web 可补齐字段（article_id/body 只占位登记；PR-151：arch 两字段入列）
    expect(keys.filter((key) => Boolean(articleFields[key].control))).toEqual(WEB_COMPLETABLE_FIELDS);
    // 契约段 ⊆ v2 article 类属性集（契约登记的每个字段都在立法面有绑定名）
    for (const key of keys) {
      expect(V2_ARTICLE_KEYS.includes(key), `article.fields.${key} 未在 fields.yaml v2 article 类属性集登记`).toBe(true);
    }
    // v2 article.properties 键集 ≡ 生成物字典 article 域键集（生成物跟随立法面）
    expect([...V2_ARTICLE_KEYS].sort()).toEqual(Object.keys(FIELD_LABELS.article).sort());
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

  it("L3 域分段语义：实体域 title/arch_component/status 与文章域取值互不相同", () => {
    expect(FIELD_LABELS.entity.title).toBe("实体名称");
    expect(FIELD_LABELS.article.title).toBe("标题");
    // WP-195 三处改名按 Master 裁定落 v2 display
    expect(FIELD_LABELS.entity["architecture-node-id"]).toBe("架构组件 ID");
    expect(FIELD_LABELS.entity.arch_component).toBe("是否架构组件");
    expect(FIELD_LABELS.entity.status).toBe("生命周期状态");
    expect(FIELD_LABELS.article.article_id).toBe("文章标识");
    // 缺省域序：entity → article
    expect(fieldLabel("title")).toBe("实体名称");
    expect(fieldLabel("arch_component")).toBe("是否架构组件");
    expect(fieldLabel("status")).toBe("生命周期状态");
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

  // L7 生成物 ≡ 立法面（WP-195）：seq209 载体退役后，shared/field-labels.mjs 与
  // src/lib/generated/field-view.ts 都是生成物——两者互相比对失去意义（同一生成链的手改错两边同错），
  // 比对基准上移到立法面 data/theschema/fields.yaml v2 的 classes.*.properties display：
  // 从立法面构建两域期望表，逐键断言 ≡ 两个生成物的字典（原 WP-187 的生成物互比随之上移退役）。
  // 漂移（手改生成物／立法面变更未再生）即红——gen:field-view --check（check-derivation-sync
  // 注册表纳管）是构建期同款锁，本测试是测试期冗余备份。
  it("L7 生成物 ≡ 立法面：两域 display 逐键同值（WP-195）、fieldLabel 同语义", () => {
    expect(Object.keys(GENERATED_FIELD_LABELS.entity).sort()).toEqual([...V2_ENTITY_KEYS].sort());
    expect(Object.keys(GENERATED_FIELD_LABELS.article).sort()).toEqual([...V2_ARTICLE_KEYS].sort());
    expect(Object.keys(FIELD_LABELS.entity).sort()).toEqual([...V2_ENTITY_KEYS].sort());
    expect(Object.keys(FIELD_LABELS.article).sort()).toEqual([...V2_ARTICLE_KEYS].sort());
    for (const [key, value] of Object.entries(V2_ENTITY_LABELS)) {
      expect(GENERATED_FIELD_LABELS.entity[key], `entity.${key}（前端生成物）`).toBe(value);
      expect(FIELD_LABELS.entity[key], `entity.${key}（服务端生成物）`).toBe(value);
    }
    for (const [key, value] of Object.entries(V2_ARTICLE_LABELS)) {
      expect(GENERATED_FIELD_LABELS.article[key], `article.${key}（前端生成物）`).toBe(value);
      expect(FIELD_LABELS.article[key], `article.${key}（服务端生成物）`).toBe(value);
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

  // L8 同值列头收编锁（WP-188 波4）：列头显示词与字段中文名「同值同义」且列数据即该字段值者，
  // 经派生面 fieldLabel 取（WP-151「同值同义者引既有键不另抄」判据的列头面延伸）——禁经 TERM 转抄
  // 或字面量第二份。页面语义词列头（文章标题/源实体/产品 / 模块等）不适用本锁（非字段键投影，
  // 收编即改产品语义——WP-188 合同 non_goals 在案）。
  it("L8 同值列头经派生面取（WP-188 波4：准入登记表＋检查结果表）", () => {
    // 接线：两 copy 模块的同值列头经派生面取（显式域）
    const admissionCopy = readRepo("src/features/admission/admission-copy.ts");
    expect(admissionCopy).toContain('COL_LAYER: fieldLabel("arch_layer", "entity")');
    expect(admissionCopy).toContain('COL_CATEGORY: fieldLabel("arch_category", "entity")');
    const propertyGovCopy = readRepo("src/features/property-gov/property-gov-copy.ts");
    expect(propertyGovCopy).toContain('COL_LAYER: sharedFieldLabel("arch_layer", "entity")');
    // 反例：两组件不再以 TERM 转抄同值列头（筛选器 DocumentSearchBar 的 TERM.CATEGORY/TERM.LAYER
    // 是 facet 过滤标签，非表格列头，不在本锁射程）
    const registryTable = readRepo("src/features/admission/EntityRegistryTable.tsx");
    expect(registryTable).not.toContain("TERM.LAYER");
    expect(registryTable).not.toContain("TERM.CATEGORY");
    const checkResultsPanel = readRepo("src/features/property-gov/CheckResultsPanel.tsx");
    expect(checkResultsPanel).not.toContain("TERM.LAYER");
    // 值等价：派生值与原 TERM 字面量逐字同（显示零变化）
    expect(FIELD_LABELS.entity.arch_layer).toBe("架构分层");
    expect(FIELD_LABELS.entity.arch_category).toBe("实体类别");
    expect(generatedFieldLabel("arch_layer", "entity")).toBe("架构分层");
    expect(generatedFieldLabel("arch_category", "entity")).toBe("实体类别");
  });
});
