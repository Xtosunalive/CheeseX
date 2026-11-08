// EntityDetailPanel — 图谱检索枢纽右侧三上下文侧栏（是什么 / 从哪来 / 连到哪）
// 数据诚实度（seq212 红线）：sourceFile:line + reviewStatus 为真实稳定字段；ruleId/ruleRevision/confidence
// 有则展示、无则标「未记录」；assertedBy/sourceKind 当前 feed 不携带——按空处理，不伪造。
import { Panel } from "@/components/panel";
import { sliceWithRest } from "@/lib/format";
import { MissingValue } from "@/components/no-data/MissingValue";
import { reviewStatusDisplay } from "@/lib/domain/ReviewStatus";
import { ArrowLeftRight, ArrowUpRight, Fingerprint, Inbox } from "lucide-react";
import type { TopoEdge, TopoNode } from "@/lib/topology-types";
import { CATEGORY_COLORS, DEFAULT_COLOR, DEFAULT_RELATION_COLOR, RELATION_COLORS, readEdgeProvenance } from "@/lib/topology-types";
import { RELATION_TYPES, relationTypeLabel } from "@/lib/ontology";
import { nodeNameLabel } from "@/lib/domain";
import { TERM } from "@/constants/term-const";
import { ENTITY_DETAIL_COPY, ENTITY_DETAIL_CTX_SUMMARY, ddRelationCount, entityDetailRestHint, entityDetailUpDown, entityDetailViewSource, entityDetailViewTarget } from "./data-dashboard-copy";

/** 枢纽选中态：实体节点或真实拓扑边（与 ProjectionSelection 同构，由 ArchProjFlow onSelect 抛出） */
export type HubSelection = { kind: "node"; nodeId: string } | { kind: "edge"; edgeId: string };

interface Props {
  selection: HubSelection | null;
  nodes: TopoNode[];
  edges: TopoEdge[];
  onSelect: (selection: HubSelection) => void;
}

function relationLabel(type: string): string {
  return relationTypeLabel(type);
}

function relationColor(type: string): string {
  return RELATION_COLORS[type] || DEFAULT_RELATION_COLOR;
}

const BADGE_TONE_CLASS: Record<string, string> = {
  fact: "bg-status-fact-2 text-status-fact ring-status-fact-6",
  warn: "bg-status-warn-2 text-status-warn ring-status-warn-6",
  error: "bg-status-error-2 text-status-error ring-status-error-6",
};

// REVIEW-STATUS-001：语义（label/tone）经域单源；仅视觉类名本地下映
function statusBadge(status: string | undefined) {
  const { label, tone } = reviewStatusDisplay(status);
  return <span className={`inline-flex shrink-0 rounded-sm px-2 py-0.5 text-xs ring-1 ${BADGE_TONE_CLASS[tone]}`}>{label}</span>;
}

/** 证据文件引用：basename:line（无则「未记录」） */
function fileRef(edge: TopoEdge): string | null {
  if (!edge.sourceFile) return null;
  const base = edge.sourceFile.split("/").pop() || edge.sourceFile;
  return edge.lineNumber != null ? `${base}:${edge.lineNumber}` : base;
}

function CtxHeader({ icon, title, tone }: { icon: React.ReactNode; title: string; tone: string }) {
  return (
    <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-hint">
      <span aria-hidden="true" className={`flex h-4 w-4 items-center justify-center rounded text-accent-contrast ${tone}`}>{icon}</span>
      {title}
    </h3>
  );
}

