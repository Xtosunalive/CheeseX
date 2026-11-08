// Component: Runtime-State-Import
// @responsible: SPEC-012 boot 一次性迁移单点——vault .anyshare 存量文件/目录迁入持久层。
//   ③类 json：导入 runtime-state.db，幂等（runtime_migration 标记族级去重）；导入后原文件改名
//   .migrated 留存一版（人裁删除，不自动删）；backups/ 物理搬至 data/backups（原始字节跨目录移动）。
//   ②类目录（wave-2 article-manifests）：导入 derived-index.db 行级后整体删除（派生物可丢弃，
//   与 health 目录同款处理——不设 .migrated 留存；boot 重建/manifest rebuild 幂等覆盖兜底）。
//   图族三件（wave-2）：master_graph/extract_manifest 原文行入 derived-index.db＋master_graph.db
//   字节工件复制 data/，迁完删除（②类可丢弃，落 migrate: 账）。
// @inputs: vaultPath；runtimeState store；derivedIndex store；gitLedger（迁移改名/删除的落账）
// @outputs: importLegacyRuntimeState() → { families: [...], backupsMoved, articleManifests: {...}, graphArtifacts: {...} }
// @context: boot 期（listen 前）；单次执行；失败只 warn 不阻断启动（下一 boot 重试——幂等）
"use strict";

const fs = require("node:fs");
const path = require("node:path");

// 旧文件 → 导入器映射（读路径字面量集中于此——迁移完成后本模块随 WP-J 退役）
const LEGACY_FILES = {
  "approval-states.json": (store, parsed) => {
    for (const [articleId, record] of Object.entries(parsed || {})) store.approval.put(articleId, record);
  },
  "article-upload-tasks.json": (store, parsed) => store.workflow.put(parsed),
  "governance_actions.json": (store, parsed) => {
    for (const entry of parsed || []) store.governance.put(entry);
  },
  "review_actions.json": (store, parsed) => {
    for (const record of parsed || []) store.review.append(record, record.decidedAt ?? null);
  },
  "inference_rule_conflicts.json": (store, parsed) => {
    if (parsed) store.inference.putEnvelope(parsed);
  },
  "relation_write_expectations.json": (store, parsed) => {
    if (parsed) store.expectations.put(parsed);
  },
  // 管线三件套（WP-A 续：Node/Python 双写者已全部迁库，此处只收历史存量）
  "pipeline_state.json": (store, parsed) => {
    if (parsed && typeof parsed === "object") {
      if (parsed.pending_refresh) store.pipeline.statePut("pending_refresh", parsed);
      if (parsed.last_stage !== undefined) store.pipeline.statePut("run_stage", parsed);
    }
  },
  "pipeline-runs.json": (store, parsed) => {
    if (Array.isArray(parsed)) {
      for (const entry of [...parsed].reverse()) store.pipeline.runsInsert(entry); // 旧文件新→旧；库序旧→新（runsLatest=最新）
    }
  },
  "pipeline_version.json": (store, parsed) => {
    if (parsed && typeof parsed === "object") store.pipeline.versionPut(parsed);
  },
  // SPEC-012 wave-2 首家族：anomaly 台账（对象键=issueId → 行级）
  "anomaly-work-items.json": (store, parsed) => {
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) store.anomaly.replaceAll(parsed);
  },
};

