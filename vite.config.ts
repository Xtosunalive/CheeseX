// vitest 复用本文件作配置源：defineConfig 从 vitest/config 导入——其返回类型在 Vite UserConfig
// 之上扩展了 test 块（Vite 原生无此属性）。此前从 "vite" 导入导致 tsc -b 全量构建检查报
// TS2769（'test' does not exist in type 'UserConfigExport'）——CI typecheck 只查 tsconfig.app
// 未覆盖此文件，口径差即此（2026-10-09 修，两条口径此后应同绿）。
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import { createRequire } from "node:module";
import { apiTypesPlugin } from "./contracts/api-types-plugin.mjs";

// seq197 缺陷修复轮（#1610）：Vite dev 对项目内 .cjs 原样返回、不做 CJS→ESM 互操作转换——
// 前端 import 该模块必死（具名/默认导入实测均 SyntaxError → dev 全站白屏）。
// Node 侧 require 单源读取（唯一事实源仍为 server/shared/version-contract.cjs），编译期 define 内联给前端；
// dev/build/vitest 三态一致；此处只读 .cjs，不写任何文件（dev:web 只读约束不破）。
const requireCjs = createRequire(path.resolve(__dirname, "package.json"));
const { VERSION_PATTERN } = requireCjs("./server/shared/version-contract.cjs") as { VERSION_PATTERN: RegExp };

export default defineConfig({
  // 依赖优化缓存目录可用环境变量隔离：任务工作树软链主树 node_modules（PR-008 开树惯例），
  // 两个 dev server 并发写同一 node_modules/.vite 会损坏优化产物——G6 dep 请求 504 挂起、
  // 前端动态 import 永不完成实录（2026-10-30）。并行开发时任务树设 VITE_CACHE_DIR 隔离。
  cacheDir: process.env.VITE_CACHE_DIR || "node_modules/.vite",
  server: {
    host: "0.0.0.0",
    port: 5174,
    allowedHosts: ["semiyearly-implicitly-philomena.ngrok-free.dev", "7308aa86.r7.cpolar.top"],
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env.API_PORT || "18083"}`,
        changeOrigin: true,
      },
    },
  },
  plugins: [apiTypesPlugin(), tailwindcss(), react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  define: {
    __VERSION_PATTERN_SOURCE__: JSON.stringify(VERSION_PATTERN.source),
    __VERSION_PATTERN_FLAGS__: JSON.stringify(VERSION_PATTERN.flags),
  },
  test: {
    environment: "jsdom",
    globals: true,
    maxWorkers: 1,
    setupFiles: ["./src/test/setup.ts"],
    include: [
      "src/test/**/*.test.{ts,tsx}",
    ],
    coverage: {
      provider: 'v8',
      // json-summary 产出 coverage-summary.json——scripts/check-coverage-thresholds.mjs 与
      // CI test-coverage.yml 的汇总步骤依赖该文件（仅 'json' 只出 coverage-final.json）。
      reporter: ['text', 'json-summary', 'json', 'html', 'lcov'],
      reportsDirectory: './coverage',
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.test.{ts,tsx}',
        '**/*.spec.{ts,tsx}',
        'src/lib/generated/',
        'src/types/',
        '**/*.d.ts',
        'scripts/',
        'server/',
        '.claude/',
        'dist/',
        'coverage/',
      ],
      // all: true 已删——vitest 4 CoverageOptions 无此键（tsc -b 报 TS2769 的第二处）；
      // 实测 coverageConfigDefaults 键集无 all，运行时本就静默忽略，删除零行为变化。
      clean: true,
      thresholds: {
        // 实测基线（2026-09-12 全量套件 98 文件全绿实测：67.61/60.43/56.96/64），
        // 向下取整防边界抖动；爬坡提升另立窗口，勿凭意愿调高（CI 必红）。
        lines: 67,
        functions: 60,
        branches: 56,
        statements: 64,
      },
    },
  },
});
