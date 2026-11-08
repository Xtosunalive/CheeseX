// WP-138 R5c：文章上传（架构师摄取 Skill）支持的文件扩展名值域——全库唯一事实源。
// ADR-016 §三判语：上传扩展名属命令入口入参值域，须单源。同型缺陷判据 P6 在册：
// 原 server/services/article-workflow/article-workflow-service.cjs 与前端
// ArticleUploadDock.tsx 各持一份逐字手抄（server 与前端各一份，无对账）。
// 载体形态照抄 shared/field-labels.mjs（seq209）：ESM 载体，前后端共用——
// 后端 node≥22 require(esm) 直吃；前端 vite 原生 import；零新机制。
// 顺序即契约：415 错误载荷 acceptedExtensions 与前端 accept 属性串均按此序展开。
export const ARTICLE_UPLOAD_EXTENSIONS = Object.freeze([
  ".pdf", ".docx", ".xlsx", ".csv", ".pptx", ".mht", ".md", ".txt", ".html", ".eml",
]);