function importLegacyRuntimeState({ vaultPath, store, derivedIndexStore, gitLedger, logger, dataDir }) {
  const log = logger || { info() {}, warn() {}, error() {} };
  const ledger = gitLedger || { markSystemFile() {}, scheduleLedger() {} };
  const legacyLedgerDir = path.join(vaultPath, ".ledger");
  const results = [];
  const touched = [];

  for (const [filename, importFamily] of Object.entries(LEGACY_FILES)) {
    const family = filename.replace(/\.json$/, "");
    const source = path.join(legacyLedgerDir, filename);
    try {
      if (!fs.existsSync(source)) {
        results.push({ family, imported: false, renamed: false, reason: "absent" });
        continue;
      }
      if (store.migration.imported(family)) {
        results.push({ family, imported: false, renamed: false, reason: "already-imported" });
        continue;
      }
      const parsed = JSON.parse(fs.readFileSync(source, "utf8"));
      importFamily(store, parsed);
      const migrated = source + ".migrated";
      ledger.markSystemFile([source, migrated]); // 迁移改名不是外部写（WP-J：静态登记，替代原时间窗）
      fs.renameSync(source, migrated);
      store.migration.markImported(family);
      touched.push(migrated);
      results.push({ family, imported: true, renamed: true });
    } catch (error) {
      log.warn({ event: "runtime-state-import-failed", family, error: error.message });
      results.push({ family, imported: false, renamed: false, reason: `error: ${error.message}` });
    }
  }

  // backups/：物理搬到 data/backups/legacy/（保留原结构 articles/entities/schema）
  let backupsMoved = 0;
  const legacyBackups = path.join(legacyLedgerDir, "backups");
  try {
    if (fs.existsSync(legacyBackups) && !store.migration.imported("backups")) {
      const targetRoot = path.join(dataDir, "backups", "legacy");
      fs.mkdirSync(targetRoot, { recursive: true });
      for (const entry of fs.readdirSync(legacyBackups, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const from = path.join(legacyBackups, entry.name);
        const to = path.join(targetRoot, entry.name);
        fs.mkdirSync(to, { recursive: true });
        for (const file of fs.readdirSync(from)) {
          fs.renameSync(path.join(from, file), path.join(to, file));
          backupsMoved += 1;
        }
        fs.rmdirSync(from);
      }
      fs.rmdirSync(legacyBackups);
      store.migration.markImported("backups");
      touched.push(legacyBackups);
    }
  } catch (error) {
    log.warn({ event: "runtime-state-import-backups-failed", error: error.message });
  }

  // SPEC-012 wave-2 ②类：article-manifests 目录树导入 derived-index.db 后整体删除
  // （行级 put 幂等；目录幂等＝不存在即 no-op。boot 顺序：本导入在 rebuildArticleManifests
  // 之前完成——main.cjs 将 rebuild 链在本 promise 之后，导入的存量行被重建行新鲜覆盖）
  const articleManifestsResult = importLegacyArticleManifests({ vaultPath, derivedIndexStore, ledger, log });

  // SPEC-012 wave-2 图族：vault .ledger 三件迁出（②类可丢弃——store 原文行＋字节工件复制，
  // 迁完删除旧住址；幂等＝文件缺席 no-op。boot 后 main.cjs 再摄取一次 staging——升级窗口下
  // vault 旧图与 staging 新图并存时，staging（较新，Python 现行写点）胜出）
  const graphArtifactsResult = importLegacyGraphArtifacts({ vaultPath, derivedIndexStore, ledger, log, dataDir });

  // 迁移痕迹落账（改名产生的新文件与删除的旧文件一并进一笔 migrate: 提交）
  if (touched.length > 0 || graphArtifactsResult.removed.length > 0) {
    ledger.scheduleLedger("migrate", "SPEC-012 ③类迁出（json→SQLite）", [legacyLedgerDir]);
  }

  log.info({ event: "runtime-state-import-done", results, backupsMoved });
  return { families: results, backupsMoved, articleManifests: articleManifestsResult, graphArtifacts: graphArtifactsResult };
}

// ②类目录导入：递归收集 *.json → 行级 put（key=相对路径去 .json）→ 目录整体移除。
// 单文件解析失败只 warn 跳过（脏行不进库，boot 重建按活源重生成）。
function importLegacyArticleManifests({ vaultPath, derivedIndexStore, ledger, log }) {
  const dir = path.join(vaultPath, ".ledger", "article-manifests");
  if (!derivedIndexStore) {
    log.warn({ event: "article-manifests-import-skipped", reason: "derivedIndexStore 未装配" });
    return { imported: 0, removed: false };
  }
  if (!fs.existsSync(dir)) return { imported: 0, removed: false }; // 幂等：已迁/从未有

  let imported = 0;
  const walk = function walk(rel) {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const relPath = rel ? path.posix.join(rel, entry.name) : entry.name;
      if (entry.isDirectory()) walk(relPath);
      else if (entry.name.endsWith(".json")) {
        try {
          const parsed = JSON.parse(fs.readFileSync(path.join(dir, relPath), "utf8"));
          derivedIndexStore.articleManifests.put(relPath.slice(0, -".json".length), parsed);
          imported += 1;
        } catch (error) {
          log.warn({ event: "article-manifests-import-file-failed", file: relPath, error: error.message });
        }
      }
    }
  };
  walk("");

  try {
    ledger.markSystemFile([dir]); // ②类派生物迁出删除不是外部写（WP-J：静态登记）
    fs.rmSync(dir, { recursive: true, force: true });
    ledger.scheduleLedger("migrate", "SPEC-012 ②类迁出（article-manifests→derived-index.db）", [dir]);
    log.info({ event: "article-manifests-import-done", imported, removed: true });
    return { imported, removed: true };
  } catch (error) {
    log.warn({ event: "article-manifests-import-remove-failed", error: error.message });
    return { imported, removed: false };
  }
}

