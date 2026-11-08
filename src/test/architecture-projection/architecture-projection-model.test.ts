import { describe, it, expect } from "vitest";
import { buildProjectionModel, stableNodeId, stableEdgeId } from "@/components/architecture-projection/architecture-projection-model";

const emptyTopo = { nodes: [], edges: [] };
const sampleTopo = {
  nodes: [
    { id: "api-gw", label: "API Gateway" },
    { id: "pay-svc", label: "Payment Service" },
    { id: "order-svc", label: "Order Service" },
  ],
  edges: [{ source: "api-gw", target: "pay-svc" }],
};

describe("buildProjectionModel · 缺口叠加层语义（showGaps，seq212 起诊断仅叠加可见）", () => {
  it("returns empty terminal when topology has no nodes", () => {
    const m = buildProjectionModel({ seedCount: 0, seedComponentIds: [] }, emptyTopo);
    expect(m.nodes.length).toBe(1);
    expect(m.nodes[0].data.nodeType).toBe("empty");
    expect(m.meta.isComplete).toBe(false);
    expect(m.meta.nodeCount).toBe(0);
  });

  it("returns success terminal when seeds exist and no diagnostics", () => {
    const m = buildProjectionModel({ seedCount: 1, seedComponentIds: ["api-gw"], implicitPaths: [], unresolvedPairs: [], missingSeeds: [] }, sampleTopo, { showGaps: true });
    expect(m.nodes.some(n => n.data.nodeType === "success")).toBe(true);
    expect(m.meta.isComplete).toBe(true);
    expect(m.meta.seedCount).toBe(1);
  });

  it("does not generate success when diagnostics present", () => {
    const m = buildProjectionModel({ seedCount: 2, seedComponentIds: ["api-gw", "pay-svc"], implicitPaths: [], unresolvedPairs: [], missingSeeds: ["ghost"] }, sampleTopo, { showGaps: true });
    expect(m.nodes.some(n => n.data.nodeType === "success")).toBe(false);
    expect(m.meta.isComplete).toBe(false);
    expect(m.meta.missingCount).toBe(1);
  });

  it("builds entity nodes for existing seeds", () => {
    const m = buildProjectionModel({ seedCount: 1, seedComponentIds: ["api-gw"], implicitPaths: [], unresolvedPairs: [], missingSeeds: [] }, sampleTopo, { showGaps: true });
    expect(m.nodes.some(n => n.data.nodeType === "entity" && n.data.label === "API Gateway")).toBe(true);
  });

  it("fallback label when nodeId missing from topology", () => {
    const m = buildProjectionModel({ seedCount: 1, seedComponentIds: ["no-label"], implicitPaths: [], unresolvedPairs: [], missingSeeds: [] }, { nodes: [{ id: "no-label", label: "" }], edges: [] }, { showGaps: true });
    const ents = m.nodes.filter(n => n.data.nodeType === "entity");
    expect(ents.length).toBe(1);
    // empty label falls back to id
    expect(ents[0].data.label).toBe("no-label");
  });

  it("builds missing nodes for absent seeds", () => {
    const m = buildProjectionModel({ seedCount: 2, seedComponentIds: ["api-gw", "ghost"], implicitPaths: [], unresolvedPairs: [], missingSeeds: ["ghost"] }, sampleTopo, { showGaps: true });
    expect(m.nodes.some(n => n.data.nodeType === "missing")).toBe(true);
    expect(m.meta.missingCount).toBe(1);
  });

  it("builds implicit path chain", () => {
    const m = buildProjectionModel({ seedCount: 2, seedComponentIds: ["api-gw", "order-svc"], implicitPaths: [{ seedA: "api-gw", seedB: "order-svc", path: ["api-gw", "pay-svc", "order-svc"], ambiguous: false, alternateCount: 1 }], unresolvedPairs: [], missingSeeds: [] }, sampleTopo, { showGaps: true });
    expect(m.nodes.some(n => n.data.nodeType === "implicit")).toBe(true);
    expect(m.nodes.some(n => n.data.nodeType === "decision" && n.data.label.includes("间接关联"))).toBe(true);
    expect(m.meta.implicitCount).toBe(1);
    expect(m.meta.isComplete).toBe(false);
  });

  it("ambiguous path builds ambiguous nodes", () => {
    const m = buildProjectionModel({ seedCount: 2, seedComponentIds: ["api-gw", "order-svc"], implicitPaths: [{ seedA: "api-gw", seedB: "order-svc", path: ["api-gw", "pay-svc", "order-svc"], ambiguous: true, alternateCount: 2 }], unresolvedPairs: [], missingSeeds: [] }, sampleTopo, { showGaps: true });
    expect(m.nodes.some(n => n.data.nodeType === "ambiguous")).toBe(true);
    expect(m.meta.isComplete).toBe(false);
  });

  it("builds unresolved pair node", () => {
    const m = buildProjectionModel({ seedCount: 2, seedComponentIds: ["api-gw", "order-svc"], implicitPaths: [], unresolvedPairs: [{ nodeA: "api-gw", nodeB: "order-svc" }], missingSeeds: [] }, sampleTopo, { showGaps: true });
    expect(m.nodes.some(n => n.data.nodeType === "unresolved")).toBe(true);
    expect(m.meta.unresolvedCount).toBe(1);
  });

  it("handles undefined implicitPaths", () => {
    const m = buildProjectionModel({ seedCount: 1, seedComponentIds: ["api-gw"], implicitPaths: undefined, unresolvedPairs: undefined, missingSeeds: undefined }, sampleTopo, { showGaps: true });
    expect(m.meta.implicitCount).toBe(0);
    expect(m.meta.unresolvedCount).toBe(0);
    expect(m.meta.missingCount).toBe(0);
  });

  it("handles undefined topology nodes gracefully", () => {
    const m = buildProjectionModel({ seedCount: 2, seedComponentIds: ["a", "b"], implicitPaths: [], unresolvedPairs: [], missingSeeds: [] }, { nodes: [{ id: "a", label: "A" }, { id: "b", label: "B" }], edges: undefined }, { showGaps: true });
    expect(m.nodes.some(n => n.data.nodeType === "entity")).toBe(true);
  });

  it("evidence index contains implicit path evidence", () => {
    const m = buildProjectionModel({ seedCount: 2, seedComponentIds: ["api-gw", "order-svc"], implicitPaths: [{ seedA: "api-gw", seedB: "order-svc", path: ["api-gw", "pay-svc", "order-svc"], ambiguous: false, alternateCount: 1 }], unresolvedPairs: [], missingSeeds: [] }, sampleTopo, { showGaps: true });
    const node = m.nodes.find(n => n.data.nodeType === "implicit");
    expect(node?.data.evidenceKey).toBeDefined();
    expect(m.evidenceIndex.get(node!.data.evidenceKey!)).toMatchObject({ type: "implicit_path" });
  });

  it("evidence index contains unresolved pair evidence", () => {
    const m = buildProjectionModel({ seedCount: 2, seedComponentIds: ["api-gw", "order-svc"], implicitPaths: [], unresolvedPairs: [{ nodeA: "api-gw", nodeB: "order-svc" }], missingSeeds: [] }, sampleTopo, { showGaps: true });
    const node = m.nodes.find(n => n.data.nodeType === "unresolved");
    expect(m.evidenceIndex.get(node!.data.evidenceKey!)).toMatchObject({ type: "unresolved_pair" });
    expect(m.edges.some(e => e.target === node?.id && e.data?.edgeType === "unresolved")).toBe(true);
  });

  it("evidence index contains missing seed evidence", () => {
    const m = buildProjectionModel({ seedCount: 2, seedComponentIds: ["api-gw", "ghost"], implicitPaths: [], unresolvedPairs: [], missingSeeds: ["ghost"] }, sampleTopo, { showGaps: true });
    const node = m.nodes.find(n => n.data.nodeType === "missing");
    expect(m.evidenceIndex.get(node!.data.evidenceKey!)).toMatchObject({ type: "missing_seed" });
  });

  it("success has dataFreshness in evidence", () => {
    const df = { fresh: true, ageHours: 0.5, updatedAt: "2026-07-13T12:00:00Z", version: "1.0" };
    const m = buildProjectionModel({ seedCount: 1, seedComponentIds: ["api-gw"], implicitPaths: [], unresolvedPairs: [], missingSeeds: [], dataFreshness: df }, sampleTopo, { showGaps: true });
    const ev = m.evidenceIndex.get("success:complete");
    expect(ev).toBeDefined();
    expect(ev?.dataFreshness?.fresh).toBe(true);
  });

  it("start node label shows seed count", () => {
    const m = buildProjectionModel({ seedCount: 5, seedComponentIds: ["a","b","c","d","e"] }, emptyTopo, { showGaps: true });
    expect(m.nodes.some(n => n.data.nodeType === "start" && n.data.label.includes("5"))).toBe(true);
  });

  it("no 故障原因 text in any node label", () => {
    const m = buildProjectionModel({ seedCount: 2, seedComponentIds: ["api-gw", "order-svc"], implicitPaths: [{ seedA: "api-gw", seedB: "order-svc", path: ["api-gw", "pay-svc", "order-svc"], ambiguous: true, alternateCount: 2 }], unresolvedPairs: [{ nodeA: "a", nodeB: "b" }], missingSeeds: ["ghost"] }, sampleTopo, { showGaps: true });
    for (const n of m.nodes) expect(n.data.label).not.toContain("故障原因");
  });

  it("no kubectl or shell in any node label", () => {
    const m = buildProjectionModel({ seedCount: 2, seedComponentIds: ["api-gw", "order-svc"], implicitPaths: [{ seedA: "api-gw", seedB: "order-svc", path: ["api-gw", "pay-svc", "order-svc"], ambiguous: true, alternateCount: 2 }], unresolvedPairs: [], missingSeeds: [] }, sampleTopo, { showGaps: true });
    for (const n of m.nodes) { expect(n.data.label).not.toContain("kubectl"); expect(n.data.label).not.toContain("shell"); }
  });
});

