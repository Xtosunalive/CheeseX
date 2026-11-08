// Component: Enums-Change-Preview-Service
// @responsible: 预览分类身份变更影响，并为同 revision、同候选内容签发短期确认凭证。
// @inputs: enums.yaml 当前 revision、候选分类 section、受治理 Markdown 文档
// @outputs: 规则/模块/来源文档影响证据与一次性 previewId
// @context: Schema-Manager

const crypto = require("crypto");
const { displayTheSchemaPath } = require("../../shared/theschema-root.cjs");
const fs = require("fs");
const path = require("path");
const { scanDocumentSources } = require("../projection/document-source-scanner.cjs");

const PREVIEW_TTL_MS = 10 * 60 * 1000;
const MANAGED_KEYS = ["revision", "domains", "subdomains", "layers", "categories", "article_types", "doc_types", "modules"];

const { createError: serviceError } = require("../../shared/error-factory.cjs");

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map(function (key) { return [key, stableValue(value[key])]; }));
}

function candidateFingerprint(payload) {
  const managed = {};
  MANAGED_KEYS.forEach(function (key) {
    if (payload[key] !== undefined) managed[key] = payload[key];
  });
  return crypto.createHash("sha256").update(JSON.stringify(stableValue(managed))).digest("hex");
}

function valueLocations(subdomains) {
  // ADR-008 D1：词条双形态取 id（裸标量 legacy｜{id,...} 对象）。
  const toId = require("../../shared/enums-loader.cjs").subdomainEntryId;
  const locations = new Map();
  Object.entries(subdomains || {}).forEach(function ([domainId, values]) {
    if (!Array.isArray(values)) return;
    values.forEach(function (value) {
      const id = toId(value);
      if (id) locations.set(id, domainId);
    });
  });
  return locations;
}

function classificationChanges(previousSubdomains, nextSubdomains) {
  const previous = valueLocations(previousSubdomains);
  const next = valueLocations(nextSubdomains);
  return {
    removed: Array.from(previous.entries()).filter(function ([value]) { return !next.has(value); }).map(function ([value, domainId]) { return { domainId, value }; }),
    added: Array.from(next.entries()).filter(function ([value]) { return !previous.has(value); }).map(function ([value, domainId]) { return { domainId, value }; }),
  };
}

function fieldLineNumber(vaultPath, sourcePath, field) {
  const absolutePath = path.join(vaultPath, sourcePath);
  if (!fs.existsSync(absolutePath)) return null;
  const lines = fs.readFileSync(absolutePath, "utf8").split(/\r?\n/);
  const pattern = new RegExp("^\\s*" + field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\s*:");
  const index = lines.findIndex(function (line) { return pattern.test(line); });
  return index >= 0 ? index + 1 : null;
}

function createEnumsChangePreviewService(options) {
  const vaultPath = options.vaultPath;
  const now = options.now || Date.now;
  const createId = options.createId || crypto.randomUUID;
  const previews = new Map();

  function purgeExpired() {
    const timestamp = now();
    for (const [previewId, preview] of previews.entries()) {
      if (preview.expiresAtMs <= timestamp) previews.delete(previewId);
    }
  }

  function preview(payload, currentEnums) {
    purgeExpired();
    if (!payload.revision || payload.revision !== currentEnums.revision) {
      throw serviceError("ENUMS_REVISION_CONFLICT", "enums.yaml changed after it was loaded", 409);
    }
    const nextSubdomains = payload.subdomains || currentEnums.data.subdomains || {};
    const nextModules = payload.modules || currentEnums.data.modules || {};
    const changes = classificationChanges(currentEnums.data.subdomains || {}, nextSubdomains);
    if (!changes.removed.length) {
      throw serviceError("PREVIEW_NOT_REQUIRED", "No existing subdomain identity is being removed", 400);
    }

    let scan;
    try {
      scan = scanDocumentSources({ vaultPath });
    } catch (error) {
      throw serviceError(error.code || "DOCUMENT_INDEX_UNAVAILABLE", error.message, 503, error.details);
    }
    const removedValues = new Set(changes.removed.map(function (item) { return item.value; }));
    const affectedDocuments = scan.documents.filter(function (document) {
      return removedValues.has(document.arch_subdomain);
    }).map(function (document) {
      return {
        documentId: document.documentId,
        title: document.title,
        sourcePath: document.sourcePath,
        sourceHash: document.sourceHash,
        lineNumber: fieldLineNumber(vaultPath, document.sourcePath, "arch_subdomain"),
        currentValue: document.arch_subdomain,
      };
    });
    const currentModules = currentEnums.data.modules || {};
    const affectedModules = Object.keys(currentModules).filter(function (name) {
      return removedValues.has(currentModules[name] && currentModules[name].subdomain);
    }).map(function (name) {
      return {
        name,
        before: currentModules[name].subdomain,
        after: nextModules[name] && typeof nextModules[name].subdomain === "string" ? nextModules[name].subdomain : null,
      };
    });
    const previewId = createId();
    const expiresAtMs = now() + PREVIEW_TTL_MS;
    previews.set(previewId, {
      fingerprint: candidateFingerprint(payload),
      revision: currentEnums.revision,
      expiresAtMs,
    });
    return {
      previewId,
      expiresAt: new Date(expiresAtMs).toISOString(),
      source: { sourceFile: displayTheSchemaPath(vaultPath, "enums.yaml"), revision: currentEnums.revision },
      changes,
      affectedModules,
      affectedDocuments,
      diagnostics: scan.invalid,
      summary: {
        removedValues: changes.removed.length,
        addedValues: changes.added.length,
        modules: affectedModules.length,
        documents: affectedDocuments.length,
        invalidDocuments: scan.invalid.length,
      },
    };
  }

  function assertWriteAllowed(payload, currentEnums) {
    const nextSubdomains = payload.subdomains || currentEnums.data.subdomains || {};
    const changes = classificationChanges(currentEnums.data.subdomains || {}, nextSubdomains);
    if (!changes.removed.length) return null;
    purgeExpired();
    const confirmation = payload.confirmation;
    if (!confirmation || confirmation.confirmed !== true || !confirmation.previewId) {
      throw serviceError("CHANGE_PREVIEW_REQUIRED", "Subdomain identity changes require impact preview and explicit confirmation", 409);
    }
    const previewRecord = previews.get(confirmation.previewId);
    if (!previewRecord || previewRecord.revision !== currentEnums.revision || previewRecord.fingerprint !== candidateFingerprint(payload)) {
      throw serviceError("CHANGE_PREVIEW_STALE", "The impact preview no longer matches the current candidate change", 409);
    }
    return confirmation.previewId;
  }

  function consume(previewId) {
    if (previewId) previews.delete(previewId);
  }

  return { preview, assertWriteAllowed, consume };
}

module.exports = { candidateFingerprint, classificationChanges, createEnumsChangePreviewService };
