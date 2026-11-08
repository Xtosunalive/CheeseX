#!/usr/bin/env node
// Component: Theme-Vocab-Guard（PR-025 留账 2：配方自检能力固化）
// @responsible: 主题词汇表与定义的双向对账——「词表↔定义」缺失的实证（上会话配方自检
//   曾抓出 accent-bg-strong 有消费无定义的真 bug，本门禁把该能力常驻化，并修掉
//   ring- 前缀切分 bug：完整 CSS 变量名边界切分，不做前缀截断）。
// 检查面四项：
//   ① 悬空消费：业务代码消费的 --color-* 在 index.css 无定义 → fail（静默无样式的根源）
//   ② 死定义：index.css 定义的 L1 --color-* 在业务代码零消费 → fail（词表膨胀）
//      （例外：chart-*/status-* 预留语义位；@theme inline 内被 var() 引用的中间词不算死）
//   ③ shadcn 内部词禁令：业务代码（非 ui//aria/）消费 --color-{primary,secondary,muted,
//      accent,popover,card,destructive,sidebar,background,foreground,ring,border,input}(-*)？
//      → fail（契约禁令 3：shadcn 官方词仅限基础组件内部）
//   ④ 退役 var 禁令：--color-kg-* → fail（kg 颜色别名已退役，字阶 kg-xs/2xs/md 不在 --color 域）；
//      WP-147 二期（2026-11-07 连名换装）：var(--cat-*)/「--cat-*」token 名串 → fail（cat L0 名
//      全量退役）；defined/consumed/dead 三态随新词形 --color-<族>-<step> 重排——step 词与 vendor
//      变量同名（--color-cyan-9: var(--cyan-9)），定义行自身引用不得自证活词（死定义照判）
//   ⑤ 非颜色命名空间对账（W0-3 · 契约 A3）：--table-/--radius-/--shadow-/--animate-/--text- 尺寸
//      ＋:root 度量词（--app-bar-height/--kg-font-scale）——悬空 var／悬空类／惰性类（@theme 外
//      定义被类消费，工具类不生成）／死定义；新前缀须在 NS 注册表登记（不允许无注册新前缀）
//   ⑥ CSS 消费通道（W0-3 · 契约 A2）：@import 图子文件＋组件直挂 CSS 的 var() 消费计入对账
//      （preset 组件类是 L2/L1 的合法消费方——CSS 内消费不再是盲区）
//   存量走 theme-baseline.json 棘轮（契约「存量收敛条款」）：只减不增＋逼销账。
// 豁免区：src/components/ui/**、src/components/aria/**（基础组件合法区）、src/test/**
// 模式：fail-closed——index.css 缺失/解析异常 exit 1。
// @outputs: stdout 报告 theme_vocab=ok|FAIL ...；非零退出 = 存在违规
// @context: 2026-10-06「处理12」指令（留账 1+2）；范式承 theme-token-faces.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { collectCssGraph, parseVarDefinitions, stripCssComments } from "./shared/theme-css-graph.mjs";
import { loadThemeBaseline, compareBaseline } from "./shared/theme-baseline.mjs";
import { themeExemptZonePatterns } from "../../shared/theme-exemptions.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const SRC = path.join(ROOT, "src");
const INDEX_CSS = path.join(ROOT, "src", "index.css");

// WP-138 R5c：豁免区单源化——原与 theme-token-faces.mjs 各持一份手抄，改经 theme-exemptions.mjs
// 唯一声明派生（THEME_EXEMPT_ZONES；tokens 面另叠加色板唯一源文件，本门禁词汇执法不需要该面）。
const EXEMPT = themeExemptZonePatterns();

// shadcn 内部层词根（契约禁令 3：业务代码不得消费，ui//aria/ 除外）
const SHADCN_ROOTS = ["primary", "secondary", "muted", "accent-foreground", "popover", "card-foreground",
  "destructive", "sidebar", "background", "foreground", "ring", "border", "input", "accent"];
const isShadcnWord = (name) => {
  // --color-accent-base/accent-bg/accent-bg-strong/accent-contrast/accent-fg 是 L1 词，不是 shadcn 词
  if (name.startsWith("accent-")) return ["accent", "accent-foreground"].includes(name);
  return SHADCN_ROOTS.includes(name) || name.startsWith("sidebar-") ||
    ["popover", "card", "muted"].includes(name) || name.endsWith("-foreground") ||
    ["background", "foreground", "border", "input", "ring", "destructive"].includes(name);
};

