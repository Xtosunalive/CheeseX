'use strict';
// Component: Article-Health-Service（WP-156——分类规则产品化的查询面读模型）
// @responsible: 按契约规则全量规则表现算全库文章健康度——筛违规文章清单（存量覆盖：不依赖变更事件，
//   天然取代退役的 validate_classification.py 批量巡检职能）。
// @inputs: vaultPath（库根）；ruleSetProvider()（enums-loader buildRuleSet 词表枚举面——与实时面同源）；
//   now()（可选时钟注入，过期判定测试用）
// @outputs: { scope, total, healthy, unhealthyCount, files: [{file, ok, violations[]}], generatedAt }
// @context: 遍历与解析经装载入口批量形态（doc-envelope-materializer buildDocEnvelope——全库收集＋信封口径
//   切分，WP-117 交付）＋document-load-port.loadDocument（fm 对象）；校验经 frontmatter-rule-engine
//   validateFrontmatter（与 watcher 实时面同引擎同契约——同源对拍验收③的机制基础）。零规则逻辑（规则
//   全在契约，引擎零分叉）。读放大：每次调用全库重读（真库 ~2MiB 物化 <1s，低频人工查询可接受——WP-117 §二.5 压测口径）。

const { buildDocEnvelope } = require("../../shared/doc-envelope-materializer.cjs");
const { loadDocument } = require("../../shared/document-load-port.cjs");
const { validateFrontmatter } = require("../../shared/frontmatter-rule-engine.cjs");

function computeArticleHealth({ vaultPath, ruleSetProvider, now = () => new Date() }) {
  const ruleSet = ruleSetProvider();
  const envelope = buildDocEnvelope(vaultPath);
  const files = envelope.documents.map((doc) => {
    // 原文＝fmText+body（信封切分点同址，逐字节同源——WP-155 对拍钉）
    const raw = doc.fmText + doc.body;
    let fm = {};
    try {
      fm = loadDocument(raw, doc.path).frontmatter || {};
    } catch {
      fm = {}; // 解析失败按空 fm 走引擎（required 类报必填——与 watcher 同路径同行为）
    }
    const violations = validateFrontmatter(fm, ruleSet);
    return { file: doc.path, ok: violations.length === 0, violations };
  });
  const unhealthy = files.filter((f) => !f.ok);
  return {
    scope: "all",
    total: files.length,
    healthy: files.length - unhealthy.length,
    unhealthyCount: unhealthy.length,
    files,
    generatedAt: now().toISOString(),
  };
}

module.exports = { computeArticleHealth };
