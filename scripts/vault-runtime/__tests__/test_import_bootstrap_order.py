# @tests: scripts/vault-py/** 模块导入自举顺序不变量（PR-132／WP-025 静态扫描回归）
# 层级：纯单元（AST 静态断言，零执行零 IO 副作用）。
# 钉死两条不变量（65aee107 写者迁移批两度踩中，真库重建 stage 3.5 全断）：
#   ①顺序：vault-py 脚本对 vault-runtime 模块（write_gateway/kb_paths/schema_loader 等）的导入，
#     必须晚于本文件内全部 sys.path 自举语句——自举前导入＝找不到模块必炸；
#   ②锚点：自举取 parents[N]（N≥1）的锚变量必须锚在目录（Path(...).resolve().parent），
#     禁止锚在文件本身（Path(...).resolve() 直接 parents[1]＝差一层，指向不存在目录）。
# 运行态模块清单从 scripts/vault-runtime/*.py 动态派生——新模块自动纳管，无需改本测试。
import ast
import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
VAULT_PY = REPO_ROOT / "scripts" / "vault-py"
RUNTIME_DIR = REPO_ROOT / "scripts" / "vault-runtime"

RUNTIME_MODULES = {p.stem for p in RUNTIME_DIR.glob("*.py") if p.stem != "__init__"}
PATH_INSERT_RE = re.compile(r"(?:_sys|sys)\.path\.(?:insert|append)")


def _runtime_import_lines(tree):
    lines = []
    for node in tree.body:
        if isinstance(node, ast.ImportFrom) and node.module and node.module.split(".")[0] in RUNTIME_MODULES:
            lines.append(node.lineno)
        elif isinstance(node, ast.Import):
            if any(a.name.split(".")[0] in RUNTIME_MODULES for a in node.names):
                lines.append(node.lineno)
    return lines


def _bootstrap_lines(tree):
    """顶层自举语句行号（For/If 内含 path.insert；按语句末行计——导入须在其后）"""
    lines = []
    for node in tree.body:
        if isinstance(node, (ast.For, ast.If)):
            if PATH_INSERT_RE.search(ast.unparse(node)):
                lines.append(node.end_lineno or node.lineno)
    return lines


def _anchor_violations(tree, source_lines):
    """锚在文件本身的变量被取 parents[N] 解析 vault-runtime＝差一层（只盯 vault-runtime 目标——
    文件锚 parents[3] 取仓根等合法用法不误伤）"""
    dir_anchors, file_anchors, violations = set(), set(), []
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
            name = node.targets[0].id
            src = ast.unparse(node.value)
            if ".resolve()" not in src:
                continue
            if src.endswith(".parent") or src.endswith(".parents[0]"):
                dir_anchors.add(name)
            elif "__file__" in src:
                file_anchors.add(name)
    for node in ast.walk(tree):
        if (isinstance(node, ast.Attribute) and node.attr == "parents"
                and isinstance(node.value, ast.Name) and node.value.id in file_anchors
                and "vault-runtime" in source_lines[node.lineno - 1]):
            violations.append(node.lineno)
    return violations


INLINE_FILE_ANCHOR_RE = re.compile(r"__file__\s*\)\s*\.resolve\(\)\s*\.parents\[\d+\]\s*/\s*[\"']vault-runtime[\"']")


def test_import_bootstrap_order_and_anchor():
    assert RUNTIME_MODULES, "vault-runtime 模块清单为空——测试自身失明"
    problems = []
    scanned = 0
    for f in sorted(VAULT_PY.rglob("*.py")):
        if "__tests__" in f.parts:
            continue
        scanned += 1
        source_lines = f.read_text(encoding="utf-8").splitlines()
        tree = ast.parse("\n".join(source_lines), filename=str(f))
        imports = _runtime_import_lines(tree)
        boots = _bootstrap_lines(tree)
        rel = f.relative_to(REPO_ROOT)
        if imports and boots and min(imports) <= max(boots):
            problems.append(f"{rel}:{min(imports)} 违反①顺序——runtime 模块导入(line {imports})不在自举(line ≤{max(boots)})之后")
        for line in _anchor_violations(tree, source_lines):
            problems.append(f"{rel}:{line} 违反②锚点——parents[N] 锚在文件路径解析 vault-runtime（差一层，指向不存在目录）")
        for m in INLINE_FILE_ANCHOR_RE.finditer(f.read_text(encoding="utf-8")):
            problems.append(f"{rel} 违反②锚点（内联）——__file__.resolve().parents[N] 差一层")
    assert not problems, f"导入自举不变量违例 {len(problems)} 处（扫描 {scanned} 文件）:\n" + "\n".join(problems)
