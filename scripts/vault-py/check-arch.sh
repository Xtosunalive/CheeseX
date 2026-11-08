#!/usr/bin/env bash
# Component: Pipeline-Quick-Check — 一键验证管线: extract → sync → validate
# @responsible: 三阶段快速验证（extract → sync → validate），退出码即结果，不依赖 Pipeline-Runner 全管道
# @inputs: 无
# @outputs: 通过/失败 + 退出码
# @context: A. 知识源上下文 (Vault Context)
# 用法: bash check-arch.sh
# 退出码 0 = 全部通过，非 0 = 某步失败

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
VAULT_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
ARCH_SCRIPTS="$(cd "$ARCH_SCRIPTS" 2>/dev/null && pwd || echo "$ARCH_SCRIPTS")"

echo "=== 1/3 extract_graph.py --apply ==="
python3 "$SCRIPT_DIR/extract_graph.py" --apply

echo "=== 2/3 generate-sa.py --apply ==="
python3 "$SCRIPT_DIR/generate-sa.py" --apply

echo "=== 3/3 validate-entity.py --changed ==="
python3 "$SCRIPT_DIR/validate-entity.py" --changed

echo "=== check-arch: 全部通过 ==="
