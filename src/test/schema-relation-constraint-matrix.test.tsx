import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RelationConstraintMatrix } from "@/features/schema-manager/components/RelationConstraintMatrix";

describe("RelationConstraintMatrix", () => {
  it("renders source and target constraints and selects the relation", () => {
    const onSelect = vi.fn();
    render(<RelationConstraintMatrix nodeTypes={{ System: { description: "系统", category: "", color: "gray", icon: "box", allows_relations: [] }, Module: { description: "模块", category: "", color: "gray", icon: "box", allows_relations: [] } }} relationTypes={{ DEPENDS_ON: { description: "", direction: "directed", weight_default: 1, weight_range: [0, 1], versionable: true, source_types: ["System"], target_types: ["Module"], label_cn: "依赖", assertion_policies: [{ source_kind: "typed_wikilink", producer: "entity-compliance.body-relations", decision_mode: "deterministic", required_evidence: [], working_projection: "approved_only", formal_consumers: [] }] } }} onSelectRelation={onSelect} />);
    expect(screen.getByText("系统")).toBeInTheDocument(); expect(screen.getByText("模块")).toBeInTheDocument(); expect(screen.getByText("依赖")).toBeInTheDocument();
    expect(screen.queryByText("DEPENDS_ON")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button")); expect(onSelect).toHaveBeenCalledWith("DEPENDS_ON");
  });
});