// L1 语义位预留（定义合法但业务暂未消费——语义位规划，非死词）
// WP-147 二期终棒（2026-11-07）新增四档：决策卡 §3.1 连名映射在册的语义位，其唯一旧消费者
// 被 §2.2 alpha 治理改落他档（cat-red-deep 深环→red-9「要更醒目直接 9」、cat-rose/15→ruby-3、
// cat-blue-lighter 零实消费、cat-emerald-deep 仅测试夹具引用）——映射在册、消费者改道，
// 留位防词表回退；后续消费落地即摘（同棘轮销账口径）。
const RESERVED = [
  /^chart-\d$/,
  /^status-(fact|inferred|warn|error|loading)$/,
  /^(cyan-4|jade-12|red-12|ruby-9)$/, // WP-147：卡 §3.1 在册语义位（消费者改道他档，见上注）
];

function fail(lines) {
  // 按类别分组抽样输出（WP-147 迁移窗口期经验：单一类别高发时可把其他类别的真实违规
  // 挤出详情区——每类别保底露头 15 条＋摘要直方图，总输出仍有界）
  const byCat = new Map();
  for (const l of lines) {
    const c = l.match(/^\[(.+?)\]/)?.[1] || "其他";
    if (!byCat.has(c)) byCat.set(c, []);
    byCat.get(c).push(l);
  }
  const hist = Object.fromEntries([...byCat.entries()].map(([c, ls]) => [c, ls.length]));
  console.log(`theme_vocab=FAIL violations=${lines.length} by_category=${JSON.stringify(hist)}`);
  for (const [c, ls] of byCat) {
    for (const l of ls.slice(0, 15)) console.log(`  ${l}`);
    if (ls.length > 15) console.log(`  [${c}] …另 ${ls.length - 15} 处`);
  }
  process.exit(1);
}

// ── 收集 index.css 定义的 --color-* 词 ──
if (!fs.existsSync(INDEX_CSS)) fail(["[结构] src/index.css 不存在"]);
const css = fs.readFileSync(INDEX_CSS, "utf-8");
const defined = new Set();
for (const m of css.matchAll(/(--color-[a-z0-9-]+)\s*:/g)) defined.add(m[1].replace("--color-", ""));
// WP-147 分类色词形：<族>-<step>（step 1..12，Radix 12 阶）——死定义自证豁免与预览镜像
// 抽样豁免都以此判定（surface/text/accent 等全局角色词不含数字档，不会误入）；
// chart-1..5 是图表系列号非 step 档，显式排除（其死定义豁免/镜像执法走各自通道）
const STEP_WORD = /^(?!chart-)[a-z]+-(?:[1-9]|1[0-2])$/;

