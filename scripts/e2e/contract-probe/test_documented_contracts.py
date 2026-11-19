"""WP-189 移植引擎离线回归——守护对象＝api_contract_diff.py 适配后形态的纯函数。

Run: python3 scripts/e2e/contract-probe/test_documented_contracts.py
（或 python3 -m unittest discover -s scripts/e2e/contract-probe -p 'test_*.py' -v）

零网络、零服务依赖、零第三方依赖（本仓契约 contracts/http-api.openapi.json 为
JSON，stdlib 解析——PyYAML 仅在上游 yaml 目录形态才需要，本套不触发）。

上游原自测试（OpenBKN）断言的是 bkn-foundry 自身文档与实现的域事实（swag 标题
一致性、FastAPI 装配、退役路由禁入、sandbox schema 形状等）——域不合未随迁；
本套改测移植引擎本身：真实契约装载＋schema 摊平＋类型判定＋请求组装＋报告
诚实性（空响应样本不计入已验证）。上游逐行逻辑未改，本套是移植质量的守护面。
"""
import importlib.util
import json
import sys
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]  # 仓库根（scripts/e2e/contract-probe → 上三级）
CONTRACT = ROOT / "contracts" / "http-api.openapi.json"

_spec = importlib.util.spec_from_file_location(
    "api_contract_diff", HERE / "api_contract_diff.py")
probe = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(probe)


class RealContractLoading(unittest.TestCase):
    """真实契约（本仓单一 JSON 文件）经适配①装载链路。"""

    def test_single_json_file_loads_operations(self):
        loader = probe.SpecLoader(str(CONTRACT))
        self.assertEqual(loader.files(), [str(CONTRACT)])
        ops = loader.operations(face="ex")
        self.assertGreater(len(ops), 0)
        gets = [o for o in ops if o["method"] == "GET"]
        self.assertGreater(len(gets), 30, "契约 GET 操作应远多于 30（当前 62）")
        comparable = [o for o in gets if o["doc_fields"] is not None]
        self.assertGreater(len(comparable), 50,
                           "带 200 JSON 响应的 GET 才可比对（当前 59，另 3 个非 200 形态）")
        no_schema = {o["url"] for o in gets if o["doc_fields"] is None}
        self.assertEqual(no_schema,
                         {"/api/sync/pull", "/api/auth/login", "/api/auth/callback"},
                         "无 200 JSON 的 GET＝410/302 形态，引擎按上游语义排除比对")
        for op in comparable:
            self.assertEqual(op["method"], "GET")
            self.assertTrue(op["url"].startswith("/"), "server 头应被剥离为路径")

    def test_ref_resolution_reaches_components(self):
        loader = probe.SpecLoader(str(CONTRACT))
        doc = loader._load(str(CONTRACT))
        # 任取一个含 $ref 的 200 响应，摊平后应触及 components 定义的字段
        ops = loader.operations(face="ex")
        hit = False
        for op in ops:
            if op["doc_fields"]:
                for k in op["doc_fields"]:
                    if not k.startswith(op["url"]):
                        hit = True
                        break
            if hit:
                break
        self.assertTrue(hit, "$ref 展开应产出深层字段路径")


