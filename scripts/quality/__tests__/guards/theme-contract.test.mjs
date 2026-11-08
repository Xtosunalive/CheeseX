// WP-143 波2：theme-contract 门禁转普通测试——哨兵直呼原检查器（读契约/单源→扫全仓），红=拦截。
// 层级：产品不变量静态验证；检查器文件保留为测试助手（注册表已 retired，账物分离）。
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
test("theme-contract 哨兵：全仓无违规", () => {
  let out, code;
  try {
    out = execFileSync(process.execPath, [path.join(ROOT, "scripts/quality/check-theme-contract.mjs")], { encoding: "utf-8", cwd: ROOT });
    code = 0;
  } catch (e) {
    code = e.status; out = (e.stdout || "") + (e.stderr || "");
  }
  assert.equal(code, 0, `theme-contract 检查红：\n${out.slice(0, 2000)}`);
});
