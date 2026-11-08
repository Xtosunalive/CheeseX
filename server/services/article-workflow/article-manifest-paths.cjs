// Component: Article-Manifest-Paths
// @responsible: manifest 路径族纯工具（key 归一化/行集枚举/源存在性）——自
// article-manifest-service.cjs 规则 2（≤500 行）拆出，vaultPath 前置参、零语义变化（#1795）。
// SPEC-012 wave-2：②类迁 derived-index.db 行级——磁盘目录树退役，listManifestSources 改从
// store 行集确定性反解（key = buildArticleManifestKey(源) = 去「知识库/」前缀的相对路径，反解即还原）；
// resolveArticleManifestPath 随目录树退役（key 穿越校验保留在 buildArticleManifestKey，语义不变）。
const fs = require("fs");
const path = require("path");
const { getDerivedIndexStore } = require("../../shared/persistence/derived-index-store.cjs");

function buildArticleManifestKey(normalizedSourcePath) {
  const s = String(normalizedSourcePath || "").replace(/\\/g, "/").trim();
  if (!s) throw new Error("manifest key 不得为空");
  // Windows absolute: C:/... drive letter
  if (/^[A-Za-z]:\//.test(s)) throw new Error("manifest key 不接受绝对路径: " + s);
  if (path.isAbsolute(s)) throw new Error("manifest key 不接受绝对路径: " + s);
  // segment-level .. check: reject ".." as a segment, allow "wikidata" etc
  if (s.split("/").some(function(seg) { return seg === ".."; })) throw new Error("manifest key 包含非法 .. 段: " + s);
  if (!s.endsWith(".md")) throw new Error("manifest key 必须以 .md 结尾: " + s);
  const clean = s.replace(/^知识库\//, "").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!clean) throw new Error("normalize 后 manifest key 为空");
  return clean;
}

// B1（#1795）孤儿对账支撑：枚举全部 manifest 的源路径（store 行集反解）＋源存在性判定。
// 供 batch rebuild 清除「源已删除」的孤儿 manifest（此前 rebuild 只遍历活源，
// 孤儿永不在对账范围内——ADR063「重建即对账」的 manifest 域补全）。
function listManifestSources(vaultPath) {
  return getDerivedIndexStore(vaultPath).articleManifests.list()
    .map((row) => ({ sourcePath: "知识库/" + row.key }));
}

function sourceExists(vaultPath, sourcePath) {
  const normalized = String(sourcePath || "").replace(/\\/g, "/").trim();
  if (!normalized) return false;
  return fs.existsSync(path.join(vaultPath, normalized));
}

module.exports = { buildArticleManifestKey, listManifestSources, sourceExists };
