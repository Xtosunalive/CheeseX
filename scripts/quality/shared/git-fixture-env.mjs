#!/usr/bin/env node
/**
 * git-fixture-env.mjs — git 夹具 spawn 的 env 净化（ESM 消费包装）
 *
 * 实现唯一事实源 = 同目录 git-fixture-env.cjs（seq163 起）——server 侧 CJS 测试
 * （require 同步消费）与本 ESM 面（既有 scripts/quality 消费方，import 路径与签名
 * 零变化）共用同一实现，禁止两处漂移（规则 8 配置单源化）。
 *
 * 背景（seq162 / B3 家族，#1319 红灯四发实证；seq163 #1325 盲区事故二次实证）：
 * 测试夹具与夹具构建器 spawn git 时裸继承 process.env。当父链携带 GIT_DIR 等
 * GIT_* 上下文变量时，夹具的 git 操作会被重定向到宿主仓（HEAD 被推进夹具提交、
 * user.* 被改写、分支 ref 被强移、core.bare 被翻转）。
 *
 * 用法（所有夹具 git spawn 与被测 checker 子进程 spawn 统一接线）：
 *   import { gitFixtureEnv } from "../shared/git-fixture-env.mjs";
 *   spawnSync("git", args, { cwd: fixtureRoot, env: gitFixtureEnv() });
 *   execFileSync("git", args, { cwd: fixtureRoot, env: gitFixtureEnv(process.env) });
 *
 * 语义边界（实现文件内注释为权威全文）：
 * - 只净化「会把 git 操作重定向到夹具之外」的 GIT_* 变量；普通变量原样保留。
 * - GIT_AUTHOR_* / GIT_COMMITTER_* 一并剥离，夹具本地 config 身份成为唯一事实源。
 * - 生产 checker 的读路径不适用本净化器——见 seq162 manifest ownershipNote。
 */

import gitFixtureEnvCjs from "./git-fixture-env.cjs";

export const gitFixtureEnv = gitFixtureEnvCjs.gitFixtureEnv;
export const gitFixtureEnvStrippedKeys = gitFixtureEnvCjs.gitFixtureEnvStrippedKeys;
