// Component: Reuse-Domain-Refs（PR-208 清债第一批共用助手）
// @responsible: 从 contracts/reuse-domains.json 读域行的 authority／writers——
//   检查器的「目标文件名单」以此为准，不再手抄第二份（抄本普查 P6-F3 的债源：
//   check-navigation×3／check-interaction-state×1 的硬编码目标与契约 authority/writers 同串）。
//   PR-215 教训：共享常量只许一处定义——本件即该处。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", ".."); // 本件住 scripts/quality/shared/——三层上到仓根
const REUSE_DOMAINS = path.join(ROOT, "contracts", "reuse-domains.json");

/** 读 reuse-domains 域行（id 或 domain 匹配）；不可读/无此域返回 null（调用方决定退化策略）。 */
export function reuseDomain(domainId, { readText } = {}) {
  const read = readText || ((rel) => fs.readFileSync(path.join(ROOT, rel), "utf8"));
  const text = read("contracts/reuse-domains.json");
  if (text == null) return null;
  const doc = JSON.parse(text);
  return (doc.domains || []).find((d) => (d.id || d.domain) === domainId) || null;
}

/** 域 authority（单字符串）；域缺 authority 返回 null。 */
export function authorityOf(domainId, io) {
  const dom = reuseDomain(domainId, io);
  return dom && typeof dom.authority === "string" ? dom.authority : null;
}

/** 域 writers 里含给定片段（或全部）的行。 */
export function writersOf(domainId, { include, readText } = {}) {
  const dom = reuseDomain(domainId, { readText });
  const writers = (dom && Array.isArray(dom.writers) ? dom.writers : []).map(String);
  return include ? writers.filter((w) => w.includes(include)) : writers;
}
