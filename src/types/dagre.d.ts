declare module "dagre" {
  const dagre: {
    graphlib: { Graph: new () => dagre.Graph };
    layout: (graph: dagre.Graph) => void;
  };
  namespace dagre {
    interface GraphLabel { rankdir?: "TB"|"BT"|"LR"|"RL"; nodesep?: number; ranksep?: number; marginx?: number; marginy?: number; }
    interface Graph {
      setGraph(l: GraphLabel): Graph;
      setDefaultEdgeLabel(fn: () => Record<string,unknown>): Graph;
      setNode(id: string, c?: { width?: number; height?: number }): Graph;
      setEdge(s: string, t: string, c?: Record<string,unknown>): Graph;
      node(id: string): { x: number; y: number; width: number; height: number };
      nodes(): string[];
      edges(): Array<{ v: string; w: string }>;
    }
  }
  export = dagre;
}