// 图族三件迁出：master_graph.json/extract_manifest.json 原文行 put 进 derived-index.db
// （字节精确），master_graph.db 字节工件复制到 repo 侧 dataDir/（不进库）；随后三件删除。
// 单件失败只 warn（脏 JSON 不进库，staging/boot 重建兜底）；幂等＝文件缺席 no-op。
function importLegacyGraphArtifacts({ vaultPath, derivedIndexStore, ledger, log, dataDir }) {
  const legacyLedgerDir = path.join(vaultPath, ".ledger");
  const result = { imported: [], dbCopied: false, removed: [] };
  if (!derivedIndexStore) {
    log.warn({ event: "graph-artifacts-import-skipped", reason: "derivedIndexStore 未装配" });
    return result;
  }
  const textFiles = [
    { file: "master_graph.json", name: "master_graph" },
    { file: "extract_manifest.json", name: "extract_manifest" },
  ];
  let touchedAny = false;
  for (const { file, name } of textFiles) {
    const source = path.join(legacyLedgerDir, file);
    try {
      if (!fs.existsSync(source)) continue;
      const raw = fs.readFileSync(source, "utf8");
      if (!raw.trim()) {
        fs.rmSync(source, { force: true }); // 空文件＝无内容可迁，直接清住址
        touchedAny = true;
        result.removed.push(file);
        continue;
      }
      derivedIndexStore.artifacts.put(name, raw);
      ledger.markSystemFile([source]);
      fs.rmSync(source, { force: true });
      touchedAny = true;
      result.imported.push(name);
      result.removed.push(file);
    } catch (error) {
      log.warn({ event: "graph-artifacts-import-failed", file, error: error.message });
    }
  }
  // master_graph.db：字节工件复制到 dataDir（不进库——SQLite 文件非行级数据）
  try {
    const dbSource = path.join(legacyLedgerDir, "master_graph.db");
    if (fs.existsSync(dbSource) && fs.statSync(dbSource).isFile()) {
      fs.mkdirSync(dataDir, { recursive: true });
      fs.copyFileSync(dbSource, path.join(dataDir, "master_graph.db"));
      ledger.markSystemFile([dbSource]);
      fs.rmSync(dbSource, { force: true });
      touchedAny = true;
      result.dbCopied = true;
      result.removed.push("master_graph.db");
    }
  } catch (error) {
    log.warn({ event: "graph-artifact-db-import-failed", error: error.message });
  }
  if (touchedAny) {
    ledger.scheduleLedger("migrate", "SPEC-012 ②类迁出（图族→derived-index.db＋data/）", [legacyLedgerDir]);
    log.info({ event: "graph-artifacts-import-done", ...result });
  }
  return result;
}

module.exports = { importLegacyRuntimeState, LEGACY_FILES };
