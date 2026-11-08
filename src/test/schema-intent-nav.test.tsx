// SchemaIntentNav／SchemaDanglingNotice 装配测试——复用域 schema-shape 的真实消费面（SCHEMA-IA-001 批2）
// 断言口径：叶名唯一来源 TAB_LABELS（seq202 延续）；徽标/警示条数据全部现算自 schemaTopology（零第二份事实）；
// coverage 门控（ontology 缺席≠零悬空——type-system 徽标隐藏而非显示 0）。
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SchemaDanglingNotice } from "@/features/schema-manager/SchemaDanglingNotice";
import { SchemaIntentNav } from "@/features/schema-manager/SchemaIntentNav";
import { TAB_LABELS, type TabId } from "@/features/schema-manager/schema-manager-types";
import { schemaTopology } from "@/lib/schema-shape";

const cleanTopology = schemaTopology(
  {
    domains: { d1: "域" },
    subdomains: { d1: [{ id: "s1" }] },
    subdomain_constraints: { s1: { domain_id: "d1" } },
    tags: { g: ["t1"] },
    tag_aliases: { t1: [] },
    modules: { m: { subdomain: "s1" } },
  },
  { node_types: { a: { allows_relations: ["R"] } }, relation_types: { R: { source_types: ["a"], target_types: ["a"] } } },
);

const dirtyTopology = schemaTopology(
  {
    domains: { d1: "域" },
    subdomains: { d1: [{ id: "s1" }] },
    subdomain_constraints: { ghostRow: { domain_id: "ghost" }, offRow: { domain_id: "d1" } },
    tags: { g: ["t1"] },
    tag_aliases: { ghostAlias: [] },
    modules: { m: { subdomain: "ghost-s" } },
  },
  {
    node_types: { service: { allows_relations: ["CONSUMES", "DEPENDS_ON"] } },
    relation_types: { DEPENDS_ON: { source_types: ["ghost-node"], target_types: [] } },
  },
);

describe("SchemaIntentNav（意图分区导航——消费 schemaPartitions 现算）", () => {
  it("五分区标题齐备且互不重名", () => {
    render(<SchemaIntentNav activeTab="domains" onSelect={() => {}} topology={cleanTopology} />);
    for (const title of ["分类与矩阵", "词表与标签", "类型系统", "账与版本", "未收录值"]) {
      // 单页签分区（未收录值）标题与叶名同词——getAllByText 断言存在即可
      expect(screen.getAllByText(title).length).toBeGreaterThan(0);
    }
  });

  it("13 页签叶名 ≡ TAB_LABELS 且逐叶可点达（onSelect 收到 TabId）", () => {
    const onSelect = vi.fn();
    render(<SchemaIntentNav activeTab="domains" onSelect={onSelect} topology={cleanTopology} />);
    for (const label of Object.values(TAB_LABELS)) {
      fireEvent.click(screen.getByRole("button", { name: label }));
    }
    expect(onSelect.mock.calls.map(([tab]) => tab).sort()).toEqual((Object.keys(TAB_LABELS) as TabId[]).sort());
  });

  it("active 叶高亮（aria-current）随 activeTab 移动", () => {
    const { rerender } = render(<SchemaIntentNav activeTab="ontology" onSelect={() => {}} topology={cleanTopology} />);
    expect(screen.getByRole("button", { name: TAB_LABELS.ontology }).getAttribute("aria-current")).toBe("true");
    expect(screen.getByRole("button", { name: TAB_LABELS.domains }).getAttribute("aria-current")).toBe("false");
    rerender(<SchemaIntentNav activeTab="tags" onSelect={() => {}} topology={cleanTopology} />);
    expect(screen.getByRole("button", { name: TAB_LABELS.tags }).getAttribute("aria-current")).toBe("true");
  });

  it("悬空徽标现算自 topology：classification 3／vocabulary 1／type-system 2；ledger/intake 无徽标", () => {
    render(<SchemaIntentNav activeTab="domains" onSelect={() => {}} topology={dirtyTopology} />);
    expect(screen.getByTestId("intent-nav-badge-classification")).toHaveTextContent("3");
    expect(screen.getByTestId("intent-nav-badge-vocabulary")).toHaveTextContent("1");
    expect(screen.getByTestId("intent-nav-badge-type-system")).toHaveTextContent("2");
    expect(screen.queryByTestId("intent-nav-badge-ledger")).not.toBeInTheDocument();
    expect(screen.queryByTestId("intent-nav-badge-intake")).not.toBeInTheDocument();
  });

  it("干净拓扑零徽标；coverage 门控：ontology 缺席时 type-system 徽标隐藏（宁缺勿假）", () => {
    const { rerender } = render(<SchemaIntentNav activeTab="domains" onSelect={() => {}} topology={cleanTopology} />);
    expect(screen.queryByTestId("intent-nav-badge-classification")).not.toBeInTheDocument();
    // 手工构造矛盾面：type-system 有悬空但 coverage.ontology=false（数据缺席）——徽标必须不显示
    const partialTopology = { ...dirtyTopology, coverage: { ontology: false } };
    rerender(<SchemaIntentNav activeTab="domains" onSelect={() => {}} topology={partialTopology} />);
    expect(screen.queryByTestId("intent-nav-badge-type-system")).not.toBeInTheDocument();
    expect(screen.getByTestId("intent-nav-badge-classification")).toHaveTextContent("3");
  });

  it("topology=null（数据未就绪）：导航仍可用、全部分区无徽标", () => {
    render(<SchemaIntentNav activeTab="domains" onSelect={() => {}} topology={null} />);
    expect(screen.getByRole("button", { name: TAB_LABELS.versions })).toBeInTheDocument();
    expect(screen.queryByTestId(/intent-nav-badge-/)).not.toBeInTheDocument();
  });
});

describe("SchemaDanglingNotice（悬空警示条——danglingForTab 一行取数）", () => {
  it("当前页签归属分区有悬空：渲染条目（from 定位串＋to＋语义标签），计数现算", () => {
    render(<SchemaDanglingNotice tab="domains" topology={dirtyTopology} />);
    const notice = screen.getByTestId("schema-dangling-notice");
    expect(notice).toHaveTextContent("配置悬空引用 3 处");
    expect(notice).toHaveTextContent("modules.m.subdomain");
    expect(notice).toHaveTextContent("模块挂靠的子域不存在");
  });

  it("零悬空或页签分区无悬空：不渲染（能改变才呈现）", () => {
    const { rerender } = render(<SchemaDanglingNotice tab="domains" topology={cleanTopology} />);
    expect(screen.queryByTestId("schema-dangling-notice")).not.toBeInTheDocument();
    rerender(<SchemaDanglingNotice tab="versions" topology={dirtyTopology} />);
    expect(screen.queryByTestId("schema-dangling-notice")).not.toBeInTheDocument();
  });

  it("topology=null：不渲染", () => {
    render(<SchemaDanglingNotice tab="tags" topology={null} />);
    expect(screen.queryByTestId("schema-dangling-notice")).not.toBeInTheDocument();
  });
});