function NodeDetail({ node, nodes, edges, onSelect }: { node: TopoNode; nodes: TopoNode[]; edges: TopoEdge[]; onSelect: Props["onSelect"] }) {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const incident = edges.filter((e) => e.source === node.id || e.target === node.id);
  // WP-134 波3：可见集与折叠剩余数一处算出——旧写法 JSX 里 `slice(0, 6)` 与 `length - 6` 各写一遍，改一处漏一处
  const incidentFold = sliceWithRest(incident, 6);
  const upstream = incident.filter((e) => e.target === node.id);
  const downstream = incident.filter((e) => e.source === node.id);
  const color = CATEGORY_COLORS[node.category] || DEFAULT_COLOR;
  const missingProvenance = incident.some((e) => {
    const p = readEdgeProvenance(e);
    return !p.ruleId || !p.confidence;
  });

  return (
    <>
      <div className="mb-5 last:mb-0">
        <CtxHeader icon={<Fingerprint className="h-3 w-3" />} title={ENTITY_DETAIL_COPY.CTX_WHAT} tone="bg-accent-base" />
        <dl className="mt-2 space-y-1.5 text-sm">
          <div className="flex gap-2"><dt className="w-20 shrink-0 text-text-hint">{ENTITY_DETAIL_COPY.DT_NAME}</dt><dd className="min-w-0 truncate font-medium text-text-main">{nodeNameLabel(node)}</dd></div>
          <div className="flex gap-2"><dt className="w-20 shrink-0 text-text-hint">{ENTITY_DETAIL_COPY.DT_CATEGORY}</dt>
            <dd><span className="inline-flex items-center gap-1.5 rounded-sm bg-surface-hover/60 px-2 py-0.5 text-xs text-text-sub ring-1 ring-border-thin"><span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />{node.category || ENTITY_DETAIL_COPY.UNCATEGORIZED}</span></dd>
          </div>
          <div className="flex gap-2"><dt className="w-20 shrink-0 text-text-hint">{ENTITY_DETAIL_COPY.DT_ID}</dt><dd className="min-w-0 break-all font-mono text-xs text-text-sub">{node.id}</dd></div>
          <div className="flex gap-2"><dt className="w-20 shrink-0 text-text-hint">{ENTITY_DETAIL_COPY.DT_DEGREE}</dt><dd className="text-text-main">{ddRelationCount(incident.length)}<span className="ml-1 text-xs text-text-hint">{entityDetailUpDown(upstream.length, downstream.length)}</span></dd></div>
        </dl>
      </div>

      <div className="mb-5 last:mb-0">
        <CtxHeader icon={<ArrowUpRight className="h-3 w-3" />} title={ENTITY_DETAIL_COPY.CTX_FROM} tone="bg-purple-9" />
        <div className="mt-2 space-y-1.5 rounded-lg bg-surface-root p-2.5 ring-1 ring-border-thin">
          {incident.length === 0 && <p className="text-xs text-text-hint">{TERM.EMPTY_RELATION_ORPHAN}</p>}
          {incidentFold.visible.map((e) => (
            <div key={e.edgeId} className="flex items-center justify-between gap-2 text-xs">
              <span className="min-w-0 truncate">
                <span style={{ color: relationColor(e.type) }}>{relationLabel(e.type)}</span>
                <span className="ml-1.5 font-mono text-text-sub">{fileRef(e) ?? ENTITY_DETAIL_COPY.SOURCE_UNRECORDED}</span>
              </span>
              {statusBadge(e.reviewStatus)}
            </div>
          ))}
          {incidentFold.rest > 0 && <p className="text-xs text-text-hint">{entityDetailRestHint(incidentFold.rest)}</p>}
        </div>
        {missingProvenance && (
          <p className="mt-1.5 rounded-lg bg-status-warn-2 px-2.5 py-1.5 text-xs leading-relaxed text-text-hint ring-1 ring-status-warn-6">
            {ENTITY_DETAIL_COPY.PROVENANCE_GAP_NOTE}
          </p>
        )}
      </div>

      <div className="mb-5 last:mb-0">
        <CtxHeader icon={<ArrowLeftRight className="h-3 w-3" />} title={ENTITY_DETAIL_COPY.CTX_TO} tone="bg-accent-base" />
        {upstream.length === 0 && downstream.length === 0 && <p className="mt-2 text-xs text-text-hint">{ENTITY_DETAIL_COPY.NO_CONNECTION}</p>}
        {upstream.length > 0 && <p className="mt-2 text-xs text-text-hint">{ENTITY_DETAIL_COPY.UPSTREAM_HEADING}</p>}
        <div className="space-y-1">
          {upstream.map((e) => <EdgeRow key={e.edgeId} edge={e} other={nodeById.get(e.source)} direction="up" onSelect={onSelect} />)}
        </div>
        {downstream.length > 0 && <p className="mt-2 text-xs text-text-hint">{ENTITY_DETAIL_COPY.DOWNSTREAM_HEADING}</p>}
        <div className="space-y-1">
          {downstream.map((e) => <EdgeRow key={e.edgeId} edge={e} other={nodeById.get(e.target)} direction="down" onSelect={onSelect} />)}
        </div>
      </div>
    </>
  );
}

