#!/usr/bin/env python3
"""pipeline_due.py — D2 触发判定（ADR-011／SPEC-025 C2）。

阈值（Master 2026-10-23「1 篇，1 天」）：change_count ≥ 1 或 距上次抽取 ≥ 1 天 → due。
状态经仓内唯一网关 vault-runtime/_runtime_state_db.py 的 pipeline_state 表（load_stage/save_stage）——零新状态源。

用法：
  python3 pipeline_due.py --check       # 输出 JSON {"due":bool,"reason":str,"change_count":int,"last_run_at":str|null}
  python3 pipeline_due.py --inc         # 外部写事件计数 +1（watcher 桥接调用）
  python3 pipeline_due.py --mark-run    # 抽取执行后：计数清零＋last_run_at 前移
"""
from __future__ import annotations
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

_HERE = Path(__file__).resolve().parent
for _dep in (_HERE.parents[1] / "vault-runtime",):
    _s = str(_dep)
    if _s not in sys.path:
        sys.path.insert(0, _s)

import json as _json

import _runtime_state_db as rtdb  # noqa: E402

THRESHOLD_COUNT = 1   # 1 篇变更即 due（Master 2026-10-23）
THRESHOLD_DAYS = 1    # 每日兜底

# 状态住 runtime-state.db 的 pipeline_state 表独立 key（load/save_stage 是 run_stage 专属，不得混用——
# 计数高频低价值不入 ③类 journal；执行事件由 telemetry pipeline-run 记（审计面已够）。
_KEY = "pipeline_due"


def _stage_data() -> dict:
    with rtdb.connect() as conn:
        row = conn.execute("SELECT value_json FROM pipeline_state WHERE key = ?", (_KEY,)).fetchone()
    if row:
        try:
            v = _json.loads(row[0])
            return v if isinstance(v, dict) else {}
        except _json.JSONDecodeError:
            return {}
    return {}


def _save(d: dict) -> None:
    with rtdb.connect() as conn:
        conn.execute(
            "INSERT INTO pipeline_state (key, value_json, updated_at) VALUES (?, ?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at",
            (_KEY, _json.dumps(d, ensure_ascii=False), datetime.now(timezone.utc).isoformat()),
        )
        conn.commit()


def check() -> dict:
    st = _stage_data()
    count = int(st.get("change_count") or 0)
    last = st.get("last_run_at")
    due, reason = False, ""
    if count >= THRESHOLD_COUNT:
        due, reason = True, f"change_count={count}≥{THRESHOLD_COUNT}"
    elif not last:
        due, reason = True, "首次运行（无 last_run_at）"
    else:
        try:
            elapsed = datetime.now(timezone.utc) - datetime.fromisoformat(last)
        except ValueError:
            due, reason = True, f"last_run_at 不可解析：{last}"
        else:
            if elapsed >= timedelta(days=THRESHOLD_DAYS):
                due, reason = True, f"距上次抽取 {elapsed}≥{THRESHOLD_DAYS} 天"
    return {"due": due, "reason": reason, "change_count": count, "last_run_at": last}


def inc() -> None:
    st = _stage_data()
    st["change_count"] = int(st.get("change_count") or 0) + 1
    _save(st)


def mark_run() -> None:
    st = _stage_data()
    st["change_count"] = 0
    st["last_run_at"] = datetime.now(timezone.utc).isoformat()
    _save(st)


if __name__ == "__main__":
    import json
    arg = sys.argv[1] if len(sys.argv) > 1 else "--check"
    if arg == "--inc":
        inc()
        print(json.dumps({"ok": True, "op": "inc"}, ensure_ascii=False))
    elif arg == "--mark-run":
        mark_run()
        print(json.dumps({"ok": True, "op": "mark_run"}, ensure_ascii=False))
    else:
        print(json.dumps(check(), ensure_ascii=False))
