// Entity registry selectors — derived data from topology store.
// Migrated from features/admission/admission-store.ts (Phase 1 store decoupling).
// These are pure data transformations, not admission-specific logic.

import { useTopologyStore } from "./topology-store";
import { useCanvasAdmissionStore } from "@/features/admission/admission-store";
import type { EntityRegistryItem, TopologyEdge } from "@/features/admission/admission-types";

// 降级缓存判定键序——契约 contracts/graph-admission.json sourceArticleKeys 的前端副本
// （降级态镜像权威口径，红队复核跟进项②：单键缓存会让原漂移在 fail-open 路径复活）；
// 与契约的一致性由 graph-admission-contract.test.ts 第三例对账钉锁死。
export const SOURCE_ARTICLE_KEYS = ["file_path", "sourcePath", "source_path"] as const;

export function useRegistryItems(): EntityRegistryItem[] {
  const nodes = useTopologyStore((s) => s.admittedNodes);
  // WP-030/PR-145：准入状态以后端 canvas-admission 为唯一事实源（三源口径——前端 file_path
  // 单源判定曾是漂移点）；权威面缺席（未加载/失败）时降级为三键自算加速缓存（镜像权威键序），
  // 数据缺席≠判 PENDING。coverageRate 拍脑袋合成值已删除（无后端 per-item 真值——不伪造）。
  const authority = useCanvasAdmissionStore((s) => s.componentsById);
  return nodes.map((n) => {
    const props = n.properties ?? {};
    const archLayer = (props.arch_layer as string) || n.category || "—";
    const rawArticlePath = typeof props.file_path === "string" ? props.file_path.trim() : "";
    const hasArticle = rawArticlePath.length > 0;
    const cacheAdmitted = SOURCE_ARTICLE_KEYS.some((k) => !!props[k]);
    const backend = authority?.get(n.id);
    const admissionStatus: EntityRegistryItem["admissionStatus"] = backend
      ? backend.admitted
        ? "APPROVED"
        : "PENDING"
      : cacheAdmitted
        ? "APPROVED"
        : "PENDING"; // PD-5 死枚举归位：真实派生；REJECTED 零生产方已退役
    return {
      componentName: (n.label as string) || n.id,
      entityId: n.id,
      layer: archLayer,
      category: (n.category as string) || "—",
      articlePath: hasArticle ? rawArticlePath.replace(/\\/g, "/") : null,
      admissionStatus,
      hasSourceArticle: hasArticle,
      frontmatter: Object.keys(props).length > 0 ? (props as Record<string, unknown>) : null,
    };
  });
}

export function useTopologyEdges(): TopologyEdge[] {
  const edges = useTopologyStore((s) => s.admittedEdges);
  return edges.map((e) => ({ source: e.source, target: e.target, type: e.type }));
}
