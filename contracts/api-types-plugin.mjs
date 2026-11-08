/**
 * Vite 插件：API 类型新鲜度提示（serve 只读模式）
 *
 * serve 阶段禁止生成或改写文件。类型缺失/陈旧时提示显式生成命令，
 * 提交阶段由 check:api-contract 阻断漂移。
 *
 * 输出稳定机器字段：
 *   api_types_cache=hit   — 跳过生成
 *   api_types_cache=missing|stale — 提示显式生成
 */

import { resolve, dirname } from "path";
import { existsSync, statSync } from "fs";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const CONTRACT = resolve(ROOT, "contracts/http-api.openapi.json");
const OUTPUT = resolve(ROOT, "src/lib/generated/api-types.ts");
export function apiTypesPlugin({ exists = existsSync, stat = statSync, logger = console } = {}) {
  let hasRun = false;
  return {
    name: "api-types-gen",
    apply: "serve",

    buildStart() {
      if (hasRun) return;
      hasRun = true;

      if (!exists(CONTRACT)) {
        logger.warn("[api-types] api_types_cache=skip reason=contract_missing");
        return;
      }

      // mtime cache: skip if output exists and is newer than contract
      if (exists(OUTPUT)) {
        const contractMtime = stat(CONTRACT).mtimeMs;
        const outputMtime = stat(OUTPUT).mtimeMs;
        if (outputMtime >= contractMtime) {
          logger.log("[api-types] api_types_cache=hit");
          return;
        }
      }
      const state = exists(OUTPUT) ? "stale" : "missing";
      logger.warn(`[api-types] api_types_cache=${state}; run npm run gen:api-types`);
    },
  };
}