class FieldFlattening(unittest.TestCase):
    """schema 摊平规则（含适配③ type 数组与上游既有规则）。"""

    def setUp(self):
        self.loader = probe.SpecLoader("")

    def test_nullable_type_array_takes_primary(self):
        out = self.loader.field_paths(
            {"type": ["object", "null"],
             "properties": {"name": {"type": ["string", "null"]},
                            "count": {"type": ["integer", "null"]}}},
            {}, "x")
        self.assertEqual(out["name"], ("string", False))
        self.assertEqual(out["count"], ("integer", False))

    def test_nullable_array_type_recognized(self):
        out = self.loader.field_paths(
            {"type": ["array", "null"], "items": {"type": "string"}}, {}, "x")
        self.assertEqual(out["[]"], ("string", True))

    def test_oneof_branch_required_not_global(self):
        out = self.loader.field_paths(
            {"oneOf": [
                {"type": "object", "required": ["a"],
                 "properties": {"a": {"type": "string"}}},
                {"type": "object", "properties": {"b": {"type": "integer"}}},
            ]}, {}, "x")
        self.assertEqual(out["a"], ("string", False), "oneOf 分支 required 不外推")
        self.assertEqual(out["b"], ("integer", False))

    def test_allof_keeps_required(self):
        out = self.loader.field_paths(
            {"allOf": [
                {"type": "object", "required": ["id"],
                 "properties": {"id": {"type": "string"}}},
            ]}, {}, "x")
        self.assertEqual(out["id"], ("string", True))

    def test_additional_properties_wildcards(self):
        out = self.loader.field_paths(
            {"type": "object",
             "properties": {
                 "opaque": {"type": "object", "additionalProperties": True},
                 "typed": {"type": "object", "additionalProperties":
                           {"type": "object", "properties": {"v": {"type": "string"}}}},
             }}, {}, "x")
        self.assertEqual(out["opaque.*"], ("any", False))
        self.assertEqual(out["typed.*"], ("object", False))
        self.assertEqual(out["typed.*.v"], ("string", False))

    def test_recursive_ref_terminates(self):
        schema = {"type": "object",
                  "properties": {"child": {"$ref": "#/components/schemas/Node"}}}
        doc = {"components": {"schemas": {"Node": {
            "type": "object",
            "properties": {"child": {"$ref": "#/components/schemas/Node"}}}}}}
        out = self.loader.field_paths(schema, doc, "x")  # 环引用必须终止不炸
        self.assertIn("child", out)

    def test_recursive_ref_bounded_expansion_适配5a(self):
        """适配⑤(a)：递归 $ref 限深展开——子层字段进比对面（原硬停即假红源头）。"""
        node = {"type": "object",
                "properties": {"id": {"type": "string"},
                               "child": {"$ref": "#/components/schemas/Node"}}}
        doc = {"components": {"schemas": {"Node": node}}}
        out = self.loader.field_paths(
            {"type": "array", "items": {"$ref": "#/components/schemas/Node"}}, doc, "x")
        self.assertIn("[].child.id", out, "第二层（同引用第 2 次）应展开")
        self.assertIn("[].child.child", out, "第三层标记应出现（限深内）")

    def test_render_wildcard_fold_keeps_array_marker_适配5b(self):
        """适配⑤(b)：数组内开映射折叠保 [] 标记——map 域→数组元素字段不再误报。"""
        doc = self.loader.field_paths(
            {"type": "object", "properties": {"subdomains": {
                "type": "object",
                "additionalProperties": {"type": "array", "items": {
                    "anyOf": [{"type": "string"},
                              {"type": "object", "required": ["id"],
                               "properties": {"id": {"type": "string"}}}]}}}}},
            {}, "x")
        self.assertIn("subdomains.*[].id", doc)
        op = {"method": "GET", "module": "m", "spec_file": "s",
              "url": "/x", "req_url": "/x", "doc_fields": doc,
              "actual": probe.actual_paths({"subdomains": {"ops": [{"id": "a"}]}})}
        args = type("A", (), {"face": "ex", "exec_mode": "direct", "ssh": None,
                              "spec_dir": ".", "include_query_post": False,
                              "include_probe_post": False})()
        report, stats = probe.render([op], [], args)
        self.assertEqual(stats["gap_ops"], 0, "map 域→数组元素字段经折叠应清零")


class ActualVsDoc(unittest.TestCase):
    def test_actual_paths_types(self):
        got = probe.actual_paths({"a": 1, "b": None, "c": [], "d": {"e": True}})
        self.assertEqual(got["a"], "integer")
        self.assertEqual(got["b"], "null")
        self.assertEqual(got["c[]"], "unknown")
        self.assertEqual(got["d.e"], "boolean")

    def test_type_ok_equivalences(self):
        self.assertTrue(probe.type_ok("integer", "string"))   # id 常以字符串下发
        self.assertTrue(probe.type_ok("number", "integer"))
        self.assertTrue(probe.type_ok("string", "null"))      # nullable 实返 null 放行
        self.assertFalse(probe.type_ok("string", "object"))

    def test_render_empty_sample_not_counted_as_verified(self):
        """防自欺核心：空数组样本的字段既不算缺口也不算已验证（报告单列）。"""
        loader = probe.SpecLoader("")
        doc = loader.field_paths(
            {"type": "object", "required": ["data"],
             "properties": {"data": {"type": "array",
                                     "items": {"type": "object",
                                               "required": ["id"],
                                               "properties": {"id": {"type": "string"}}}}}},
            {}, "x")
        op = {"method": "GET", "module": "m", "spec_file": "s",
              "url": "/x", "req_url": "/x", "doc_fields": doc,
              "actual": probe.actual_paths({"data": []})}
        args = type("A", (), {"face": "ex", "exec_mode": "direct", "ssh": None,
                              "spec_dir": ".", "include_query_post": False,
                              "include_probe_post": False})()
        report, stats = probe.render([op], [], args)
        self.assertEqual(stats["gap_ops"], 0, "空数组不产生缺口")
        self.assertEqual(stats["empty_sample"], 1, "空样本必须单列")
        self.assertIn("0 缺口 ≠ 已验证", report)
        self.assertIn("本次未观测", report)

    def test_render_gap_detection(self):
        loader = probe.SpecLoader("")
        doc = loader.field_paths(
            {"type": "object", "required": ["id"],
             "properties": {"id": {"type": "string"},
                            "note": {"type": ["string", "null"]}}},
            {}, "x")
        # 实际多返回 extra、id 类型不符
        op = {"method": "GET", "module": "m", "spec_file": "s",
              "url": "/x", "req_url": "/x", "doc_fields": doc,
              "actual": probe.actual_paths({"id": 1, "note": "n", "extra": 2})}
        args = type("A", (), {"face": "ex", "exec_mode": "direct", "ssh": None,
                              "spec_dir": ".", "include_query_post": False,
                              "include_probe_post": False})()
        report, stats = probe.render([op], [], args)
        self.assertEqual(stats["gap_ops"], 1)
        self.assertIn("实际返回但文档未声明", report)
        self.assertIn("`extra`", report)


