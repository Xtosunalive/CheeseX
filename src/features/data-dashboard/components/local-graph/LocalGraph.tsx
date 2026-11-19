// LocalGraph — 图谱检索·关系 tab 主体：Obsidian 式关系图（批15 按 Master 裁定重塑：
// 「不是选种子查询，而是像 Obsidian 一样全部展示出来；点某个节点=选中并高亮相关关系；
// 图上与下方表格同时详细展示」）。
// 数据=共享拓扑 store（useKnowledgeNodes/useKnowledgeEdges，与拓扑页同源零新请求）；
// 交互=进页全量展示 → 点节点选中（该节点与其关系边高亮、其余淡化）→ 明细表随选中联动，
// 点明细行=选中邻居（Obsidian 局部游走同款）。血统：EDGE-RELATION-GOV-001 阶段5
// （Juggl mode=local 同构）＋批13 迁位；批15 起「选种子→查询」流程退役。
// 可见性裁定（Master 2026-10-29）：边=REFERENCES（作者手写双链，SPEC-027 置信度恒 1.0）全显，
// 其余类型为机器推导断言、仅 reviewStatus=approved 上图；节点=文件背书节点（对应 vault 篇页面）
// 常驻（Obsidian 孤儿笔记口径），注册表骨架/派生节点须有 ≥1 条可见边——WP-005 结构走属性轴后
// 骨架点永无连线，不进图（防无实体裸点）。
// 交互补齐（Master 2026-10-29「节点不能点和拖/全参考 obsidian」）：G6 v5 behaviors 显式声明
// drag-element（节点拖拽·力导向联动）/drag-canvas（画布拖移）/zoom-canvas（滚轮缩放）；
// 选中高亮改走 v5 state 通道——点选只改元素状态不整图重建，拖拽后的位置不因点选复位。
// Obsidian 图谱逆向引入批（Master 2026-10-30 裁「这三个直接引入」，源码级证据=obsidian.asar sim.js）：
// ①拖拽钉住——drag-element-force+fixed（Obsidian 拖拽即 fx/fy 固定，松手不回弹；drag-element 会被
//   力导向拉回）；②悬停聚焦——hover-activate 度1双向（Obsidian 核心手感：悬停即高亮邻居、其余淡化）；
// ③图内搜索＋按分类着色——搜索非匹配淡化（Obsidian filters 口径），着色=分类→色表
// （CATEGORY_COLORS 单源，Obsidian groups 的分类版——自由查询着色对本库是过度工程）。
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { nodeNameLabel } from "@/lib/domain";
import { isHumanApprovedReviewStatus, reviewStatusDisplay } from "@/lib/domain/ReviewStatus";
import { relationTypeLabel } from "@/lib/ontology";
import { Loader2, Maximize2, Minus, Plus, Search, SwatchBook } from "lucide-react";
import { TERM } from "@/constants/term-const";
import { EmptyState } from "@/components/empty-state";
import { Button as UiButton } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useKnowledgeEdges, useKnowledgeNodes, useTopologyLoading } from "@/lib/topology-store";
import {
  CANVAS_PALETTE,
  CATEGORY_COLORS,
  DEFAULT_COLOR,
  isEdgeVisible,
  isFileBackedNode,
  matchesQuery,
  type TopoEdge,
  type TopoNode,
} from "@/lib/topology-types";
import { LOCAL_GRAPH_COPY, localGraphInLinks, localGraphLinkSummary, localGraphOutLinks } from "@/features/data-dashboard/data-dashboard-copy";
// Obsidian 式数据落图（2026-11-20「一大一小跳变」收口）：常驻实例＋增量同步——渲染物理
// 早已是 Obsidian 同款 d3-force，跳变来自自建的「整图销毁重建」（每次数据变化/重挂载
// 都从中心炸开＋fitView 重适配）。本批改为 Obsidian 实际形态：图谱实例常驻，数据变化
// 只做最小增删改＋结构变化才轻推布局（d3-force 从现位起），节点位置跨重挂载连续。
import { buildEdgePayload, buildNodePayload, computeGraphSyncPlan, type LiveGraphSnapshot } from "./graph-sync";