// ── 遍历业务代码收集 var(--color-*) 消费 ──
const violations = [];
const consumed = new Map(); // word -> [file:line]
const l0Consumed = new Map(); // L0 名 -> [file:line]（死定义侧豁免用）
const walk = (dir, acc) => {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, acc);
    else if (name.endsWith(".tsx") || (name.endsWith(".ts") && !name.endsWith(".d.ts"))) acc.push(full);
  }
  return acc;
};
// ring- 前缀切分 bug 修正：用完整变量名边界（(?<=\() 或空白/引号后接 --color-...），
// 不做前缀截断——上一版会话内脚本把 ring- 切成 ri+ng- 造成透明度派生误报。
const VAR_USE = /var\((--color-[a-z0-9-]+)[,)]/g;
// L0 名直连通道：TS 色表（topology-types/dashboard-containers/LAYER_COLOR_MAP）经
// 运行时 CSS 解析消费 L0 名（var(--cat-red-600) 形态）——统计时折算到同名 L1 词。
const L0_VAR_USE = /var\((--cat-[a-z0-9-]+|--grid-line[a-z-]*|--overlay-[a-z-]+|--glass[a-z-]*|--zebra[a-z-]*|--shadow-[a-z-]+)\)/g;
// 工具类通道：@theme inline 生成的语义工具类（text-cat-blue / bg-accent-bg / ring-border-focus…）
// 切分教训（ring- bug 同型复发）：lookahead 不得用 \b——\b 在连字符处成立，懒惰匹配会把
// cat-blue-500 截断成 cat。用负向前瞻「后面不是词字符/连字符」才吃得完整。
const CLASS_USE = /\b(text|bg|border|ring|fill|stroke|from|to|via|outline|decoration|divide|caret)-([a-z][a-z0-9-]*?)(?![a-z0-9-])/g;
const allFiles = walk(SRC, []);
for (const full of allFiles) {
  const rel = path.relative(ROOT, full).split(path.sep).join("/");
  if (EXEMPT.some((re) => re.test(rel))) continue;
  const lines = fs.readFileSync(full, "utf-8").split("\n");
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
    for (const m of line.matchAll(VAR_USE)) {
      const word = m[1].replace("--color-", "");
      // ④ 退役 var
      if (word.startsWith("kg-")) violations.push(`[退役var] ${rel}:${i + 1}: var(--color-${word}) → kg 颜色别名已退役，用 status-*/cat-*`);
      // ③ shadcn 内部词
      if (isShadcnWord(word)) violations.push(`[shadcn词] ${rel}:${i + 1}: var(--color-${word}) → 契约禁令 3，业务代码用 L1 词（text-sub/surface-hover/accent-fg 等）`);
      if (!consumed.has(word)) consumed.set(word, []);
      consumed.get(word).push(`${rel}:${i + 1}`);
    }
    // 工具类通道消费计数（死定义判定用；shadcn/退役词另有 RETIRED_TOKENS 管，此处不重复执法）。
    // WP-147：词形认领从「前缀枚举」改为「前缀枚举 ∪ defined 在册词」——分类色 step 词
    // （bg-cyan-9 等）随 index.css 定义自动入账，新色族零登记成本；cat- 前缀保留以抓悬空旧词。
    for (const m of line.matchAll(CLASS_USE)) {
      const word = m[2];
      if (word.startsWith("surface-") || word.startsWith("text-") || word.startsWith("border-") ||
          word.startsWith("accent-") || word.startsWith("status-") || word.startsWith("cat-") ||
          word.startsWith("line-") || ["glass", "overlay", "zebra", "grid-line", "grid-line-strong"].includes(word) ||
          defined.has(word)) {
        if (!consumed.has(word)) consumed.set(word, []);
        consumed.get(word).push(`${rel}:${i + 1}`);
      }
    }
    // 变体前缀通道：hover:bg-xxx / focus-visible:ring-xxx 等（Tailwind 变体不改变词汇本体）
    for (const m of line.matchAll(/[a-z-]+:(text|bg|border|ring)-([a-z][a-z0-9-]*?)(?![a-z0-9-])/g)) {
      const word = m[2];
      if (word.startsWith("surface-") || word.startsWith("accent-") || word.startsWith("status-") ||
          word.startsWith("cat-") || word.startsWith("line-") || word.startsWith("border-") ||
          defined.has(word)) {
        if (!consumed.has(word)) consumed.set(word, []);
        consumed.get(word).push(`${rel}:${i + 1}`);
      }
    }
    // token 名串通道（WP-147）：契约禁令 5 形态「集中表存 token 名」（token: "--color-cyan-9"）
    // 是运行时 CSS 解析消费——计入 consumed；预览页镜像清单是展示目录不是业务消费，不计。
    for (const m of line.matchAll(/["'`](--color-[a-z0-9-]+)["'`]/g)) {
      if (rel.endsWith("ThemePreviewView.tsx")) continue;
      const word = m[1].replace("--color-", "");
      if (!consumed.has(word)) consumed.set(word, []);
      consumed.get(word).push(`${rel}:${i + 1}`);
    }
    // L0 直连通道：TS 色表的 var(--cat-*) 等是合法形态（L0 名运行时解析）。
    // 悬空判定只对 --color-* 词执法；L0 名折算进 consumed 供死定义侧豁免同名 L1 词。
    for (const m of line.matchAll(L0_VAR_USE)) {
      const word = m[1].replace("--", "");
      // WP-147：cat L0 名随连名换装退役——var(--cat-*) 残留即红（与 kg 退役var 同型）
      if (word.startsWith("cat-")) {
        violations.push(`[退役var] ${rel}:${i + 1}: var(${m[1]}) → cat 分类色 L0 名已退役（WP-147 Radix 连名换装），用 var(--color-<族>-<step>)`);
      }
      if (!l0Consumed.has(word)) l0Consumed.set(word, []);
      l0Consumed.get(word).push(`${rel}:${i + 1}`);
      if (defined.has(word)) { // 恰有同名 L1 词则一并计入消费
        if (!consumed.has(word)) consumed.set(word, []);
        consumed.get(word).push(`${rel}:${i + 1}`);
      }
    }
    // token 名串退役通道（WP-147）：「--cat-*」字符串形态同 var 通道一并退役
    for (const m of line.matchAll(/["'`](--cat-[a-z0-9-]+)["'`]/g)) {
      violations.push(`[退役var] ${rel}:${i + 1}: ${m[1]}（token 名串）→ cat 分类色 L0 名已退役（WP-147 连名换装），存 --color-<族>-<step>`);
    }
  });
}

// ── ⑤ 非颜色命名空间对账＋⑥ CSS 消费通道（W0-3 · 契约 A3/A2）──
// NS 注册表：新前缀在此登记（「不允许无注册新前缀」）；builtins = Tailwind 内建档
// （非 var 驱动，不参与悬空/惰性执法，但定义了同名词时算合法消费）。
const NS = [
  { name: "table", prefix: "--table-", cls: null, builtins: [] }, // P0 组件 token：var 通道 only（契约：不生成工具类）
  { name: "radius", prefix: "--radius-", cls: "rounded", builtins: ["none", "DEFAULT", "full", "sm", "md", "lg", "xl", "2xl", "3xl"] },
  { name: "shadow", prefix: "--shadow-", cls: "shadow", builtins: ["none", "inner", "sm", "md", "lg", "xl", "2xl"] },
  { name: "animate", prefix: "--animate-", cls: "animate", builtins: ["none", "spin", "ping", "pulse", "bounce"] },
  { name: "text-size", prefix: "--text-", cls: "text", builtins: ["xs", "sm", "base", "lg", "xl", "2xl", "3xl", "4xl", "5xl", "6xl", "7xl", "8xl", "9xl",
    "left", "center", "right", "justify", "start", "end", "wrap", "balance", "pretty", "nowrap", "truncate", "ellipsis", "clip",
    "uppercase", "lowercase", "capitalize", "normal-case", "underline", "overline", "line-through", "no-underline"] },
  { name: "duration", prefix: "--duration-", cls: null, builtins: [] }, // L1 动效家族（P0 首枚 --duration-fast；var 通道 only）
  { name: "z-layer", prefix: "--z-", cls: "z", builtins: [] }, // C3 层级语义族（2026-10-16；工具类走 @utility z-modal 等自定义名，cls 前缀 z- 与 Tailwind 内建 z-0..z-50 不冲突——内建词不在本表 builtins，仅对账 --z- 定义侧）
  { name: "control-height", prefix: "--control-height-", cls: null, builtins: [] }, // C3 控件高度锚点（var 通道 only；tsx 的 h-* 属 spacing 底座派生不在此辖）
  { name: "metrics", prefix: null, fixed: ["--app-bar-height", "--kg-font-scale"], cls: null, builtins: [] }, // :root 度量词显式注册
];
const varDefs = parseVarDefinitions(css);
const nsDefined = new Map(); // "ns|word" -> "theme"|"root"
for (const [vn, where] of varDefs) {
  for (const n of NS) if (n.prefix && vn.startsWith(n.prefix)) nsDefined.set(`${n.name}|${vn.slice(n.prefix.length)}`, where);
}
for (const n of NS) if (n.fixed) for (const w of n.fixed) if (varDefs.has(w)) nsDefined.set(`${n.name}|${w}`, varDefs.get(w));

const pushLoc = (map, k, loc) => { if (!map.has(k)) map.set(k, []); map.get(k).push(loc); };
const nsVarUse = new Map();   // var 通道消费（tsx＋CSS 图，含 index.css 自引用）
const nsClassUse = new Map(); // 工具类通道消费（死定义救赎用）
const nsClassFlag = new Map(); // 需执法的类消费（非内建词：悬空类/惰性类判定用）
const NSVAR = /var\((--[a-z0-9-]+)[,)]/g;
const classifyVar = (vn, loc) => {
  for (const n of NS) {
    if (n.prefix && vn.startsWith(n.prefix)) pushLoc(nsVarUse, `${n.name}|${vn.slice(n.prefix.length)}`, loc);
    else if (n.fixed && n.fixed.includes(vn)) pushLoc(nsVarUse, `${n.name}|${vn}`, loc);
  }
};

// ⑥ CSS 消费通道：index.css 自引用（@theme 内 var() 派生算活词）＋图子文件＋组件直挂 CSS
const CLS_NS = new Map([["rounded", "radius"], ["shadow", "shadow"], ["animate", "animate"]]);
const { subFiles } = collectCssGraph({ root: ROOT, src: SRC });
for (const cssFile of [INDEX_CSS, ...subFiles]) {
  const rel = path.relative(ROOT, cssFile).split(path.sep).join("/");
  stripCssComments(fs.readFileSync(cssFile, "utf-8")).forEach((line, i) => {
    for (const m of line.matchAll(NSVAR)) classifyVar(m[1], `${rel}:${i + 1}`);
    // 颜色通道补齐（A2 原设计「消费侧扩到图内 CSS」的颜色半边，W0-3 漏项——P0 实弹抓出）：
    // 图内/直挂 CSS 的 var(--color-*) 消费计入 consumed（死定义侧豁免；悬空侧由 tsx 执法不变）
    for (const m of line.matchAll(VAR_USE)) {
      const word = m[1].replace("--color-", "");
      if (!consumed.has(word)) consumed.set(word, []);
      consumed.get(word).push(`${rel}:${i + 1}`);
    }
    // S6（红队）：@apply 的工具类是合法消费通道（P0 preset 天然主场）——计入类消费
    for (const am of line.matchAll(/@apply\s+([a-z0-9:\s-]+)/g)) {
      for (const tok of am[1].split(/\s+/)) {
        const cm = tok.match(/^(rounded|shadow|animate)-([a-z][a-z0-9-]*)$/);
        if (cm) {
          const k = `${CLS_NS.get(cm[1])}|${cm[2]}`;
          pushLoc(nsClassUse, k, `${rel}:${i + 1}`);
        }
      }
    }
  });
}
// tsx 双通道（var＋工具类；lookbehind 防 drop-shadow 型前缀截断，lookahead 防懒惰截断——ring- bug 同族教训）
for (const full of allFiles) {
  const rel = path.relative(ROOT, full).split(path.sep).join("/");
  if (EXEMPT.some((re) => re.test(rel))) continue;
  const lines = fs.readFileSync(full, "utf-8").split("\n");
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
    // S8（红队）：行尾 // 注释切割须保留引号内容（className/模板串里的类与 var 是合法消费），
    // 只在引号外遇到 // 时截断——防「// rounded-pill」一句注释把死词洗出棘轮
    const cutLineComment = (s) => {
      let q = null;
      for (let i = 0; i < s.length; i++) {
        const c = s[i];
        if (q) { if (c === q && s[i - 1] !== "\\") q = null; continue; }
        if (c === '"' || c === "'" || c === "`") { q = c; continue; }
        if (c === "/" && s[i + 1] === "/") return s.slice(0, i);
      }
      return s;
    };
    const scanLine = cutLineComment(line);
    const loc = `${rel}:${i + 1}`;
    for (const m of scanLine.matchAll(NSVAR)) classifyVar(m[1], loc);
    for (const m of scanLine.matchAll(/(?<![a-z0-9-])(?:[a-z-]+:)?(rounded|shadow|animate)-([a-z][a-z0-9-]*?)(?![a-z0-9-])/g)) {
      const nsName = CLS_NS.get(m[1]);
      const cfg = NS.find((n) => n.name === nsName);
      const word = m[2];
      // 圆角方位内建折算：rounded-l-md / rounded-tr-xl 等方位变体取自同一 --radius-<档>
      //（Tailwind 4 corner modifier），消费折算回基础档，不做悬空/惰性执法。
      let base = word;
      if (nsName === "radius") base = word.replace(/^[lrtb]{1,2}-/, "");
      const k = `${nsName}|${base}`;
      const defined = nsDefined.has(k);
      const builtin = cfg.builtins.includes(base);
      if (builtin && !defined) continue; // Tailwind 内建且非本仓 var 驱动（rounded-sm 默认档等）
      pushLoc(nsClassUse, k, loc);
      if (!builtin) pushLoc(nsClassFlag, k, loc); // S7（红队）：方位变体基础档未定义同样执法（rounded-t-nonexistent 绕行堵死）
    }
    // text- 词面与颜色共享：只做已知尺寸词的消费救赎，未知 text- 词归颜色通道管辖
    // 数字字阶（text-2xl/3xl/4xl/5xl）以数字开头，首字符类须含 0-9——否则大数字工具类
    // 被误判死定义（假红）。nsDefined 只登记 text-size 命名空间，颜色词不会误入。
    for (const m of scanLine.matchAll(/(?<![a-z0-9-])(?:[a-z-]+:)?text-([a-z0-9][a-z0-9-]*?)(?![a-z0-9-])/g)) {
      const k = `text-size|${m[1]}`;
      if (nsDefined.has(k)) pushLoc(nsClassUse, k, `${rel}:${i + 1}`);
    }
  });
}

