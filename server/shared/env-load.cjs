// Component: Env-Load — 基于 Node 标准库的 .env 加载器。
// @responsible: 在 main.cjs 读取 process.env 之前，把仓库根目录 .env 的键值合并进 process.env。
// @inputs: 仓库根目录 .env（若存在）
// @outputs: 变更后的 process.env（已设变量优先，不被 .env 覆盖）
// @context: Canvas
//
// 设计约束：
// - 只在 .env 文件存在时读取；不存在则原样返回，零副作用。
// - 不覆盖已经显式设置的环境变量（export 优先于 .env），便于临时覆盖。
const fs = require("fs");
const path = require("path");
const { parseEnv } = require("node:util");

function loadEnvFile(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return {};
  return parseEnv(fs.readFileSync(filePath, "utf8"));
}

function loadEnv(rootDir) {
  const envPath = path.join(rootDir, ".env");
  const entries = loadEnvFile(envPath);
  for (const [key, value] of Object.entries(entries)) {
    // 已显式设置的变量优先，.env 不覆盖。
    if (process.env[key] === undefined) process.env[key] = value;
  }
  return { loadedPath: fs.existsSync(envPath) ? envPath : null, keys: Object.keys(entries) };
}

module.exports = { loadEnv, loadEnvFile };
