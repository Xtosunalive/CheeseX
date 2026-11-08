// Component: Data-Roles-Routes（SPEC-019 ②＋PR-163 重建入口）
// @responsible: GET /api/schema/data-roles——TheSchema 数据角色注册表投影（页签层标注条的数据源）；
//   POST /api/schema/derived/rebuild——派生物重建一等入口（openbkn build API 形态）。
// @context: 注册表 contracts/theschema-roles.json 单源；页面不手写层标注（防漂移）；
//   重建清单＝role=derived ∧ generator≠null 行（derivation-sync 门禁同一选择口径，登记即自动入列）。
const { sendJSON } = require("../shared/api-envelope.cjs");
const { logger } = require("../shared/json-logger.cjs");
const { createError } = require("../shared/error-factory.cjs");
// WP-048 Wave 1 W1-C：derived/rebuild 经统一执行工厂（#53——ADR-014 §八 52→53 增补项）。
const { registerActionExecutor, executeAction } = require("../shared/action-execution-factory.cjs");
const { runCommand } = require("../shared/async-exec.cjs"); // PR-056：server 运行时禁同步子进程
const { createHash } = require("node:crypto");
const fs = require("fs");
const path = require("path");

function selectDerivations(registry) {
  return (registry.entries || []).filter((e) => e && e.role === "derived" && typeof e.generator === "string" && e.generator.trim());
}

function register(registerRoute, deps) {
  const repoRoot = deps.repoRoot || process.cwd();
  const registryPath = path.join(repoRoot, "contracts", "theschema-roles.json");

  registerRoute("GET", "/api/schema/data-roles", function (_req, res) {
    try {
      const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
      return sendJSON(res, 200, { schema_version: registry.schema_version, entries: registry.entries });
    } catch (e) {
      logger.error({ event: "data-roles-get-failed", error: e.message });
      return sendJSON(res, 500, { error_code: "DATA_ROLES_UNAVAILABLE", message: e.message });
    }
  });

  // PR-163（重建入口显形化）：同步逐个真跑生成器（npm 别名），幂等；changed＝构建前后字节哈希
  // 比对——操作者一键把全部派生物拉回与真身一致，且知道刚才是否发生了重建。
  // PR-163（重建入口显形化）＋WP-048 W1-C 动作化：schema.derived-rebuild——批报告型动作，
  // 部分失败以 __http_status=500 携数据体上报（契约 anyOf 双形状既有；前端消费 artifacts/failed 字段）。
  const __exec_schema_derived_rebuild = async function () {
    const startedAt = Date.now();
    try {
      const registry = JSON.parse(fs.readFileSync(registryPath, "utf8"));
      const derivations = selectDerivations(registry);
      const artifacts = []; for (const entry of derivations) { artifacts.push(await (async () => {
        const abs = path.join(repoRoot, entry.file);
        const before = fs.existsSync(abs) ? createHash("sha256").update(fs.readFileSync(abs)).digest("hex") : null;
        // PR-169/F2：runCommand 非零退出以 {status} resolve（spawnSync 语义，从不 reject）——
        // 判 result.status 而非 try/catch（原 catch 为死代码，失败上报 ok:true 假绿）
        const run = await runCommand("npm", ["run", entry.generator], { cwd: repoRoot, timeoutMs: 60 * 1000 });
        if (!run || run.status !== 0) {
          return { artifact: entry.file, generator: entry.generator, ok: false, changed: null, error: String((run && (run.stderr || run.stdout)) || `exit ${run && run.status}`).slice(0, 200) };
        }
        const after = fs.existsSync(abs) ? createHash("sha256").update(fs.readFileSync(abs)).digest("hex") : null;
        return { artifact: entry.file, generator: entry.generator, ok: true, changed: before !== after, hash: after ? "sha256:" + after : null };
      })()); }
      const failed = artifacts.filter(function (a) { return !a.ok; });
      const report = {
        rebuiltAt: new Date().toISOString(),
        total: artifacts.length,
        failed: failed.length,
        durationMs: Date.now() - startedAt,
        artifacts,
        // WP-055 Q2（SPEC-049）：重建即翻新——响应携带重建后读模型版本（与 GET
        // /api/read-model/version 同源同函数；失败路径不携带＝不翻新）
        readModelVersion: deps.vaultPath
          ? require("../shared/read-model-port.cjs").getReadModelVersion({ vaultPath: deps.vaultPath })
          : undefined,
      };
      if (failed.length) {
        // PR-169/F1：500 走正规错误信封——error_code/message＋完整报告入 details（信封丢弃根级杂字段，
        // 原裸数据体与执法信封永不匹配致生产恒 500）
        return {
          __http_status: 500,
          error_code: "DERIVATION_REBUILD_FAILED",
          message: failed.map(function (f) { return f.artifact + ": " + f.error; }).join("; ").slice(0, 300),
          details: report,
        };
      }
      return report;
    } catch (e) {
      logger.error({ event: "derived-rebuild-failed", error: e.message });
      throw createError("DERIVATION_REBUILD_FAILED", e.message, 500);
    }
  };
  registerActionExecutor("schema.derived-rebuild", __exec_schema_derived_rebuild);

  registerRoute("POST", "/api/schema/derived/rebuild", function (_req, res) {
    return executeAction({ actionId: "schema.derived-rebuild", executor: __exec_schema_derived_rebuild, request: _req, reply: res });
  });
}

module.exports = { register };