// 判定（指纹入基线棘轮：悬空var/悬空类/惰性类/死定义）
const nsFindings = []; // { fp, msg }
const bumpNs = (fp, msg) => nsFindings.push({ fp, msg });
for (const [k, locs] of nsVarUse) {
  if (!nsDefined.has(k)) {
    const [nsName, word] = k.split("|");
    const shown = nsName === "metrics" ? word : `--${NS.find((n) => n.name === nsName).prefix.slice(2)}${word}`;
    bumpNs(`悬空var|${k}`, `[悬空var·${nsName}] ${shown} 被消费 ${locs.length} 处（首处 ${locs[0]}）但无定义（${nsName} 命名空间）`);
  }
}
for (const [k, locs] of nsClassFlag) {
  const where = nsDefined.get(k);
  const [nsName, word] = k.split("|");
  const clsPrefix = NS.find((n) => n.name === nsName).cls;
  if (where === "theme") continue; // @theme 定义 → 工具类正常生成
  if (where === "root") {
    bumpNs(`惰性类|${k}`, `[惰性类·${nsName}] ${clsPrefix}-${word} 被消费 ${locs.length} 处（首处 ${locs[0]}）但定义在 :root/@theme 外——Tailwind 4 只从 @theme 生成工具类（shadow-blur-ink 同型陷阱）：移入 @theme 或删类`);
  } else {
    bumpNs(`悬空类|${k}`, `[悬空类·${nsName}] ${clsPrefix}-${word} 被消费 ${locs.length} 处（首处 ${locs[0]}）但无 @theme 定义（类不生成，静默失效）`);
  }
}
for (const [k, where] of nsDefined) {
  if (nsVarUse.has(k) || nsClassUse.has(k)) continue;
  // Tailwind 配对元数据（--text-X--line-height 等）随基础工具类消费——基础档活则配对活
  if (/--(line-height|letter-spacing|font-weight)$/.test(k.split("|")[1])) {
    const base = `${k.split("|")[0]}|${k.split("|")[1].replace(/--(line-height|letter-spacing|font-weight)$/, "")}`;
    if (nsClassUse.has(base) || nsVarUse.has(base)) continue;
  }
  const [nsName, word] = k.split("|");
  const cfg = NS.find((n) => n.name === nsName);
  const shown = cfg.prefix ? `--${cfg.prefix.slice(2)}${word}` : word;
  bumpNs(`死定义|${k}`, `[死定义·${nsName}] ${shown} 定义于 ${where === "theme" ? "@theme" : ":root/裸区"} 但全仓零消费（词表膨胀；PR-069 结案批处置或补消费）`);
}
const nsNow = new Map();
for (const f of nsFindings) nsNow.set(f.fp, (nsNow.get(f.fp) || 0) + 1);
const nsBaseline = loadThemeBaseline();
if (nsBaseline.error) violations.push(`[结构] ${nsBaseline.error}`);
const nsRatchet = compareBaseline(nsBaseline.vocab_ns, nsNow);
for (const [k] of nsRatchet.added) {
  const first = nsFindings.find((f) => f.fp === k);
  violations.push(`${first ? first.msg : k}（基线外新增——契约禁令，存量只减不增）`);
}
for (const [k, was, now] of nsRatchet.stale) {
  violations.push(`[ns快照滞留] ${k}：基线 ${was} → 现存 ${now}（已收敛——请从 theme-baseline.json 删该条目销账）`);
}

