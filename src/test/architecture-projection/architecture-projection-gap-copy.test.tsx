import { readFileSync, readdirSync, statSync } from "node:fs";
// checker: check:term-copy（term-copy 域执法）＋本文件旧词回流面
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import ArchProjToolbar from "@/components/architecture-projection/ArchitectureProjectionToolbar";
import { TERM } from "@/constants/term-const";

// 缺口三态词单源守卫（2026-10-28）：这三个词住 TERM「架构投影缺口诊断」段，组件只准引用。
// 判定口径单源＝server/services/projection/master-graph-service.cjs::pruneToSubgraph（2 跳上限）。
// 旧词（隐式／未连通／缺失种子／种子）是「设计未统一管理」期的组件私设字面量——禁止回流。
const LEGACY_TERMS = ["隐式路径", "隐式", "未连通", "缺失种子", "种子"];
const COMPONENT_DIR = path.resolve(__dirname, "../../components/architecture-projection");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) ? [full] : [];
  });
}

// 去注释：块注释＋行注释（// 后全是文字说明，不含 URL 形态陷阱）
const stripComments = (src: string) =>
  src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|\n)\s*\/\/[^\n]*/g, "$1");

describe("架构投影缺口诊断文案单源", () => {
  it("TERM 缺口三态词齐备（缺失组件／间接关联／未发现关联）", () => {
    expect(TERM.GAP_MISSING_COMPONENT).toBe("缺失组件");
    expect(TERM.GAP_INDIRECT).toBe("间接关联");
    expect(TERM.GAP_UNRELATED).toBe("未发现关联");
  });

  it("工具栏三态筛选按钮文案取自 TERM（非私设字面量）", () => {
    const noop = vi.fn();
    render(
      <ArchProjToolbar
        filter="all"
        onFilterChange={noop}
        counts={{ implicit: 0, unresolved: 0, missing: 0 }}
        onZoomIn={noop}
        onZoomOut={noop}
        onFitView={noop}
        onToggleFullscreen={noop}
        isFullscreen={false}
        fullscreenAvailable
        onClearHighlight={noop}
        hasHighlight={false}
      />,
    );
    // 计数为 0 时不渲染数字，按钮文本＝TERM 值本身
    expect(screen.getByText(TERM.GAP_INDIRECT)).toBeDefined();
    expect(screen.getByText(TERM.GAP_UNRELATED)).toBeDefined();
    expect(screen.getByText(TERM.GAP_MISSING_COMPONENT)).toBeDefined();
    // 「全部」是筛选哨兵值，属数据非文案，不入 TERM（reuse-domains term-copy 段裁定）
    expect(screen.getByText("全部")).toBeDefined();
  });

  it("旧词未回流到 architecture-projection 组件（注释除外）", () => {
    const offenders: string[] = [];
    for (const file of walk(COMPONENT_DIR)) {
      const body = stripComments(readFileSync(file, "utf8"));
      for (const term of LEGACY_TERMS) {
        if (body.includes(term)) offenders.push(`${path.relative(COMPONENT_DIR, file)} 含「${term}」`);
      }
    }
    expect(
      offenders,
      `缺口诊断旧词回流：\n${offenders.join("\n")}\n（单源＝TERM「架构投影缺口诊断」段；句子级文案可内联，三态词禁止）`,
    ).toEqual([]);
  });
});
