// Component: Null-Segment-Guard（数据域治理批 A6——check:schema-writers 检查面⑧的纯函数面）
// @responsible: edited_by_tab=null 且非 reserved 的 enums 段（页面不可编辑段）的越权直写检测。
//               纯函数与门禁执行分离：本文件可被单测直接 import（checker 是顶层执行脚本，import 即跑）。
// @context: theschema-roles.json 段级纪律——null 段=只读账（lifecycle/category_map/subdomain_layer_map
//           等运行消费段）；reserved=预留位（登记在册、物理允许缺失，同样不得代码直写？——否：
//           reserved 不在本面扫描集，因其「未落物理」无被写语义；机器要写它之日即矩阵落地之时，
//           届时改登记〔edited_by_tab 或 generator〕即自动出/入本面）。
import fs from "node:fs";
import path from "node:path";

/** 从 theschema-roles.json 注册表对象收集 null 段名集（edited_by_tab=null/缺省 且非 reserved；复合段名拆分）。 */
export function collectNullSegments(registry) {
  const entry = ((registry && registry.entries) || []).find((e) => e.file === "data/theschema/enums.yaml");
  const names = new Set();
  for (const seg of (entry && entry.segments) || []) {
    // PR-156 刀二：effective_role=derived-view 段豁免——派生视图段的机器写=派生机制本体
    // （writeEnums 随写重算 arch_categories）；人通道直改另有 B1 403 DERIVED_SEGMENT_READ_ONLY 拦。
    if ((seg.edited_by_tab === null || seg.edited_by_tab === undefined) && seg.status !== "reserved" && seg.effective_role !== "derived-view") {
      for (const n of String(seg.segment || "").split("+").map((x) => x.trim()).filter(Boolean)) names.add(n);
    }
  }
  return [...names];
}

/** 扫描文件内容里的 YAML CST 直写（doc.set("<null段>", …)）。
 * files: [{ rel|path, content }]；返回 [{ file, line, segment }]。 */
export function scanNullSegmentDirectWrites({ nullSegments, files }) {
  const hits = [];
  const segs = (nullSegments || []).filter(Boolean);
  if (!segs.length || !files || !files.length) return hits;
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(`\\.set\\(\\s*["'](${segs.map(escapeRe).join("|")})["']\\s*,`);
  for (const f of files) {
    const lines = String(f.content || "").split("\n");
    lines.forEach((line, i) => {
      const m = line.match(pattern);
      if (m) hits.push({ file: f.rel || f.path, line: i + 1, segment: m[1] });
    });
  }
  return hits;
}

/** 递归收集 .cjs/.mjs 文件（跳过 node_modules／__tests__／fixtures）。门禁接线用。 */
export function collectJsFiles(rootDir) {
  const out = [];
  const skip = new Set(["node_modules", "__tests__", "fixtures"]);
  const walk = (dir) => {
    let items;
    try {
      items = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const item of items) {
      if (skip.has(item.name)) continue;
      const full = path.join(dir, item.name);
      if (item.isDirectory()) walk(full);
      else if (/\.(cjs|mjs)$/.test(item.name)) out.push(full);
    }
  };
  walk(rootDir);
  return out;
}
