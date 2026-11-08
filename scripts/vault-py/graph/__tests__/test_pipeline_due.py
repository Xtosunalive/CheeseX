"""D2 触发判定测试（SPEC-025 C2）——阈值 1 篇/1 天（Master 2026-10-23）；状态经 vault-runtime 唯一网关 pipeline_state 表。"""
import importlib
import json
import os
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

_TMP = tempfile.mkdtemp(prefix="pd-due-")
Path(_TMP, "知识库").mkdir(parents=True, exist_ok=True)
os.environ["KB_VAULT"] = _TMP
os.environ["KB_DATA_DIR"] = str(Path(_TMP, "data"))
Path(_TMP, "data").mkdir(parents=True, exist_ok=True)  # sqlite 不建父目录
Graph = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(Graph))
sys.path.insert(0, str(Graph.parents[1] / "vault-runtime"))

import pipeline_due as pd  # noqa: E402


def _reset():
    pd._save({})


def test_first_run_due():
    _reset()
    c = pd.check()
    assert c["due"] and "首次运行" in c["reason"]


def test_one_change_due():
    pd._save({"last_run_at": datetime.now(timezone.utc).isoformat(), "change_count": 0})
    pd.inc()
    c = pd.check()
    assert c["due"] and c["change_count"] == 1


def test_stale_one_day_due():
    pd._save({"last_run_at": (datetime.now(timezone.utc) - timedelta(days=2)).isoformat(), "change_count": 0})
    assert pd.check()["due"]


def test_fresh_quiet_not_due():
    pd._save({"last_run_at": datetime.now(timezone.utc).isoformat(), "change_count": 0})
    assert not pd.check()["due"]


def test_mark_run_resets():
    pd._save({"change_count": 3, "last_run_at": None})
    pd.mark_run()
    c = pd.check()
    assert c["change_count"] == 0 and not c["due"]


def test_cli_check_json():
    _reset()
    out = subprocess.run([sys.executable, str(Graph / "pipeline_due.py"), "--check"], capture_output=True, text=True, check=True)
    assert json.loads(out.stdout)["due"] is True
