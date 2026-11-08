// Component: Workflow-Gates（甲' 三件普通 CI 断言——WP-143 波5，2026-11-08 Master 确认）
// @responsible: 纪律自觉版的机器兜底（无注册/准入/问责/棘轮外壳——单目的脚本，非治理机器）：
//   ①合同闸：写任务路径改动而无同批工作包合同文件 → 红
//   ②对账闸：merge-reconcile 现成脚本直呼（撞号/登记簿分叉）
//   ③门禁冻结闸：新增 scripts/quality/check-*.mjs → 红（治理建造线封笔，WP-143 铁律）
// @inputs: git 暂存面（pre-commit 语境）。fail-closed（拦提交）；CI 恢复后同脚本挂 CI 步骤。
// @outputs: workflow_gates=ok|FAIL；非零退出=违规。
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const ROOT = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf-8" }).trim();
const stagedStatus = execFileSync("git", ["diff", "--cached", "--name-status"], { encoding: "utf-8" })
  .split("\n").filter(Boolean);
const vs = [];

// ③ 门禁冻结闸：**新增**门禁脚本＝治理建造回潮（删除退役脚本不受此限——那是正确的退役行为）
for (const line of stagedStatus) {
  const [status, ...rest] = line.split("\t");
  const f = rest.join("\t");
  if (status === "D") continue; // 删除退役脚本＝正确退役
  if (status !== "A") continue; // 只拦新增；存量脚本修改（M）＝执法适配非建造回潮（WP-150 实录：check-action-routing 解析扩双形态被 A/M 混判误拦）
  if (/^scripts\/quality\/check-[\w.-]+\.mjs$/.test(f)) {
    vs.push(`[门禁冻结] 新增门禁脚本 ${f}——治理建造线已封笔（WP-143 铁律）；产品验证请写普通测试`);
  }
}