function EdgeRow({ edge, other, direction, onSelect }: { edge: TopoEdge; other: TopoNode | undefined; direction: "up" | "down"; onSelect: Props["onSelect"] }) {
  return (
    <button
      type="button"
      onClick={() => onSelect({ kind: "edge", edgeId: edge.edgeId })}
      className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm text-text-main transition-colors hover:bg-surface-hover/60"
      title={ENTITY_DETAIL_COPY.EDGE_ROW_TITLE}
    >
      <span aria-hidden="true" className="text-text-hint">{direction === "up" ? "◀" : "▶"}</span>
      <span style={{ color: relationColor(edge.type) }}>{relationLabel(edge.type)}</span>
      <span className="text-text-hint">·</span>
      <span className="min-w-0 truncate">{other?.label || (direction === "up" ? edge.source : edge.target)}</span>
      <span className="ml-auto">{statusBadge(edge.reviewStatus)}</span>
    </button>
  );
}

export function EdgeDetail({ edge, nodes, onSelect }: { edge: TopoEdge; nodes: TopoNode[]; onSelect: Props["onSelect"] }) {
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const source = nodeById.get(edge.source);
  const target = nodeById.get(edge.target);
  const provenance = readEdgeProvenance(edge);
  const def = RELATION_TYPES[edge.type];
  const color = relationColor(edge.type);

  return (
    <>
      <div className="mb-5 last:mb-0">
        <CtxHeader icon={<Fingerprint className="h-3 w-3" />} title={ENTITY_DETAIL_COPY.CTX_WHAT} tone="bg-accent-base" />
        <dl className="mt-2 space-y-1.5 text-sm">
          <div className="flex gap-2"><dt className="w-20 shrink-0 text-text-hint">{TERM.RELATION}</dt>
            <dd><span className="inline-flex items-center gap-1.5 rounded-sm bg-surface-hover/60 px-2 py-0.5 text-xs ring-1 ring-border-thin" style={{ color }}><span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />{relationLabel(edge.type)}</span></dd>
          </div>
          <div className="flex gap-2"><dt className="w-20 shrink-0 text-text-hint">{ENTITY_DETAIL_COPY.DT_SOURCE}</dt><dd className="min-w-0 truncate text-text-main">{source?.label || edge.source}<span className="ml-1 text-xs text-text-hint">（{source?.category || "?"}）</span></dd></div>
          <div className="flex gap-2"><dt className="w-20 shrink-0 text-text-hint">{ENTITY_DETAIL_COPY.DT_TARGET}</dt><dd className="min-w-0 truncate text-text-main">{target?.label || edge.target}<span className="ml-1 text-xs text-text-hint">（{target?.category || "?"}）</span></dd></div>
          <div className="flex gap-2"><dt className="w-20 shrink-0 text-text-hint">{ENTITY_DETAIL_COPY.DT_ID}</dt><dd className="min-w-0 break-all font-mono text-xs text-text-sub">{edge.edgeId}</dd></div>
        </dl>
      </div>

      <div className="mb-5 last:mb-0">
        <CtxHeader icon={<ArrowUpRight className="h-3 w-3" />} title={ENTITY_DETAIL_COPY.CTX_FROM} tone="bg-purple-9" />
        <div className="mt-2 space-y-1.5 rounded-lg bg-surface-root p-2.5 text-xs ring-1 ring-border-thin">
          <div className="flex items-center justify-between gap-2"><span className="text-text-hint">{ENTITY_DETAIL_COPY.SOURCE_KIND}</span>{provenance.sourceKind ? <span className="text-text-sub">{provenance.sourceKind}</span> : <MissingValue label={ENTITY_DETAIL_COPY.SOURCE_KIND} />}</div>
          <div className="flex items-center justify-between gap-2"><span className="text-text-hint">{ENTITY_DETAIL_COPY.RULE}</span>{provenance.ruleId ? <span className="font-mono text-text-sub">{provenance.ruleId}{provenance.ruleRevision ? `@${provenance.ruleRevision}` : ""}</span> : <MissingValue label={ENTITY_DETAIL_COPY.RULE} />}</div>
          <div className="flex items-center justify-between gap-2"><span className="text-text-hint">{ENTITY_DETAIL_COPY.EVIDENCE_FILE}</span>{fileRef(edge) ? <span className="font-mono text-text-sub">{fileRef(edge)}</span> : <MissingValue label={ENTITY_DETAIL_COPY.EVIDENCE_FILE} />}</div>
          <div className="flex items-center justify-between gap-2"><span className="text-text-hint">{ENTITY_DETAIL_COPY.MACHINE_CONFIDENCE}</span>{provenance.confidence != null ? <span className="tabular-nums text-text-sub">{provenance.confidence.toFixed(2)}</span> : <MissingValue label={ENTITY_DETAIL_COPY.CONFIDENCE} />}</div>
          <div className="flex items-center justify-between gap-2"><span className="text-text-hint">{TERM.REVIEW_STATUS}</span>{statusBadge(edge.reviewStatus)}</div>
        </div>
        <p className="mt-1.5 rounded-lg bg-status-warn-2 px-2.5 py-1.5 text-xs leading-relaxed text-text-hint ring-1 ring-status-warn-6">
          {ENTITY_DETAIL_COPY.EDGE_PROVENANCE_NOTE}
        </p>
      </div>

      <div className="mb-5 last:mb-0">
        <CtxHeader icon={<ArrowLeftRight className="h-3 w-3" />} title={ENTITY_DETAIL_COPY.CTX_TO} tone="bg-accent-base" />
        <p className="mt-2 text-xs leading-relaxed text-text-sub">{def?.description || ENTITY_DETAIL_COPY.RELATION_DESC_FALLBACK}</p>
        <div className="mt-1.5 space-y-1">
          <button type="button" onClick={() => onSelect({ kind: "node", nodeId: edge.source })} className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm text-text-main transition-colors hover:bg-surface-hover/60" title={ENTITY_DETAIL_COPY.VIEW_SOURCE_TITLE}>
            <span aria-hidden="true" className="text-text-hint">◀</span>{entityDetailViewSource(source?.label || edge.source)}
          </button>
          <button type="button" onClick={() => onSelect({ kind: "node", nodeId: edge.target })} className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-left text-sm text-text-main transition-colors hover:bg-surface-hover/60" title={ENTITY_DETAIL_COPY.VIEW_TARGET_TITLE}>
            <span aria-hidden="true" className="text-text-hint">▶</span>{entityDetailViewTarget(target?.label || edge.target)}
          </button>
        </div>
      </div>
    </>
  );
}

export function EntityDetailPanel({ selection, nodes, edges, onSelect }: Props) {
  const edge = selection?.kind === "edge" ? edges.find((e) => e.edgeId === selection.edgeId) : undefined;
  const node = selection?.kind === "node" ? nodes.find((n) => n.id === selection.nodeId) : undefined;

  return (
    <Panel testId="entity-detail-panel" ariaLabel={ENTITY_DETAIL_COPY.PANEL_ARIA} padding="none" className="flex h-full min-h-0 flex-col overflow-auto">
      <div className="p-4">
        {edge ? (
          <EdgeDetail edge={edge} nodes={nodes} onSelect={onSelect} />
        ) : node ? (
          <NodeDetail node={node} nodes={nodes} edges={edges} onSelect={onSelect} />
        ) : (
          <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
            <Inbox className="h-5 w-5 text-text-hint opacity-50" aria-hidden="true" />
            <p className="text-sm text-text-hint">{ENTITY_DETAIL_COPY.EMPTY_LINE1}<br />{ENTITY_DETAIL_COPY.EMPTY_LINE2}</p>
            <p className="text-xs text-text-hint opacity-70">{ENTITY_DETAIL_CTX_SUMMARY}</p>
          </div>
        )}
      </div>
    </Panel>
  );
}

