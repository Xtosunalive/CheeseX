// WP-143 波3：pipeline-rules 门禁转普通测试——厚扫描逻辑原样保留于检查器助手（读契约→扫代码），红=拦截。
// 层级：产品/契约不变量静态验证；检查器保留为测试助手（注册表已 retired，账物分离）。
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
// 规则数据住 data/governance（内部面，不入公开仓）：缺席时明示跳过，本地有数据时照常执法。
const DATA_SKIP = fs.existsSync(path.join(ROOT, "data/governance/pipeline-rules/active.json"))
  ? false
  : "data/governance/pipeline-rules 不在公开面——哨兵缺席跳过";
test("pipeline-rules 哨兵：全仓无违规", { skip: DATA_SKIP }, () => {
  let out, code;
  try {
    out = execFileSync(process.execPath, [path.join(ROOT, "scripts/quality/check-pipeline-rules.mjs")], { encoding: "utf-8", cwd: ROOT });
    code = 0;
  } catch (e) {
    code = e.status; out = (e.stdout || "") + (e.stderr || "");
  }
  assert.equal(code, 0, "pipeline-rules 检查红：" + String(out).slice(0, 2000));
});
