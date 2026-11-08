#!/usr/bin/env node
// Component: Theme-CSS-Graph（W0-3 · 契约 A2：门禁执法面扩到 CSS 图）
// @responsible: 收集主题门禁的 CSS 执法面，两条通道——
//   ① 图内 CSS：从 src/index.css 出发解析 @import（相对路径递归；包名/URL/裸
//      说明符跳过——"tailwindcss"、"@xyflow/react/dist/style.css" 不是仓内文件）。
//      preset 子文件（src/styles/*.preset.css）按契约由 index.css 顶部 @import，
//      由此自动入图。
//   ② 组件直挂 CSS：业务 ts/tsx 里 `import "./x.css"` 的相对样式（CardNav 模式）。
//      契约不允许默默存在的法外样式文件——一律纳入同等执法（豁免区除外）。
// index.css 自身不入「子文件」集合：它有自己的 L0/@theme 专属规则（tokens 检查④）。
// 另提供 parseVarDefinitions：按 @theme 块内外分类 var 定义位置（惰性工具类判定用
// ——Tailwind 4 只从 @theme 生成工具类，:root 定义的 --shadow-* 等被类消费即惰性）。
// 模式：fail-closed——index.css 缺失由调用方判定；图内 import 指向不存在的文件跳过
//      （构建期 Tailwind 自会报错，本图不做重复执法）。
import fs from "node:fs";
import path from "node:path";

const GRAPH_EXEMPT = [/src[\/\\]components[\/\\]ui[\/\\]/, /src[\/\\]components[\/\\]aria[\/\\]/, /src[\/\\]test[\/\\]/];

function walk(dir, acc) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const stat = fs.statSync(full);
    if (stat.isDirectory()) walk(full, acc);
    else if (name.endsWith(".tsx") || (name.endsWith(".ts") && !name.endsWith(".d.ts"))) acc.push(full);
  }
  return acc;
}

export function collectCssGraph({ root, src }) {
  const indexCss = path.join(src, "index.css");
  const empty = { root, indexCss, graphFiles: [], componentCss: [], subFiles: [] };
  if (!fs.existsSync(indexCss)) return empty;

  // B3 修复（红队复核）：specifier 先剥 ?query/#hash 再判后缀；相对（./ ../）、
  // 绝对（/ 开头按 ROOT 解析）都收；包名（tailwindcss、@xyflow/...）与 http/data URL 不收。
  const resolveImport = (spec, fromDir) => {
    const clean = spec.split("?")[0].split("#")[0];
    if (!clean.endsWith(".css")) return null;
    if (clean.startsWith("./") || clean.startsWith("../")) return path.resolve(fromDir, clean);
    if (clean.startsWith("/")) return path.resolve(root, clean.slice(1));
    return null;
  };
  const parseImports = (file) => {
    // N3 修复：注释里的 @import 不入图（先剥注释再匹配）
    const text = stripCssComments(fs.readFileSync(file, "utf-8")).join("\n");
    const out = [];
    // 引号形态（"x" / 'x'）＋无引号 url token（url(./x.css)）——B3 通道 2
    const re = /@import\s+(?:url\(\s*)?(?:["']([^"']+)["']|([^"'\s)]+))\s*\)?[^;]*;/g;
    for (const m of text.matchAll(re)) {
      const r = resolveImport(m[1] || m[2], path.dirname(file));
      if (r) out.push(r);
    }
    return out;
  };

  // ① @import 递归（防环：seen 集合）
  const seen = new Set([indexCss]);
  const graphFiles = [indexCss];
  const queue = [indexCss];
  while (queue.length) {
    for (const dep of parseImports(queue.shift())) {
      if (seen.has(dep) || !fs.existsSync(dep)) continue;
      seen.add(dep);
      graphFiles.push(dep);
      queue.push(dep);
    }
  }

  // ② 组件直挂 CSS（相对 import；去重于图内）
  const componentCss = [];
  for (const full of walk(src, [])) {
    const rel = path.relative(root, full).split(path.sep).join("/");
    if (GRAPH_EXEMPT.some((re) => re.test(rel))) continue;
    const text = fs.readFileSync(full, "utf-8");
    // B3 通道 4/5：动态 import() 与 require() 形态一并发现
    for (const m of text.matchAll(/(?:import\s+[^;]*?|import\s*\(\s*|require\s*\(\s*)["'](\.[^"']+\.css)["']/g)) {
      const p = path.resolve(path.dirname(full), m[1]);
      if (fs.existsSync(p) && !seen.has(p)) {
        seen.add(p);
        componentCss.push(p);
      }
    }
  }

  return { root, indexCss, graphFiles, componentCss, subFiles: [...graphFiles.slice(1), ...componentCss] };
}

// var 定义位置分类：@theme 块内 = "theme"（工具类生成源），其余（:root/裸区/子文件）= "root"。
// 块跟踪逻辑与 check-theme-tokens 检查④同型（行首真实指令 + 花括号深度）。
// 匹配口径：先剥注释（防 /* --x: … */ 溯源标注成幻影定义），再行内全量匹配
// `--名字:`（单行内联 :root { --a: 1 } 同样收录；var() 引用无尾冒号不会误命中）。
export function parseVarDefinitions(cssText) {
  const defs = new Map(); // varName -> "theme" | "root"
  let inTheme = false;
  let depth = 0;
  stripCssComments(cssText).forEach((line) => {
    if (/^\s*@theme\s+(?:inline\s+)?\{/.test(line)) {
      inTheme = true;
      depth = 1;
      return;
    }
    if (inTheme) {
      depth += (line.match(/\{/g) || []).length;
      depth -= (line.match(/\}/g) || []).length;
      if (depth <= 0) inTheme = false;
    }
    for (const m of line.matchAll(/(--[a-z0-9-]+)\s*:/g)) {
      defs.set(m[1], inTheme ? "theme" : "root");
    }
  });
  return defs;
}

// CSS 行级注释剥离（保持行号）：返回每行的"有效文本"（块注释跨行状态机）。
// 用途：字面值/裸值扫描不误伤 /* … */ 注释里的溯源标注（契约 §2 注释合法）。
export function stripCssComments(cssText) {
  const out = [];
  let inBlock = false;
  for (const line of cssText.split("\n")) {
    let effective = line;
    if (inBlock) {
      const end = effective.indexOf("*/");
      if (end === -1) {
        out.push("");
        continue;
      }
      effective = effective.slice(end + 2);
      inBlock = false;
    }
    // 行内可能有多段 /*…*/；逐段剥离，未闭合则进入块状态
    let s = effective;
    let result = "";
    for (;;) {
      const start = s.indexOf("/*");
      if (start === -1) {
        result += s;
        break;
      }
      const end = s.indexOf("*/", start);
      if (end === -1) {
        inBlock = true;
        result += s.slice(0, start);
        break;
      }
      result += s.slice(0, start) + " ";
      s = s.slice(end + 2);
    }
    out.push(result);
  }
  return out;
}
