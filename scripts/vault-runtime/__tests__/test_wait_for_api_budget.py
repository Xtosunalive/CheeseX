"""PR-097 单元测试——wait_for_api 启动预算可配且只在失败路径生效。

层级：纯单元（桩进程直喂 wait_for_api，不启动真实服务）。
对应修复：test_pipeline_full_e2e.py 的 deadline 由硬编码 10s 改为
PIPELINE_E2E_API_TIMEOUT 可配（默认 60s）——全量链并发负载下 node 冷启
可超 10s（WP-006 集成四轮实测 1 轮"等待 API 启动超时"假红）。
"""
import io
import os
import time
import unittest

from test_pipeline_full_e2e import wait_for_api


class _StubProcess:
    """永不发 server-start 的桩进程——stdout 立即 EOF，进程常驻。"""

    def __init__(self):
        self.stdout = io.StringIO("")  # readline 立即返回空串（EOF 形态）
        self.stderr = io.StringIO("")

    def poll(self):
        return None  # 常驻未退出——逼等待循环走满预算


class WaitForApiBudgetTest(unittest.TestCase):
    def test_budget_override_takes_effect(self):
        """预算 0.2s 生效：超时报错带预算与修法指引，耗时≈预算（破坏实验：预算可配真执法）"""
        os.environ["PIPELINE_E2E_API_TIMEOUT"] = "0.2"
        try:
            started = time.time()
            with self.assertRaises(AssertionError) as ctx:
                wait_for_api(_StubProcess())
            elapsed = time.time() - started
        finally:
            os.environ.pop("PIPELINE_E2E_API_TIMEOUT", None)
        self.assertIn("预算 0s 已用尽", str(ctx.exception))
        self.assertIn("PIPELINE_E2E_API_TIMEOUT", str(ctx.exception))
        self.assertLess(elapsed, 5, "小额预算必须被尊重（0.2s 预算不得等到默认值）")

    def test_server_start_returns_port_immediately(self):
        """正常路径：收到 server-start 立即返回端口——预算加宽不拖慢过闸速度"""

        class _ReadyProcess(_StubProcess):
            def __init__(self):
                super().__init__()
                self.stdout = io.StringIO('{"event":"server-start","port":8901}\n')

        self.assertEqual(wait_for_api(_ReadyProcess()), 8901)

    def test_early_exit_reported(self):
        """API 提前退出路径保持：报 stderr 原文（诊断面不回退）"""

        class _DeadProcess(_StubProcess):
            def poll(self):
                return 1

            def __init__(self):
                super().__init__()
                self.stderr = io.StringIO("boom")

        with self.assertRaises(AssertionError) as ctx:
            wait_for_api(_DeadProcess())
        self.assertIn("API 提前退出", str(ctx.exception))
        self.assertIn("boom", str(ctx.exception))


if __name__ == "__main__":
    unittest.main()
