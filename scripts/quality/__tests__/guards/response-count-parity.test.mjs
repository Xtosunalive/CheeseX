// WP-143 波3：response-count-parity 门禁转普通测试——厚扫描逻辑原样保留于检查器助手（读契约→扫代码），红=拦截。
// 层级：产品/契约不变量静态验证；检查器保留为测试助手（注册表已 retired，账物分离）。
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
test("response-count-parity 哨兵：全仓无违规", () => {
  let out, code;
  try {
    out = execFileSync(process.execPath, [path.join(ROOT, "scripts/quality/check-response-count-parity.mjs")], { encoding: "utf-8", cwd: ROOT });
    code = 0;
  } catch (e) {
    code = e.status; out = (e.stdout || "") + (e.stderr || "");
  }
  assert.equal(code, 0, "response-count-parity 检查红：" + String(out).slice(0, 2000));
});
