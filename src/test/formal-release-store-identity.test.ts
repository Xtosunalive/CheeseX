import { beforeEach, describe, expect, it, vi } from "vitest";
import { fetchTopology } from "@/features/dashboard/dashboard-api";
import { apiFetchJson } from "@/lib/api";
import { useGraphStore } from "@/lib/graph-data";
import { useTopologyStore } from "@/lib/topology-store";

vi.mock("@/features/dashboard/dashboard-api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/features/dashboard/dashboard-api")>();
  return { ...actual, fetchTopology: vi.fn() };
});

vi.mock("@/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api")>();
  return { ...actual, apiFetchJson: vi.fn() };
});

const releaseId = `release-${"a".repeat(64)}`;
const sourceCommit = "b".repeat(40);

describe("formal Release identity stores", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useTopologyStore.setState({ stats: null, admittedNodes: [], admittedEdges: [], knowledgeNodes: [], knowledgeEdges: [], gaps: [], status: "idle", error: null, errorCode: null });
    useGraphStore.setState({ data: null, status: "idle", error: null });
  });

  it("keeps topology identity with the loaded response", async () => {
    vi.mocked(fetchTopology).mockResolvedValue({ success: true, gaps: [], data: { releaseId, sourceCommit, scope: "full", totalNodes: 0, returnedNodes: 0, totalEdges: 0, returnedEdges: 0, topology: { nodes: [], edges: [] }, knowledgeTopology: { nodes: [], edges: [] }, gaps: [], dataFreshness: { fresh: true, ageHours: 0, updatedAt: "now", version: "1" } } });
    await useTopologyStore.getState().load();
    expect(useTopologyStore.getState().stats).toMatchObject({ releaseId, sourceCommit });
  });

  it("keeps graph identity with the loaded response", async () => {
    vi.mocked(apiFetchJson).mockResolvedValue({ success: true, data: { releaseId, sourceCommit, components: [], layers: [], dependencies: [] } });
    await useGraphStore.getState().load();
    expect(useGraphStore.getState().data).toMatchObject({ releaseId, sourceCommit });
  });
});
