import { normalizeCategory, validateRelation } from "@/lib/ontology";
import { NodeIdentity } from "./NodeIdentity";
import { RelationIdentity } from "./RelationIdentity";
import { ReviewStatus } from "./ReviewStatus";
import type { ReviewStatusValue } from "./ReviewStatus";

export type GraphAdmissionNode = {
  id: string;
  category?: string;
  labels?: string[];
};

export type GraphAdmissionRelation = {
  from: string;
  to: string;
  relationType?: string;
  reviewStatus?: string;
};

export type GraphAdmissionResult = {
  ok: boolean;
  relation?: RelationIdentity;
  reviewStatus: ReviewStatusValue;
  confidence: number;
  errors: string[];
  warnings: string[];
};

export class GraphAdmissionService {
  static validate(input: {
    relation: GraphAdmissionRelation;
    nodesById: ReadonlyMap<string, GraphAdmissionNode>;
  }): GraphAdmissionResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    let relation: RelationIdentity | undefined;

    try {
      relation = RelationIdentity.create({
        from: input.relation.from,
        to: input.relation.to,
        relationType: input.relation.relationType || "CONNECTS_TO",
      });
    } catch (error) {
      errors.push(error instanceof Error ? error.message : "Invalid relation identity");
    }

    const fromNode = relation ? input.nodesById.get(relation.from.value) : null;
    const toNode = relation ? input.nodesById.get(relation.to.value) : null;
    if (relation && !fromNode) errors.push(`Unknown from node: ${relation.from.value}`);
    if (relation && !toNode) errors.push(`Unknown to node: ${relation.to.value}`);

    if (relation?.from.equals(relation.to)) {
      warnings.push("Self relation requires manual review");
    }

    const validation =
      relation && fromNode && toNode
        ? validateRelation(
            relation.relationType,
            fromNode.category ? normalizeCategory(fromNode.category) : undefined,
            toNode.category ? normalizeCategory(toNode.category) : undefined,
          )
        : { valid: false, confidence: 0, reason: "Relation endpoints are not resolvable" };
    if (validation.reason) warnings.push(validation.reason);

    const requestedStatus = ReviewStatus.from(input.relation.reviewStatus);
    const reviewStatus =
      errors.length > 0 || warnings.length > 0 || validation.confidence < 0.8
        ? ReviewStatus.pending()
        : requestedStatus.value === "rejected"
          ? ReviewStatus.pending()
          : ReviewStatus.approved();

    return {
      ok: errors.length === 0,
      relation,
      reviewStatus: reviewStatus.value,
      confidence: validation.confidence,
      errors,
      warnings,
    };
  }

  static assertNodeIdentity(raw: string): NodeIdentity {
    return NodeIdentity.create(raw);
  }

  /**
   * Topology admission rule — only nodes carrying "ArchitectureComponent" or "Module" labels are renderable entities.
   * 单源 contracts/graph-admission.json（WP-030/PR-145）——contracts 目录前端读不到（entity-readiness-rules
   * 同款裁决），本副本经 src/test/graph-admission-contract.test.ts 对账钉与契约锁死：改契约不同步本副本即测试红。
   */
  static readonly ENTITY_LABELS = ["ArchitectureComponent", "Module"] as const;

  static isRenderableNode(node: { labels?: readonly string[] | string[] }): boolean {
    if (!node.labels || node.labels.length === 0) return false;
    return node.labels.some((l) => (GraphAdmissionService.ENTITY_LABELS as readonly string[]).includes(l));
  }

  /**
   * Filter topology nodes to renderable entities only (ArchitectureComponent / Module).
   * Frontend defense-in-depth mirror of backend filterTopologyEntities().
   */
  static filterTopoNodes<T extends { id: string; labels?: string[] | readonly string[] }>(nodes: T[]): T[] {
    return nodes.filter((n) => GraphAdmissionService.isRenderableNode(n));
  }

  /**
   * Co-accession rule: keep only edges whose both endpoints are in the admitted node set.
   * If a node was filtered out, all its incident edges must be removed from stats and rendering.
   */
  static filterTopologyEdges<T extends { source: string; target: string }>(
    edges: T[],
    admittedNodeIds: Set<string>,
  ): T[] {
    return edges.filter((e) => admittedNodeIds.has(e.source) && admittedNodeIds.has(e.target));
  }
}
