import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArticlePanorama } from "@/features/document-inventory/components/ArticlePanorama";
import { RelationOverview } from "@/features/impact-analysis/components/relation-overview";
import { ImpactPathGraph } from "@/features/impact-analysis/components/ImpactPathGraph";
import { buildAnomalyHandoffHash, matchAnomalyHandoff, parseAnomalyHandoff } from "@/lib/domain/anomaly-handoff";
import { useAnomalyWorkbenchStore } from "@/features/anomaly-workbench/anomaly-workbench-store";
import { useTopologyStore } from "@/lib/topology-store";
import { fetchDocument } from "@/features/document-inventory/document-inventory-api";
import { getApprovalStatus } from "@/features/approval-workbench/approval-api";
import { fetchAnomalies } from "@/features/anomaly-workbench/anomaly-workbench-api";
import type { AnomalyIssue } from "@/features/anomaly-workbench/anomaly-workbench-types";
import type { ImpactAnalysisResult } from "@/features/impact-analysis/impact-analysis-types";

vi.mock("@/features/document-inventory/document-inventory-api", () => ({ fetchDocument: vi.fn() }));
vi.mock("@/features/approval-workbench/approval-api", () => ({ getApprovalStatus: vi.fn() }));
vi.mock("@/features/anomaly-workbench/anomaly-workbench-api", () => ({ fetchAnomalies: vi.fn(), performAnomalyOperation: vi.fn() }));
vi.mock("@/components/obsidian", () => ({ ObsidianLink: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));

const releaseId = `release-${"a".repeat(64)}`;
const sourceCommit = "b".repeat(40);
const sourcePath = "知识库/wiki/articles/mysql-guide.md";

const issue: AnomalyIssue = {
  issueId: "issue-article",
  issueKind: "missing_field",
  handling: "fix",
  title: "文章字段缺失",
  status: "open",
  evidence: [{ path: sourcePath }],
  expectedRevisions: {},
  blockedActions: [],
  proposedAction: { type: "entity-repair", sourceKey: sourcePath },
};

function impactResult(): ImpactAnalysisResult {
  const lineage: NonNullable<ImpactAnalysisResult["lineage"]> = {
    source: { kind: "vault-document", path: sourcePath, contentHash: `sha256:${"c".repeat(64)}`, lineNumber: 12, coordinate: "relation:a-b" },
    rule: { ruleId: "typed-wikilink", ruleRevision: "runtime:v2", reasonCode: "SOURCE_RELATION" },
    scope: { product: "AnyShare", version: "7.0" },
    decision: { decisionId: "decision-1", operatorId: "architect", kind: "manual", decidedAt: "2026-08-10T00:00:00.000Z" },
    freshness: { status: "fresh", checkedAt: "2026-08-10T00:00:00.000Z", changedFields: [] },
  };
  const edge = { edgeId: "edge-a-b", source: "a", target: "b", type: "DEPENDS_ON", confidence: 1, reviewStatus: "approved", sourceFile: sourcePath, sourceHash: `sha256:${"c".repeat(64)}`, lineNumber: 12, evidenceHash: `sha256:${"d".repeat(64)}`, lineage };
  return {
    releaseId,
    sourceCommit,
    downstream: { byHop: [{ hop: 1, nodes: [{ nodeId: "b", label: "组件 B", hop: 1, risk: "LOW", paths: [{ nodeIds: ["a", "b"], edges: [edge], confidence: 1 }] }] }], terminalNodeIds: ["b"], documentRefs: [] },
    upstream: { byHop: [], terminalNodeIds: [], documentRefs: [] },
    filteredEdges: [],
    meta: { totalNodesAffected: 1, maxDepth: 1, traversalEdgesFiltered: 0, truncated: false, resolvedSeedNodeIds: ["a"] },
    lineage,
    reasoning: null,
  };
}

describe("shared read-only detail and maintenance handoff", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.location.hash = "#/document-inventory";
    useTopologyStore.setState({ admittedNodes: [{ id: "a", label: "组件 A", category: "服务", degree: 1 }, { id: "b", label: "组件 B", category: "服务", degree: 1 }] });
    useAnomalyWorkbenchStore.setState({ issues: [], selectedIssueId: null, status: "idle", error: null, refreshing: false, lastCheckedAt: null, refreshSummary: null });
  });

  it("round-trips stable context and refuses ambiguous issue matches", () => {
    const hash = buildAnomalyHandoffHash({ objectKind: "article", objectId: "article:ART-1", sourcePath, releaseId, sourceCommit });
    expect(parseAnomalyHandoff(hash)).toMatchObject({ objectKind: "article", objectId: "article:ART-1", sourcePath, releaseId, sourceCommit });
    expect(matchAnomalyHandoff([issue], parseAnomalyHandoff(hash)!)).toEqual(issue);
    expect(matchAnomalyHandoff([issue, { ...issue, issueId: "issue-2" }], parseAnomalyHandoff(hash)!)).toBeNull();
  });

  it("loads the existing formal document detail without falling back to search-card data", async () => {
    vi.mocked(getApprovalStatus).mockResolvedValue({ status: "pending", revision: "sha256:changed", changeSummary: null });
    vi.mocked(fetchDocument).mockResolvedValue({
      releaseId,
      sourceCommit,
      generatedAt: "2026-08-10T00:00:00.000Z",
      document: {
        documentId: "article:ART-1", documentKind: "standard-article", title: "MySQL 指南", articleId: "ART-1", sourcePath,
        sourceHash: `sha256:${"c".repeat(64)}`, graphNodeIds: [], graphStatus: "pending-extraction", product: "AnyShare", version: "7.0",
        module: "Content", articleType: "排错", docType: "技术文档", arch_component: null, arch_status: "", status: "有效", arch_layer: "",
        arch_category: "", arch_subdomain: "", tags: [], relations: [],
      },
    });
    render(<ArticlePanorama documentId="article:ART-1" />);
    expect(await screen.findByRole("region", { name: "文章全景" })).toHaveTextContent(releaseId);
    expect(screen.getByText(/下列字段属于已发布版本/)).toBeInTheDocument();
    expect(screen.getByText(/发布时来源路径/)).toBeInTheDocument();
    expect(await screen.findByText(/当前文件审批状态：待审/)).toBeInTheDocument();
    expect(getApprovalStatus).toHaveBeenCalledWith("ART-1");
    expect(fetchDocument).toHaveBeenCalledWith("article:ART-1");
    fireEvent.click(screen.getByRole("button", { name: "在待处理问题中查看" }));
    expect(window.location.hash).toContain("#/anomalies?handoff=formal-detail");
    expect(window.location.hash).toContain("objectKind=article");
  });

  it("shows one shared relation overview from an impact path with formal identity", () => {
    render(<ImpactPathGraph result={impactResult()} />);
    fireEvent.click(screen.getByRole("button", { name: "查看 组件 A 到 组件 B 的关系依据" }));
    expect(screen.getByText("查看关系依据")).toBeInTheDocument();
    expect(screen.getByText(sourcePath)).toBeInTheDocument();
    expect(screen.getByText(new RegExp(releaseId))).toBeInTheDocument();
  });

  it("routes relation maintenance through Anomalies with source coordinates", () => {
    render(<RelationOverview defaultOpen relation={{ edgeId: "edge-a-b", source: "a", target: "b", relationType: "DEPENDS_ON", sourcePath, sourceLine: 12, evidenceHash: "evidence", sourceHash: "source", freshness: "fresh", releaseId, sourceCommit }} />);
    fireEvent.click(screen.getByRole("button", { name: "在待处理问题中查看" }));
    expect(window.location.hash).toContain("objectKind=relation");
    expect(window.location.hash).toContain("sourceLine=12");
    expect(window.location.hash).toContain("relationType=DEPENDS_ON");
  });

  it("selects only the exact Anomaly handoff and visibly fails closed when absent", async () => {
    vi.mocked(fetchAnomalies).mockResolvedValue({ generatedAt: "2026-08-10T00:00:00.000Z", total: 1, workingRevisions: {}, issues: [issue] });
    window.location.hash = buildAnomalyHandoffHash({ issueId: issue.issueId, objectKind: "article", objectId: "article:ART-1", sourcePath });
    await useAnomalyWorkbenchStore.getState().load();
    expect(useAnomalyWorkbenchStore.getState().selectedIssueId).toBe(issue.issueId);

    window.location.hash = buildAnomalyHandoffHash({ issueId: "missing", objectKind: "article", objectId: "article:ART-1", sourcePath });
    await useAnomalyWorkbenchStore.getState().load();
    await waitFor(() => expect(useAnomalyWorkbenchStore.getState()).toMatchObject({ issues: [], selectedIssueId: null, status: "error" }));
    expect(useAnomalyWorkbenchStore.getState().error).toContain("停止自动选择");
  });

  it("keeps every shared detail read-only and removes the property-writer shortcut", () => {
    const paths = [
      "src/features/document-inventory/components/ArticlePanorama.tsx",
      "src/features/impact-analysis/components/relation-overview/RelationOverview.tsx",
      "src/components/app-shell/EntityHubDrawer.tsx",
      "src/features/document-inventory/components/DocumentResultCard.tsx",
    ];
    const source = paths.map((path) => readFileSync(path, "utf8")).join("\n");
    expect(source).not.toMatch(/method:\s*["'](?:POST|PUT|PATCH|DELETE)["']/);
    expect(source).not.toContain("performAnomalyOperation");
    expect(source).not.toContain("#/property?entityId=");
  });
});
