/**
 * 文案词表闭集守卫（四源合并测试）——WP-145 波 4 尾项。
 *
 * 来源（四个来源文件，于 2026-11-07 依 ADR-019 §四「词表先迁后删，同批完成」迁移＋退役）：
 *   ① src/test/schema-copy-humanized.test.ts（WP-037 C5）——治理话术 8 禁词 → 本文件组二；
 *   ② src/test/check-copy-vocabulary-ssot.test.ts（#1404 P1）——anomaly 词族单源断言，执法职责
 *     已被文案闭集体系吸收（anomaly-workbench-copy.ts 已入闭集豁免单，词族成员皆中文文案，
 *     闭集外写中文即 lint 红），词族词表不另迁（WP-145 波 4 保留资产＝受众禁词/正名词表）；
 *   ③ src/test/term-copy-inline-guard.test.ts（#1755）——aria 受控文案 → 组三；页签正名 → 组四；
 *   ④ eslint.config.js TERMINOLOGY_REPLACEMENTS＋noForbiddenTermRule（9 对术语替换，
 *     分库搬运自 cheese-q scripts/quality/check-ui-copy.mjs:18-28）→ 组一。
 *
 * 定位变化：上述守卫的执法职责已被 lint CJK 选择器（no-restricted-syntax 展示面两族）＋
 * 文案闭集体系吸收（ADR-019 §三），lint 规则段与三个测试文件随本批退役；本文件只保留
 * 词表内容本身作为断言资产——禁词出现即红，防止词表漂移与话术回潮。
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";
import { describe, expect, it } from "vitest";
import { TERM } from "../constants/term-const";

const SRC_ROOT = join(process.cwd(), "src");

// ═══════════════ 组一：受众术语对（9 对 term→replacement）═══════════════
// 照抄 eslint noForbiddenTermRule 的扫描形态：字符串字面量＋JSX 文本＋模板串
// （AST 节点面 StringLiteral／JsxText／TemplateHead·Middle·Tail；注释与标识符天然不在面内）。
// 扫描范围 src/**，排除：term-const.ts（术语定义处——9 对替换对的词源本体）、src/test/**、
// *.d.ts、generated 目录（openapi 投影，事实源在 contracts/，与 eslint 全局 ignores 同口径）。
// 闭集文案模块（property-gov-copy 等页级文案单源）是用户文案正文，禁词守卫的真正执法对象，
// 不再豁免；CLOSED_SET_FILES 降级为纯投影——单源＝eslint.config.js 尾部闭集豁免块，闭集清单
// 变更须两处同步，但不再参与组一排除（记档 1：WP-147 漏列 theme-preview-copy 已补投影）。
// 替换对单源：eslint.config.js TERMINOLOGY_REPLACEMENTS（cheese-q check-ui-copy.mjs 分库搬运，
// 逐字未改）；规则段退役后本表即唯一事实源。
const TERMINOLOGY_REPLACEMENTS = [
  { term: "架构层级", replacement: "架构分层" },
  { term: "技术分层", replacement: "架构分层" },
  { term: "层次筛选", replacement: "分层筛选" },
  { term: "实体类型", replacement: "实体类别" },
  { term: "外向关系", replacement: "外向依赖" },
  { term: "被引用", replacement: "被依赖" },
  { term: "关联关系", replacement: "关系" },
  { term: "图谱拓扑", replacement: "拓扑视图" },
  { term: "骨架", replacement: "图谱规则配置" },
];

// 闭集清单投影（单源＝eslint.config.js 尾部闭集豁免块，逐个单列不用目录 glob；登记镜像，
// 不再作为组一排除面——组一排除面见下方 describe 内过滤器）
const CLOSED_SET_FILES = new Set([
  "src/constants/term-const.ts",
  "src/features/property-gov/property-gov-copy.ts",
  "src/features/anomaly-workbench/anomaly-workbench-copy.ts",
  "src/features/anomaly-workbench/action-routing-reasons.ts",
  "src/features/theme-preview/theme-preview-copy.ts", // theme-preview 页级文案单源（WP-147 入册时本投影漏列，记档 1 补齐）
  "src/features/document-inventory/components/article-panorama-labels.ts",
  "src/features/document-inventory/components/document-result-field-labels.ts",
  "src/features/schema-manager/dangling-kind-labels.ts",
  "src/features/schema-manager/schema-manager-copy.ts",
  "src/features/review/review-copy.ts",
  "src/features/gap-engine/gap-engine-copy.ts",
  "src/features/approval-workbench/approval-workbench-copy.ts",
  "src/features/article-workflow/article-workflow-copy.ts",
  "src/features/impact-analysis/impact-analysis-copy.ts",
  "src/features/document-inventory/document-inventory-copy.ts",
  "src/features/data-dashboard/data-dashboard-copy.ts",
  "src/features/entity-compliance/entity-compliance-copy.ts",
  "src/features/admission/admission-copy.ts",
  "src/features/article-associations/article-associations-copy.ts",
  "src/features/architecture-version/architecture-version-copy.ts",
  "src/features/dashboard/dashboard-copy.ts",
  "src/components/components-copy.ts",
  "src/lib/lib-copy.ts",
  "src/features/architecture-version/components/version-diff-field-labels.ts",
  "src/lib/domain/StatusDisplay.ts",
  "src/lib/domain/RelationProvenance.ts",
  "src/lib/domain/EntityCategory.ts",
  "src/lib/domain/ConclusionEffectLabels.ts",
  "src/lib/api.ts",
]);

describe("闭集投影完整性（CLOSED_SET_FILES＝eslint.config.js 尾部闭集豁免块的登记镜像）", () => {
  it("投影清单内文件全部实存（改名/移动未同步投影即红——两处同步的最低保真）", () => {
    const missing = [...CLOSED_SET_FILES].filter((p) => !existsSync(join(process.cwd(), p)));
    expect(
      missing,
      "闭集投影文件缺失（eslint.config.js 闭集块与本投影须两处同步）：\n" + missing.join("\n"),
    ).toEqual([]);
  });
});

function walkSources(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "generated" || name.startsWith(".")) continue;
    const full = join(dir, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkSources(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) {
      out.push(full);
    }
  }
  return out;
}

// eslint Literal(字符串)＝StringLiteral；JSXText＝JsxText；TemplateElement＝TemplateHead/Middle/Tail。
// .text 取 cooked 值（转义形态 \uXXXX 也命中，覆盖面不小于 eslint 的 raw 面）。
const STRING_MEDIA_KINDS = [
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.JsxText,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
];

function stringMediaOf(file: string): string[] {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sourceFile = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, kind);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (STRING_MEDIA_KINDS.includes(node.kind)) found.push((node as ts.StringLiteral).text ?? "");
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return found;
}

describe("组一 受众术语对（9 对 term→replacement，禁词出现即红）", () => {
  it("src/** 文案介质（字符串字面量／JSX 文本／模板串）无 9 对受众禁词", () => {
    const files = walkSources(SRC_ROOT).filter((file) => {
      const rel = relative(SRC_ROOT, file);
      if (rel.startsWith("test" + "/")) return false; // src/test/** 断言面豁免
      if (rel === "constants" + "/term-const.ts") return false; // 术语定义处豁免（禁词表词源本体）
      return true;
    });
    const violations: string[] = [];
    for (const file of files) {
      for (const media of stringMediaOf(file)) {
        for (const { term, replacement } of TERMINOLOGY_REPLACEMENTS) {
          if (media.includes(term)) {
            violations.push(`${relative(process.cwd(), file)}：「${term}」→ 请替换为「${replacement}」｜文案片段：${media.slice(0, 80)}`);
          }
        }
      }
    }
    expect(
      violations,
      "受众术语禁词泄漏（eslint noForbiddenTermRule 退役后由本断言执法）：\n" + violations.join("\n"),
    ).toEqual([]);
  });
});

// ═══════════════ 组二：治理话术 8 禁词（WP-037 C5）═══════════════
// 源自 schema-copy-humanized.test.ts，扫描范围与行级剥注释逻辑逐字照抄：
// features/schema-manager 目录顶层（非递归）＋ src/lib/schema-shape.ts ＋ src/lib/lib-copy.ts
// （WP-152 引入的 lib 层文案住址——分区文案/写门中文化都在此，记档 2 补入扫描清单）；
// 跳注释行（注释是正当的开发文档，不在执法面）。
const FEATURE_DIR = join(process.cwd(), "src", "features", "schema-manager");
const SHAPE_FILE = join(process.cwd(), "src", "lib", "schema-shape.ts");
const LIB_COPY_FILE = join(process.cwd(), "src", "lib", "lib-copy.ts");

const FORBIDDEN = ["B1=", "Master", "已裁", "工作包", "查实 2026-", "ADR-0", "F05b", "立契"];

function nonCommentViolations(file: string): { line: number; text: string }[] {
  const lines = readFileSync(file, "utf8").split("\n");
  const hits: { line: number; text: string }[] = [];
  lines.forEach((raw, i) => {
    const trimmed = raw.trim();
    // 跳过纯注释行与 JSX 注释行（{/* … */} 整行形态）；行内尾注释截断后再扫
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
    if (trimmed.endsWith("*/}") || trimmed.endsWith("*/")) return; // 多行注释尾行
    // 行首对象键同注释豁免（记档 2）：键是机器契约标识符（如 lib-copy ENTITY_REPAIR_BLOCKER_MESSAGES
    // 的 F05b:——后端 ruleId，永不渲染，改键即断 describeBlocker 查表），键面不算文案；冒号后的
    // 值面（用户文案正文）仍逐字全扫，执法面不减。
    const code = (raw.split("//")[0] ?? raw).replace(/^[ \t]*[A-Za-z_$][\w$]*[ \t]*:[ \t]*/, "");
    if (trimmed.startsWith("{/*")) return; // 跨行 JSX 注释首行保守跳过
    for (const token of FORBIDDEN) {
      if (code.includes(token)) hits.push({ line: i + 1, text: `${token} · ${trimmed.slice(0, 70)}` });
    }
  });
  return hits;
}