// theme-tokens 门禁口径：G6 canvas 不解析 CSS var()——运行时从 :root 解析 token；
// 兜底值收编 topology-types CANVAS_PALETTE（index.css 真值镜像，批16 尾笔清账——原散落字面量三处漂移）
function token(entry: { readonly token: string; readonly fallback: string }): string {
  if (typeof window === "undefined") return entry.fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(entry.token).trim() || entry.fallback;
}

// CSS var() 色值（CATEGORY_COLORS 表值形态）→ canvas 可用实色；解析失败回落兜底
function resolveCssColor(varColor: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const m = /var\((--[^)]+)\)/.exec(varColor);
  if (!m) return varColor;
  return getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || fallback;
}

type GraphApi = {
  destroy: () => void;
  fitView: () => void;
  zoomBy: (f: number) => void;
  setElementState: (id: string, states: string[]) => void;
  // 增量同步面（G6 v5.1.1：数据 API 不自动绘制，draw=仅绘制不布局，layout=执行布局）
  getNodeData: () => LiveGraphSnapshot["nodes"];
  getEdgeData: () => LiveGraphSnapshot["edges"];
  addData: (data: { nodes?: unknown[]; edges?: unknown[] }) => void;
  updateData: (data: { nodes?: unknown[] }) => void;
  removeData: (ids: { nodes?: unknown[]; edges?: unknown[] }) => void;
  draw: () => Promise<void>;
  layout: () => Promise<void>;
};

// 模块级位置缓存（Obsidian 体感：图谱视图关了再开，节点还在原地——重挂载不再从中心炸开）
const positionCache = new Map<string, { x: number; y: number }>();
function rememberPositions(api: GraphApi): void {
  try {
    for (const n of api.getNodeData()) {
      const x = n.style?.x, y = n.style?.y;
      if (typeof x === "number" && typeof y === "number") positionCache.set(String(n.id), { x, y });
    }
  } catch { /* 位置读取失败不阻断（缓存只是连续性优化） */ }
}

// 增量同步：把下一份图数据以最小操作落入常驻实例（Obsidian 式——节点原位、视口不动、
// 结构变化才轻推布局）。同步失败降级：抛错由调用方 catch 落 RENDER_FAILED_WARN，不静默丢数据
// （实例内数据与 store 分叉时，下次完整重建路径兜底——组件重挂载即完整重建）。
async function syncGraphData(
  api: GraphApi,
  visibleNodes: LiveGraphSyncNodes,
  visibleEdges: TopoEdge[],
  degreeById: Map<string, number>,
  catFillOf: (category: string) => string | undefined,
): Promise<void> {
  const nextNodePayloads = visibleNodes.map((n) =>
    buildNodePayload(n, degreeById.get(n.id) ?? 0, catFillOf(n.category)),
  );
  const nextEdgePayloads = visibleEdges.map(buildEdgePayload);
  const plan = computeGraphSyncPlan(
    { nodes: api.getNodeData(), edges: api.getEdgeData() },
    nextNodePayloads,
    nextEdgePayloads,
  );
  if (!plan.structureChanged && plan.updateNodes.length === 0) return;
  if (plan.removeEdgeIds.length || plan.removeNodeIds.length) {
    api.removeData({ edges: plan.removeEdgeIds, nodes: plan.removeNodeIds });
  }
  if (plan.addNodes.length || plan.addEdges.length) {
    // 新节点位置种子：优先位置缓存（Obsidian 口径——曾出现过的节点回到原位附近）；
    // 无缓存的全新节点取现有点质心＋抖动（d3 无位节点落在世界原点＝画布左上角外，看不见）
    const centroid = (() => {
      const pts = [...positionCache.values()];
      if (!pts.length) return undefined;
      return {
        x: pts.reduce((s, p) => s + p.x, 0) / pts.length,
        y: pts.reduce((s, p) => s + p.y, 0) / pts.length,
      };
    })();
    const nodesWithSeed = plan.addNodes.map((n) => {
      const seed = n.style ?? positionCache.get(n.id) ?? (centroid
        ? { x: centroid.x + (Math.random() - 0.5) * 220, y: centroid.y + (Math.random() - 0.5) * 220 }
        : undefined);
      return { ...n, style: seed };
    });
    api.addData({ nodes: nodesWithSeed, edges: plan.addEdges });
  }
  if (plan.updateNodes.length) api.updateData({ nodes: plan.updateNodes });
  await api.draw();
  if (plan.structureChanged) await api.layout(); // d3-force 从现位重入仿真，轻推即停
  rememberPositions(api);
}
type LiveGraphSyncNodes = TopoNode[];

