// SchemaPartitionOverview 消费测试（SCHEMA-IA-001 批3）——分区引用总览面板：六类边画成可见层级。
// 断言口径：①数据全部现算自 schemaTopology 真函数（fixture 走 schemaTopology 而非手拼 topology）；
// ②悬空边全量呈现永不折叠、健康边超阈值折叠可展开；③coverage 门控（ontology 缺席=未知提示而非零）；
// ④ledger 无引用边渲染明示行（schema-shape 已定 ledger/intake 无边）。
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { SchemaPartitionOverview } from "@/features/schema-manager/SchemaPartitionOverview";
import type { TabId } from "@/features/schema-manager/schema-manager-types";
import { schemaTopology } from "@/lib/schema-shape";

function buildEnums(moduleCount: number) {
  const modules: Record<string, { subdomain: string }> = {};
  for (let i = 1; i <= moduleCount; i += 1) modules[`m${i}`] = { subdomain: "s1" };
  return {
    domains: { d1: "域一" },
    subdomains: { d1: [{ id: "s1" }] },
    subdomain_constraints: { s1: { domain_id: "d1" }, ghostRow: { domain_id: "ghost" } },
    tags: { g: ["t1"] },
    tag_aliases: { t1: [] },
    modules,
  };
}

describe("SchemaPartitionOverview", () => {
  it("classification 页签：呈现分区标题/注记、策略→域悬空全量、健康挂靠边", () => {
    const topology = schemaTopology(buildEnums(2));
    render(<SchemaPartitionOverview tab={"domains" as TabId} topology={topology} />);
    expect(screen.getByText(/分区引用总览 · 分类与矩阵/)).toBeInTheDocument();
    expect(screen.getByTestId("schema-overview-kind-policy-domain")).toHaveTextContent("悬空 1");
    expect(screen.getByTestId("schema-overview-kind-policy-domain")).toHaveTextContent("subdomain_constraints.ghostRow");
    expect(screen.getByTestId("schema-overview-kind-module-subdomain")).toHaveTextContent("modules.m1.subdomain → s1");
  });

  it("健康边超过阈值折叠：8 条模块挂靠显示 3 条 + 展开按钮，点击后全量可见", () => {
    const topology = schemaTopology(buildEnums(8));
    render(<SchemaPartitionOverview tab={"taxonomy" as TabId} topology={topology} />);
    const group = screen.getByTestId("schema-overview-kind-module-subdomain");
    expect(group).toHaveTextContent("modules.m1.subdomain → s1");
    expect(group).not.toHaveTextContent("modules.m7.subdomain → s1");
    fireEvent.click(screen.getByRole("button", { name: /展开全部 8 条/ }));
    expect(screen.getByTestId("schema-overview-kind-module-subdomain")).toHaveTextContent("modules.m7.subdomain → s1");
  });

  it("type-system 页签：ontology 缺席时显示未知提示且 allows-relation 组不出现（未知≠零）", () => {
    const topology = schemaTopology(buildEnums(1)); // 不传 ontology
    render(<SchemaPartitionOverview tab={"ontology" as TabId} topology={topology} />);
    expect(screen.getByTestId("schema-partition-overview-coverage")).toHaveTextContent("未知 ≠ 零");
    expect(screen.queryByTestId("schema-overview-kind-allows-relation")).not.toBeInTheDocument();
  });

  it("type-system 页签：ontology 在场时呈现允许关系边", () => {
    const topology = schemaTopology(buildEnums(1), {
      node_types: { a: { allows_relations: ["R"] } },
      relation_types: { R: { source_types: ["a"], target_types: ["a"] } },
    });
    render(<SchemaPartitionOverview tab={"ontology" as TabId} topology={topology} />);
    expect(screen.getByTestId("schema-overview-kind-allows-relation")).toHaveTextContent("node_types.a");
  });

  it("ledger 页签（无引用边分区）：渲染明示行而非空白", () => {
    const topology = schemaTopology(buildEnums(1));
    render(<SchemaPartitionOverview tab={"versions" as TabId} topology={topology} />);
    expect(screen.getByTestId("schema-partition-overview-empty")).toHaveTextContent("无跨文件引用边");
  });
});

describe("SchemaPartitionOverview 编辑性徽标（批5 角色面）", () => {
  it("admin 页签对象在无 admin 角色主体下转「需 admin」警示徽标", () => {
    const topology = schemaTopology(buildEnums(1));
    render(<SchemaPartitionOverview tab={"domains" as TabId} topology={topology} roles={["review"]} />);
    const badge = screen.getByTestId("schema-overview-editability-知识域/子域");
    expect(badge).toHaveTextContent("需 admin");
  });
  it("同一对象在 admin 主体下为「可编辑」；身份未知回静态面", () => {
    const topology = schemaTopology(buildEnums(1));
    const { rerender } = render(<SchemaPartitionOverview tab={"domains" as TabId} topology={topology} roles={["admin"]} />);
    expect(screen.getByTestId("schema-overview-editability-知识域/子域")).toHaveTextContent("可编辑");
    rerender(<SchemaPartitionOverview tab={"domains" as TabId} topology={topology} roles={null} />);
    expect(screen.getByTestId("schema-overview-editability-知识域/子域")).toHaveTextContent("可编辑");
  });
});