describe("组二 治理话术禁词（台账腔不进 schema 页主界面，WP-037 C5）", () => {
  it("schema-manager 特性与 schema-shape 渲染态文案无治理禁词", () => {
    const files = readdirSync(FEATURE_DIR)
      .filter((f) => f.endsWith(".tsx") || f.endsWith(".ts"))
      .map((f) => join(FEATURE_DIR, f));
    files.push(SHAPE_FILE);
    files.push(LIB_COPY_FILE);
    const violations = files.flatMap((f) => nonCommentViolations(f).map((v) => `${f.split("/").pop()}:${v.line} ${v.text}`));
    expect(violations, `发现治理话术泄漏：\n${violations.join("\n")}\n（改用户语言；执法/只读语义保留——先例：B1=b 横幅改「分类矩阵自动生成」）`).toEqual([]);
  });
});

// ═══════════════ 组三＋组四：受控文案内联守卫（#1755）═══════════════
// 源自 term-copy-inline-guard.test.ts：受控文案禁止在 term-const.ts 定义处以外的任何 src
// 文件以字面量出现（剥注释后扫——开发文档引词合法，只执法代码字面量）。
// 组三＝aria 受控文案（FloatingSearch 以「全文检索」构建 CSS 选择器，文案与 DOM 查询耦合，
// 改值需验证 "/" 快捷键聚焦）；组四＝八个页面正名（导航与页题同源，term-const 规则 1）。
const GUARDED_ARIA_COPY = ["全文检索", "清除筛选"] as const;

