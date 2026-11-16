// Component: document-index 生产库污染哨兵（PR-327 验收收口——测试隔离加固的检测面）
// @responsible: 生产 document_index（checkout data/master_graph.db）不得含指向不存在文件的行——
//               PR-327 事故形态（测试未隔离 KB_DATA_DIR 把 fixture 行写进生产库）一旦复发即本哨兵红。
// @inputs: checkout data/master_graph.db（KB_DATA_DIR 未注入时的默认生产库；不存在=非本机常态，skip）
// @outputs: node:test 断言（生产库存在时执法）
// @context: PR-327（fixture 行写穿生产库→管道一致性预检拦停整条管道）；数据面已外科修复，本哨兵防复发。
// 注意：本哨兵只读，不修复；修复走 validate-document-index 报告＋外科清除（PR-327 同款）。
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { DatabaseSync } from "node:sqlite";

const REPO_ROOT = path.resolve(import.meta.dirname, "..", "..", "..", "..");
const PROD_DB = path.join(REPO_ROOT, "data", "master_graph.db");

function resolveVaultPath() {
  const injected = process.env.VAULT_PATH;
  if (injected) return injected;
  const envFile = path.join(REPO_ROOT, ".env");
  if (fs.existsSync(envFile)) {
    const match = fs.readFileSync(envFile, "utf8").match(/^VAULT_PATH=(.+)$/m);
    if (match) return match[1].trim();
  }
  return null;
}

test("PR-327 哨兵：生产 document_index 无指向不存在文件的行（fixture/e2e 污染形态检测）", (t) => {
  const vaultPath = resolveVaultPath();
  if (!vaultPath || !fs.existsSync(PROD_DB)) {
    t.skip(`非本机常态（VAULT_PATH 或生产 master_graph.db 缺席）：${PROD_DB}`);
    return;
  }
  const db = new DatabaseSync(PROD_DB, { readOnly: true });
  try {
    const rows = db.prepare("SELECT node_id, file_path FROM document_index").all();
    const unsafe = rows.filter((row) => {
      const rel = String(row.file_path || "").replace(/^\/+/, "");
      return !fs.existsSync(path.join(vaultPath, rel));
    });
    assert.deepEqual(
      unsafe.map((row) => row.node_id),
      [],
      `生产 document_index 存在指向不存在文件的行（PR-327 污染形态复发）：${JSON.stringify(unsafe)}`,
    );
  } finally {
    db.close();
  }
});
