# 三视图交互契约

架构图系统前端三视图（架构图 / 知识图谱 / 树）的统一交互行为契约。任何涉及 `App.tsx`、`ArchitectureDiagram.tsx`、`KnowledgeGraphCanvas.tsx`、`TreeViewMode.tsx`、`ReactFlowAdapter.tsx` 的交互变更，必须在此文件中同步更新。

## 契约矩阵

| 交互 | 架构图 | 知识图谱 | 树 |
|------|--------|---------|-----|
| 单击节点 | `toggleNodeSelection` — 选中/取消 | `toggleNodeSelection` — 选中/取消 | 已折叠→展开+选中 / 已展开→`toggleNodeSelection` |
| 双击节点 | - | - | 折叠/展开子树（`expandedSet` toggle） |
| 连线点击 | 打开 sidebar 连线详情 | 打开 sidebar 连线详情 | 打开 sidebar 连线详情（查 `allEdges` 获取 confidence） |
| 右键菜单 | 架构师: "移动到层级" / 阻止浏览器默认 | `preventDefault` 阻止浏览器默认 | `preventDefault` 阻止浏览器默认 |
| 双击缩放 | `zoomOnDoubleClick={false}` | 无 ReactFlow（自定义 SVG） | `zoomOnDoubleClick={false}` |
| 节点悬停边高亮 | 关联边 opacity:0.7, 非关联:0.08 | - | 关联边 opacity:0.6, 非关联:0.15 |
| 视图切换 | `clearCanvasSelection` 清除选中 | `clearCanvasSelection` 清除选中 | `clearCanvasSelection` 清除选中 |

## 选择状态流

```
selectedNode: string | null     （App.tsx useState，跨视图共享）
focusedModuleId: string | null  （zustand graph-store，与 selectedNode 同步）
```

- `toggleNodeSelection(id)`: `prev === id ? null : id` — 支持取消
- `applyUpgradeProgramNodeScope(id)`: 升级程序 plate scope 设置（仅 KG/树视图调用）
- 视图切换 (`handleViewModeChange`): 始终调用 `clearCanvasSelection()`
- 侧边栏关闭 (`handleCloseSidebar`): 清除 `selectedNode`、`focusedModule`、`architectureInspect`

## 连线选中

```
selectedConnection: { from, to, confidence?, needsManualReview?, sources? } | null
```

- `handleConnectionClick`: 从 edge data 提取，设置 `selectedConnection` + `selectedNode = from` + `focusedModule = from`

## 树视图特有

- `expandedSet: Set<string>` — 已展开节点的 originalId 集合
- 初始状态: `useEffect` 在 `rootId` 变化时重置为 `new Set([rootId])`
- `effectiveExpanded`: `expandedSet.size > 0 ? expandedSet : new Set([rootId])` — 保证根节点始终展开
- 单击已折叠节点: 展开（add to Set）+ 调用 `onNodeSelect`（toggle 选中）
- 单击已展开节点: 仅 `onNodeSelect`（toggle 选中），不改变展开状态
- 双击任意节点: toggle `expandedSet`（展开/折叠），不触发 `onNodeSelect`

## 知识图谱特有

- `expandNeighbors(nodeId)`: 单击节点时触发渐进加载（`handleCanvasNodeClick` in ArchitectureDiagram.tsx）
- 泳道展开/折叠: `expandedCategories` + `onToggleCategory`
- 连接线 LOD: `connectionLOD` 控制边密度

## 代码锚点

| 函数/组件 | 文件 | 行号（约） |
|-----------|------|-----------|
| `handleDiagramNodeClick` | App.tsx | 632 |
| `handleTreeNodeSelect` | App.tsx | 645 |
| `toggleNodeSelection` | App.tsx | 571 |
| `handleConnectionClick` | App.tsx | 669 |
| `handleViewModeChange` | App.tsx | 579 |
| `handleCloseSidebar` | App.tsx | 649 |
| `handleCanvasNodeClick` | ArchitectureDiagram.tsx | 569 |
| `handleNodeClick` (tree) | TreeViewMode.tsx | 583 |
| `handleNodeDoubleClick` (tree) | TreeViewMode.tsx | 596 |
| `handleEdgeClick` (tree) | TreeViewMode.tsx | 610 |
| `handleNodeClick` (ReactFlowAdapter) | ReactFlowAdapter.tsx | 559 |
| `handleNodeContextMenu` (ReactFlowAdapter) | ReactFlowAdapter.tsx | 611 |
| `handleEdgeClick` (ReactFlowAdapter) | ReactFlowAdapter.tsx | 628 |
| `styledEdges` (ReactFlowAdapter) | ReactFlowAdapter.tsx | 641 |

## 变更记录

- 2026-05-16: 初始契约建立 — 三视图统一 toggle 选择、树视图展开/选中解耦、连线点击统一、右键菜单统一、双击缩放统一禁用、架构图节点悬停边高亮