describe("stable IDs", () => {
  it("nodeId matches proj-{type}-{key} regex", () => {
    expect(/^proj-\w+-[\w-]+$/.test(stableNodeId("entity", "api-gw"))).toBe(true);
    expect(stableNodeId("decision", "exists")).toBe("proj-decision-exists");
  });
  it("edgeId matches proj-edge-{source}->{target} regex", () => {
    expect(stableEdgeId("start", "end")).toBe("proj-edge-start->end");
  });
  it("encodes special characters via encodeURIComponent", () => {
    const id = stableNodeId("entity", "a/b:c");
    expect(id).not.toContain("/");
    expect(id).not.toContain(":");
  });
  it("normalizes unresolved pair keys independent of input order", () => {
    const a = buildProjectionModel({ seedCount: 2, unresolvedPairs: [{ nodeA: "z", nodeB: "a" }] }, emptyTopo, { showGaps: true });
    const b = buildProjectionModel({ seedCount: 2, unresolvedPairs: [{ nodeA: "a", nodeB: "z" }] }, emptyTopo, { showGaps: true });
    expect(a.nodes.find(n => n.data.nodeType === "unresolved")?.data.evidenceKey)
      .toBe(b.nodes.find(n => n.data.nodeType === "unresolved")?.data.evidenceKey);
  });
});
