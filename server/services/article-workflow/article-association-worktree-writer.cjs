// Component: Article-Association-Worktree-Writer
// @responsible: 文章映射工作树直接写回（AA1，方向 A：仅正式文章）——从 main.cjs 提取，规则 2 行数上限
const { createArticleAssociationService } = require("./article-association-service.cjs");
const { scanFormalArticleCatalog } = require("../projection/document-source-scanner.cjs");

// 正式文章 catalog（listFormalArticles port：复用 scanFormalArticleCatalog，身份与 formal 消费一致）
function formalCatalog(vaultPath) {
  const catalog = scanFormalArticleCatalog({ vaultPath });
  if (catalog.invalid.length > 0) {
    const error = new Error("Formal article catalog is invalid");
    Object.assign(error, { code: "FORMAL_ARTICLE_CATALOG_INVALID", status: 409, details: catalog.invalid });
    throw error;
  }
  return catalog;
}

function createWorktreeAssociationWriter(options) {
  // tr_43c615f5（2026-10-07 Master 批 A 案）：preview 同源校验——写前可行性在预览阶段即可见。
  // 归因：preview 原走 formalConsumer（pinned release 清单）无身份唯一性校验，save 走本 writer
  // 的 scanFormalArticleCatalog（vault 实扫+DUPLICATE 直通）——源差致「预览放行、确认才炸」。
  // 修法：writer 的 preview 入口先跑同一 catalog，invalid 非空即抛 FORMAL_ARTICLE_CATALOG_INVALID
  // （契约已在 save 错误集 409 内）——与 save 同镜，时序归位。
  //
  // PR-205（2026-11-03，Master 裁 A 支）：removeDecision／removeDecisionsForArticle 由只读 pinned 实例
  // 改道本活装配——2026-10-15「引用随源流转」批把两个移除出口接在了 writeAuditRaw 恒 409 的只读实例上，
  // 生产形态下移除恒 FORMAL_RELEASE_IMMUTABLE（且 reconciler 退役清行口同堵）。移除与 save 同为
  // 账本维护写，统一走活 writer；只读 pinned 实例继续承担 list/preview 读面。
  const live = () => createArticleAssociationService({
    vaultPath: options.vaultPath,
    operatorContext: options.operatorContext,
    getGraph: options.getGraph,
    getRegistry: options.getRegistry,
    changeDispositionService: options.changeDispositionService,
    listFormalArticles: () => formalCatalog(options.vaultPath),
  });
  return {
    preview: (payload) => { formalCatalog(options.vaultPath); return live().preview(payload); },
    save: (expectedRevision, payload) => live().save(expectedRevision, payload),
    removeDecision: (expectedRevision, decisionId) => live().removeDecision(expectedRevision, decisionId),
    removeDecisionsForArticle: (basename) => live().removeDecisionsForArticle(basename),
  };
}

module.exports = { createWorktreeAssociationWriter };