// 八个页面正名 → term-const.ts 词条（key→value 精确锁定；正名改动必须过本表）
const PAGE_OFFICIAL_NAMES: ReadonlyArray<{ key: keyof typeof TERM; name: string }> = [
  { key: "ARTICLE_AND_COMPONENTS", name: "属性治理" },
  { key: "SOURCE_DOC_CHECK", name: "实体合规检查" },
  { key: "ARTICLE_MAPPING_REPAIR", name: "文章关联" },
  { key: "GRAPH_ADMISSION", name: "实体准入" },
  { key: "TOPOLOGY_GAP_REVIEW", name: "拓扑缺口检查" },
  { key: "DOC_LOOKUP", name: "文档清单" },
  { key: "VERSION_ANALYSIS", name: "架构版本对比" },
  { key: "TASK_IMPACT_ANALYSIS", name: "影响分析" },
];

const GUARD_SELF = "copy-vocabulary-closed-set.test";
const ALLOWED_BASENAMES = ["term-const.ts", GUARD_SELF];

/** 剥注释（块注释＋整行行注释）——开发文档引词合法，只执法代码字面量（照抄原守卫） */
function stripComments(content: string): string {
  return content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** 一次遍历同时匹配全部受控词条。
 *  原形态每个词条各 walkSources(SRC_ROOT) 一遍：组四 8 个正名＝8 次全量 src 扫描，
 *  实测约 8s > vitest 默认 5s 超时，守卫因此**假红**（超时而非真违规）。
 *  违规集合与逐词条扫描逐项一致，只是聚合顺序改为按文件优先；断言 toEqual([]) 不受影响。 */
function inlineOccurrences(copies: readonly string[]): { copy: string; file: string; hits: number }[] {
  const violations: { copy: string; file: string; hits: number }[] = [];
  for (const file of walkSources(SRC_ROOT)) {
    const name = file.split("/").pop() ?? file;
    if (ALLOWED_BASENAMES.some((allowed) => name.includes(allowed))) continue;
    const content = stripComments(readFileSync(file, "utf8"));
    for (const copy of copies) {
      const hits = content.split(copy).length - 1;
      if (hits > 0) violations.push({ copy, file: file.replace(SRC_ROOT + "/", ""), hits });
    }
  }
  return violations;
}

describe("组三 aria 受控文案（受控文案禁止内联字面量，#1755）", () => {
  it("aria 受控文案只允许出现在 term-const.ts 定义处", () => {
    const violations = inlineOccurrences(GUARDED_ARIA_COPY).map(
      (v) => `${v.file}: "${v.copy}" ×${v.hits}`,
    );
    expect(
      violations,
      "以下文件内联了受控文案，请改为引用 TERM 常量（#1755）：\n" + violations.join("\n"),
    ).toEqual([]);
  });
});

describe("组四 页面正名（导航与页题同源，手写正名即红）", () => {
  it("八个页面正名的词条消费点仍在 term-const.ts（key→value 未漂移）", () => {
    const drifted = PAGE_OFFICIAL_NAMES.filter(({ key, name }) => TERM[key] !== name);
    expect(
      drifted.map(({ key, name }) => `TERM.${key} 期望「${name}」，实际「${TERM[key]}」`),
      "页面正名词条漂移：\n（正名改动须同步本测试词表与消费点）",
    ).toEqual([]);
  });

  it("八个页面正名禁止在 term-const.ts 以外内联手写（原守卫断言形态照抄）", () => {
    const violations = inlineOccurrences(PAGE_OFFICIAL_NAMES.map(({ name }) => name)).map(
      (v) => `${v.file}: "${v.copy}" ×${v.hits}`,
    );
    expect(
      violations,
      "页面正名被内联手写，请改为引用 TERM 常量（term-const 规则 1：页面标题与侧栏导航同源）：\n" + violations.join("\n"),
    ).toEqual([]);
  });
});