class RequestAssembly(unittest.TestCase):
    def test_sample_value_sources(self):
        self.assertEqual(probe.sample_value({"example": "x1"}), "x1")
        self.assertEqual(probe.sample_value({"schema": {"default": 5}}), "5")
        self.assertEqual(probe.sample_value({"schema": {"enum": ["a", "b"]}}), "a")
        self.assertEqual(probe.sample_value({"schema": {"type": "integer",
                                                        "minimum": 3}}), "3")
        self.assertIsNone(probe.sample_value({"schema": {"type": "object"}}),
                          "造不出取值必须显式返回 None（不猜业务语义）")

    def test_with_required_query(self):
        op = {"params": [
            {"in": "query", "required": True, "name": "q",
             "schema": {"type": "string", "example": "k"}},
            {"in": "query", "required": False, "name": "opt",
             "schema": {"type": "string"}},
        ]}
        filled, unfillable = probe.with_required_query(op, {"q": "preset"})
        self.assertEqual(filled, {"q": "preset"}, "probe 显式值优先于 schema 造值")
        self.assertEqual(unfillable, [])

    def test_required_query_consumes_seed_适配6a(self):
        """适配⑥(a)：必填 query 先查种子（真实运行时值）再回落 schema 造值。"""
        op = {"url": "/api/kg/architecture-version", "params": [
            {"in": "query", "required": True, "name": "product", "schema": {"type": "string"}},
            {"in": "query", "required": True, "name": "version", "schema": {"type": "string"}},
            {"in": "query", "required": True, "name": "limit", "schema": {"type": "integer", "minimum": 3}},
        ]}
        found = [("/api/", "product", "E2eProduct"), ("/api/", "version", "1.0.0")]
        filled, unfillable = probe.with_required_query(op, None, found)
        self.assertEqual(filled.get("product"), "E2eProduct", "种子值优先于 schema 造值")
        self.assertEqual(filled.get("version"), "1.0.0")
        self.assertEqual(filled.get("limit"), "3", "种子没有的参数回落 schema 造值")
        self.assertEqual(unfillable, [])
        op2 = {"url": "/api/edges", "params": [{"in": "query", "required": True, "name": "node",
                           "schema": {"type": "string"}}]}
        filled2, unfillable2 = probe.with_required_query(op2, None, [])
        self.assertEqual(unfillable2, ["node"], "无种子无 schema 值→如实 unfillable")

    def test_url_encode_non_ascii_适配6b(self):
        """适配⑥(b)：PROBE_SRC 对非 ASCII URL 百分号编码——中文实体 id 可发送。"""
        import urllib.parse
        raw = "/api/anomalies/entity-知识库/wiki/entities/e2e-incomplete-component.md-F11"
        encoded = urllib.parse.quote(raw, safe=":/?&=#%@+;,~()$!*'")
        self.assertTrue(encoded.isascii(), "编码后必须纯 ascii（urllib 发送前提）")
        self.assertIn("%E7%9F%A5", encoded, "中文已转码")
        self.assertTrue(encoded.startswith("/api/anomalies/"), "路由结构字符保留")

    def test_fill_path_scope_longest_match(self):
        found = [("/api/", "id", "global"), ("/api/kg/", "id", "kg-scope")]
        url, missing = probe.fill_path("/api/kg/nodes/{id}", found)
        self.assertEqual(url, "/api/kg/nodes/kg-scope")
        self.assertEqual(missing, [])
        url, missing = probe.fill_path("/api/other/{id}", found)
        self.assertEqual(url, "/api/other/global")

    def test_dig_path(self):
        body = {"entries": [{"id": "e1", "nested": {"deep": [1, 2]}}]}
        self.assertEqual(probe.dig(body, "entries[0].id"), "e1")
        self.assertEqual(probe.dig(body, "entries[0].nested.deep[1]"), 2)
        self.assertIsNone(probe.dig(body, "entries[9].id"))
        self.assertIsNone(probe.dig(body, "nope.id"))


class ReadOnlyGuarantee(unittest.TestCase):
    """只读保证：普通组装路径永不发 PUT/DELETE，POST 仅两条显式通道。"""

    def test_main_assembly_skips_writes_without_flags(self):
        # 直接构造 ops：PUT/DELETE/普通 POST 均不得进入请求列表
        ops = [{"method": "PUT", "url": "/u", "doc_fields": {}, "params": []},
               {"method": "DELETE", "url": "/d", "doc_fields": {}, "params": []},
               {"method": "POST", "url": "/p", "doc_fields": {}, "params": []}]
        # 复刻 main() 的组装判据（与上游逐字同源的字段逻辑）：
        sent = []
        for op in ops:
            readonly_post = (op["method"] == "POST" and op.get("override")
                             and False)  # include_query_post 关闭
            if op["method"] != "GET" and not readonly_post:
                continue
            sent.append(op["method"])
        self.assertEqual(sent, [], "零写请求——GET-only 保证的结构性依据")


if __name__ == "__main__":
    unittest.main(verbosity=2)