// ── ① 悬空消费（消费了但没定义）──
for (const [word, locs] of consumed) {
  if (!defined.has(word)) violations.push(`[悬空消费] ${word} 被消费 ${locs.length} 处（首处 ${locs[0]}）但 index.css 无定义`);
}

// ── ② 死定义（定义了但零消费且非预留/非中间引用）──
// 中间引用豁免：@theme inline 值位里被 var() 引用的 L0 色名（如 --color-accent-bg 的字面角色）
const innerVarRefs = new Set();
for (const m of css.matchAll(/var\((--[a-z0-9-]+)[,)]/g)) innerVarRefs.add(m[1].replace("--color-", "").replace("--", ""));
// shadcn 内部层词汇（primary/sidebar/destructive 系）：消费方在 ui//aria/ 豁免区，
// 本门禁不扫豁免区故统计不到——整类跳过死定义检查（其「业务侧禁用」由检查③执法）
const shadcnDead = (word) => isShadcnWord(word) || word.startsWith("sidebar-") || word.endsWith("-foreground") && !word.startsWith("accent-") && !word.startsWith("text-");
for (const word of defined) {
  if (RESERVED.some((re) => re.test(word))) continue;
  if (consumed.has(word)) continue;
  // index.css 自身引用（工具类/深度层派生）算活词——但 WP-147 连名换装后分类色 step 词
  // 与 vendor 变量同名（--color-cyan-9: var(--cyan-9)），定义行自身就是 innerVarRef，
  // 不得自证活词：step 词形不经此豁免，仍须有真实业务消费
  if (innerVarRefs.has(word) && !STEP_WORD.test(word)) continue;
  if (shadcnDead(word)) continue;       // shadcn 内部层词：消费方在豁免区
  violations.push(`[死定义] --color-${word} 在 index.css 有定义但业务代码零消费（词表膨胀；若为预留语义位请登记 RESERVED）`);
}

