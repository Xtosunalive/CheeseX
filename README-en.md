# cheeseh

**[中文文档](./README.md)** | English

A knowledge-governance workbench for [Obsidian](https://obsidian.md) vaults: a Node.js API + React/Vite web app that turns a plain vault of notes into a governed knowledge base — article lifecycle, entity compliance, schema registries, review workflows, and a graph pipeline with immutable releases.

> The vault (any Obsidian directory mounted via `VAULT_PATH`) is the single source of truth. cheeseh reads and writes it through one audited channel; TheSchema configuration (vocabularies, fields, ontology, relations, versions) ships in-repo at `data/theschema/`.

## Highlights

- **Content lifecycle** — submit → validate → promote → standardize (validate + restamp the candidate + freeze metadata; the immutable formal snapshot is written at publish) → map into the graph → retire, with a full audit trail
- **Entity governance** — compliance checks (F01–F17 rule set) on component/concept entities, preview-then-apply repair with optimistic locking and pre-write backups
- **Schema governance** — six registry families (vocabularies, ontology, dependencies, fields, relation ledger, product versions) behind write gateways with revision locks, git snapshots and history rollback
- **Graph & insight** — topology explorer, multi-hop impact analysis with risk classification, architecture version diff, unified document search
- **Anomaly workbench** — 12 issue kinds triaged in one place, action-routed to the right repair page
- **Approval & release** — approval state machine (approve/publish separated) plus one-click whole-repo minting (`POST /api/releases/mint`) into content-addressed immutable releases
- **Self-healing runtime** — vault file watching with provenance accounting, drift-triggered graph recomputation, boot journal replay (recovers from kill -9 with the state DB deleted), resumable pipeline runs (`--resume`)
- **Structural constraints** — registry-driven quality gates (`contracts/quality-gates.json`), writer-domain gating, contract-first API with request/response schema enforcement, five-class storage classification (① source / ② rebuildable derived / ③ replayable journal / ④ droppable trace / ⑤ audit log) + 9 registered data domains

## Quick Start

### Prerequisites

- Node.js ≥ 22.13 (uses the built-in `node:sqlite`)
- Python 3 with PyYAML (for the graph pipeline; point `PYTHON_PATH` at that interpreter)
- Any Obsidian vault directory (see Configure below)
- npm

### 1. Clone & Install

```bash
git clone https://github.com/Xtosunalive/CheeseX.git && cd CheeseX
npm install
```

### 2. Configure

```bash
cp .env.example .env
```

Edit `.env`:

| Variable | Meaning |
|---|---|
| `VAULT_PATH` | **Required.** Root of your Obsidian vault — the authoritative knowledge base. The server refuses to start without it (no silent fallback, by design). |
| `PYTHON_PATH` | Required in practice. Interpreter with PyYAML; resolution single point is `server/shared/python-path.cjs` (a bare `python3` grabbed by a PyYAML-less interpreter breaks three runtime paths — see `.env.example`). |
| `API_PORT` / `VITE_PORT` | Optional. Defaults `18083` / `5174`. |
| `THESCHEMA_DIR` | Optional. Pin the TheSchema directory (tests/CI). Default resolution: env → vault `知识库/TheSchema/` → in-repo `data/theschema/`. |

### 3. Run

```bash
npm run dev           # Node API :18083 + Vite :5174 → http://localhost:5174
npm run health:api    # GET /api/health
```

### 4. Test

```bash
npm run typecheck     # TS types
npm run lint          # ESLint (includes structural rules: write-channel, no bare fs in server/)
npm test              # frontend vitest + full Node suite (CI-equivalent)
npm run test:e2e      # browser E2E: 7 specs — six business-flow/journey specs + a persistence journey
                      # (kill -9 → delete state DB → boot replay → consistency)
```

### 5. Build

```bash
npm run build         # vite production build
```

## Project layout

```
CheeseX/
├── contracts/          # Design-time contracts: OpenAPI, JSON schemas, gate/data-domain registries
├── data/theschema/     # TheSchema main source (vocabularies, fields, ontology, relations, versions)
├── server/             # Node API: routes / services / shared (persistence, auth, vault channel)
├── shared/             # cross-stack contract modules (date contract, field labels)
├── src/                # React/Vite frontend (components / features / lib)
├── scripts/
│   ├── quality/        # quality gates and projections
│   ├── e2e/            # browser end-to-end flows
│   ├── vault-runtime/  # Python runtime driven via PYTHON_PATH (pipeline, projections, validation)
│   └── vault-py/       # graph pipeline ecosystem (extract / infer / validate / project)
└── test/fixtures/      # test fixtures (incl. a synthetic minimal vault)
```

## Contributing / Security / Changelog

- [CONTRIBUTING.md](./CONTRIBUTING.md) — environment, test layers, engineering conventions (contract-first API, single write channel, registry-driven gates)
- [SECURITY.md](./SECURITY.md) — please report vulnerabilities privately, not via public issues
- [CHANGELOG.md](./CHANGELOG.md)

## License

[MIT](./LICENSE)
