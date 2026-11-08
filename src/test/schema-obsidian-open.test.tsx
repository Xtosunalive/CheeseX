import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ObsidianLink } from "@/components/obsidian";
import { toast } from "@/components/ui/sonner";
import { openObsidianFile } from "@/lib/obsidian";

vi.mock("@/components/ui/sonner", () => ({ toast: { error: vi.fn() } }));

function response(status: number, body: object) {
  return Promise.resolve(new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  }));
}

describe("shared Obsidian opener", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(toast.error).mockReset();
  });

  it("posts the normalized source path to the backend-owned opener", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(() => response(200, {
      success: true,
      data: { opened: true, sourcePath: "知识库/wiki/entities/sample.md", vaultName: "Test Vault" },
      trace_id: "trace-1",
    }));

    const result = await openObsidianFile("知识库\\wiki\\entities\\sample.md");

    expect(result.opened).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("/api/system/open-obsidian", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ sourcePath: "知识库/wiki/entities/sample.md" }),
    }));
  });

  it("uses the same opener from UI buttons and exposes backend failures", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() => response(404, {
      success: false,
      error: "来源文档不存在或已移动",
      error_code: "SOURCE_NOT_FOUND",
      message: "来源文档不存在或已移动",
      trace_id: "trace-2",
    }));
    render(<ObsidianLink sourcePath="知识库/wiki/entities/missing.md">打开 Obsidian</ObsidianLink>);

    fireEvent.click(screen.getByRole("button", { name: "打开 Obsidian" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("来源文档不存在或已移动"));
  });
});
