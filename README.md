# CheeseX

**中文** | [English](./README-en.md)

Node.js API + React/Vite 前端：面向 Obsidian 知识库（vault）的架构图编辑与知识图谱治理界面。词表、字段、本体等 TheSchema 源数据以仓内 `data/theschema/` 为主源；运行时经 `VAULT_PATH` 读写 vault 中的 Entity 笔记与 `.ledger/` 账本（图谱 `master_graph.json`、决策与状态流水）。

## 环境要求

- Node.js ≥ 22.13（用到内置 `node:sqlite`）、npm
- Python 3（带 PyYAML，`PYTHON_PATH` 指向该解释器；已装 [uv](https://docs.astral.sh/uv/) 时建库流程可自动准备——见下）
- 一个 Obsidian Vault 目录（作为知识库）
- macOS / Windows / Linux

## 安装

```bash
git clone https://github.com/Xtosunalive/CheeseX.git && cd CheeseX
npm install
cp .env.example .env       # 按本机情况填 VAULT_PATH 与 PYTHON_PATH
npm run dev                # API 18083 + 前端 5174 → http://localhost:5174
```

首次 `npm run dev` 没有可用知识库时会问一次位置（带默认值），回车即建库并生成 `.env`（复用 `npm run vault:init`；非交互终端只给命令指引、不替你决定）。建库时若没找到带 PyYAML 的解释器，会再问一句「要现在自动准备 Python 吗？」——本机有 uv 时答 Y 即全自动装好并写进 `.env`，没装 uv 会给出安装命令。

> 本仓是**开发仓（代码仓）**：设计文档、工作包合同与开发台账放在独立的私有治理仓，普通克隆里没有 `docs/`、`.githooks/` 等目录属正常形态。维护者可用 `npm run gov:setup -- <治理仓路径> --with-hooks` 挂载治理面，详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

完整起步细节（环境变量、测试要求、工程约定）见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

### Docker（可选）

```bash
cp .env.example .env       # 填 VAULT_PATH 与 PYTHON_PATH
docker-compose up          # 构建并启动，API 18083
```

## 路径与环境变量

| 变量 | 含义 |
|------|------|
| `VAULT_PATH` | 必填。vault 根目录，Node.js API 以此为权威入口；未设置时启动 FATAL（有意为之：知识库是唯一事实源，无静默降级） |
| `PYTHON_PATH` | 实际必填。指向带 PyYAML 的 Python 解释器，解析单点 `server/shared/python-path.cjs`（裸 `python3` 被无 PyYAML 的解释器抢占时三条运行时链路会坏，详见 `.env.example` 注释） |
| `API_PORT` / `VITE_PORT` | 可选。默认 18083 / 5174 |
| `THESCHEMA_DIR` | 可选。硬钉 TheSchema 目录（测试/CI 用）。缺省解析顺序：环境注入 → vault 侧 `知识库/TheSchema/` → 仓内 `data/theschema/`（单点 `server/shared/theschema-root.cjs`） |

## 常用命令

```bash
npm run dev               # 同时启动 Node.js API 与 Vite 前端
npm run health:api        # http://127.0.0.1:18083/api/health

# 测试
npm test                  # 前端 vitest + Node 测试全量（test:frontend && test:node；Node 链含服务层 E2E，CI 同款）
npm run test:e2e          # 浏览器端到端七条旅程（清单见 scripts/e2e/run-all-e2e.mjs）
                          # 单跑：npm run test:e2e:article | dashboard | entity | review | schema

# 质量门禁（注册单：contracts/quality-gates.json）
npm run gates:ci          # CI 门禁全量（.github/workflows/quality.yml 同款）

# 治理仓挂载（仅维护者；普通克隆不需要）
npm run gov:status        # 查看挂载与 core.hooksPath 状态
npm run gov:setup -- <治理仓路径> --with-hooks

# 契约与构建
npm run gen:api-types     # OpenAPI → src/lib/generated/api-types.ts
npm run typecheck         # tsc -p tsconfig.app.json --noEmit
npm run lint              # eslint
npm run build             # vite build
```

## 目录速览

```
CheeseX/
├── contracts/            # 设计期契约：OpenAPI、各类 JSON schema、门禁/数据域注册单（唯一事实源）
├── data/theschema/       # TheSchema 主源（词表/字段/本体/关系/版本等 YAML 与数据字典）
├── server/               # Node.js API：routes / services / shared；vault-runtime → scripts/vault-runtime（符号链接）
├── shared/               # 前后端共享契约模块（日期契约、字段标签）
├── src/                  # React/Vite 前端（components/features/lib）
├── scripts/
│   ├── quality/          # 质量门禁与契约投影
│   ├── e2e/              # 浏览器端到端流程
│   ├── vault-runtime/    # API 经 PYTHON_PATH 调用的 Python 运行时脚本（管线、投影、校验）
│   └── vault-py/         # 图谱管线生态（抽取/推断/校验/投影）
└── test/fixtures/        # 测试夹具（含 minimal-vault 合成数据）
```

## 贡献

欢迎 Issue 与 PR：参与方式、本地起步、测试要求与工程约定见 [CONTRIBUTING.md](./CONTRIBUTING.md)，安全问题按 [SECURITY.md](./SECURITY.md) 的私密渠道报告。变更记录见 [CHANGELOG.md](./CHANGELOG.md)。

## 协议

本项目基于 [MIT License](./LICENSE) 发布，版权归 cheeseh contributors。第三方组件许可见 [THIRD-PARTY-NOTICES.md](./THIRD-PARTY-NOTICES.md)。
