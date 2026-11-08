#!/usr/bin/env node
/**
 * git-fixture-env.cjs — git 夹具 spawn 的 env 净化（实现唯一事实源）
 *
 * 背景（seq162 / B3 家族，#1319 红灯四发实证；seq163 #1325 盲区事故二次实证）：
 * 测试夹具与夹具构建器 spawn git 时裸继承 process.env。当父链携带 GIT_DIR 等
 * GIT_* 上下文变量（git hook 执行 npm test 时注入、嵌套 git 工具链注入）时，
 * 夹具的 `git init` 会把仓库定位到 GIT_DIR 指向的宿主仓，随后 config/add/commit
 * 全部落到宿主仓——宿主 HEAD 被推进夹具提交、user.* 被改写、checkout 分支 ref
 * 被强移、`init --bare` 变体甚至翻转宿主 core.bare。
 *
 * 双模块形态（seq163）：实现唯一事实源在本 CJS 文件——server 侧 CJS 测试
 * （require 同步消费）与 scripts/quality 侧 ESM 消费方（经 git-fixture-env.mjs
 * re-export 包装）共用同一实现，禁止两处漂移（规则 8 配置单源化）。
 *
 * 用法（所有夹具 git spawn 与被测 checker 子进程 spawn 统一接线）：
 *   const { gitFixtureEnv } = require("<root>/scripts/quality/shared/git-fixture-env.cjs");
 *   execFileSync("git", args, { cwd: fixtureRoot, env: gitFixtureEnv(process.env) });
 *
 * 语义边界：
 * - 只净化「会把 git 操作重定向到夹具之外」的 GIT_* 变量；普通变量（PATH/HOME/
 *   自定义开关）原样保留，调用方的测试开关（如 QUALITY_GATE_BASE 变体）继续生效。
 * - GIT_AUTHOR_* 与 GIT_COMMITTER_* 一并剥离：env 身份优先级高于 `git config user.*`，
 *   剥离后夹具本地 config 身份成为唯一事实源（提交身份确定性）。
 * - 生产 checker 的读路径不适用本净化器（hook 上下文注入的 GIT_INDEX_FILE 对
 *   读取语义是正确输入）——见 seq162 manifest ownershipNote 的范围裁决。
 */

const GIT_ESCAPE_VARS = [
  // 仓库/工作树重定向
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_COMMON_DIR",
  "GIT_NAMESPACE",
  "GIT_PREFIX",
  // 索引与对象存储重定向
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
  // 发现边界
  "GIT_CEILING_DIRECTORIES",
  "GIT_DISCOVERY_ACROSS_FILESYSTEM",
  // 配置注入
  "GIT_CONFIG",
  "GIT_CONFIG_PARAMETERS",
  "GIT_CONFIG_COUNT",
  // 提交身份（env 优先级高于 git config，剥离以保夹具身份确定性）
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_AUTHOR_DATE",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
  "GIT_COMMITTER_DATE",
];

/**
 * 返回净化后的 env 副本（不修改入参）。
 * @param {NodeJS.ProcessEnv} [base=process.env]
 * @returns {NodeJS.ProcessEnv}
 */
function gitFixtureEnv(base = process.env) {
  const env = { ...base };
  for (const key of GIT_ESCAPE_VARS) {
    delete env[key];
  }
  return env;
}

/** 净化器剥离的变量清单（供契约测试与静态守卫引用，防两处漂移）。 */
function gitFixtureEnvStrippedKeys() {
  return [...GIT_ESCAPE_VARS];
}

module.exports = { gitFixtureEnv, gitFixtureEnvStrippedKeys, GIT_ESCAPE_VARS };
