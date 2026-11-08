# 贡献指南（Contributing to cheeseh）

感谢你关注 cheeseh——面向 Obsidian 知识库的知识治理工作台。欢迎 Issue 与 PR。

## 如何参与

- Bug / 疑问：先搜 [Issues](../../issues)，没有再提（用 Bug 报告模板）。
- 新功能：先开 Feature Request 讨论方向，达成一致再动工。
- 小问题（文案/文档/明显小 bug）可直接提 PR。

## 环境要求

- Node.js ≥ 22.13（含内置 `node:sqlite` DatabaseSync；`package.json` engines 声明 `>=22`，实用下限 22.13 见 `sqlite-adapter.cjs:9`）
- Python 3（图谱管线子进程需要，用 `PYTHON_PATH` 指定解释器）；运行时最小依赖 PyYAML，完整 provision 单源＝`scripts/vault-init.mjs` 的 `PYTHON_PROVISION_PACKAGES`（pyyaml/pytest/jsonschema/ruamel.yaml），`npm run vault:init` 经 uv 备 venv＋安装
- 一个 Obsidian Vault 目录（作为知识库；见下方环境变量）
- npm（本仓非 pnpm workspace）

## 本地起步

```bash
git clone https://github.com/Xtosunalive/cheeseX.git && cd cheeseX
npm install

cp .env.example .env
# 编辑 .env：
#   VAULT_PATH   必填——Obsidian Vault 根目录（知识库事实源）
#   PYTHON_PATH  必填——带 PyYAML 的 Python 解释器路径
#   可选：API_PORT（默认 18083）/ VITE_PORT（默认 5174）

npm run dev        # 同时启动 Node API(:18083) 与 Vite(:5174) → http://localhost:5174
npm run health:api # 健康自检
```

> 未设置 VAULT_PATH 时服务会 FATAL 退出（有意为之：知识库是唯一事实源，无静默降级）。

## 测试（提交前三层）

```bash
npm run typecheck   # TS 类型
npm run lint        # ESLint（含 server 写通道/裸 fs 等结构性规则）
npm test            # 前端 vitest + Node 服务端全量
npm run test:e2e    # 浏览器端到端 7 条（6 业务流/旅程 + 1 持久化旅程；较慢，改到关键链路时跑）
```

## 工程约定（影响 PR 是否被收）

1. **契约优先**：改 HTTP API 先改 `contracts/http-api.openapi.json`，再 `npm run gen:api-types` 重生成前端类型——禁止手改 `src/lib/generated/`。
2. **写通道唯一**：服务端写 Vault 必经 `server/shared/vault-io.cjs`（凭据制）；写 SQLite 必经 `server/shared/persistence/*` store；直连 `fs`/裸 SQL 会被 lint 与门禁拦下。
3. **数据域登记**：新增数据落点先在 `contracts/data-domains.json` 登记六件（五件套＋住址枚举 `store_location`，门禁对账）。
4. **前端路由**：页面跳转一律经 `src/lib/navigation.ts` 的 `navigate()`（登记制，门禁执法）。
5. **质量门禁**：CI 按 `contracts/quality-gates.json` 注册表执行（`npm run gates:ci` 本地同款）；红灯不合并。
6. 提交信息用简洁祈使句；一个 PR 聚焦一件事。

## 目录速览

| 路径 | 内容 |
|---|---|
| `server/` | Node API（Fastify，CommonJS）：routes/services/shared/persistence |
| `src/` | React 18 + Vite 前端（features 按页面域组织） |
| `scripts/vault-py/`、`server/vault-runtime/` | Python 图谱管线（抽取/推断/投影） |
| `contracts/` | OpenAPI、TheSchema schema、门禁/数据域等契约注册表 |
| `data/theschema/` | TheSchema 默认主源（词表/本体/依赖/字段等 YAML） |
| `docs/` | 设计与系统文档 |

## 行为准则

保持专业与善意；对事不对人。报告安全漏洞请勿开公开 Issue，走 [SECURITY.md](./SECURITY.md)。
