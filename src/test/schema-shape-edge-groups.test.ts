// WP-134 波4 投影出口钉：分区边分组与徽标读数同出一处，且差集键不再用可见字符拼接。
import { describe, expect, it } from "vitest";
import {
  TOPOLOGY_EDGE_KINDS,
  danglingBadgeForPartition,
  partitionDanglingCounts,
  partitionEdgeGroups,
  partitionIsBlind,
  partitionOfKind,
  partitionOfTab,
  schemaPartitions,
  type SchemaTopology,
  type TopologyEdgeKind,
} from "@/lib/schema-shape";

// 取第一个分区的页签与该分区所属的一种边，夹具随分区表演化不失效
const firstPartition = schemaPartitions()[0];
const tab = firstPartition.tabs[0];
const kind = TOPOLOGY_EDGE_KINDS.find((k) => partitionOfKind(k) === firstPartition.id) as TopologyEdgeKind;

function topologyOf(edges: SchemaTopology["edges"], dangling: SchemaTopology["dangling"], ontology = true): SchemaTopology {
  return { edges, dangling, coverage: { ontology } };
}

describe("partitionEdgeGroups：健康集与悬空集一处算出", () => {
  it("悬空边只从 healthy 里扣一次，面板合计与徽标读数同口径", () => {
    const topology = topologyOf(
      [
        { kind, from: "a", to: "b" },
        { kind, from: "c", to: "d" },
        { kind, from: "e", to: "f" },
      ],
      [{ kind, from: "c", to: "d" }],
    );
    const groups = partitionEdgeGroups(tab, topology);
    expect(groups).toHaveLength(1);
    expect(groups[0].healthy.map((e) => `${e.from}>${e.to}`)).toEqual(["a>b", "e>f"]);
    expect(groups[0].dangling).toHaveLength(1);
    // 同口径对账：面板各 kind 的悬空合计 ≡ 徽标读数（两处若分叉，本例即红）
    const panelTotal = groups.reduce((n, g) => n + g.dangling.length, 0);
    expect(danglingBadgeForPartition(firstPartition.id, topology)).toBe(panelTotal);
  });

  it("差集键不用可见字符拼接：含「→」的 id 不再互相碰撞（旧实现 `${from}→${to}` 把第二条误判为悬空）", () => {
    const topology = topologyOf(
      [
        { kind, from: "a→b", to: "c" }, // 在册悬空
        { kind, from: "a", to: "b→c" }, // 合法边——旧键拼出来同样是 "a→b→c"
      ],
      [{ kind, from: "a→b", to: "c" }],
    );
    const groups = partitionEdgeGroups(tab, topology);
    expect(groups[0].dangling).toHaveLength(1);
    expect(groups[0].healthy).toEqual([{ kind, from: "a", to: "b→c" }]);
  });

  it("两类皆空的 kind 整体略过；未知页签不出分组", () => {
    expect(partitionEdgeGroups(tab, topologyOf([], []))).toEqual([]);
    expect(partitionEdgeGroups("no-such-tab", topologyOf([{ kind, from: "a", to: "b" }], []))).toEqual([]);
  });
});

describe("no-data 门控单源", () => {
  it("盲区分区不可出数（null＝隐藏），非盲区照实报数", () => {
    const blindTopology = topologyOf(
      [{ kind: "allows-relation", from: "n", to: "r" }],
      [{ kind: "allows-relation", from: "n", to: "r" }],
      false,
    );
    expect(partitionIsBlind("type-system", blindTopology)).toBe(true);
    expect(danglingBadgeForPartition("type-system", blindTopology)).toBeNull();
    // 同一拓扑下非盲区分区仍出数——门控不得顺手把所有徽标一起吞掉
    expect(danglingBadgeForPartition(firstPartition.id, blindTopology)).toBe(0);
    expect(partitionDanglingCounts(blindTopology)[firstPartition.id]).toBe(0);
  });

  it("topology 未就绪＝null，不是 0", () => {
    expect(danglingBadgeForPartition(firstPartition.id, null)).toBeNull();
    expect(partitionOfTab(tab)).toBe(firstPartition.id);
  });
});
