// 归一化守卫（WP 批 2026-10-29 Master「归一化管理」）：列表工具条唯一实现＝
// src/components/table-toolbar。features/ 禁手写药丸容器类与手写搜索 label 块。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FORBIDDEN = [
  "relative min-w-56 flex-1", // 手写搜索 label 块（→ TableToolbarSearch）
  "flex-wrap items-center gap-1 rounded-lg bg-surface-root", // 手写药丸容器（→ TableToolbar）
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

describe("TableToolbar 归一化守卫", () => {
  it("features/ 无手写工具条容器与搜索块（唯一实现＝table-toolbar 组件）", () => {
    const root = join(process.cwd(), "src/features");
    const violations: string[] = [];
    for (const file of walk(root)) {
      const content = readFileSync(file, "utf8");
      for (const marker of FORBIDDEN) {
        if (content.includes(marker)) violations.push(`${file.replace(root + "/", "")}: ${marker.slice(0, 30)}…`);
      }
    }
    expect(violations, `手写工具条回流：\n${violations.join("\n")}\n（改用 TableToolbar/TableToolbarSearch）`).toEqual([]);
  });
});
