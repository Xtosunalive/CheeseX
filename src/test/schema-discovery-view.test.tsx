import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SchemaManagerView } from "@/features/schema-manager/SchemaManagerView";
import { useSchemaManagerStore } from "@/features/schema-manager/schema-manager-store";

const absorbDiscovery = vi.hoisted(() => vi.fn());

vi.mock("@/features/schema-manager/schema-manager-api", () => ({
  fetchEnums: vi.fn().mockResolvedValue({ revision: "sha256:enums", domains: { arch: "架构" }, subdomains: { arch: ["architecture"] }, layers: [], categories: [] }),
  previewEnumsChanges: vi.fn(),
}));
vi.mock("@/features/schema-manager/schema-write-api", () => ({
  writeOntology: vi.fn(),
  writeEnums: vi.fn(),
  writeDependencies: vi.fn(),
  writeVersions: vi.fn(),
  writeProductIdentity: vi.fn(),
  freezeVersion: vi.fn(),
  absorbDiscovery,
  rollbackEnums: vi.fn(),
}));
vi.mock("@/features/schema-manager/schema-discovery-api", () => ({
  fetchDiscovery: vi.fn().mockResolvedValue({
    discovery: {
      layers: [{ value: "wild-layer", count: 2, files: ["a.md", "b.md"] }],
      categories: [],
      subdomains: [{ value: "wild-sub", count: 1, files: ["c.md"] }],
    },
    counts: { layers: 1, categories: 0, subdomains: 1, total: 2 },
  }),
  absorbFormalValue: vi.fn(),
  absorbAliasItems: vi.fn().mockResolvedValue({ enums: { domains: { arch: "架构" }, subdomains: { arch: ["architecture"] }, layers: [], categories: [] }, absorbed: [] }),
}));
describe("Schema discovery P0A", () => {
  beforeEach(() => {
    absorbDiscovery.mockReset();
    absorbDiscovery.mockResolvedValue({ category: "discovery", revision: "sha256:after" });
    useSchemaManagerStore.setState({
      activeTab: "domains", enums: null, savedEnums: null, status: "idle", error: null,
      saveStatus: "clean", saveError: null, discovery: null, discoveryRequest: { status: "idle", error: null },
      discoveryOperationError: null, absorbingValue: null,
    });
  });

  it("renders discovery groups without exposing the retired alias direct-write action", async () => {
    render(<SchemaManagerView />);
    await screen.findByRole("button", { name: "未收录值" });
    fireEvent.click(screen.getByRole("button", { name: "未收录值" }));
    await screen.findByText("wild-layer");
    expect(screen.queryByText(/提交已确认别名/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /归并目标/ })).not.toBeInTheDocument();
    expect(screen.getByText(/野生标签不自动吞并/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "提交" })).toHaveLength(2);
  });

  it("requires an explicit knowledge domain before formal subdomain absorb", async () => {
    render(<SchemaManagerView />);
    await screen.findByRole("button", { name: "未收录值" });
    fireEvent.click(screen.getByRole("button", { name: "未收录值" }));
    await screen.findByText("wild-sub");
    const row = screen.getByText("wild-sub").closest("div.rounded-lg")!;
    const button = Array.from(row.querySelectorAll("button")).find((item) => item.textContent === "提交")!;
    expect(button).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "wild-sub 归属知识域" }));
    fireEvent.click(screen.getByRole("option", { name: "架构" }));
    // Master 2026-10-17 裁决「发现的时候就写好」：subdomain 晋升 label 必填——选域后仍禁用，填 label 才启用
    expect(button).toBeDisabled();
    fireEvent.change(screen.getByRole("textbox", { name: "wild-sub 标签" }), { target: { value: "野生子域" } });
    await waitFor(() => expect(button).not.toBeDisabled());
    fireEvent.click(button);
    await waitFor(() => expect(absorbDiscovery).toHaveBeenCalledWith("sha256:enums", { field: "subdomains", value: "wild-sub", domain: "arch", label: "野生子域" }));
  });
});
