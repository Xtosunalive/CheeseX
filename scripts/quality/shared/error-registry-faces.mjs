// Component: error-registry-faces（错误码注册物两检查面的唯一实现——WP-122 error 族合一）
// @responsible: 面③freshness＋面④出生校验 strict，自 check-error-registry.mjs 原样收编（判定逻辑
//   零改动）。消费方：check-error-codes.mjs（在册常驻台，无条件执法——CI 门禁阶段在 vault 构建
//   步之前，派生同步在 CI 是 skip 态）与 check-error-registry.mjs（退役留档工具，独立复跑）。
//   收编为共享件＝探针常量（ZZZ_NOT_BORN_PROBE_CODE 等）单点存在，不进 defect-shapes 词法影子账。
// @inputs: scripts/quality/gen-error-registry.mjs（--check）；server/shared/error-factory.cjs
// @outputs: violations: string[]（空数组=绿）；runFreshness/factory 可注入（守护测试合成桩直调）
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export async function auditRegistryFaces({ runFreshness, factory, root = ROOT } = {}) {
  const violations = [];
  // ③ freshness：生成物与当前抛点扫描一致（生成器 --check）
  try {
    if (runFreshness) await runFreshness();
    else execFileSync(process.execPath, [path.join(root, "scripts/quality/gen-error-registry.mjs"), "--check"], { cwd: root, stdio: "pipe" });
  } catch (error) {
    violations.push(`[freshness] ${String(error.stderr || error.message).trim().split("\n")[0]}`);
  }
  // ④ 出生校验行为证明（strict 面）——进程内加载工厂，强注 strict 环境变量后验证三态
  let mod = factory ?? null;
  if (!mod) {
    try { mod = await import(pathToFileURL(path.join(root, "server/shared/error-factory.cjs")).href); }
    catch (e) { violations.push(`[出生校验] error-factory 不可加载：${e.message}`); mod = null; }
  }
  if (mod) {
    const { createError, bindErrorFactory, listErrorCodes } = mod;
    const codes = listErrorCodes();
    if (!codes) {
      violations.push("[账本] error-registry.generated.cjs 不可读——出生校验整体旁路中，先运行 npm run gen:error-registry");
    } else {
      process.env.CHEESE_ERROR_STRICT = "1";
      // ④a 已登记码：构造通过（取账本首码真打工厂）
      try {
        const err = createError(codes[0], "门禁自证", 400, { probe: true });
        if (err.code !== codes[0]) violations.push(`[出生校验] 已登记码 ${codes[0]} 构造后 code 漂移为 ${err.code}`);
      } catch (e) {
        violations.push(`[出生校验] 已登记码 ${codes[0]} 被 strict 拒绝：${e.message}`);
      }
      // ④b 未知码：必须炸（出生未登记即构造失败）
      const unknown = "ZZZ_NOT_BORN_PROBE_CODE";
      if (codes.includes(unknown)) violations.push(`[出生校验] 探针码 ${unknown} 意外已登记（改名探针）`);
      else {
        let threw = false;
        try { createError(unknown, "门禁自证", 400); } catch { threw = true; }
        if (!threw) violations.push("[出生校验] 未知码未触发 strict 拒绝——出生校验失效（strict 面形同虚设）");
      }
      // ④c 三工厂变体共享校验（bindErrorFactory / createErrorWithDetails 走同一 assertCodeBorn）
      const bound = bindErrorFactory({ status: 400 });
      let boundThrew = false;
      try { bound(unknown, "门禁自证"); } catch { boundThrew = true; }
      if (!boundThrew) violations.push("[出生校验] bindErrorFactory 视图未共享出生校验");
    }
  }
  return violations;
}
