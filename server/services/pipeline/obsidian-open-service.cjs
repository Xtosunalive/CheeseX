// Component: Obsidian-Open-Service
// @responsible: 校验 Vault 来源路径并通过系统协议处理器打开对应 Obsidian 文档。
// @inputs: 当前 Vault 根路径、Vault 相对 Markdown 路径
// @outputs: 已打开的规范来源路径和 Vault 名称
// @context: Vault

const childProcess = require("child_process");
const fs = require("fs");
const path = require("path");
const { deriveVaultName, buildObsidianUri } = require("../../shared/obsidian-utils.cjs");

const { createError: serviceError } = require("../../shared/error-factory.cjs");

function normalizeVaultRelativeMarkdownPath(value) {
  if (typeof value !== "string" || !value.trim()) throw serviceError("VALIDATION_ERROR", "sourcePath 不能为空", 400);
  const normalized = value.trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/");
  if (normalized.includes("\0") || normalized.includes("://") || path.posix.isAbsolute(normalized) || path.win32.isAbsolute(normalized)) {
    throw serviceError("VALIDATION_ERROR", "sourcePath 必须是 Vault 相对路径", 400);
  }
  const segments = normalized.split("/");
  if (segments.some(function (segment) { return !segment || segment === "." || segment === ".."; })) {
    throw serviceError("VALIDATION_ERROR", "sourcePath 包含非法路径片段", 400);
  }
  if (path.posix.extname(normalized).toLowerCase() !== ".md") {
    throw serviceError("VALIDATION_ERROR", "仅允许打开 Vault 内的 Markdown 文档", 400);
  }
  return normalized;
}

function systemOpen(uri) {
  return new Promise(function (resolve, reject) {
    childProcess.execFile("/usr/bin/open", [uri], { timeout: 5000 }, function (error) {
      if (error) reject(error);
      else resolve();
    });
  });
}

function createObsidianOpenService(options) {
  const vaultPath = path.resolve(options.vaultPath);
  const openExternal = options.openExternal || systemOpen;

  async function openSource(sourcePath) {
    const normalizedPath = normalizeVaultRelativeMarkdownPath(sourcePath);
    const absolutePath = path.resolve(vaultPath, normalizedPath);
    const vaultPrefix = vaultPath.endsWith(path.sep) ? vaultPath : vaultPath + path.sep;
    if (!absolutePath.startsWith(vaultPrefix)) throw serviceError("VALIDATION_ERROR", "sourcePath 超出当前 Vault", 400);
    if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
      throw serviceError("SOURCE_NOT_FOUND", "来源文档不存在或已移动", 404);
    }
    const vaultName = deriveVaultName(vaultPath);
    const uri = buildObsidianUri(vaultName, normalizedPath);
    try {
      await openExternal(uri);
    } catch (error) {
      throw serviceError("OBSIDIAN_OPEN_FAILED", "无法启动 Obsidian：" + error.message, 500);
    }
    return { opened: true, sourcePath: normalizedPath, vaultName };
  }

  return { openSource };
}

module.exports = { createObsidianOpenService, normalizeVaultRelativeMarkdownPath };
