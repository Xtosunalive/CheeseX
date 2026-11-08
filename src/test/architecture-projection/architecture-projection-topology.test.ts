// seq212 红灯→绿灯：buildProjectionModel 必须消费 topology.edges 渲染真实拓扑（C1，方案 A 修正版）
// 设计依据：docs/design/core-business-loop/05-consumption-verification-pages.md §7（读 topology 实时生成图）
import { describe, it, expect } from "vitest";
import { buildProjectionModel } from "@/components/architecture-projection/architecture-projection-model";

const topology = {
  nodes: [
    { id: "gateway", label: "网关", category: "终端", degree: 2 },
    { id: "pay-svc", label: "支付服务", category: "服务", degree: 1 },
    { id: "mysql", label: "主数据库", category: "存储", degree: 1 },
  ],
  edges: [
    {
      edgeId: "edge-gateway-pay",
      source: "gateway",
      target: "pay-svc",
      type: "USES",
      sourceFile: "知识库/wiki/entities/gateway.md",
      lineNumber: 42,
      reviewStatus: "approved",
      properties: { ruleId: "rel-uses", ruleRevision: "a1b2c3" },
    },
    {
      edgeId: "edge-pay-mysql",
      source: "pay-svc",
      target: "mysql",
      type: "DEPENDS_ON",
      sourceFile: "知识库/wiki/entities/pay-svc.md",
      lineNumber: 7,
      reviewStatus: "pending",
    },
  ],
};

describe("buildProjectionModel · 拓扑模式（默认）", () => {
  it("为全部拓扑节点建 entity 节点，由真实 topology.edges 互联", () => {
    const m = buildProjectionModel({ seedCount: 2, seedComponentIds: ["gateway", "pay-svc"] }, topology);
    const entities = m.nodes.filter((n) => n.data.nodeType === "entity");
    expect(entities).toHaveLength(3);
    const sourceIds = new Set(entities.map((n) => n.data.sourceNodeId));
    expect(sourceIds.has("gateway")).toBe(true);
    expect(sourceIds.has("pay-svc")).toBe(true);
    expect(sourceIds.has("mysql")).toBe(true);

    const entityIds = new Set(entities.map((n) => n.id));
    const topologyEdges = m.edges.filter((e) => e.data?.edgeType === "topology");
    expect(topologyEdges).toHaveLength(2);
    for (const e of topologyEdges) {
      expect(entityIds.has(e.source)).toBe(true);
      expect(entityIds.has(e.target)).toBe(true);
    }
  });

  it("拓扑边透传关系类型与溯源字段供三上下文侧栏消费", () => {
    const m = buildProjectionModel({ seedCount: 2, seedComponentIds: ["gateway", "pay-svc"] }, topology);
    const edge = m.edges.find((e) => e.data?.relationType === "USES");
    expect(edge).toBeDefined();
    expect(edge?.data?.edgeId).toBe("edge-gateway-pay");
    expect(edge?.data?.sourceFile).toBe("知识库/wiki/entities/gateway.md");
    expect(edge?.data?.lineNumber).toBe(42);
    expect(edge?.data?.reviewStatus).toBe("approved");
    expect(edge?.data?.properties).toMatchObject({ ruleId: "rel-uses", ruleRevision: "a1b2c3" });
  });

  it("默认不渲染缺口诊断结构（决策星/间接关联/缺失组件/未发现关联全部缺席）", () => {
    const m = buildProjectionModel(
      { seedCount: 2, seedComponentIds: ["gateway", "pay-svc"], missingSeeds: ["ghost"], unresolvedPairs: [{ nodeA: "a", nodeB: "b" }] },
      topology,
    );
    const diagnosticTypes = new Set(["start", "decision", "implicit", "ambiguous", "unresolved", "missing", "empty", "success"]);
    for (const n of m.nodes) {
      expect(diagnosticTypes.has(n.data.nodeType)).toBe(false);
    }
  });

  it("meta 报告拓扑节点/边计数", () => {
    const m = buildProjectionModel({ seedCount: 2, seedComponentIds: ["gateway", "pay-svc"] }, topology);
    expect(m.meta.nodeCount).toBe(3);
    expect(m.meta.edgeCount).toBe(2);
  });

  it("悬空边（端点不在节点集内）被安全跳过，不崩不渲染", () => {
    const dangling = {
      nodes: [{ id: "a", label: "A", category: "服务", degree: 0 }],
      edges: [
        { edgeId: "e1", source: "a", target: "ghost", type: "USES" },
        { edgeId: "e2", source: "phantom", target: "a", type: "USES" },
      ],
    };
    const m = buildProjectionModel({ seedCount: 1, seedComponentIds: ["a"] }, dangling);
    expect(m.edges.filter((e) => e.data?.edgeType === "topology")).toHaveLength(0);
    expect(m.meta.edgeCount).toBe(0);
  });
});

describe("buildProjectionModel · 缺口叠加层（showGaps，能力保留）", () => {
  it("showGaps=true 时缺口诊断结构随叠加层出现", () => {
    const m = buildProjectionModel(
      { seedCount: 2, seedComponentIds: ["gateway", "pay-svc"], missingSeeds: ["ghost"] },
      topology,
      { showGaps: true },
    );
    expect(m.nodes.some((n) => n.data.nodeType === "missing")).toBe(true);
    expect(m.meta.missingCount).toBe(1);
  });

  it("showGaps=false（默认）时缺口诊断不出现", () => {
    const m = buildProjectionModel(
      { seedCount: 2, seedComponentIds: ["gateway", "pay-svc"], missingSeeds: ["ghost"] },
      topology,
      { showGaps: false },
    );
    expect(m.nodes.some((n) => n.data.nodeType === "missing")).toBe(false);
  });
});
