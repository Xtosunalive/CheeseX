# Component: _runtime_state_db
# @responsible: SPEC-012 WP-A 管线三件套的 Python 侧持久化——runtime-state.db（repo 侧 data/，SQLite）。
#   pipeline-runner（run 阶段状态/run 摘要/版本指纹）与 sa_projection_support（版本指纹）经本模块
#   读写，替代旧 .ledger/pipeline_state.json / pipeline-runs.json / pipeline_version.json 直写
#   （Node/Python 双进程同文件互踩覆写构造性消失——各占 pipeline_state 键）。
# @inputs: 环境变量 KB_DATA_DIR（服务端 spawn 注入，与 KB_VAULT 同款先例）
# @outputs: load_stage/save_stage/clear_stage、insert_run_summary、read_pipeline_version/upsert_pipeline_version
# @context: repo data 目录（与 Node sqlite-adapter 同库：WAL＋busy_timeout 跨进程并发安全）
#
# DDL 镜像纪律：本文件的 CREATE TABLE 语句是 server/shared/persistence/runtime-state-store.cjs
# 迁移 0002-pipeline 的逐字镜像（手工 CLI 先于 server 起跑时自举）；双侧漂移由
# scripts/vault-runtime/__tests__/runtime-state-ddl-parity.test.cjs 的 schema 对账测试拦截
# （PR-165 兑现——2026-10-30 前该承诺为纸面，测试并不存在）。

import json
import os
import sqlite3
from datetime import datetime, timezone

STATE_KEY_RUN_STAGE = "run_stage"
_RUNS_KEEP = 20

_DDL = """
CREATE TABLE IF NOT EXISTS pipeline_state (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pipeline_runs (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  run_ts TEXT NOT NULL,
  run_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS pipeline_version (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  version_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
"""


def data_db_path():
    """runtime-state.db 路径——data 根经 kb_paths.data_dir 单源（缺失 fail-closed 统一指引）。"""
    from kb_paths import data_dir

    return os.path.join(data_dir(), "runtime-state.db")


def connect():
    conn = sqlite3.connect(data_db_path(), timeout=5)
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.executescript(_DDL)  # 幂等自举（server 已建库时为 no-op）
    return conn


def _now():
    return datetime.now(timezone.utc).isoformat()


# ── F2 耐久性流水（SPEC-012 WP-I）：写事务后追加 vault ⑤类 state-journal.jsonl ──
# 与 Node state-journal.cjs 同文件同事件形态（{seq, family, op, args, ts}；boot 按水位统一重放）。
# seq 取文件现有最大值+1（进程内递增缓存；跨进程竞态下 seq 重复不影响正确性——重放按行序）。

_JOURNAL_PATH = None
_JOURNAL_SEQ = 0


def _journal_path():
    global _JOURNAL_PATH
    if _JOURNAL_PATH is None:
        vault_root = os.environ.get("KB_VAULT", "")
        if not vault_root:
            return None
        _JOURNAL_PATH = os.path.join(vault_root, ".ledger", "state-journal.jsonl")
        os.makedirs(os.path.dirname(_JOURNAL_PATH), exist_ok=True)
    return _JOURNAL_PATH


def _journal_init_seq():
    global _JOURNAL_SEQ
    p = _journal_path()
    if p and os.path.isfile(p):
        with open(p, encoding="utf-8") as f:
            for line in f:
                try:
                    _JOURNAL_SEQ = max(_JOURNAL_SEQ, json.loads(line).get("seq", 0))
                except Exception:
                    pass


def _journal_append(op, args):
    p = _journal_path()
    if not p:
        return  # KB_VAULT 缺失（如纯本地调用）不记流水——Python 侧流水尽力而为
    global _JOURNAL_SEQ
    if _JOURNAL_SEQ == 0:
        _journal_init_seq()
    _JOURNAL_SEQ += 1
    event = {"seq": _JOURNAL_SEQ, "family": "pipeline", "op": op, "args": args,
             "ts": datetime.now(timezone.utc).isoformat()}
    with open(p, "a", encoding="utf-8") as f:
        f.write(json.dumps(event, ensure_ascii=False) + "\n")
    # SPEC-012 F2 修复批：落账内建于流水模块本体（尾接 _vault_ledger，与 Node 侧
    # state-journal.cjs 的 scheduleLedger 同义）——「流水写者忘落账」这一类问题构造性消灭；
    # _vault_ledger 自带 VAULT_GIT_LEDGER_DISABLE 开关与 push 尽力而为，失败不抛。
    try:
        from _vault_ledger import ledger
        ledger("state-journal", "③类耐久性流水", [p])
    except Exception:
        pass  # 落账失败不阻断③类写路径；残留由 boot 漂移扫收账


# ── run 阶段状态（runner 崩溃恢复用；与 Node 的 pending_refresh 各占其键）──

def load_stage():
    with connect() as conn:
        row = conn.execute(
            "SELECT value_json FROM pipeline_state WHERE key = ?", (STATE_KEY_RUN_STAGE,)
        ).fetchone()
    if row:
        return json.loads(row[0])
    return {"last_stage": -1, "stage_data": {}}


def save_stage(stage, data=None):
    payload = {"last_stage": stage, "stage_data": data or {}, "ts": datetime.now().isoformat()}
    _journal_append("statePut", ["run_stage", payload])
    with connect() as conn:
        conn.execute(
            "INSERT INTO pipeline_state (key, value_json, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
            (STATE_KEY_RUN_STAGE, json.dumps(payload, ensure_ascii=False), _now()),
        )
        conn.commit()


def clear_stage():
    _journal_append("stateDelete", ["run_stage"])
    with connect() as conn:
        conn.execute("DELETE FROM pipeline_state WHERE key = ?", (STATE_KEY_RUN_STAGE,))
        conn.commit()


# ── run 摘要（保留最近 20 条，沿旧文件口径）──

def insert_run_summary(entry):
    _journal_append("runsInsert", [dict(entry)])
    with connect() as conn:
        conn.execute(
            "INSERT INTO pipeline_runs (run_ts, run_json) VALUES (?, ?)",
            (str(entry.get("run_ts", "")), json.dumps(entry, ensure_ascii=False)),
        )
        conn.execute(
            "DELETE FROM pipeline_runs WHERE seq NOT IN "
            "(SELECT seq FROM pipeline_runs ORDER BY seq DESC LIMIT ?)",
            (_RUNS_KEEP,),
        )
        conn.commit()


# ── 版本指纹（管线产物 SHA256；Node 读侧做 freshness 比对与发布打包物化）──

def read_pipeline_version():
    with connect() as conn:
        row = conn.execute("SELECT version_json FROM pipeline_version WHERE id = 1").fetchone()
    return json.loads(row[0]) if row else {}


def upsert_pipeline_version(payload):
    _journal_append("versionPut", [dict(payload)])
    with connect() as conn:
        conn.execute(
            "INSERT INTO pipeline_version (id, version_json, updated_at) VALUES (1, ?, ?) "
            "ON CONFLICT(id) DO UPDATE SET version_json = excluded.version_json, updated_at = excluded.updated_at",
            (json.dumps(payload, ensure_ascii=False), _now()),
        )
        conn.commit()
