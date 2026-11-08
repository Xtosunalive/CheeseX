import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import ArchProjEvidence from "@/components/architecture-projection/ArchitectureProjectionEvidence";

describe("ArchProjEvidence", () => {
  it("renders implicit path evidence", () => { render(<ArchProjEvidence evidence={{ type:"implicit_path", label:"p", sourceNodeId:"a", targetNodeId:"b", pathNodeIds:["a","m","b"], isImplicit:true }} onClose={vi.fn()} onHighlight={vi.fn()} onClearHighlight={vi.fn()} />); expect(screen.getByText("a → m → b")).toBeDefined(); expect(screen.getByRole("button", { name: "关闭证据面板" })).toBeDefined(); });
  it("renders unresolved pair", () => { render(<ArchProjEvidence evidence={{ type:"unresolved_pair", label:"u", pairNodes:{nodeA:"x",nodeB:"y"} }} onClose={vi.fn()} onHighlight={vi.fn()} onClearHighlight={vi.fn()} />); expect(screen.getByText("x")).toBeDefined(); });
  it("renders missing seed", () => { render(<ArchProjEvidence evidence={{ type:"missing_seed", label:"m", sourceNodeId:"ghost" }} onClose={vi.fn()} onHighlight={vi.fn()} onClearHighlight={vi.fn()} />); expect(screen.getByText("ghost")).toBeDefined(); });
  it("renders dataFreshness in success", () => { render(<ArchProjEvidence evidence={{ type:"success", label:"ok", dataFreshness:{fresh:true,ageHours:0.5,updatedAt:"t",version:"1"} }} onClose={vi.fn()} onHighlight={vi.fn()} onClearHighlight={vi.fn()} />); expect(screen.getByText(/新鲜/)).toBeDefined(); });
  it("highlight button calls onHighlight", () => { const fn=vi.fn(); render(<ArchProjEvidence evidence={{ type:"implicit_path", label:"p", pathNodeIds:["n1"] }} onClose={vi.fn()} onHighlight={fn} onClearHighlight={vi.fn()} />); fireEvent.click(screen.getByText("在拓扑中高亮")); expect(fn).toHaveBeenCalledWith(["n1"]); });
});
