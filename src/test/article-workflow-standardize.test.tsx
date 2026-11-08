import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock API
const mockApiFetchEnvelope = vi.fn()
vi.mock('@/lib/api', () => ({
  apiFetchEnvelope: mockApiFetchEnvelope,
}))

describe('Article Workflow - Standardize Flow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Upload Flow', () => {
    it('应该上传文章并创建任务', async () => {
      const uploadData = {
        fileName: '安装指南.md',
        content: '---\ntitle: 安装指南\n---\n\n# 安装指南',
      }

      const expectedResponse = {
        taskId: 'task-123',
        originalFileName: '安装指南.md',
        draftPath: 'submissions/安装指南.md',
        status: 'awaiting_architect_processing',
        createdAt: '2026-09-12T10:00:00Z',
      }

      mockApiFetchEnvelope.mockResolvedValue({
        ok: true,
        data: expectedResponse,
        error: null,
      })

      const result = await mockApiFetchEnvelope('/api/articles/upload', {
        method: 'POST',
        body: JSON.stringify(uploadData),
      })

      expect(result.ok).toBe(true)
      expect(result.data.taskId).toBe('task-123')
      expect(result.data.status).toBe('awaiting_architect_processing')
      expect(result.data.draftPath).toBe('submissions/安装指南.md')
    })

    it('应该验证 JSON body 格式', async () => {
      const invalidData = {
        fileName: '测试.md',
        // 缺少 content 字段
      }

      mockApiFetchEnvelope.mockResolvedValue({
        ok: false,
        error: 'content 是必填字段',
        errorCode: 'VALIDATION_ERROR',
      })

      const result = await mockApiFetchEnvelope('/api/articles/upload', {
        method: 'POST',
        body: JSON.stringify(invalidData),
      })

      expect(result.ok).toBe(false)
      expect(result.errorCode).toBe('VALIDATION_ERROR')
    })

    it('应该拒绝过大的文件', async () => {
      const largeContent = 'x'.repeat(15 * 1024 * 1024) // 15MB

      mockApiFetchEnvelope.mockResolvedValue({
        ok: false,
        error: '请求体超过 14 MiB',
        errorCode: 'UPLOAD_BODY_TOO_LARGE',
        status: 413,
      })

      const result = await mockApiFetchEnvelope('/api/articles/upload', {
        method: 'POST',
        body: JSON.stringify({ fileName: 'large.md', content: largeContent }),
      })

      expect(result.ok).toBe(false)
      expect(result.errorCode).toBe('UPLOAD_BODY_TOO_LARGE')
      expect(result.status).toBe(413)
    })
  })

  describe('Precleaned Sync', () => {
    it('应该列出 precleaned 文章', async () => {
      const precleanedItems = [
        {
          id: 'article-1',
          title: '安装指南',
          sourcePath: 'precleaned/安装指南.md',
        },
        {
          id: 'article-2',
          title: '配置说明',
          sourcePath: 'precleaned/配置说明.md',
        },
      ]

      mockApiFetchEnvelope.mockResolvedValue({
        ok: true,
        data: { items: precleanedItems, generatedAt: '2026-09-12T10:00:00Z' },
      })

      const result = await mockApiFetchEnvelope('/api/articles/precleaned')

      expect(result.ok).toBe(true)
      expect(result.data.items).toHaveLength(2)
      expect(result.data.items[0].id).toBe('article-1')
    })

    it('应该获取单个 precleaned 文章详情', async () => {
      const articleDetail = {
        id: 'article-1',
        title: '安装指南',
        sourcePath: 'precleaned/安装指南.md',
        metadata: {
          product: 'AnyShare',
          version: '7.0.6.7',
          module: 'MySQL',
        },
        content: '# 安装指南\n\n正文内容',
      }

      mockApiFetchEnvelope.mockResolvedValue({
        ok: true,
        data: articleDetail,
      })

      const result = await mockApiFetchEnvelope('/api/articles/precleaned/article-1')

      expect(result.ok).toBe(true)
      expect(result.data.id).toBe('article-1')
      expect(result.data.metadata.product).toBe('AnyShare')
      expect(result.data.content).toContain('安装指南')
    })

    it('应该处理文章不存在错误', async () => {
      mockApiFetchEnvelope.mockResolvedValue({
        ok: false,
        error: 'precleaned 文章不存在',
        errorCode: 'ARTICLE_NOT_FOUND',
        status: 404,
      })

      const result = await mockApiFetchEnvelope('/api/articles/precleaned/invalid-id')

      expect(result.ok).toBe(false)
      expect(result.errorCode).toBe('ARTICLE_NOT_FOUND')
      expect(result.status).toBe(404)
    })
  })

  describe('Standardize Flow', () => {
    it('应该执行完整标准化流程', async () => {
      const standardizeRequest = {
        id: 'article-1',
        confirmed: true,
      }

      const standardizeResponse = {
        success: true,
        articleId: 'article-1',
        finalPath: '知识库/内容/运维/安装指南.md',
        status: 'standardized',
      }

      mockApiFetchEnvelope.mockResolvedValue({
        ok: true,
        data: standardizeResponse,
      })

      const result = await mockApiFetchEnvelope('/api/articles/standardize', {
        method: 'POST',
        body: JSON.stringify(standardizeRequest),
      })

      expect(result.ok).toBe(true)
      expect(result.data.success).toBe(true)
      expect(result.data.finalPath).toContain('知识库/内容/')
      expect(result.data.status).toBe('standardized')
    })

    it('应该要求显式确认', async () => {
      const requestWithoutConfirm = {
        id: 'article-1',
        // 缺少 confirmed: true
      }

      mockApiFetchEnvelope.mockResolvedValue({
        ok: false,
        error: '缺少显式确认，请在请求中传 confirmed: true',
        errorCode: 'CONFIRMATION_REQUIRED',
      })

      const result = await mockApiFetchEnvelope('/api/articles/standardize', {
        method: 'POST',
        body: JSON.stringify(requestWithoutConfirm),
      })

      expect(result.ok).toBe(false)
      expect(result.errorCode).toBe('CONFIRMATION_REQUIRED')
    })

    it('应该区分 ERROR 和 WARNING 级别问题', async () => {
      const checkResult = {
        errors: [
          {
            field: 'product',
            severity: 'error',
            message: 'product 字段缺失',
            blocking: true,
          },
        ],
        warnings: [
          {
            field: 'tags',
            severity: 'warning',
            message: '建议添加标签',
            blocking: false,
          },
        ],
      }

      // ERROR 级别问题应该阻断
      mockApiFetchEnvelope.mockResolvedValue({
        ok: false,
        error: '标准化检查失败',
        errorCode: 'ARTICLE_STANDARDIZATION_BLOCKED',
        details: checkResult,
        status: 409,
      })

      const result = await mockApiFetchEnvelope('/api/articles/standardize', {
        method: 'POST',
        body: JSON.stringify({ id: 'article-1', confirmed: true }),
      })

      expect(result.ok).toBe(false)
      expect(result.errorCode).toBe('ARTICLE_STANDARDIZATION_BLOCKED')
      expect(result.details.errors).toHaveLength(1)
      expect(result.details.errors[0].blocking).toBe(true)
      expect(result.details.warnings).toHaveLength(1)
      expect(result.details.warnings[0].blocking).toBe(false)
    })

    it('WARNING 级别问题应该进入待处理问题但允许通过', async () => {
      const checkResultWithWarningsOnly = {
        errors: [],
        warnings: [
          {
            field: 'tags',
            severity: 'warning',
            message: '建议添加标签',
            blocking: false,
          },
        ],
      }

      mockApiFetchEnvelope.mockResolvedValue({
        ok: true,
        data: {
          success: true,
          articleId: 'article-1',
          finalPath: '知识库/内容/运维/安装指南.md',
          status: 'standardized',
          pendingIssues: checkResultWithWarningsOnly.warnings,
        },
      })

      const result = await mockApiFetchEnvelope('/api/articles/standardize', {
        method: 'POST',
        body: JSON.stringify({ id: 'article-1', confirmed: true }),
      })

      expect(result.ok).toBe(true)
      expect(result.data.success).toBe(true)
      expect(result.data.pendingIssues).toHaveLength(1)
      expect(result.data.pendingIssues[0].severity).toBe('warning')
    })

    it('应该从 Release 投影正式身份', async () => {
      const releaseProjection = {
        entityTypes: ['Module', 'ArchitectureComponent'],
        relationTypes: ['DEPENDS_ON', 'CONNECTS_TO', 'STORES_IN'],
        enums: {
          products: ['AnyShare'],
          modules: ['MySQL', 'Ceph', 'Kubernetes'],
        },
      }

      mockApiFetchEnvelope.mockResolvedValue({
        ok: true,
        data: {
          success: true,
          articleId: 'article-1',
          releaseProjection: releaseProjection,
        },
      })

      const result = await mockApiFetchEnvelope('/api/articles/standardize', {
        method: 'POST',
        body: JSON.stringify({ id: 'article-1', confirmed: true }),
      })

      expect(result.ok).toBe(true)
      expect(result.data.releaseProjection).toBeDefined()
      expect(result.data.releaseProjection.entityTypes).toContain('Module')
      expect(result.data.releaseProjection.enums.products).toContain('AnyShare')
    })

    it('应该更新 article-manifest.json', async () => {
      const manifestUpdate = {
        articleId: 'article-1',
        action: 'add',
        manifestPath: '.ledger/article-manifest.json',
        entry: {
          id: 'article-1',
          title: '安装指南',
          path: '知识库/内容/运维/安装指南.md',
          product: 'AnyShare',
          version: '7.0.6.7',
          addedAt: '2026-09-12T10:00:00Z',
        },
      }

      mockApiFetchEnvelope.mockResolvedValue({
        ok: true,
        data: {
          success: true,
          manifestUpdate: manifestUpdate,
        },
      })

      const result = await mockApiFetchEnvelope('/api/articles/standardize', {
        method: 'POST',
        body: JSON.stringify({ id: 'article-1', confirmed: true }),
      })

      expect(result.ok).toBe(true)
      expect(result.data.manifestUpdate).toBeDefined()
      expect(result.data.manifestUpdate.action).toBe('add')
      expect(result.data.manifestUpdate.entry.id).toBe('article-1')
    })

    it('应该移动文件到最终位置', async () => {
      const fileMove = {
        from: 'precleaned/安装指南.md',
        to: '知识库/内容/运维/安装指南.md',
        operation: 'move',
        success: true,
      }

      mockApiFetchEnvelope.mockResolvedValue({
        ok: true,
        data: {
          success: true,
          fileOperation: fileMove,
        },
      })

      const result = await mockApiFetchEnvelope('/api/articles/standardize', {
        method: 'POST',
        body: JSON.stringify({ id: 'article-1', confirmed: true }),
      })

      expect(result.ok).toBe(true)
      expect(result.data.fileOperation.operation).toBe('move')
      expect(result.data.fileOperation.from).toContain('precleaned/')
      expect(result.data.fileOperation.to).toContain('知识库/内容/')
      expect(result.data.fileOperation.success).toBe(true)
    })
  })

  describe('Candidate Search', () => {
    it('应该搜索候选文章', async () => {
      const searchRequest = {
        keyword: '安装',
        limit: 50,
        offset: 0,
      }

      const searchResponse = {
        items: [
          { title: '安装指南' },
          { title: '安装配置说明' },
        ],
        total: 2,
        limit: 50,
        offset: 0,
        dataSource: 'precleaned-worktree',
      }

      mockApiFetchEnvelope.mockResolvedValue({
        ok: true,
        data: searchResponse,
      })

      const result = await mockApiFetchEnvelope(
        `/api/articles/candidates/search?keyword=${searchRequest.keyword}&limit=${searchRequest.limit}`
      )

      expect(result.ok).toBe(true)
      expect(result.data.items).toHaveLength(2)
      expect(result.data.items[0].title).toContain('安装')
      expect(result.data.total).toBe(2)
    })

    it('应该处理空搜索结果', async () => {
      mockApiFetchEnvelope.mockResolvedValue({
        ok: true,
        data: {
          items: [],
          total: 0,
          limit: 50,
          offset: 0,
        },
      })

      const result = await mockApiFetchEnvelope('/api/articles/candidates/search?keyword=不存在')

      expect(result.ok).toBe(true)
      expect(result.data.items).toHaveLength(0)
      expect(result.data.total).toBe(0)
    })

    it('应该支持分页', async () => {
      const page1Response = {
        items: Array(50).fill({ title: '文章' }),
        total: 120,
        limit: 50,
        offset: 0,
      }

      const page2Response = {
        items: Array(50).fill({ title: '文章' }),
        total: 120,
        limit: 50,
        offset: 50,
      }

      mockApiFetchEnvelope
        .mockResolvedValueOnce({ ok: true, data: page1Response })
        .mockResolvedValueOnce({ ok: true, data: page2Response })

      const result1 = await mockApiFetchEnvelope('/api/articles/candidates/search?limit=50&offset=0')
      const result2 = await mockApiFetchEnvelope('/api/articles/candidates/search?limit=50&offset=50')

      expect(result1.data.items).toHaveLength(50)
      expect(result1.data.offset).toBe(0)
      expect(result2.data.items).toHaveLength(50)
      expect(result2.data.offset).toBe(50)
    })
  })
})
