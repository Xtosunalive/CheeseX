# @tests: pipeline-runner._candidate_api_ports（PR-133 端口候选序不变量）
# 层级：纯单元。钉死：①env API_PORT（发起方）存在时只验发起方——多实例并存不扫邻居（跨服务
# 假验证防护）；②缺席（手工跑 runner）维持 18080-18089 范围扫描；③非法值回落扫描不炸。
import os
import sys
import tempfile
from pathlib import Path

# runner 模块级 staging_path 调用 fail-closed 依赖 KB_DATA_DIR——import 前置临时住址；
# 文件名带连字符不能常规 import——importlib 按路径加载（main 守卫在，导入零执行副作用）
os.environ.setdefault("KB_DATA_DIR", tempfile.mkdtemp(prefix="api-port-test-"))
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import importlib.util  # noqa: E402

_spec = importlib.util.spec_from_file_location(
    "pipeline_runner_mod", Path(__file__).resolve().parents[1] / "pipeline-runner.py"
)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
_candidate_api_ports = _mod._candidate_api_ports


def test_preferred_single_candidate():
    assert _candidate_api_ports("18101") == [18101]


def test_absent_falls_back_to_range_scan():
    assert _candidate_api_ports(None) == list(range(18080, 18090))
    assert _candidate_api_ports("") == list(range(18080, 18090))


def test_invalid_falls_back_to_range_scan():
    assert _candidate_api_ports("not-a-port") == list(range(18080, 18090))
