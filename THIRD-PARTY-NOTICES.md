# 第三方通知（Third-Party Notices）

本项目以 MIT 许可证发布（见 [LICENSE](./LICENSE)）。仓内分发的以下第三方资产按其各自许可证授权：

## 字体（SIL Open Font License 1.1）

`public/fonts/` 下自托管的字体文件采用 SIL Open Font License, Version 1.1：

- **Inter** — Copyright (c) 2016 The Inter Project Authors (https://github.com/rsms/inter)。
  许可证全文见 [public/fonts/OFL-Inter.txt](./public/fonts/OFL-Inter.txt)。
- **Nunito** — Copyright 2014 The Nunito Project Authors (https://github.com/googlefonts/nunito)。
  许可证全文见 [public/fonts/OFL-Nunito.txt](./public/fonts/OFL-Nunito.txt)。

OFL 允许随软件 bundled/分发字体，但要求保留上述版权声明与许可证文本；字体本身不得单独销售。

## 整搬件（第三方项目成件收录）

- **OpenBKN**（bkn-foundry，github.com/openbkn-ai）— Apache License 2.0，Copyright 2026 OpenBKN contributors。
  已收录：`scripts/e2e/contract-probe/api_contract_diff.py` 及其离线自测试（WP-189 整搬，适配四处见文件头注记）。归属判定（红队复核 P2-5 触发的核实，2026-11-19）：上游为 kweaver-core fork 且多许可——OpenBKN License（附加条件版）仅适用于"源码头显式引用该文件"的模块，kweaver 派生清单（BKN Engine/Context Loader/VEGA/Dataflow/Exec Factory）不含 docs/api/tools；本件无任何许可头，按上游仓根默认 LICENSE（Apache-2.0）补记归属，本文件头内 Apache-2.0 声明系本批新增而非上游原文保留；NOTICE 义务以本节登记为载体。
- **OpenMAIC**（github.com/THU-MAIC/OpenMAIC）— MIT License，Copyright (c) 2026 THU-MAIC。
  已收录：`.github/workflows/flaky-report.yml`＋`.github/scripts/flaky-report.mjs`（WP-190 整搬，适配四处见文件头与合同；上游自测试 flaky-report.test.mjs 未随本批）。
  已收录：`.github/PULL_REQUEST_TEMPLATE.md` 的「你亲自验证了什么／你没验什么」两栏字段形态（WP-191 整搬，出处注释随文件）。## npm 依赖

运行时与开发依赖各自的许可证见 `node_modules/` 内对应包的 `LICENSE` 文件，以及 `package-lock.json` 的 `license` 字段。