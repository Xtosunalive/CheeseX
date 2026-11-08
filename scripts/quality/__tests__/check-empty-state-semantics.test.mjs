// check-empty-state-semantics 门禁守护测试（WP-070／SPEC-070 §3.5）
// 层级：纯单元（门禁逻辑）＋门禁实跑。反例内建：边自指/悬空/成环、站点种类悬空、消费类缺定义码、
// 文案指纹出现在组装点之外——全部必须判红；组装点自身放行。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { checkContractClosure, scanGuidanceSource, GUIDANCE_ASSEMBLY_POINT } from "../check-empty-state-semantics.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const contract = JSON.parse(fs.readFileSync(path.join(ROOT, "contracts", "empty-state-semantics.json"), "utf8"));

function clone(o) { return JSON.parse(JSON.stringify(o)); }

test("当前契约：②③两面零违规（边闭合＋站点闭合＋消费类有定义码）", () => {
  assert.deepEqual(checkContractClosure(contract, { fileExists: () => true }), []);
});

test("反例：requires 自指／悬空／成环各自判红", () => {
  const selfRef = clone(contract); selfRef.absence_kinds["versions-empty"].requires = ["versions-empty"];
  assert.ok(checkContractClosure(selfRef).some((v) => v.includes("自指")));
  const dangling = clone(contract); dangling.absence_kinds["versions-empty"].requires = ["ghost-kind"];
  assert.ok(checkContractClosure(dangling).some((v) => v.includes("未登记")));
  const cyc = clone(contract);
  cyc.absence_kinds["product-identity-unmounted"].requires = ["versions-empty"]; // versions-empty 已 requires product-identity → 环
  assert.ok(checkContractClosure(cyc).some((v) => v.includes("成环")));
});

test("反例：站点 kinds 悬空／消费类缺 error_code／module 不存在各自判红", () => {
  const k = clone(contract); k.sites[0].kinds = ["ghost-kind"];
  assert.ok(checkContractClosure(k).some((v) => v.includes("未登记")));
  const c = clone(contract); const site = c.sites.find((s) => s.class === "consumer"); delete site.error_code;
  assert.ok(checkContractClosure(c).some((v) => v.includes("缺 error_code")));
  assert.ok(checkContractClosure(contract, { fileExists: () => false }).some((v) => v.includes("module 不存在")));
});

test("文案 tripwire：组装点放行；其他文件含模板指纹即红；指纹随契约模板派生", () => {
  const t = contract.guide_template;
  const seg = t.slice(t.indexOf("{what}") + 6, t.indexOf("{where}"));
  const fp = new RegExp(seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  assert.equal(scanGuidanceSource(GUIDANCE_ASSEMBLY_POINT, `x = "产品身份未配置${seg}「配置管理」"`, fp), false, "组装点自身放行");
  assert.equal(scanGuidanceSource("server/services/x.cjs", `const hint = "产品身份未配置${seg}「配置管理」";`, fp), true, "第二文案源判红");
  assert.equal(scanGuidanceSource("server/services/x.cjs", `const msg = "无关文案";`, fp), false);
});

test("门禁实跑：当前树绿", () => {
  const out = execFileSync(process.execPath, [path.join(ROOT, "scripts", "quality", "check-empty-state-semantics.mjs")], { encoding: "utf8" });
  assert.match(out, /empty_state_semantics=ok faces=①②③④/);
});
