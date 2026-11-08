#!/usr/bin/env node
/**
 * check-e2e-baseline.mjs — e2e 基线门禁（豁免名单制）
 *
 * 立项目的：消灭 nightly-e2e 的「假绿」。
 *
 *   此前 nightly-e2e job 挂着 continue-on-error: true，job 实际 failure 而 run 级别
 *   显示 success —— Actions 页面上看不到任何红。这同时使 PR-013 既定路线
 *   「套件连续绿后再进 PR gate」的判据失效：continue-on-error 让 job 永远绿，
 *   「连续绿」永远满足，等于没有判据。
 *
 * 判定方式（读 e2e 汇总报告 + 豁免名单）：
 *
 *   A. 名单外的红 → fail。已知红写进 contracts/e2e-known-red.json 才不阻断。
 *      **新增的红永远不会静默。**
 *   B. 名单内的红 → 打印不阻断。但豁免条目必须有 owner / expires / tracking，
 *      过期即 fail（防豁免永久化）。
 *   C. 名单里的流**绿了** → fail。豁免失去对象就该摘掉（防豁免空转）。
 *      修复动作只是从 JSON 删一条，成本极低；放任则豁免永远留着——
 *      那正是本门禁要治的病。
 *   D. 豁免了不存在的流名 → fail。拼错就等于永久豁免一个不存在的东西，
 *      同时真正的红会以「名单外」身份继续被打回，形成双输。
 *   E. 汇总报告缺失 → fail。e2e 没跑成不能假装绿（fail-closed）。
 *
 * 判别：fail-closed。任一条不满足即 exit 1 并列出违规项。
 *
 * 用法：node scripts/quality/check-e2e-baseline.mjs
 *      （需先跑 npm run test:e2e 生成 test-results/e2e-all-tests-summary.json）
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();
const SUMMARY_REL = "test-results/e2e-all-tests-summary.json";
const ALLOWLIST_REL = "contracts/e2e-known-red.json";
const CATALOG_REL = "scripts/e2e/run-all-e2e.mjs";

const violations = [];

function readJson(rel, onMissing) {
  let raw;
  try {
    raw = readFileSync(path.join(ROOT, rel), "utf8");
  } catch (err) {
    violations.push({
      id: onMissing,
      where: rel,
      detail: String(err?.message ?? err).split("\n")[0],
      fix: "确认文件存在且可读",
    });
    return null;
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    violations.push({
      id: onMissing,
      where: rel,
      detail: `JSON 解析失败：${String(err?.message ?? err).split("\n")[0]}`,
      fix: "修正 JSON 语法",
    });
    return null;
  }
}

const summary = readJson(SUMMARY_REL, "e2e_baseline_summary_missing");
const allowlist = readJson(ALLOWLIST_REL, "e2e_baseline_allowlist_unreadable");

// 流全集自 run-all-e2e.mjs 的 tests[].name 提取——唯一事实源，避免豁免名单与
// 实际流集合各写一份而漂移。提取失败即 fail（fail-closed，不许降级为「跳过检查」）。
let catalog = null;
try {
  const src = readFileSync(path.join(ROOT, CATALOG_REL), "utf8");
  const names = [...src.matchAll(/\bname:\s*"([^"]+)"/g)].map((m) => m[1]);
  if (names.length === 0) throw new Error("未提取到任何 name: 字段");
  catalog = names;
} catch (err) {
  violations.push({
    id: "e2e_baseline_catalog_unparseable",
    where: CATALOG_REL,
    detail: String(err?.message ?? err).split("\n")[0],
    fix: "tests[].name 格式变更需同步本脚本的提取正则",
  });
}

if (summary && Array.isArray(summary.results)) {
  const results = summary.results;
  // 局部跑（run-all-e2e --only）的报告不作基线判定：七条流只跑其一，其绿不承载全量语义——
  // 判 ok 就是拿局部证据冒充 nightly 基线（假绿方向），故显式 fail 而非静默放行。
  if (summary.only) {
    violations.push({
      id: "e2e_baseline_partial_run",
      where: SUMMARY_REL,
      detail: `报告为 --only "${summary.only}" 局部跑，不可作基线判定`,
      fix: "跑全量 npm run test:e2e 后复判",
    });
  }
  const allow = Array.isArray(allowlist?.known_red) ? allowlist.known_red : [];
  const allowByName = new Map(allow.map((e) => [e.flow, e]));

  // D. 豁免了不存在的流名
  if (catalog) {
    for (const entry of allow) {
      if (!catalog.includes(entry.flow)) {
        violations.push({
          id: "e2e_baseline_allowlist_flow_not_found",
          where: `${ALLOWLIST_REL}#${entry.flow}`,
          detail: `豁免的流名不在 ${CATALOG_REL} 的 tests 全集中（拼错即永久豁免一个不存在的流）`,
          fix: "逐字对齐 tests[].name，或删除该条豁免",
        });
      }
    }
    // 报告里出现未登记的流名（防御：tests 数组与报告不一致）
    for (const r of results) {
      if (!catalog.includes(r.name)) {
        violations.push({
          id: "e2e_baseline_unregistered_flow",
          where: SUMMARY_REL,
          detail: `报告中流名「${r.name}」不在 tests 全集中`,
          fix: "确认 run-all-e2e.mjs 是否被改动",
        });
      }
    }
  }

  // B. 豁免条目自身合规：owner / expires / tracking 齐备且未过期
  // 到期日一律按 +08:00 判定（与登记簿时间戳口径一致）：nightly cron 是 UTC 20:00
  // = 北京次日 04:00，两日历永远差一天。若按 UTC 取今天，豁免会晚一天才过期——
  // 判据的日期边界必须锁定时区，否则「过期」这件事本身会漂移。
  const today = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  for (const entry of allow) {
    for (const field of ["owner", "expires", "tracking"]) {
      if (!entry[field]) {
        violations.push({
          id: "e2e_baseline_allowlist_incomplete",
          where: `${ALLOWLIST_REL}#${entry.flow}`,
          detail: `豁免条目缺 ${field} 字段（豁免必须有主、有期、有追踪）`,
          fix: "补齐字段后再提交",
        });
      }
    }
    if (entry.expires && entry.expires < today) {
      violations.push({
        id: "e2e_baseline_allowlist_expired",
        where: `${ALLOWLIST_REL}#${entry.flow}`,
        detail: `豁免已于 ${entry.expires} 过期（今天 ${today}）——豁免不是免死金牌`,
        fix: `修好该流并删除豁免，或由 ${entry.owner ?? "owner"} 续期并在 ${entry.tracking ?? "登记簿"} 说明理由`,
      });
    }
  }

  const failedFlows = results.filter((r) => !r.passed && !r.skipped).map((r) => r.name);
  const passedFlows = results.filter((r) => r.passed).map((r) => r.name);
  const skippedFlows = results.filter((r) => r.skipped).map((r) => r.name);

  const newRed = failedFlows.filter((n) => !allowByName.has(n));
  const knownRed = failedFlows.filter((n) => allowByName.has(n));
  const staleAllow = passedFlows.filter((n) => allowByName.has(n));

  // A. 名单外的红
  for (const name of newRed) {
    violations.push({
      id: "e2e_baseline_new_failure_outside_allowlist",
      where: SUMMARY_REL,
      detail: `流「${name}」红且不在豁免名单内——**新增的红不静默**`,
      fix: "修好该流，或确认是已知存量红后按 owner/expires/tracking 三字段登记进豁免名单",
    });
  }

  // C. 豁免的流已经绿了
  for (const name of staleAllow) {
    violations.push({
      id: "e2e_baseline_allowlist_stale",
      where: `${ALLOWLIST_REL}#${name}`,
      detail: `豁免的流「${name}」本次已绿——豁免失去对象就该摘掉`,
      fix: `从 ${ALLOWLIST_REL} 删除该条（修复动作仅此一行）`,
    });
  }

  if (violations.length > 0) {
    console.error("check-e2e-baseline FAIL:");
    for (const v of violations) {
      console.error(`  [${v.id}] ${v.where}`);
      console.error(`      ${v.detail}`);
      console.error(`      fix: ${v.fix}`);
    }
    console.error(
      `\n  e2e_baseline=fail total=${results.length} passed=${passedFlows.length} known_red=${knownRed.length} new_red=${newRed.length} stale_allow=${staleAllow.length} skipped=${skippedFlows.length}`,
    );
    process.exit(1);
  }

  for (const name of knownRed) {
    const e = allowByName.get(name);
    console.log(`  known-red（豁免中，${e?.tracking ?? "无追踪"}，${e?.owner ?? "无主"}，${e?.expires ?? "无期"}）：${name}`);
  }
  for (const name of skippedFlows) {
    console.log(`  skipped：${name}`);
  }
  console.log(
    `e2e_baseline=ok total=${results.length} passed=${passedFlows.length} known_red=${knownRed.length} new_red=0 stale_allow=0 skipped=${skippedFlows.length}`,
  );
} else {
  if (violations.length === 0) {
    violations.push({
      id: "e2e_baseline_summary_shape_invalid",
      where: SUMMARY_REL,
      detail: "报告缺少 results 数组",
      fix: "确认 run-all-e2e.mjs 正常产出汇总报告",
    });
  }
  console.error("check-e2e-baseline FAIL:");
  for (const v of violations) {
    console.error(`  [${v.id}] ${v.where}`);
    console.error(`      ${v.detail}`);
    console.error(`      fix: ${v.fix}`);
  }
  process.exit(1);
}
