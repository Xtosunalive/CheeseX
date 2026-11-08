const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { performance } = require("perf_hooks");
const test = require("node:test");
const { createDocumentInventoryService } = require("../document-inventory-service.cjs");

// PR-038 教训（2026-10-09 立案）：绝对预算 build<10000ms 在忙机必假红（同代码忙时 40s 恒红、
// 闲时 850ms 绿——万文件写入被 I/O 抢占放大 47 倍，红绿不可分辨代码回归）。
// 本测改为「同数据规模相对断言」，机器快慢同除、只留代码因子：
//   ① build：10000 文档构建 < 1000 文档构建 × 150（10 数据量比 × 15 保守系数）；
//   ② 查询中位：10000 文档 30 次同型查询的中位 < 1000 文档同型查询中位 × 50（数据量比 × 5）；
//   ③ 查询尾部：p95 < 自身中位 × 10（尾部效应守卫——p95 与中位同规模同负载，只对代码回归敏感；
//      实测依据 2026-10-09/10 四轮：忙闲两态中位 0.4~1.5ms、p95 38~58ms，差距约 40 倍系
//      首查建缓存+GC 停顿固有抖动，倍数取 10 后仍稳定通过——若代码退化（如逐次全表扫）
//      p95/中位比将突破 10）。机器忙→基线与目标同步变慢→预算同步放大，红绿只随代码变。
const BASELINE_DOCS = 1000;
const TARGET_DOCS = 10000;
const BUILD_BUDGET_FACTOR = 150; // 10 数据量比 × 15 保守系数
const MEDIAN_BUDGET_FACTOR = 50; // 10 数据量比 × 5 保守系数
const P95_VS_MEDIAN_FACTOR = 10;

function writeDocs(dir, count) {
  fs.mkdirSync(dir, { recursive: true });
  for (let index = 0; index < count; index += 1) {
    const category = index % 2 ? "服务" : "存储";
    fs.writeFileSync(
      path.join(dir, `entity-${index}.md`),
      `---\ntitle: Entity ${index}\narchitecture-node-id: entity-${index}\narch_component: true\narch_category: ${category}\narch_layer: service\ntags: [架构]\n---\nContent service keyword-${index % 100}.\n依赖::[[entity-${(index + 1) % count}]]\n`,
      "utf8",
    );
  }
}

test("indexes 10,000 documents without catastrophic regression (relative budget, PR-038)", { timeout: 60000 }, async (t) => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), "doc-inventory-perf-"));
  t.after(() => fs.rmSync(vault, { recursive: true, force: true }));

  // ① 基线：1000 文档构建 + 同型查询（同 vault、同进程——环境状态共享，机器忙则两者同步变慢）
  writeDocs(path.join(vault, "知识库", "wiki", "entities"), BASELINE_DOCS);
  const baselineService = createDocumentInventoryService({ vaultPath: vault });
  const baselineStart = performance.now();
  const baselineStatus = await baselineService.initialize();
  const baselineBuildMs = performance.now() - baselineStart;
  assert.strictEqual(baselineStatus.totalDocuments, BASELINE_DOCS);

  const baselineSamples = [];
  for (let index = 0; index < 10; index += 1) {
    const start = performance.now();
    baselineService.search({ keyword: `keyword-${(index % 10) * 2 + 1}`, arch_category: ["服务"], limit: 50 });
    baselineSamples.push(performance.now() - start);
  }
  baselineSamples.sort((left, right) => left - right);
  const baselineMedianMs = baselineSamples[Math.floor(baselineSamples.length / 2)];
  assert(baselineMedianMs > 0, "baseline median must be positive");

  // ② 目标：10000 文档（目录另起，排除基线服务常驻内存的干扰）
  const targetDir = path.join(vault, "target", "知识库", "wiki", "entities");
  writeDocs(targetDir, TARGET_DOCS);
  const service = createDocumentInventoryService({ vaultPath: path.join(vault, "target") });
  const buildStart = performance.now();
  const status = await service.initialize();
  const buildMs = performance.now() - buildStart;
  assert.strictEqual(status.totalDocuments, TARGET_DOCS);

  const samples = [];
  for (let index = 0; index < 30; index += 1) {
    const start = performance.now();
    const result = service.search({ keyword: `keyword-${(index % 10) * 2 + 1}`, arch_category: ["服务"], limit: 50 });
    samples.push(performance.now() - start);
    assert(result.summary.totalResults > 0);
  }
  samples.sort((left, right) => left - right);
  const medianMs = samples[Math.floor(samples.length / 2)];
  const p95Ms = samples[Math.floor(samples.length * 0.95)];

  const buildBudgetMs = baselineBuildMs * BUILD_BUDGET_FACTOR;
  const medianBudgetMs = baselineMedianMs * MEDIAN_BUDGET_FACTOR;
  console.log(
    `document-inventory performance (relative): baseline_build_ms=${baselineBuildMs.toFixed(1)} build_ms=${buildMs.toFixed(1)} budget=${buildBudgetMs.toFixed(1)} | baseline_median_ms=${baselineMedianMs.toFixed(2)} median_ms=${medianMs.toFixed(2)} budget=${medianBudgetMs.toFixed(2)} | p95_ms=${p95Ms.toFixed(2)} vs_median_budget=${(medianMs * P95_VS_MEDIAN_FACTOR).toFixed(2)}`,
  );
  assert(buildMs < buildBudgetMs, `build took ${buildMs.toFixed(1)}ms vs relative budget ${buildBudgetMs.toFixed(1)}ms (baseline ${baselineBuildMs.toFixed(1)}ms × ${BUILD_BUDGET_FACTOR})`);
  assert(medianMs < medianBudgetMs, `query median took ${medianMs.toFixed(2)}ms vs relative budget ${medianBudgetMs.toFixed(2)}ms (baseline median ${baselineMedianMs.toFixed(2)}ms × ${MEDIAN_BUDGET_FACTOR})`);
  assert(p95Ms < medianMs * P95_VS_MEDIAN_FACTOR, `query p95 took ${p95Ms.toFixed(2)}ms vs own median ${medianMs.toFixed(2)}ms × ${P95_VS_MEDIAN_FACTOR} (tail guard)`);
});