// ④ 域同步闸（WP-153 增，波5 方案"单源条款转测试拦截"既定路径的落地——非新造治理机器）：
//   改动闭集豁免清单（eslint.config.js 闭集块）而 reuse-domains.json 未同批更新域行 → 红。
//   判据=客观差集（闭集块新成员 ↔ 域卡 note 成员名），零误伤；只拦"搬了不报"，不逼塞卡。
//   背景：term-copy 闭集成员域登记曾连跳十几批（R2 机器退役后无提醒），收官追补两次。
const domainRegistryChanged = stagedStatus.map(l=>l.split("\t")[1]).filter(Boolean).includes("contracts/reuse-domains.json");
const closureListChanged = stagedStatus.some(l=>l==="M\teslint.config.js" || l==="A\teslint.config.js");
// 判据实现＝客观差集（红队复核 M2 修复：原 includes("-copy.ts") 字面量探测与注释承诺不符——
//   diff 含无关 "-copy.ts" 字样的改动也会误触发）。现按注释语义做：
//   取 eslint.config.js 暂存 diff 中【新增行】里出现的新成员名（加引号标识符），逐个核对
//   reuse-domains.json gate-governance 域卡 note 是否已含该成员名；缺任何一个才红（逼"搬了要报"，不逼塞卡）。
if (closureListChanged) {
  const diff = execFileSync("git", ["diff", "--cached", "--", "eslint.config.js"], { encoding: "utf-8" });
  const addedMembers = [...diff.matchAll(/^\+.*?["'`]([A-Za-z][\w-]*(?:[-/][\w-]+)+)["'`].*$/gm)]
    .map(m => m[1])
    .filter(n => !diff.includes(`-${n}`)); // 只取净新增（同行修改的旧值不算新成员）
  const registryText = domainRegistryChanged ? "" : fs.readFileSync(path.join(ROOT, "contracts", "reuse-domains.json"), "utf-8");
  const missing = addedMembers.filter(n => !registryText.includes(n));
  if (missing.length > 0 && !domainRegistryChanged) {
    vs.push(`[域同步闸] 闭集新成员未登记域卡：${missing.join("、")}（ADR-019 §三.4 仪式；WP-153 增；同批更新 reuse-domains.json 或豁免清单勿动）`);
  }
}

// ⑤ 受管文件沉淀闸（WP-153 scope_revision 2，Master 裁 A 全量粒度——立域目的"仓内代码受管"的机器化）：
//   数据源＝reuse-domains.json 各域行 authority/writers/contract 字段（立域时登记的受管清单，非新造）。
//   判据：暂存面触及受管路径 ∧ 同批未变更该域卡（reuse-domains.json 已在暂存面则视为已沉淀）→ 红。
//   注意：域行本身变更（改清单/记沉淀）不受此闸约束——改域表即改清单，无递归。
{
  const domains = JSON.parse(fs.readFileSync("contracts/reuse-domains.json", "utf-8")).domains || [];
  const staged = stagedStatus.map(l=>l.split("\t")[1]).filter(Boolean);
  const registryTouched = staged.includes("contracts/reuse-domains.json");
  if (!registryTouched) {
    const hit = new Set();
    for (const f of staged) {
      for (const dom of domains) {
        if (hit.has(dom.id)) continue;
        const paths = [dom.authority, ...(Array.isArray(dom.writers) ? dom.writers : []), dom.contract]
          .filter(Boolean).map(p => String(p).replace(/\/$/, ""));
        for (const p of paths) {
          if (f === p || f.startsWith(p + "/")) { hit.add(dom.id); break; }
        }
      }
    }
    if (hit.size > 0) {
      vs.push(`[受管沉淀闸] 触及受管文件而域卡未同批沉淀（涉及域：${[...hit].join("、")}）——改受管代码须在 reuse-domains.json 域行记一笔（WP-153 scope_revision 2，A 全量粒度；trivial 改动可在域行 exclude 声明）`);
    }
  }
}

// ① 合同闸：写任务路径（产品代码/契约）改动而无同批合同文件
const WRITE_TASK = [/^src\//, /^server\//, /^contracts\//, /^scripts\/vault/];
const touchedWriteTask = stagedStatus.map(l=>l.split("\t")[1]).filter(Boolean).filter((f) => WRITE_TASK.some((re) => new RegExp("^" + re.source.slice(1)).test(f)));
const hasContract = stagedStatus.map(l=>l.split("\t")[1]).filter(Boolean).some((f) => /^docs\/work-packages\/WP-\d+\.json$/.test(f));
if (touchedWriteTask.length > 0 && !hasContract) {
  vs.push(`[合同闸] 写任务路径改动 ${touchedWriteTask.length} 件而无同批工作包合同——开树纪律（写合同文件或列入豁免批注）`);
}

// ② 对账闸：登记簿改动而无对账脚本直呼（现成 merge-reconcile）。
//    对账脚本住址从注册表 keptHelpers 读（派生化：该路径已是 contracts/quality-gates.json 的
//    在册值，此处硬编码即第二副本——defect-shapes P6-F3 已实测咬中，本段即对账结论的兑现）。
//    行缺声明＝账物分离口径破坏，fail-closed。
if (stagedStatus.map(l=>l.split("\t")[1]).includes("docs/plans/problem-register.md")) {
  let helper;
  try {
    const registry = JSON.parse(fs.readFileSync("contracts/quality-gates.json", "utf-8"));
    const row = (registry.gates || []).find((g) => Array.isArray(g && g.keptHelpers)
      && g.keptHelpers.some((h) => /check-merge-reconcile\.mjs$/.test(String(h))));
    helper = row && row.keptHelpers.find((h) => /check-merge-reconcile\.mjs$/.test(String(h)));
  } catch {
    vs.push("[对账闸] 注册表不可读——无法定位对账脚本住址（fail-closed）");
  }
  if (!helper && !vs.some((v) => String(v).includes("无法定位对账脚本住址"))) {
    vs.push("[对账闸] 注册表 merge-reconcile 行缺对账脚本 keptHelpers 声明——账物分离口径破坏");
  } else if (helper) {
    try {
      execFileSync("node", [helper, "--no-fetch"], { stdio: ["ignore", "pipe", "pipe"] });
    } catch {
      vs.push("[对账闸] 登记簿改动但对账脚本红——撞号/分叉未对账");
    }
  }
}

if (vs.length === 0) {
  console.log("workflow_gates=ok");
} else {
  console.log(`workflow_gates=FAIL violations=${vs.length}`);
  for (const v of vs) console.log(`  ${v}`);
  process.exit(1);
}
