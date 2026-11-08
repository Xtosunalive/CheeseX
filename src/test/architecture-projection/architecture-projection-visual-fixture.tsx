import { useState } from "react";
import { createRoot } from "react-dom/client";
import "../../index.css";
import ArchProjFlow from "@/components/architecture-projection/ArchitectureProjectionFlow";
import { buildProjectionModel } from "@/components/architecture-projection/architecture-projection-model";

const model = buildProjectionModel(
  {
    seedCount: 3,
    seedComponentIds: ["api-gateway", "order-service", "message-queue"],
    implicitPaths: [{ seedA: "api-gateway", seedB: "order-service", path: ["api-gateway", "auth-adapter", "order-service"], ambiguous: true, alternateCount: 2 }],
    unresolvedPairs: [{ nodeA: "api-gateway", nodeB: "order-service" }],
    missingSeeds: ["message-queue"],
    dataFreshness: { fresh: false, ageHours: 26, updatedAt: "2026-07-12T10:00:00Z", version: "1.0" },
  },
  {
    nodes: [
      { id: "api-gateway", label: "API Gateway" },
      { id: "auth-adapter", label: "Auth Adapter" },
      { id: "order-service", label: "Order Service" },
    ],
    edges: [],
  },
);

export function VisualFixture() {
  const [highlightNodeIds, setHighlightNodeIds] = useState<Set<string> | null>(null);
  return (
    <main className="min-h-screen bg-surface-hover p-6">
      <h1 className="mb-4 text-xl font-semibold text-text-main">C1 架构投影诊断态视觉 Fixture</h1>
      <ArchProjFlow model={model} highlightNodeIds={highlightNodeIds} onHighlight={setHighlightNodeIds} onNodeClickEvidence={() => undefined} />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<VisualFixture />);
