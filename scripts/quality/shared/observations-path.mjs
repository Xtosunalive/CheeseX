// Component: Observations-Path（WP-076·runtime-scope 域登记解析器）
// @responsible: `TAXONOMY_OBSERVATIONS_FILE` 的唯一解析点——分类观察账本落点两档：**钉扎 ＞ 拒**
//   （runtime-scope 规则 `no_implicit_fallback_on_write`：写路径上作用域变量缺席即 fail-closed）。
//   旧形态是「缺席就按脚本位置拼 repo 根 data/taxonomy-observations.jsonl」，而该住址落在
//   `.gitignore:/data/*` 覆盖内——写成功也零可见（面⑦ 只盯 data/theschema|data/governance），
//   等于无痕写；收紧后缺席即拒，调用方按既有 fail-open 包装降级为告警（痕迹非执法项先例不变）。
// @inputs: 环境变量 TAXONOMY_OBSERVATIONS_FILE
// @outputs: 绝对路径（string）；缺席即 throw（ObservationsScopeError）
// @context: 登记条目 contracts/runtime-scope.json resolvers:observations-path-resolve。
import path from "node:path";

export class ObservationsScopeError extends Error {
  constructor(message) {
    super(message);
    this.name = "ObservationsScopeError";
    // 同 mirror-scope：不设 code，消息前缀形——登记解析器的拒写无 HTTP 消费者，不新增欠账
  }
}

/** 解析观察账本落点——只认显式钉扎，不按脚本位置猜仓根。 */
export function resolveObservationsFile() {
  const pinned = process.env.TAXONOMY_OBSERVATIONS_FILE;
  if (pinned && String(pinned).trim()) return path.resolve(String(pinned).trim());
  throw new ObservationsScopeError("OBSERVATIONS_SCOPE_UNRESOLVED: 观察账本落点不可解析：TAXONOMY_OBSERVATIONS_FILE 未设——写路径不允许按脚本位置猜仓根（该住址 git 不跟踪，写成功亦零可见）；出口：export TAXONOMY_OBSERVATIONS_FILE=<路径>");
}
