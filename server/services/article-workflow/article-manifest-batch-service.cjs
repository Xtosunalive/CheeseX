// @responsible: 为当前图谱引用来源批量生成文章图谱映射产物。
// @inputs: articleManifestService 的来源查询、排除规则和单文件写入能力
// @outputs: 批量生成计数与逐文件失败证据

function createArticleManifestBatchService(options = {}) {
  const articleManifestService = options.articleManifestService;
  const pageSize = Math.min(Math.max(Number(options.pageSize) || 200, 1), 200);
  if (!articleManifestService) throw new TypeError("articleManifestService 不能为空");

  function rebuild() {
    const sources = [];
    let offset = 0;
    while (true) {
      const page = articleManifestService.queryArticleSources({ limit: pageSize, offset });
      const items = Array.isArray(page && page.items) ? page.items : [];
      sources.push(...items);
      if (items.length < pageSize) break;
      offset += pageSize;
    }

    let written = 0;
    let excluded = 0;
    let removed = 0;
    const failures = [];
    for (const source of sources) {
      const sourcePath = typeof source.sourcePath === "string" ? source.sourcePath.trim() : "";
      if (!sourcePath) {
        failures.push({ sourcePath: "", error: "来源路径为空" });
        continue;
      }
      const exclusion = articleManifestService.isSourceExcluded(sourcePath);
      if (exclusion && exclusion.excluded) {
        excluded += 1;
        if (typeof articleManifestService.removeArticleManifest === "function") {
          try { if (articleManifestService.removeArticleManifest(sourcePath).removed) removed += 1; }
          catch (error) { failures.push({ sourcePath, error: error instanceof Error ? error.message : String(error) }); }
        }
        continue;
      }
      try {
        articleManifestService.writeArticleManifest(sourcePath);
        written += 1;
      } catch (error) {
        failures.push({ sourcePath, error: error instanceof Error ? error.message : String(error) });
      }
    }

    // B1（#1795）孤儿对账：活源遍历之外，对磁盘上已存在的 manifest 反查其源——
    // 源已删除的孤儿按 removeArticleManifest 清除（此前孤儿永不在对账范围内，
    // 幽灵条目滞留并被原样打包进 Release）。能力可选（capability-gated，同 :34 先例）。
    let orphanRemoved = 0;
    if (typeof articleManifestService.listManifestSources === "function" && typeof articleManifestService.sourceExists === "function") {
      for (const manifestEntry of articleManifestService.listManifestSources()) {
        const sourcePath = typeof manifestEntry.sourcePath === "string" ? manifestEntry.sourcePath : "";
        if (!sourcePath || articleManifestService.sourceExists(sourcePath)) continue;
        if (typeof articleManifestService.removeArticleManifest !== "function") continue;
        try {
          if (articleManifestService.removeArticleManifest(sourcePath).removed) orphanRemoved += 1;
        } catch (error) {
          failures.push({ sourcePath, error: error instanceof Error ? error.message : String(error) });
        }
      }
    }

    return { totalSources: sources.length, written, excluded, removed, orphanRemoved, failed: failures.length, failures };
  }

  return { rebuild };
}

module.exports = { createArticleManifestBatchService };
