// Component: Vault-Runtime-Spawn
// @responsible: KB 运行时子进程唯一拉起点（WP-069/SPEC-069 §3.1）——env 全集组装单源＋exec 助手。
//   调用点零自拼 env：身份作用域变量（KB_VAULT/ARCH_REPO/VOCAB_ENVELOPE_PATH）只经语义选项进入
//   （vaultPath/archRepo/vocabEnvelope）；extraEnv 携带身份变量名即 TypeError（防后门自拼——
//   2026-11-01 冻结链死链教训：拉起点各自拼 env 漏一处即死链；PR-122 e2e 作用域事故教训：
//   错 KB_VAULT 会把测试数据写进用户真库）。
//   词表信封随拉起物化（WP-049 L3／ADR-016 §四-2）：vocabEnvelope=true 即物化并注入。
//   文档信封随拉起物化（WP-117 批2／SPEC-084 §二.1）：docEnvelope=true 即物化并注入——
//   同款纪律（拉起前重写、false 显式 delete，绝不继承父环境陈旧信封）。
//   THESCHEMA_DIR 等未列变量经 process.env 继承（测试隔离注入位不变）。
// @inputs: options { vaultPath（必填作用域锚）, archRepo, vocabEnvelope, docEnvelope, extraEnv, interpreter, family, cwd, timeout }
// @outputs: buildVaultRuntimeEnv（env 对象——python-bridge 流式拉起消费）＋execVaultRuntimeScript（Promise exec）
// @context: Canvas

"use strict";

const path = require("node:path");
const { runCommand } = require("./async-exec.cjs");
const { resolvePythonPath } = require("./python-path.cjs");
const { resolveVaultRuntimeScript } = require("./vault-runtime-resolver.cjs");
const { materializeVocabEnvelope } = require("./vocab-envelope-materializer.cjs");
const { writeDocEnvelope } = require("./doc-envelope-materializer.cjs");

const REPO_ROOT = path.resolve(__dirname, "..", ".."); // server/shared → 仓根（2026-11-02 E2E 咬出：误写三级致 vault-py 族脚本路径指到仓外，单测 resolver 族未覆盖——真实拉起测试补 family=vault-py-graph 例）

// 身份作用域变量（contracts/runtime-scope.json variables 的拉起侧子集）——extraEnv 禁携；
// KB_DATA_DIR 不在列：测试隔离/部署覆盖经 extraEnv 与 process.env 等价，非身份变量。
const IDENTITY_SCOPE_ENV = new Set(["KB_VAULT", "ARCH_REPO", "VOCAB_ENVELOPE_PATH", "DOC_ENVELOPE_PATH"]);

/**
 * 拉起 env 全集组装（唯一构造器）。
 * @param {object} options { vaultPath, archRepo, vocabEnvelope, extraEnv }
 * @returns {object} env（含 process.env 继承）
 */
function buildVaultRuntimeEnv(options) {
  const { vaultPath, archRepo, vocabEnvelope = false, docEnvelope = false, extraEnv } = options || {};
  if (!vaultPath) {
    throw new TypeError("VAULT_RUNTIME_SPAWN_UNRESOLVED: vaultPath 缺失（装配缺陷）——拉起拒绝静默作用域");
  }
  const smuggled = Object.keys(extraEnv || {}).filter((key) => IDENTITY_SCOPE_ENV.has(key));
  if (smuggled.length) {
    throw new TypeError(`VAULT_RUNTIME_SCOPE_OWNED: extraEnv 不得携带身份作用域变量（${smuggled.join(", ")}）——经 vaultPath/archRepo/vocabEnvelope 语义选项进入`);
  }
  const repo = path.resolve(archRepo || REPO_ROOT);
  const env = {
    ...process.env,
    KB_VAULT: path.resolve(vaultPath),
    ARCH_REPO: repo,
    KB_DATA_DIR: process.env.KB_DATA_DIR || path.join(repo, "data"), // SPEC-012 WP-A：python 侧运行时状态库住址
  };
  // 身份变量同权：由本次拉起语义决定，绝不从父环境继承（红队 2026-11-02 实测：父 env 陈旧
  // VOCAB_ENVELOPE_PATH 在 vocabEnvelope=false 时漏入子进程——信封是"本次装载产出"，继承即陈旧面）
  delete env.VOCAB_ENVELOPE_PATH;
  if (vocabEnvelope) env.VOCAB_ENVELOPE_PATH = materializeVocabEnvelope(path.resolve(vaultPath));
  // 文档信封同款纪律（WP-117 批2）：拉起前重写、false 显式 delete——继承即陈旧面
  delete env.DOC_ENVELOPE_PATH;
  if (docEnvelope) env.DOC_ENVELOPE_PATH = writeDocEnvelope(path.resolve(vaultPath));
  return Object.assign(env, extraEnv || {}); // 业务/隔离变量合入（身份变量已被上方禁令拦下）
}

/**
 * 执行 vault-runtime／vault-py 脚本（exec 语义：收集 stdout/stderr，Promise 结算）。
 * 流式长进程（pipeline-runner）不经此口——python-bridge spawn、env 仍由 buildVaultRuntimeEnv 组装。
 * @param {string} scriptName 脚本文件名（family 决定目录解析）
 * @param {string[]} args
 * @param {object} options { vaultPath, archRepo, vocabEnvelope, extraEnv, interpreter: "python"|"node", family: "vault-runtime"|"vault-py-graph", cwd, timeout, maxBuffer }
 * @returns {Promise<{error, status, stdout, stderr}>} spawnSync 同形状（async-exec 语义）
 */
async function execVaultRuntimeScript(scriptName, args, options) {
  const { interpreter = "python", family = "vault-runtime", cwd, timeout = 120000, maxBuffer } = options || {};
  const env = buildVaultRuntimeEnv(options);
  const scriptsDirectory = family === "vault-py-graph"
    ? path.join(REPO_ROOT, "scripts", "vault-py", "graph")
    : resolveVaultRuntimeScript("", { vaultPath: options.vaultPath });
  const scriptPath = path.join(scriptsDirectory, scriptName);
  const executable = interpreter === "node" ? process.execPath : resolvePythonPath();
  return runCommand(executable, [scriptPath, ...args], {
    cwd: cwd || REPO_ROOT,
    env,
    encoding: "utf8",
    timeout,
    maxBuffer: maxBuffer || 16 * 1024 * 1024,
  });
}

module.exports = { buildVaultRuntimeEnv, execVaultRuntimeScript, IDENTITY_SCOPE_ENV };
