import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock API
const mockApiFetchEnvelope = vi.fn()
vi.mock('@/lib/api', () => ({
  apiFetchEnvelope: mockApiFetchEnvelope,
}))

describe('Schema Release - Full State Machine', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Create Release (draft 状态)', () => {
    it('应该创建 Release 并返回 draft 状态', async () => {
      const createRequest = {
        changes: [
          {
            type: 'entity_type_added',
            entityType: 'Service',
            description: '新增 Service 节点类型',
          },
          {
            type: 'relation_type_added',
            relationType: 'PROVIDES',
            description: '新增 PROVIDES 关系类型',
          },
        ],
        operator: 'local-architect',
      }

      const createResponse = {
        revision: 'sha256:abc123',
        status: 'draft',
        createdAt: '2026-09-12T10:00:00Z',
        changes: createRequest.changes,
        snapshotPath: '.ledger/schema-releases/sha256:abc123/',
      }

      mockApiFetchEnvelope.mockResolvedValue({
        ok: true,
        data: createResponse,
      })

      const result = await mockApiFetchEnvelope('/api/schema/releases', {
        method: 'POST',
        body: JSON.stringify(createRequest),
      })

      expect(result.ok).toBe(true)
      expect(result.data.status).toBe('draft')
      expect(result.data.revision).toContain('sha256:')
      expect(result.data.changes).toHaveLength(2)
    })

    it('应该保存 ontology.yaml 和 enums.yaml 快照', async () => {
      const snapshotContent = {
        ontology: {
          entity_types: ['Module', 'ArchitectureComponent', 'Service'],
          relation_types: ['DEPENDS_ON', 'CONNECTS_TO', 'PROVIDES'],
        },
        enums: {
          arch_layers: ['service', 'application', 'data-lake'],
          statuses: ['active', 'deprecated', 'retired'],
        },
      }

      mockApiFetchEnvelope.mockResolvedValue({
        ok: true,
        data: {
          revision: 'sha256:abc123',
          status: 'draft',
          snapshot: snapshotContent,
        },
      })

      const result = await mockApiFetchEnvelope('/api/schema/releases', {
        method: 'POST',
        body: JSON.stringify({ changes: [], operator: 'local-architect' }),
      })

      expect(result.ok).toBe(true)
      expect(result.data.snapshot).toBeDefined()
      expect(result.data.snapshot.ontology.entity_types).toContain('Service')
      expect(result.data.snapshot.enums.arch_layers).toContain('service')
    })

    it('应该检测到没有变更时拒绝创建', async () => {
      mockApiFetchEnvelope.mockResolvedValue({
        ok: false,
        error: '没有检测到 Schema 变更',
        errorCode: 'NO_SCHEMA_CHANGES',
      })

      const result = await mockApiFetchEnvelope('/api/schema/releases', {
        method: 'POST',
        body: JSON.stringify({ changes: [], operator: 'local-architect' }),
      })

      expect(result.ok).toBe(false)
      expect(result.errorCode).toBe('NO_SCHEMA_CHANGES')
    })
  })

  describe('Promote Release (draft → staged)', () => {
    it('应该将 Release 从 draft 提升到 staged', async () => {
      const promoteResponse = {
        revision: 'sha256:abc123',
        previousStatus: 'draft',
        currentStatus: 'staged',
        promotedAt: '2026-09-12T11:00:00Z',
        promotedBy: 'local-architect',
      }

      mockApiFetchEnvelope.mockResolvedValue({
        ok: true,
        data: promoteResponse,
      })

      const result = await mockApiFetchEnvelope('/api/schema/releases/sha256:abc123/promote', {
        method: 'POST',
      })

      expect(result.ok).toBe(true)
      expect(result.data.previousStatus).toBe('draft')
      expect(result.data.currentStatus).toBe('staged')
    })

    it('应该验证兼容性', async () => {
      const compatibilityCheck = {
        passed: true,
        checks: [
          {
            type: 'backwards_compatible',
            result: 'pass',
            message: '所有变更向后兼容',
          },
          {
            type: 'no_breaking_changes',
            result: 'pass',
            message: '没有破坏性变更',
          },
        ],
      }

      mockApiFetchEnvelope.mockResolvedValue({
        ok: true,
        data: {
          revision: 'sha256:abc123',
          currentStatus: 'staged',
          compatibilityCheck: compatibilityCheck,
        },
      })

      const result = await mockApiFetchEnvelope('/api/schema/releases/sha256:abc123/promote', {
        method: 'POST',
      })

      expect(result.ok).toBe(true)
      expect(result.data.compatibilityCheck.passed).toBe(true)
      expect(result.data.compatibilityCheck.checks).toHaveLength(2)
    })

    it('应该在有破坏性变更时阻断', async () => {
      const compatibilityCheck = {
        passed: false,
        checks: [
          {
            type: 'breaking_change_detected',
            result: 'fail',
            message: '删除节点类型 "OldType" 会影响现有 5 个节点',
            affectedCount: 5,
          },
        ],
      }

      mockApiFetchEnvelope.mockResolvedValue({
        ok: false,
        error: '兼容性检查失败',
        errorCode: 'COMPATIBILITY_CHECK_FAILED',
        details: compatibilityCheck,
      })

      const result = await mockApiFetchEnvelope('/api/schema/releases/sha256:abc123/promote', {
        method: 'POST',
      })

      expect(result.ok).toBe(false)
      expect(result.errorCode).toBe('COMPATIBILITY_CHECK_FAILED')
      expect(result.details.passed).toBe(false)
      expect(result.details.checks[0].affectedCount).toBe(5)
    })

    it('应该只允许从 draft 状态 promote', async () => {
      mockApiFetchEnvelope.mockResolvedValue({
        ok: false,
        error: 'Release 已经是 staged 状态',
        errorCode: 'INVALID_STATE_TRANSITION',
      })

      const result = await mockApiFetchEnvelope('/api/schema/releases/sha256:abc123/promote', {
        method: 'POST',
      })

      expect(result.ok).toBe(false)
      expect(result.errorCode).toBe('INVALID_STATE_TRANSITION')
    })
  })

  describe('Approve Release (staged → approved)', () => {
    it('应该通过审批状态机批准 Release', async () => {
      const approveResponse = {
        revision: 'sha256:abc123',
        previousStatus: 'staged',
        currentStatus: 'approved',
        approvedAt: '2026-09-12T12:00:00Z',
        approvedBy: 'architect-2',
      }

      mockApiFetchEnvelope.mockResolvedValue({
        ok: true,
        data: approveResponse,
      })

      const result = await mockApiFetchEnvelope('/api/schema/releases/sha256:abc123/approve', {
        method: 'POST',
      })

      expect(result.ok).toBe(true)
      expect(result.data.previousStatus).toBe('staged')
      expect(result.data.currentStatus).toBe('approved')
      expect(result.data.approvedBy).toBe('architect-2')
    })

    it('应该记录审批意见', async () => {
      const approvalComment = {
        reviewer: 'architect-2',
        comment: '变更合理，同意发布',
        timestamp: '2026-09-12T12:00:00Z',
      }

      mockApiFetchEnvelope.mockResolvedValue({
        ok: true,
        data: {
          revision: 'sha256:abc123',
          currentStatus: 'approved',
          approvalComment: approvalComment,
        },
      })

      const result = await mockApiFetchEnvelope('/api/schema/releases/sha256:abc123/approve', {
        method: 'POST',
        body: JSON.stringify({ comment: '变更合理，同意发布' }),
      })

      expect(result.ok).toBe(true)
      expect(result.data.approvalComment).toBeDefined()
      expect(result.data.approvalComment.reviewer).toBe('architect-2')
    })
  })

  describe('Publish Release (approved → released)', () => {
    it('应该发布 Release 到生产', async () => {
      const publishResponse = {
        revision: 'sha256:abc123',
        previousStatus: 'approved',
        currentStatus: 'released',
        releasedAt: '2026-09-12T13:00:00Z',
        releaseTag: 'v1.2.0',
      }

      mockApiFetchEnvelope.mockResolvedValue({
        ok: true,
        data: publishResponse,
      })

      const result = await mockApiFetchEnvelope('/api/schema/releases/sha256:abc123/publish', {
        method: 'POST',
      })

      expect(result.ok).toBe(true)
      expect(result.data.previousStatus).toBe('approved')
      expect(result.data.currentStatus).toBe('released')
      expect(result.data.releaseTag).toBe('v1.2.0')
    })

    it('应该更新版本索引', async () => {
      const versionIndex = {
        currentVersion: 'v1.2.0',
        previousVersion: 'v1.1.0',
        allVersions: ['v1.0.0', 'v1.1.0', 'v1.2.0'],
        indexPath: '.ledger/schema-releases/index.json',
      }

      mockApiFetchEnvelope.mockResolvedValue({
        ok: true,
        data: {
          revision: 'sha256:abc123',
          currentStatus: 'released',
          versionIndex: versionIndex,
        },
      })

      const result = await mockApiFetchEnvelope('/api/schema/releases/sha256:abc123/publish', {
        method: 'POST',
      })

      expect(result.ok).toBe(true)
      expect(result.data.versionIndex.currentVersion).toBe('v1.2.0')
      expect(result.data.versionIndex.allVersions).toContain('v1.2.0')
    })

    it('应该记录发布历史', async () => {
      const releaseHistory = {
        version: 'v1.2.0',
        timestamp: '2026-09-12T13:00:00Z',
        changes: [
          { type: 'entity_type_added', entityType: 'Service' },
        ],
        approvedBy: 'architect-2',
        releasedBy: 'local-architect',
        historyPath: '.ledger/schema-releases/history.json',
      }

      mockApiFetchEnvelope.mockResolvedValue({
        ok: true,
        data: {
          revision: 'sha256:abc123',
          currentStatus: 'released',
          releaseHistory: releaseHistory,
        },
      })

      const result = await mockApiFetchEnvelope('/api/schema/releases/sha256:abc123/publish', {
        method: 'POST',
      })

      expect(result.ok).toBe(true)
      expect(result.data.releaseHistory).toBeDefined()
      expect(result.data.releaseHistory.version).toBe('v1.2.0')
      expect(result.data.releaseHistory.changes).toHaveLength(1)
    })
  })

  describe('List Releases', () => {
    it('应该列出所有 Releases', async () => {
      const releases = [
        {
          revision: 'sha256:abc123',
          status: 'released',
          version: 'v1.2.0',
          createdAt: '2026-09-12T10:00:00Z',
        },
        {
          revision: 'sha256:def456',
          status: 'staged',
          version: null,
          createdAt: '2026-09-13T10:00:00Z',
        },
        {
          revision: 'sha256:ghi789',
          status: 'draft',
          version: null,
          createdAt: '2026-09-14T10:00:00Z',
        },
      ]

      mockApiFetchEnvelope.mockResolvedValue({
        ok: true,
        data: { items: releases, total: 3 },
      })

      const result = await mockApiFetchEnvelope('/api/schema/releases')

      expect(result.ok).toBe(true)
      expect(result.data.items).toHaveLength(3)
      expect(result.data.items[0].status).toBe('released')
      expect(result.data.items[1].status).toBe('staged')
      expect(result.data.items[2].status).toBe('draft')
    })

    it('应该按状态过滤 Releases', async () => {
      const draftReleases = [
        {
          revision: 'sha256:ghi789',
          status: 'draft',
          createdAt: '2026-09-14T10:00:00Z',
        },
      ]

      mockApiFetchEnvelope.mockResolvedValue({
        ok: true,
        data: { items: draftReleases, total: 1 },
      })

      const result = await mockApiFetchEnvelope('/api/schema/releases?status=draft')

      expect(result.ok).toBe(true)
      expect(result.data.items).toHaveLength(1)
      expect(result.data.items[0].status).toBe('draft')
    })
  })

  describe('Redeploy Release', () => {
    it('应该支持重新部署 Release', async () => {
      const redeployResponse = {
        revision: 'sha256:abc123',
        status: 'released',
        redeployedAt: '2026-09-15T10:00:00Z',
      }

      mockApiFetchEnvelope.mockResolvedValue({
        ok: true,
        data: redeployResponse,
      })

      const result = await mockApiFetchEnvelope('/api/schema/releases/sha256:abc123/redeploy', {
        method: 'POST',
      })

      expect(result.ok).toBe(true)
      expect(result.data.redeployedAt).toBeDefined()
    })
  })

  describe('Revert Preview', () => {
    it('应该支持回滚预览', async () => {
      const revertResponse = {
        revision: 'sha256:abc123',
        action: 'revert-preview',
        message: 'Preview 已回滚',
      }

      mockApiFetchEnvelope.mockResolvedValue({
        ok: true,
        data: revertResponse,
      })

      const result = await mockApiFetchEnvelope('/api/schema/releases/sha256:abc123/revert-preview', {
        method: 'POST',
      })

      expect(result.ok).toBe(true)
      expect(result.data.action).toBe('revert-preview')
    })
  })

  describe('Get Release Detail', () => {
    it('应该获取 Release 详情', async () => {
      const releaseDetail = {
        revision: 'sha256:abc123',
        status: 'released',
        version: 'v1.2.0',
        createdAt: '2026-09-12T10:00:00Z',
        approvedAt: '2026-09-12T12:00:00Z',
        releasedAt: '2026-09-12T13:00:00Z',
        changes: [
          {
            type: 'entity_type_added',
            entityType: 'Service',
            description: '新增 Service 节点类型',
          },
        ],
        snapshot: {
          ontology: { entity_types: ['Module', 'ArchitectureComponent', 'Service'] },
          enums: { arch_layers: ['service', 'application', 'data-lake'] },
        },
      }

      mockApiFetchEnvelope.mockResolvedValue({
        ok: true,
        data: releaseDetail,
      })

      const result = await mockApiFetchEnvelope('/api/schema/releases/sha256:abc123')

      expect(result.ok).toBe(true)
      expect(result.data.revision).toBe('sha256:abc123')
      expect(result.data.status).toBe('released')
      expect(result.data.changes).toHaveLength(1)
      expect(result.data.snapshot).toBeDefined()
    })
  })
})
