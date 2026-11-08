// domain-test-router.mjs — pre-commit 域测试路由（单一事实源＝两份域表 tests 字段）
// @responsible: 把「暂存面触及哪个域 → 该域认领哪些测试」的判定抽成纯函数，供 .githooks/pre-commit
//   与测试共用（此前内联在钩子 heredoc，不可测）。SPEC-025 C14/W0.5：路由面扩 Python——
//   此前过滤正则仅认 .test.(cjs|mjs)，域表登记 .py 测试不会被路由执行＝假注册（登记即假绿）。
// @inputs: staged（暂存路径列表）、tables（reuse-domains/data-domains 解析后对象数组）、exists（路径存在判定，注入便于测试）
// @outputs: { node: [...], py: [...] }——两桶各自串行执行（node --test / pytest）
// 触发规则（与钩子原逻辑逐字等价）：域的 authority/contract/writers 命中暂存路径（writers 尾 "/" 为目录前缀），
//   或 tests 登记路径自身被暂存（含目录前缀）→ 该域全部登记测试入桶。悬空登记（文件不存在）不路由。
const NODE_TEST = /\.test\.(cjs|mjs)$/;
const PY_TEST = /(^|\/)(test_[^/]+\.py|[^/]+_test\.py)$/;

export function collectDomainTests({ staged, tables, exists }) {
  const node = new Set();
  const py = new Set();
  for (const t of tables) {
    for (const d of t.domains || []) {
      const files = (d.tests || []).map((c) => c.replace(/\/$/, ""));
      const touched = staged.some((s) =>
        [d.authority, d.contract, ...(d.writers || [])].some((p) => p && (String(p).includes(s) || (String(p).endsWith("/") && s.startsWith(p)))) ||
        files.some((f) => s === f || s.startsWith(f + "/")));
      if (!touched) continue;
      for (const f of files) {
        if (!exists(f)) continue;
        if (NODE_TEST.test(f)) node.add(f);
        else if (PY_TEST.test(f)) py.add(f);
      }
    }
  }
  return { node: [...node], py: [...py] };
}
