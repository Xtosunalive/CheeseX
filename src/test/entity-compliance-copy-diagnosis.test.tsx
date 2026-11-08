// @responsible: seq210 复制诊断的字段中文名——后端 EDIT 分支下发英文键，复制文本须与页面一致取中文
// @inputs: EntityComplianceCard 渲染 + clipboard 桩（vitest）
// @outputs: vitest 断言（正常路径 + 同名不同义键的反向锁）
import { describe, it, expect, vi, beforeEach } from "vitest";
import { EntityComplianceCard } from "@/features/entity-compliance/EntityComplianceCard";
import type { EntityComplianceResult } from "@/features/entity-compliance/entity-compliance-types";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TERM } from "@/constants/term-const";

const writeText = vi.fn();

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
});

function copyOf(entity: EntityComplianceResult): string {
  render(<MemoryRouter><EntityComplianceCard entity={entity} /></MemoryRouter>);
  fireEvent.click(screen.getByTitle("复制检查结果"));
  expect(writeText).toHaveBeenCalledTimes(1);
  return String(writeText.mock.calls[0][0]);
}

const base = {
  entityId: "copy-target", fileName: "copy.md", sourceKey: "知识库/wiki/entities/copy.md",
  sourceExists: true, architectureIntent: "active", score: 60,
  blockerCount: 0, warningCount: 1, infoCount: 0,
};

describe("复制诊断的字段中文名（seq210）", () => {
  it("后端 EDIT 分支下发英文键时，复制文本取中文（不再中英混排）", () => {
    const text = copyOf({
      ...base,
      title: "可观测性",
      sourceType: "entity",
      groups: [{ id: "identity", label: "受管属性", checks: [
        // 后端 EDIT 分支真实形态：label === field（英文键），PropertyCheckRow 界面上已派生为中文
        { ruleId: "F05", field: "arch_layer", label: "arch_layer", severity: "warn", passed: false, editable: true, value: "", message: "尚未填写" },
        { ruleId: "F07", field: "module", label: "module", severity: "warn", passed: false, editable: true, value: "", message: "尚未填写" },
      ] }],
    } as EntityComplianceResult);
    expect(text).toContain("- 架构分层: 尚未填写"); // WP-035：剪贴板去规则编号
    expect(text).toContain("- 产品模块: 尚未填写");
    // 名字位置上不再出现裸英文键（message 里仍可出现，故只断言名字段）
    expect(text).not.toMatch(/\*\*F05\*\* arch_layer/);
  });

  it("反向锁：文章域 title 保持「标题」，不得被误换成实体域的「实体名称」", () => {
    // title 是同名不同义键：实体域=实体名称 / 文章域=标题。
    // 文章域后端已下发中文（label !== field），复制文本必须原样保留，不能走实体域优先的兜底。
    const text = copyOf({
      ...base,
      title: "强制入主",
      sourceType: "standard-article",
      groups: [{ id: "article_identity", label: "文章身份", checks: [
        { ruleId: "A01", field: "title", label: "标题", severity: "error", passed: false, editable: true, value: "", message: "title 是标准文章必填字段" },
        { ruleId: "A03", field: "product", label: "产品", severity: "error", passed: false, editable: true, value: "", message: "尚未填写" },
      ] }],
    } as EntityComplianceResult);
    expect(text).toContain("- 标题: title 是标准文章必填字段");
    expect(text).toContain("- 产品: 尚未填写");
    expect(text).not.toContain("实体名称");
  });

  // 退化形态：标题曾写死为「## 实体：」，标准文章复制出来的诊断书对象错位。
  // 注：每个用例只渲染一次——同用例内两次 render 会让 getByTitle 命中多个按钮。
  it("标准文章的诊断书标题写「标准文章」，不得写成「实体」", () => {
    const text = copyOf({
      ...base,
      title: "强制入主",
      sourceType: "standard-article",
      groups: [{ id: "article_identity", label: "文章身份", checks: [
        { ruleId: "A01", field: "title", label: "标题", severity: "error", passed: false, editable: true, value: "", message: "title 是标准文章必填字段" },
      ] }],
    } as EntityComplianceResult);
    expect(text.startsWith("## 标准文章：强制入主")).toBe(true);
    expect(text).not.toContain(`## ${TERM.ENTITY}：`);
  });

  it("反向：非文章仍写「实体」，不得被这次改动波及", () => {
    const text = copyOf({
      ...base,
      title: "可观测性",
      sourceType: "entity",
      groups: [{ id: "identity", label: "受管属性", checks: [
        { ruleId: "F05", field: "arch_layer", label: "arch_layer", severity: "warn", passed: false, editable: true, value: "", message: "尚未填写" },
      ] }],
    } as EntityComplianceResult);
    expect(text.startsWith(`## ${TERM.ENTITY}：可观测性`)).toBe(true);
    expect(text).not.toContain("标准文章");
  });

  // PR-021：徽标曾写「实体源文档」、标题写「图谱实体」——两个自造词对同一对象各叫各的。
  // 本用例锁的是「两处叫法一致」这件事本身：判据锚在术语常量（不是抄死的汉字），
  // 故字典改名两侧同变仍绿，但任何一处重新写死自造词都会立刻红。
  it("类型徽标与复制标题对同一对象叫法一致，且都取自术语常量表（PR-021）", () => {
    const { container } = render(<MemoryRouter><EntityComplianceCard entity={{
      ...base,
      title: "可观测性",
      sourceType: "entity",
      groups: [{ id: "identity", label: "受管属性", checks: [
        { ruleId: "F05", field: "arch_layer", label: "arch_layer", severity: "warn", passed: false, editable: true, value: "", message: "尚未填写" },
      ] }],
    } as EntityComplianceResult} /></MemoryRouter>);
    fireEvent.click(screen.getByTitle("复制检查结果"));
    const text = String(writeText.mock.calls[0][0]);
    // 徽标侧：卡片上唯一承载对象类型的元素
    expect(container.textContent).toContain(TERM.ENTITY);
    // 标题侧：复制出来的诊断书
    expect(text.startsWith(`## ${TERM.ENTITY}：可观测性`)).toBe(true);
    // 两个自造词都不得重现
    expect(container.textContent).not.toContain("实体源文档");
    expect(container.textContent).not.toContain("图谱实体");
  });
});
