// Component: Shared-Scan-Extensions（门禁扫描面扩展名集合的单一事实源）
// @responsible: PR-215 收敛——此前 check-runtime-scope.mjs 的 SCAN_EXT 与 check-defect-shapes.mjs 的 EXTS
//   各写一份同集（.py/.cjs/.mjs/.js），增删语言面时两处要记得同改。本件是唯一定义处；
//   第二份字面量由 check:defect-shapes 的 P6-F5 族判红。
// @inputs: 无（常量件）
// @outputs: SCAN_EXTENSIONS: Set<string>
// @context: Sync（纯常量，无 IO）
export const SCAN_EXTENSIONS = new Set([".mjs", ".js", ".cjs", ".py"]);
