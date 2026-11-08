// 悬空边种类 → 用户语标签（自 SchemaDanglingNotice 拆出——组件文件只留组件，
// 标签表供悬空警示条与分区总览共用，纯呈现不拦截〔执法在写网关〕）。
import type { TopologyEdgeKind } from "@/lib/schema-shape";

export const KIND_LABELS: Record<TopologyEdgeKind, string> = {
  "policy-domain": "矩阵所属域不在册",
  "policy-key": "矩阵键不是所属域的子域",
  "module-subdomain": "模块挂靠的子域不存在",
  "tag-alias": "别名指向的规范标签不在册",
  "allows-relation": "关系类型越界",
  "relation-endpoint": "关系端点类型不在册",
};
