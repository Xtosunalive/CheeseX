import { memo } from "react";
import { Handle, Position } from "@xyflow/react";
import { CATEGORY_COLORS, DEFAULT_COLOR } from "@/lib/topology-types";
import type { ProjectionFlowNodeData } from "./architecture-projection-types";
import { ARCH_PROJECTION_COPY, archProjNodeDegree } from "../components-copy";

const STYLES: Record<string, string> = {
  start: "bg-accent-base text-accent-contrast border-accent-base rounded-lg px-6 py-3 text-sm font-semibold min-w-[220px] text-center",
  entity: "bg-surface-card text-text-main border-border-thin rounded-md px-4 py-2 text-sm min-w-[160px] text-center",
  implicit: "bg-status-warn-2 border border-amber-8 text-status-warn rounded-md px-3 py-2 text-sm min-w-[140px] text-center",
  ambiguous: "bg-status-warn-3 border border-status-warn-8 text-status-warn rounded-md px-3 py-2 text-sm min-w-[140px] text-center",
  unresolved: "bg-status-error-2 border border-red-8 border-dashed text-status-error rounded-md px-3 py-2 text-sm min-w-[140px] text-center",
  missing: "bg-status-error-3 border border-red-9 border-dashed text-status-error rounded-md px-3 py-2 text-sm min-w-[140px] text-center",
  empty: "bg-surface-hover border border-border-thin text-text-hint rounded-lg px-4 py-2 text-sm text-center",
  success: "bg-status-fact-2 border border-jade-8 text-status-fact rounded-lg px-4 py-2 text-sm font-semibold min-w-[160px] text-center",
};

function ArchProjNode({ data, selected }: { data: ProjectionFlowNodeData; selected?: boolean }) {
  // seq212 拓扑模式：entity 节点带类别（category）时按 CATEGORY_COLORS 上色 + 类别小字
  if (data.nodeType === "entity" && data.category) {
    const color = CATEGORY_COLORS[data.category] || DEFAULT_COLOR;
    return (
      <div>
        <Handle type="target" position={Position.Top} isConnectable={false} className="!bg-surface-hover" />
        <div
          className={`bg-surface-card text-text-main border rounded-md px-4 py-2 text-sm min-w-[160px] text-center${selected ? " ring-2 ring-blue-9" : ""}`}
          style={{ borderColor: color }}
        >
          <div className="flex items-center justify-center gap-1.5">
            <span aria-hidden="true" className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
            <span className="truncate max-w-[180px]">{data.label}</span>
          </div>
          <div className="mt-0.5 text-kg-xs text-text-hint">{data.category}{data.degree != null ? archProjNodeDegree(data.degree) : ""}</div>
        </div>
        <Handle type="source" position={Position.Bottom} isConnectable={false} className="!bg-surface-hover" />
      </div>
    );
  }
  const base = (STYLES[data.nodeType] || STYLES.entity) + (selected ? " ring-2 ring-blue-9" : "");
  const inner = (
    <div className={base}>
      {/* WP-146 裁决2：空 label 不渲染文本（节点本体照常渲染） */}
      {data.label ? <div className="truncate max-w-[200px]">{data.label}</div> : null}
      {data.alternateCount != null && data.alternateCount > 1 && <div className="text-xs opacity-70 mt-0.5">{ARCH_PROJECTION_COPY.CANDIDATE_PREFIX}{data.alternateCount}</div>}
    </div>
  );
  if (data.nodeType === "decision") {
    return (
      <div className={`relative flex h-20 w-28 items-center justify-center ${selected ? "ring-2 ring-blue-9" : ""}`}>
        <Handle type="target" position={Position.Top} isConnectable={false} className="!bg-surface-hover" />
        <div aria-hidden="true" className="absolute h-16 w-16 rotate-45 bg-surface-card ring-2 ring-border-thin" />
        <div className="relative z-sticky max-w-20 text-center text-xs font-medium leading-tight text-text-main">{data.label}</div>
        <Handle type="source" position={Position.Bottom} isConnectable={false} className="!bg-surface-hover" />
      </div>
    );
  }
  return (
    <div>
      <Handle type="target" position={Position.Top} isConnectable={false} className="!bg-surface-hover" />
      {inner}
      <Handle type="source" position={Position.Bottom} isConnectable={false} className="!bg-surface-hover" />
    </div>
  );
}

export default memo(ArchProjNode);
