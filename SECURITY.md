# 安全策略（Security Policy）

感谢你帮助 cheeseh 保持安全。

## 支持版本

| 版本 | 支持 |
| --- | --- |
| `main` | ✅ |
| 最新 Release | ✅ |
| 更早版本 | ❌ |

## 报告漏洞

**请勿在公开 Issue 中报告安全漏洞。** 请使用 GitHub 仓库 **Security** 标签页的
**Private Vulnerability Reporting**（Advisories → Report a vulnerability）私密提交。

请在报告中尽量包含：

- 漏洞描述与潜在影响；
- 复现步骤（含请求/响应样例更佳）；
- 相关日志、截图或代码片段（注意脱敏，不要贴 `.env` 原文或真实 Vault 路径）；
- （可选）修复建议。

## 响应口径

- 我们会在 **7 天内**确认收到报告；
- 随后评估严重性、制定修复方案，并与报告者持续同步进展；
- 修复发布后，我们会协调公开披露的时机与署名（如报告者愿意）。

请给维护者合理的修复时间，避免在修复发布前公开漏洞细节。

## 部署边界（自查清单）

cheeseh 面向**单机/内网自托管**设计，公开暴露前请自查：

- API 默认只绑定 `127.0.0.1:18083`（`server/main.cjs`）；如需外网访问请置于反向代理之后，不要直接 `0.0.0.0`。
- 认证默认 `AUTH_MODE=local`（本地单用户，恒有主体）。多人/外网场景请配置 `AUTH_MODE=oidc`（`AUTH_OIDC_*` + ≥32 字节的 `AUTH_SESSION_SECRET`；配置缺失会拒绝启动——这是有意的 fail-closed）。
- `.env` 含 Vault 路径与解释器路径，不入库（`.gitignore` 已覆盖）；不要在 Issue/截图里贴真实 Vault 路径。
- Vault（`VAULT_PATH`）是知识库事实源且服务对其有写权限：只挂载给信任本服务的目录，重要数据靠 git 版本化兜底。