export function LocalGraph() {
  const nodes = useKnowledgeNodes();
  const edges = useKnowledgeEdges();
  const loading = useTopologyLoading();
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<GraphApi | null>(null);
  const [selectedId, setSelectedId] = useState<string>("");
  const [query, setQuery] = useState<string>("");
  const [colorByCategory, setColorByCategory] = useState<boolean>(false);

  // 边可见性（Master 2026-10-29）：REFERENCES=作者手写双链全显；其余类型机器推导断言仅 approved 上图
  const visibleEdges = useMemo(() => edges.filter(isEdgeVisible), [edges]);
  // 节点可见性：文件背书常驻；骨架/派生节点须被可见边触及
  const visibleNodes = useMemo(() => {
    const touched = new Set<string>();
    for (const e of visibleEdges) { touched.add(e.source); touched.add(e.target); }
    return nodes.filter((n) => isFileBackedNode(n) || touched.has(n.id));
  }, [nodes, visibleEdges]);
  // 可见边度数（Obsidian 口径：尺寸=连接数；后端 degree 计全部边，含未上图者，不作尺寸依据）
  const degreeById = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of visibleEdges) {
      m.set(e.source, (m.get(e.source) ?? 0) + 1);
      m.set(e.target, (m.get(e.target) ?? 0) + 1);
    }
    return m;
  }, [visibleEdges]);

  // 选中节点的出入边（双向都收，展示时按方向分列；只数已上图边——明细即图面）
  const relatedEdges: TopoEdge[] = selectedId
    ? visibleEdges.filter((e) => e.source === selectedId || e.target === selectedId)
    : [];
  const outEdges = relatedEdges.filter((e) => e.source === selectedId);
  const inEdges = relatedEdges.filter((e) => e.target === selectedId);

  const nodeLabel = useCallback(
    (id: string) => visibleNodes.find((n) => n.id === id)?.label || id,
    [visibleNodes],
  );

  // 按分类着色开关（Obsidian groups 的分类版）：开着时基础填充走分类色表。
  // 注意通道优先级：graph.node.style（默认样式）> 数据 style——着色必须经默认样式回调
  // 读节点数据（数据 style 实测被默认灰覆盖），回调黑点是当年缓存损坏冤案。
  // 首建与增量同步共用一个负载函数（禁两处抄写——graph-sync buildNodePayload 的 catFill 实参）。
  const catFillOf = useCallback(
    (category: string) =>
      colorByCategory ? resolveCssColor(CATEGORY_COLORS[category] ?? DEFAULT_COLOR, token(CANVAS_PALETTE.dimNode)) : undefined,
    [colorByCategory],
  );

  // 实例销毁仅随卸载（2026-11-20 Obsidian 式收口：数据变化不再销毁重建——跳变根源即此）。
  // 空数据态也走同一销毁（空态覆盖层接管画面；下批数据到来时重新首建）。
  const destroyInstance = useCallback(() => {
    const g = graphRef.current;
    graphRef.current = null;
    if (g) {
      g.destroy();
      const c = containerRef.current;
      // G6 destroy 不清挂载层——强制清空容器兜底
      if (c) { try { c.innerHTML = ""; } catch { /* */ } }
    }
  }, []);
  useEffect(() => destroyInstance, [destroyInstance]);

  // 数据落图（常驻实例）：无实例→首建（fitView 仅此一次）；有实例→增量同步（节点原位、
  // 视口不动、结构变化才轻推布局）；选中/搜索态走独立 state 通道不受影响。
  useEffect(() => {
    if (loading) return;
    const existing = graphRef.current;
    if (!visibleNodes.length) {
      if (existing) destroyInstance();
      return;
    }
    if (existing) {
      // 增量路径（同步；失败留痕同首建口径——静默会让数据分叉不可归因）
      syncGraphData(existing, visibleNodes, visibleEdges, degreeById, catFillOf).catch(
        (err) => console.warn(LOCAL_GRAPH_COPY.RENDER_FAILED_WARN, err),
      );
      return;
    }
    const container = containerRef.current;
    if (!container) return;
    let disposed = false;
    // 首建在途的兜底销毁器（new Graph() 后立即就位——render 迭代秒级耗时，窗口内若卸载，
    // 晚到的僵尸实例必须被清：旧图 canvas 层僵尸堆积 4→8→12 实录 2026-10-30）
    let inflight: { destroy: () => void } | null = null;
    void (async () => {
      const { Graph } = await import("@antv/g6");
      if (disposed || !containerRef.current) return;
      const liveContainer = containerRef.current;
      try {
      // 节点负载（label/degree/catFill＋位置种子）：首建即读位置缓存——重挂载不再从中心炸开，
      // 节点回到上次所在位置附近（Obsidian 打开图谱视图的体感）
      const nodeData = visibleNodes.map((n) =>
        buildNodePayload(n, degreeById.get(n.id) ?? 0, catFillOf(n.category), positionCache.get(n.id)),
      );
      const edgeData = visibleEdges.map(buildEdgePayload);
      // 位置连续性：全部节点都有缓存位置时跳过布局（render 会把力仿真从 alpha=1 重热——
      // 种子位置被冲掉＝重挂载图面漂移；Obsidian 打开图谱视图不重排，只沿用原位）。
      // 无缓存（首次进图）才走完整布局。视口经 fitView 适配同一份世界坐标＝视口也不跳。
      const positionsFullyCached = visibleNodes.every((n) => positionCache.has(n.id));
      const graph = new Graph({
        container: liveContainer,
        width: liveContainer.clientWidth || 640,
        height: 460,
        // 淡化平滑过渡（Master 2026-10-30「obsidian的其他未选中是慢慢淡淡的变浅」）：透明度/颜色系
        // 样式默认不在 G6 状态动画插值面（实测瞬变），显式声明字段＋时长≈Obsidian 每帧 0.9 补间手感
        animation: {
          duration: 400,
          easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
          fields: ['fill', 'fillOpacity', 'stroke', 'strokeOpacity', 'strokeWidth', 'lineWidth', 'opacity', 'labelOpacity'],
        },
        // 不用 autoFit（它随每次重绘生效——选中改状态触发重绘时视口又被自动适配，图面缩放跳变；
        // Master 2026-10-29「选中放大的自动不要」）。首次适配改在 render 后手动 fitView 一次。
        // Obsidian 图谱交互四件套：拖拽钉住（drag-element-force+fixed——Obsidian 拖拽即 fx/fy 固定，
        // drag-element 会在松手后被力导向拉回）/画布拖移/滚轮缩放/悬停聚焦（hover-activate 度1双向：
        // 悬停节点与直连邻居亮、其余淡化——Obsidian 核心手感，obsidian.asar sim.js 逆向引入批 2026-10-30）
        behaviors: [
          { type: "drag-element-force", fixed: true },
          "drag-canvas",
          "zoom-canvas",
          // 悬停聚焦（Obsidian 口径）：聚焦节点与直连邻居保持原样，其余整体淡出——
          // 效果主体是淡化（dimmed 近隐），hover 态本身不加描边不加色（Obsidian 无悬停环）
          { type: "hover-activate", degree: 1, direction: "both", state: "hover", inactiveState: "dimmed" },
        ],
        // Obsidian 图谱同款物理：d3-force（弹簧连接力＋库仑斥力＋碰撞防叠）——无连边节点被斥力
        // 推开、均匀散布。原配置误用 @antv 自研 force 布局（参数方言不同：nodeStrength 正负语义相反、
        // collide 键不存在），d3-force 方言的参数全部哑火：-50 实为引力、防重叠不生效——
        // 3 个孤儿文档点叠堆在中心（Master 2026-10-29「为什么叠在一起 obsidian怎么不这样」）。
        // 实测 1017x460 画布 3 孤点两两间距 430-459px（探针验证 2026-10-29）。
        // 增量同步批：layout() 只在结构增删时调用（d3-force 从元素现位起步——轻推即停，
        // 不再整图从中心重排）
        layout: {
          type: "d3-force",
          linkDistance: 110,
          nodeStrength: -260,
          collide: { radius: 22, strength: 0.9, iterations: 3 },
          alphaDecay: 0.02,
        },
        node: {
          style: {
            // Obsidian 口径：节点尺寸只由连接数决定（度数映射、封顶防枢纽霸屏）；选中不改大小
            size: (d: { data?: { degree?: number } }) => 10 + Math.min(d.data?.degree ?? 0, 10) * 1.2,
            fill: (d: { data?: { catFill?: string } }) => d.data?.catFill || token(CANVAS_PALETTE.dimNode),
            stroke: token(CANVAS_PALETTE.nodeStroke),
            strokeWidth: 0.5,
            labelText: (d: { id: string; data?: { label?: string } }) => nodeNameLabel(d.data),
            labelFontSize: 10,
            labelOpacity: 0.9,
          },
          // 选中/关联/淡化/悬停走 G6 v5 state 通道（Obsidian 同款高亮语义：紫填充＋描边光圈、
          // 关联着色、无关淡化）——选中切换只改元素状态，不整图重建
          state: {
            // Obsidian 口径：选中只变色不变大、不加圈——halo:false 显式关掉 G6 base theme 内置
            // selected 光环（halo:true/haloLineWidth:24——黑圈实录 Master 2026-10-29「你整个黑圈干什么」）
            selected: { fill: token(CANVAS_PALETTE.selectedNode), lineWidth: 0.5, halo: false },
            related: { fill: token(CANVAS_PALETTE.relatedNode), labelOpacity: 0.9 },
            dimmed: { fillOpacity: 0.2, strokeOpacity: 0.2, labelOpacity: 0.15 },
            // 悬停态＝无样式变化（Obsidian 口径：悬停聚焦的效果主体是"其余淡出"，
            // 聚焦节点与邻居保持原色原样——加环加色都是画蛇添足）
            hover: {},
          },
        },
        edge: {
          style: { stroke: token(CANVAS_PALETTE.dimEdge), lineWidth: 0.6, opacity: 0.85, endArrow: true },
          state: {
            related: { stroke: token(CANVAS_PALETTE.relatedEdge), lineWidth: 2, opacity: 0.85 },
            dimmed: { opacity: 0.2 },
          },
        },
        data: { nodes: nodeData, edges: edgeData },
      } as never);
      // 在途兜底销毁器立即就位：仅当实例尚未被 graphRef 收养（disposed/被替换）时才销毁——
      // 已收养实例的生命周期归卸载 effect（数据变化不再销毁，见本 effect 顶部分支）
      inflight = {
        destroy: () => {
          try { void graph.destroy(); } catch { /* */ }
          try { liveContainer.innerHTML = ""; } catch { /* */ }
        },
      };
      if (positionsFullyCached) {
        // 布局跳过路径：数据进控制器后仅绘制（draw＝不执行布局，G6 v5.1.1 勘探 graph.d.ts）
        graph.setData({ nodes: nodeData, edges: edgeData } as never);
        await graph.draw();
      } else {
        await graph.render();
      }
      // render/draw 迭代期间组件可能已重建（disposed）——晚到的僵尸实例不得再绑事件/覆盖 graphRef
      if (disposed) { inflight?.destroy(); return; }
      // 首次适配：无条件 fitView（节点围绕世界原点散布，不适配必出界）＋缩放上限 1（防稀疏图放大闪跳，
      // Master 2026-10-29「点进关系查询突然变大」——放大被夹回后仅剩平移居中，无两段式猛放缩回）。
      // 有位置种子时 fitView 得到与上次相同的视口＝重挂载无缩放跳变；增量路径不做任何视口操作。
      try {
        // 首帧适配必须无条件执行：d3-force 围绕世界原点 (0,0) 散布、画布原点在左上角——
        // 不适配则节点大半散布在画布外/左上角（探针实测 3 孤点 c.y=-59 出界 2026-10-30）。
        // 缩放上限 1 保留：fitView 对稀疏图的放大被夹回，大图适配为缩小不受影响。
        await graph.fitView();
        if (graph.getZoom() > 1) await graph.zoomTo(1);
      } catch { /* 首次适配失败不阻断 */ }
      try {
        graph.on?.("node:click", (evt: unknown) => {
          const t = (evt as { target?: { getID?: () => unknown; id?: unknown } })?.target;
          const id = t?.getID ? String(t.getID()) : typeof t?.id === "string" ? t.id : (evt as { id?: unknown })?.id;
          if (typeof id === "string" && id) setSelectedId(id);
        });
      } catch { /* 事件绑定失败不阻断渲染 */ }
      graphRef.current = {
        destroy: () => { try { void graph.destroy(); } catch { /* 已销毁 */ } },
        fitView: () => { try { void graph.fitView(); } catch { /* */ } },
        zoomBy: (factor: number) => { try { const z = graph.getZoom(); void graph.zoomTo(z * factor); } catch { /* */ } },
        setElementState: (id: string, states: string[]) => { try { void graph.setElementState(id, states); } catch { /* 状态失败不阻断 */ } },
        getNodeData: () => (graph.getNodeData() as never) as LiveGraphSnapshot["nodes"],
        getEdgeData: () => (graph.getEdgeData() as never) as LiveGraphSnapshot["edges"],
        addData: (data) => { try { graph.addData(data as never); } catch { /* 同步失败由下次重建兜底 */ } },
        updateData: (data) => { try { graph.updateData(data as never); } catch { /* 同上 */ } },
        removeData: (ids) => { try { graph.removeData(ids as never); } catch { /* 同上 */ } },
        draw: () => graph.draw(),
        layout: () => graph.layout(),
      };
      rememberPositions(graphRef.current);

      } catch (err) {
        // G6 画布初始化/渲染失败（无 canvas 环境如 jsdom、容器竞态卸载）——图区降级为空，
        // 出入链表格区不受影响；不兜底则逃逸为 unhandled rejection（批16 时序位移暴露的批15 潜伏面）。
        // 留痕不静默：静默 catch 让渲染故障不可归因（2026-10-30 全黑排查教训）
        console.warn(LOCAL_GRAPH_COPY.RENDER_FAILED_WARN, err);
      }
    })();
    return () => {
      disposed = true;
      // 仅清未被收养的在途实例；已收养实例归卸载 effect（数据变化不再销毁重建）
      if (!graphRef.current) inflight?.destroy();
    };
  }, [visibleNodes, visibleEdges, degreeById, loading, catFillOf, destroyInstance]);

  // 选中＋图内搜索状态合成（G6 v5 状态通道——不重建图、不复位拖拽位置）：
  // 选中维度：选中=selected；邻居=related；其余=dimmed。搜索维度（Obsidian filters 口径）：
  // 非匹配节点/边一律 dimmed 覆盖（含选中的邻居），匹配节点保留选中相关态。
  useEffect(() => {
    const api = graphRef.current;
    if (!api) return;
    const q = query.trim();
    const related = new Set<string>();
    if (selectedId) {
      for (const e of visibleEdges) {
        if (e.source === selectedId) related.add(e.target);
        if (e.target === selectedId) related.add(e.source);
      }
    }
    for (const n of visibleNodes) {
      const hit = matchesQuery(n, q);
      let states: string[];
      if (!hit) {
        states = ["dimmed"];
      } else if (n.id === selectedId) {
        states = ["selected"];
      } else if (selectedId && related.has(n.id)) {
        states = ["related"];
      } else {
        states = [];
      }
      api.setElementState(n.id, states);
    }
    for (const e of visibleEdges) {
      const relatedEdge = selectedId && (e.source === selectedId || e.target === selectedId);
      // 搜索非空时：两端都匹配（任一端命中即可）才保留关联/淡化语义，否则整条淡化
      const hit = !q || matchesQuery({ id: e.source, label: nodeLabel(e.source) }, q) || matchesQuery({ id: e.target, label: nodeLabel(e.target) }, q);
      const states = !hit ? ["dimmed"] : relatedEdge ? ["related"] : q ? [] : selectedId ? ["dimmed"] : [];
      api.setElementState(e.edgeId, states);
    }
  }, [selectedId, query, visibleNodes, visibleEdges, loading, nodeLabel]);

  const edgeRow = (edge: TopoEdge, dir: "out" | "in") => {
    const neighborId = dir === "out" ? edge.target : edge.source;
    return (
      <li key={edge.edgeId}>
        <UiButton
          type="button"
          variant="ghost"
          onClick={() => setSelectedId(neighborId)}
          title={LOCAL_GRAPH_COPY.NEIGHBOR_ROW_TITLE}
          className="flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-xs font-normal transition-colors hover:bg-surface-hover"
        >
          <span className="font-mono text-text-main">{nodeLabel(edge.source)}</span>
          {/* WP-145 W2-B（C2）：关系类型经 ontology 单源正名上屏（未登记类型回落「未登记关系」），裸枚举退役 */}
          <span className="rounded bg-accent-base/10 px-1.5 py-0.5 text-accent-base">{relationTypeLabel(edge.type)}</span>
          <span className="text-text-sub">→</span>
          <span className="font-mono text-text-main">{nodeLabel(edge.target)}</span>
          {/* WP-138 R5c：tone 分桶改调 review-status 域单源谓词（人裁放行口径——语义不变，见 ReviewStatus.ts 声明处）。
              WP-145 W2-B（C3）：label 改调 reviewStatusDisplay 单源投影——非法/缺省 fail-safe=待审核（TERM.PENDING_REVIEW），
              裸枚举与手写「无状态」退役；tone 保持人裁放行口径不与生效集混用（ReviewStatus.ts 口径②）。 */}
          <span className={`ml-auto rounded px-1.5 py-0.5 ${isHumanApprovedReviewStatus(edge.reviewStatus) ? "bg-status-fact-2 text-status-fact" : "bg-status-warn-2 text-status-warn"}`}>{reviewStatusDisplay(edge.reviewStatus).label}</span>
        </UiButton>
      </li>
    );
  };

  return <section aria-label={LOCAL_GRAPH_COPY.SECTION_ARIA} className="space-y-3" data-testid="local-graph">
    <div className="border-b border-border-thin pb-3 text-xs text-text-sub">
      <p className="font-medium text-text-main">{LOCAL_GRAPH_COPY.INTRO}</p>
    </div>
    {/* 图内搜索＋着色（Obsidian filters/groups 的分类版；Master 2026-10-30「图内搜索/着色分组直接引入」） */}
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-hint" aria-hidden="true" />
        <Input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={LOCAL_GRAPH_COPY.SEARCH_PLACEHOLDER}
          aria-label={LOCAL_GRAPH_COPY.SEARCH_ARIA}
          data-testid="local-graph-search"
          className="h-6 w-56 pl-7 text-xs"
        />
      </div>
      <UiButton
        type="button"
        variant="outline"
        size="sm"
        aria-pressed={colorByCategory}
        title={colorByCategory ? LOCAL_GRAPH_COPY.COLOR_ON_TITLE : LOCAL_GRAPH_COPY.COLOR_OFF_TITLE}
        onClick={() => setColorByCategory((v) => !v)}
        className={`h-6 gap-1 px-2 text-xs ${colorByCategory ? "border-accent-base text-accent-base" : ""}`}
      >
        <SwatchBook className="h-3.5 w-3.5" aria-hidden="true" />
        {LOCAL_GRAPH_COPY.COLOR_BY_CATEGORY}
      </UiButton>
      {query && (
        <UiButton type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setQuery("")}>{LOCAL_GRAPH_COPY.CLEAR_SEARCH}</UiButton>
      )}
    </div>
    <div className="relative">
      <div ref={containerRef} className="h-[460px] rounded-md ring-1 ring-border-thin bg-surface-root" aria-label={LOCAL_GRAPH_COPY.CANVAS_ARIA} role="img" />
      {graphRef.current && (
        <div className="absolute bottom-2 right-2 flex gap-1">
          <UiButton type="button" variant="outline" size="icon" aria-label={LOCAL_GRAPH_COPY.ZOOM_IN} onClick={() => graphRef.current?.zoomBy(1.2)}><Plus className="h-4 w-4" /></UiButton>
          <UiButton type="button" variant="outline" size="icon" aria-label={LOCAL_GRAPH_COPY.ZOOM_OUT} onClick={() => graphRef.current?.zoomBy(1 / 1.2)}><Minus className="h-4 w-4" /></UiButton>
          <UiButton type="button" variant="outline" size="icon" aria-label={LOCAL_GRAPH_COPY.FIT_VIEW} onClick={() => graphRef.current?.fitView()}><Maximize2 className="h-4 w-4" /></UiButton>
        </div>
      )}
      {loading && <div className="absolute inset-0 flex items-center justify-center"><Loader2 className="h-5 w-5 animate-spin" /></div>}
      {!loading && !visibleNodes.length && (
        <div className="absolute inset-0 flex items-center justify-center" data-testid="local-graph-empty">
          {/* WP-145 N1：整块画布空态改走 EmptyState 介质（bare——容器框由画布自带，避免双层框）；渲染条件不变 */}
          <EmptyState
            bare
            title={LOCAL_GRAPH_COPY.EMPTY_TITLE}
            description={LOCAL_GRAPH_COPY.EMPTY_DESCRIPTION}
          />
        </div>
      )}
    </div>
    {/* 选中节点的出入链明细（与图联动；点行=选中邻居） */}
    <div className="space-y-2 rounded-md ring-1 ring-border-thin p-3" data-testid="local-graph-detail">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="font-medium text-text-main">{LOCAL_GRAPH_COPY.DETAIL_HEADING}</span>
        {selectedId
          ? <span>{TERM.ENTITY} <span className="font-mono text-text-main">{nodeLabel(selectedId)}</span>{localGraphLinkSummary(outEdges.length, inEdges.length)}</span>
          : <span className="text-text-hint">{LOCAL_GRAPH_COPY.DETAIL_HINT}</span>}
        {selectedId && (
          <UiButton type="button" variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setSelectedId("")}>{LOCAL_GRAPH_COPY.CLEAR_SELECTION}</UiButton>
        )}
      </div>
      {selectedId && relatedEdges.length === 0 && (
        <p className="py-4 text-center text-xs text-text-hint">{TERM.EMPTY_NODE_EDGE}</p>
      )}
      {selectedId && outEdges.length > 0 && (
        <div>
          <p className="text-xs text-text-hint">{localGraphOutLinks(outEdges.length)}</p>
          <ul className="divide-y divide-border-thin rounded-md ring-1 ring-border-thin">{outEdges.map((e) => edgeRow(e, "out"))}</ul>
        </div>
      )}
      {selectedId && inEdges.length > 0 && (
        <div>
          <p className="text-xs text-text-hint">{localGraphInLinks(inEdges.length)}</p>
          <ul className="divide-y divide-border-thin rounded-md ring-1 ring-border-thin">{inEdges.map((e) => edgeRow(e, "in"))}</ul>
        </div>
      )}
    </div>
  </section>;
}
