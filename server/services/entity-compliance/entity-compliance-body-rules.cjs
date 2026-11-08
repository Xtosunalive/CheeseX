// Component: Entity-Compliance-Body-Rules
// @responsible: Body wikilink 提取与目标解析工具（checkB01-B04 已收敛到 entity-compliance-declarative-engine.cjs）
// @inputs: Entity Markdown 正文与标题索引
// @outputs: extractTypedWikilinks / resolveTarget（被引擎复用）
// @context: Vault

function extractTypedWikilinks(body) {
  if (!body || typeof body !== "string") return { typed: [], allTargets: [] };
  var typed = [];
  var typedRe = /([一-鿿\w]+)::\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  var match;
  while ((match = typedRe.exec(body)) !== null) {
    const prefix = body.slice(0, match.index);
    const lineNumber = prefix.split("\n").length;
    typed.push({ type: match[1].trim(), target: match[2].trim(), lineNumber, coordinate: `line:${lineNumber}`, snippet: match[0] });
  }
  var allTargets = [];
  var allRe = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
  while ((match = allRe.exec(body)) !== null) {
    allTargets.push(match[1].trim());
  }
  return { typed: typed, allTargets: allTargets };
}

// 自身键判定：索引表由调用方注入（测试/写侧可能传普通 {}），查表不得沿原型链
// 命中 Object.prototype 同名属性（constructor/toString 等会被误判成「已解析」）。
function own(dict, key) {
  return !!dict && Object.prototype.hasOwnProperty.call(dict, key);
}

function resolveTarget(target, indexes) {
  if (own(indexes.ids, target)) return true;
  if (own(indexes.titleLookup, target)) return true;
  if (own(indexes.filenameLookup, target)) return true;
  if (target.indexOf(".md") < 0 && own(indexes.filenameLookup, target + ".md")) return true;
  var noSpaces = target.replace(/\s+/g, "");
  if (noSpaces !== target && own(indexes.titleLookup, noSpaces)) return true;
  // 2026-10-08 裁决 2（检索归一）：别名纳入匹配——正文用别名连线不再「未识别实体」误报。
  // 别名只认人不寻址（不参与连线建立），故只在此判可解析；aliasOf 供 B02 善意提示用。
  if (own(indexes.aliasLookup, target)) return true;
  return false;
}

/**
 * 别名命中查询（B02 善意提示单源）：target 是某实体的别名时返回其正名，否则 null。
 * 消费方：引擎 B02 段（改出「建议改用正名」轻提醒而非 unresolved 误报）。
 */
function aliasOf(target, indexes) {
  if (!own(indexes && indexes.aliasLookup, target)) return null;
  return indexes.aliasLookup[target].aliasOf || null;
}

module.exports = { extractTypedWikilinks, resolveTarget, aliasOf };
