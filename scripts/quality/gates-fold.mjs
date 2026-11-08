#!/usr/bin/env node
/**
 * gates-fold.mjs — package.json check:* 别名段的注册表投影生成器（结构收口批）
 *
 * 立项目的：npm 别名是最后一个手工维护的执行面。本脚本把 check:* 命名空间变为
 *   注册表的纯投影——registry 的 command 引用哪个 `npm run check:<token>`，别名段
 *   就有哪些键；registry 不引用的 check:* 别名即漂移（删除或报红）。
 *   「脚本加了忘了登记／登记了没有脚本」这一类问题构造性不可能。
 *
 * 投影规则（单一事实源＝contracts/quality-gates.json 的 command 字段）：
 *   - command 形如 `npm run check:<token>` → 别名 check:<token> 必须存在；
 *     实现取现值（保留 --fixture 等参数），无现值则派生 `node scripts/quality/check-<token>.mjs`（须存在）；
 *   - command 非 check: 形态（npm run typecheck 等）→ 不产生别名；
 *   - package.json 里任何不被 registry 引用的 check:* 键 → 漂移（--write 删除 / 检查态红）。
 *
 * 用法：npm run gates:fold          # 投影并写入（幂等）
 *       node gates-fold.mjs --check # 只断言（漂移 exit 1——CI/pre-commit 面用）
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const REGISTRY_REL = "contracts/quality-gates.json";
const PKG_REL = "package.json";

/**
 * 纯投影函数（无 IO——单测直证）。
 * @param {object} registry quality-gates.json
 * @param {object} scripts package.json scripts 现值
 * @returns {{ projected: object, drift: string[], missingImpl: string[] }}
 *   projected＝目标 check:* 段；drift＝现值中不被引用的 check:* 键；missingImpl＝派生实现文件不存在的 token
 */
export function projectCheckScripts(registry, scripts) {
  const referenced = new Map(); // token -> impl
  const missingImpl = [];
  for (const gate of registry.gates || []) {
    // retired/orphan 行只记账不钉实物（WP-145 波4 账物分离：账行留、别名与脚本可删）——
    // 与 run-ci-gates/pre-commit 两家消费者同语义，三处对齐后「账行强制实物存在」类假红消灭。
    if (gate && (gate.status === "retired" || gate.status === "orphan-decision-pending")) continue;
    const m = /^npm run (check:[\w:-]+)$/.exec((gate && gate.command) || "");
    if (!m) continue;
    const token = m[1];
    if (referenced.has(token)) continue;
    if (scripts && typeof scripts[token] === "string" && scripts[token].trim()) {
      referenced.set(token, scripts[token]);
    } else {
      const scannerRel = `scripts/quality/check-${token.slice("check:".length)}.mjs`;
      referenced.set(token, `node ${scannerRel}`);
      if (!existsSync(path.join(ROOT, scannerRel))) missingImpl.push(token);
    }
  }
  const drift = Object.keys(scripts || {})
    .filter((k) => k.startsWith("check:"))
    .filter((k) => !referenced.has(k));
  return { projected: Object.fromEntries([...referenced.entries()].sort(([a], [b]) => (a < b ? -1 : 1))), drift, missingImpl };
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const registry = JSON.parse(readFileSync(path.join(ROOT, REGISTRY_REL), "utf8"));
  const pkgRaw = readFileSync(path.join(ROOT, PKG_REL), "utf8");
  const pkg = JSON.parse(pkgRaw);
  const { projected, drift, missingImpl } = projectCheckScripts(registry, pkg.scripts || {});

  const problems = [];
  if (drift.length > 0) problems.push(`未被注册表引用的 check:* 别名（漂移，--write 将删除）：${drift.join(", ")}`);
  if (missingImpl.length > 0) problems.push(`注册表引用但无实现文件的别名：${missingImpl.join(", ")}`);

  if (checkOnly) {
    // 检查态：漂移或实现缺失即红；且现值须与投影逐字一致
    for (const [token, impl] of Object.entries(projected)) {
      if ((pkg.scripts || {})[token] !== impl) problems.push(`别名 ${token} 与投影不一致：现值 ${JSON.stringify((pkg.scripts || {})[token])} ≠ 投影 ${JSON.stringify(impl)}`);
    }
    if (problems.length > 0) {
      console.error("gates_fold=FAIL");
      for (const p of problems) console.error("  - " + p);
      console.error("  fix: npm run gates:fold");
      process.exit(1);
    }
    console.log(`gates_fold=ok aliases=${Object.keys(projected).length}（check:* 段＝注册表投影，零漂移）`);
    return;
  }

  // 写入态：check:* 命名空间整体替换为投影（非 check 键原序保留）
  const nextScripts = {};
  let checkBlockDone = false;
  for (const [k, v] of Object.entries(pkg.scripts || {})) {
    if (k.startsWith("check:")) {
      if (!checkBlockDone) {
        Object.assign(nextScripts, projected);
        checkBlockDone = true;
      }
      continue;
    }
    nextScripts[k] = v;
  }
  if (!checkBlockDone) Object.assign(nextScripts, projected);
  pkg.scripts = nextScripts;
  writeFileSync(path.join(ROOT, PKG_REL), JSON.stringify(pkg, null, 2) + "\n");
  console.log(`gates_fold=written aliases=${Object.keys(projected).length}` + (drift.length ? `，删除漂移：${drift.join(", ")}` : ""));
  if (missingImpl.length > 0) {
    console.error("gates_fold=WARN 以下别名尚无实现文件（注册表先行/实现待补）：" + missingImpl.join(", "));
  }
}

main();