// ── ⑦ 预览页镜像对账（W0-4 · B3：公开 token 必在 #/theme 出现）──
// 豁免：分类色 step 词（<族>-<1..12>，WP-147 起按语义抽样展示）与 chart-*/relation-*
//（全量数十字不逐一镜像，抽样区见预览页「分类色」Panel）；命名空间侧只执法 radius 与
// table（B3 范围＝全局角色＋radius＋表格 token；text/shadow/animate 家族不在此列）。
// P0 新角色与新 token 落地时本检查自动要求预览同步。
const PREVIEW = path.join(SRC, "features", "theme-preview", "ThemePreviewView.tsx");
if (!fs.existsSync(PREVIEW)) {
  violations.push("[结构] src/features/theme-preview/ThemePreviewView.tsx 不存在（预览镜像对账无从谈起）");
} else {
  const previewText = fs.readFileSync(PREVIEW, "utf-8");
  // 词边界匹配（WP-147 scope_revision 3 实证假绿修复）：裸子串 includes 会被同前缀长词顶替——
  // 删掉基词 --color-status-warn 镜像后，档桥词 --color-status-warn-2 仍让子串命中，门禁不红
  //（accent-bg 之于 accent-bg-strong、grid-line 之于 grid-line-strong 同型潜伏）。
  const mirrored = (token) => new RegExp(`${token}(?![a-z0-9-])`).test(previewText);
  for (const word of defined) {
    if (/^(chart|relation)-/.test(word) || STEP_WORD.test(word)) continue;
    if (shadcnDead(word)) continue; // shadcn 内部层词：消费方在 ui//aria/ 豁免区，不进业务预览页
    if (!mirrored(`--color-${word}`)) {
      violations.push(`[预览缺镜像] --color-${word} 未出现在 ThemePreviewView（消费者同步义务，契约 §五；新增 token 须同步预览页）`);
    }
  }
  for (const [k] of nsDefined) {
    const [nsName, word] = k.split("|");
    if (nsName !== "radius" && nsName !== "table") continue;
    const shown = nsName === "table" ? `--table-${word}` : `--radius-${word}`;
    if (!previewText.includes(shown)) {
      violations.push(`[预览缺镜像] ${shown} 未出现在 ThemePreviewView（radius/table 族公开 token 须镜像展示）`);
    }
  }
}

if (violations.length === 0) {
  const nsDeadHeld = nsFindings.filter((f) => f.fp.startsWith("死定义")).length;
  console.log(`theme_vocab=ok defined=${defined.size} consumed=${consumed.size} shadcn_roots=${SHADCN_ROOTS.length} ns_defined=${nsDefined.size} ns_baseline_held=${nsFindings.length} (dead=${nsDeadHeld})`);
} else {
  fail(violations);
}
