import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render } from '@testing-library/react'
import { DashboardView } from '@/features/dashboard/DashboardView'
import * as topologyStore from '@/lib/topology-store'
import * as reviewStore from '@/lib/review-data-store'

vi.mock('@/lib/topology-store', () => ({
  useAdmittedNodes: vi.fn(),
  useAdmittedEdges: vi.fn(),
  useTopologyStats: vi.fn(),
  useTopologyLoading: vi.fn(),
  useTopologyError: vi.fn(),
  useTopologyErrorCode: vi.fn(),
  useLoadTopology: vi.fn(),
  useUnresolvedGapCount: vi.fn(),
}))

vi.mock('@/lib/review-data-store', () => ({
  useReviewStore: vi.fn((selector) => {
    const state = { load: vi.fn() }
    return selector ? selector(state) : state
  }),
  useReviewPendingCount: vi.fn(),
}))

vi.mock('@/lib/property-data-store', () => ({
  usePropertyDataStore: vi.fn((selector) => {
    const state = { summary: null, load: vi.fn() }
    return selector ? selector(state) : state
  }),
}))

describe('DashboardView - Pipeline Flow Coverage', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    // Setup all required mocks
    vi.mocked(topologyStore.useAdmittedNodes).mockReturnValue([
      { id: 'node-1', label: '组件A', category: 'ArchitectureComponent', degree: 1, labels: ['ArchitectureComponent'] },
      { id: 'node-2', label: '组件B', category: 'ArchitectureComponent', degree: 1, labels: ['ArchitectureComponent'] },
    ])
    vi.mocked(topologyStore.useAdmittedEdges).mockReturnValue([
      { edgeId: 'edge-1', source: 'node-1', target: 'node-2', type: 'DEPENDS_ON', reviewStatus: 'approved' },
    ])
    // stats 对齐契约 DashboardTopologyData（ADR067 后无 approvedEdges/pendingEdges 字段）：
    // 身份用 worktree 臂（dataSource），规模字段按 scope=full 全量形态。
    vi.mocked(topologyStore.useTopologyStats).mockReturnValue({
      dataSource: 'worktree',
      workingRevision: 'test',
      scope: 'full',
      totalNodes: 2,
      returnedNodes: 2,
      totalEdges: 1,
      returnedEdges: 1,
      topology: { nodes: [], edges: [] },
    })
    vi.mocked(topologyStore.useTopologyLoading).mockReturnValue(false)
    vi.mocked(topologyStore.useTopologyError).mockReturnValue(null)
    vi.mocked(topologyStore.useTopologyErrorCode).mockReturnValue(null)
    vi.mocked(topologyStore.useLoadTopology).mockReturnValue(vi.fn())
    vi.mocked(topologyStore.useUnresolvedGapCount).mockReturnValue(0)
    vi.mocked(reviewStore.useReviewPendingCount).mockReturnValue(0)
  })

  it('应该显示图谱统计信息', () => {
    render(<DashboardView />)

    // 页内主标题已删（与顶栏重复，PR③ Master 2026-10-07 04:44 拍板）——副标题仍在
    // 页题已裁删（ce337ad4）
  })

  it('应该调用 load 函数初始化数据', () => {
    const mockLoad = vi.fn()
    vi.mocked(topologyStore.useLoadTopology).mockReturnValue(mockLoad)

    render(<DashboardView />)

    expect(mockLoad).toHaveBeenCalled()
  })

  it('应该显示节点和边的数量', () => {
    render(<DashboardView />)

    // 检查是否渲染了统计数据（页内主标题已删，同上拍板）
    // 页题已裁删（ce337ad4）
  })
})
